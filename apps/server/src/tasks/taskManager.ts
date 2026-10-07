import type {
  Artifact,
  Attachment,
  Confirmation,
  Task,
  TaskDetail,
  TaskEvent,
  TaskEventPayload,
  TaskStatus,
  TaskUsage,
} from '@solar/shared';
import { EMPTY_USAGE, TERMINAL_TASK_STATUSES } from '@solar/shared';
import { createLogger } from '../logger.js';
import type { Repository } from '../storage/repository.js';
import { newId, nowIso } from '../util/ids.js';
import type { ArtifactService, NewArtifact } from './artifactService.js';
import type { EventBus } from './eventBus.js';

const log = createLogger('tasks');

export interface ConfirmationRequest {
  toolUseId: string;
  tool: string;
  displayName: string;
  pluginId: string | null;
  pluginName: string | null;
  reason: string;
  input: unknown;
}

export interface ConfirmationDecision {
  approved: boolean;
  note: string | null;
  /** True when nobody answered before CONFIRMATION_TIMEOUT_MINUTES elapsed. */
  expired?: boolean;
}

/** Everything the agent needs while executing one task. */
export interface TaskRunContext {
  readonly task: Task;
  readonly signal: AbortSignal;
  readonly sessionContext: string;
  /** Documents attached to this task, in the order the user attached them. */
  readonly attachments: Attachment[];
  emit(payload: TaskEventPayload): Promise<void>;
  delta(text: string, channel?: 'text' | 'thinking'): void;
  /** Updates the "current step" shown in the UI without adding a timeline event. */
  step(step: string): Promise<void>;
  progress(progress: number, step: string, detail?: string): Promise<void>;
  addUsage(usage: Omit<TaskUsage, 'costUsd' | 'apiCalls'> & { costUsd: number }): Promise<void>;
  createArtifact(input: Omit<NewArtifact, 'taskId'>): Promise<Artifact>;
  listArtifacts(): Promise<Artifact[]>;
  confirm(request: ConfirmationRequest): Promise<ConfirmationDecision>;
}

export type TaskRunner = (ctx: TaskRunContext) => Promise<{ result: string }>;

interface ActiveTask {
  task: Task;
  controller: AbortController;
  pendingConfirmations: number;
}

interface PendingConfirmation {
  confirmation: Confirmation;
  resolve: (decision: ConfirmationDecision) => void;
}

export class TaskManager {
  private readonly active = new Map<string, ActiveTask>();
  private readonly seq = new Map<string, number>();
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly queue: string[] = [];
  private running = 0;
  private runner: TaskRunner | null = null;

  constructor(
    private readonly repo: Repository,
    private readonly artifacts: ArtifactService,
    private readonly bus: EventBus,
    private readonly options: { concurrency: number; model: string; confirmationTimeoutMs: number },
  ) {}

  setRunner(runner: TaskRunner): void {
    this.runner = runner;
  }

  /** Marks tasks that were left running by a previous process as failed. */
  async recoverInterrupted(): Promise<void> {
    for (const status of ['queued', 'running', 'awaiting_confirmation'] as TaskStatus[]) {
      const stale = await this.repo.listTasks({ limit: 500, status });
      for (const task of stale) {
        const updated: Task = {
          ...task,
          status: 'failed',
          error: 'Task terhenti karena server SOLAR di-restart. Silakan kirim ulang permintaannya.',
          finishedAt: nowIso(),
        };
        await this.repo.upsertTask(updated);
        log.warn(`Recovered interrupted task ${task.id}`);
      }
    }
    for (const c of await this.repo.listConfirmations({ status: 'pending' })) {
      await this.repo.upsertConfirmation({ ...c, status: 'expired', resolvedAt: nowIso(), note: 'Server di-restart' });
    }
  }

  async create(prompt: string, sessionId: string, attachmentIds: string[] = []): Promise<Task> {
    const firstLine = prompt.trim().split(/\r?\n/)[0] ?? '';
    const title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}...` : firstLine || 'Untitled task';
    const task: Task = {
      id: newId('task'),
      sessionId,
      title,
      prompt,
      status: 'queued',
      progress: 0,
      currentStep: 'Menunggu antrean',
      model: this.options.model,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      usage: { ...EMPTY_USAGE },
      attachmentIds: [...new Set(attachmentIds)],
    };
    await this.repo.upsertTask(task);
    this.seq.set(task.id, 0);
    this.bus.publish({ kind: 'task', task });
    await this.emit(task.id, { type: 'status', status: 'queued', message: 'Task dibuat' });
    this.queue.push(task.id);
    this.pump();
    return task;
  }

  async get(id: string): Promise<Task | null> {
    return this.active.get(id)?.task ?? (await this.repo.getTask(id));
  }

  async detail(id: string): Promise<TaskDetail | null> {
    const task = await this.get(id);
    if (!task) return null;
    const [events, artifacts, confirmations, attachments] = await Promise.all([
      this.repo.listEvents(id),
      this.repo.listArtifacts(id),
      this.repo.listConfirmations({ taskId: id }),
      this.attachmentsOf(task),
    ]);
    return { task, events, artifacts, confirmations, attachments };
  }

  async cancel(id: string): Promise<boolean> {
    const queuedIndex = this.queue.indexOf(id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const task = await this.repo.getTask(id);
      if (task) await this.finish(task, 'cancelled', { error: 'Dibatalkan oleh pengguna' });
      return true;
    }
    const active = this.active.get(id);
    if (!active) return false;
    active.controller.abort(new Error('Dibatalkan oleh pengguna'));
    for (const p of this.pending.values()) {
      if (p.confirmation.taskId === id) p.resolve({ approved: false, note: 'Task dibatalkan' });
    }
    return true;
  }

  pendingConfirmations(): Confirmation[] {
    return [...this.pending.values()].map((p) => p.confirmation);
  }

  resolveConfirmation(id: string, approved: boolean, note: string | null): Confirmation | null {
    const p = this.pending.get(id);
    if (!p) return null;
    p.resolve({ approved, note });
    return p.confirmation;
  }

  // -------------------------------------------------------------------------

  private pump(): void {
    while (this.running < this.options.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running += 1;
      void this.execute(id)
        .catch((err) => log.error(`Task ${id} crashed`, err))
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }

  private async execute(id: string): Promise<void> {
    const stored = await this.repo.getTask(id);
    if (!stored || stored.status !== 'queued') return;
    if (!this.runner) throw new Error('Task runner not configured');

    const controller = new AbortController();
    const active: ActiveTask = {
      task: { ...stored, status: 'running', startedAt: nowIso(), currentStep: 'Memulai' },
      controller,
      pendingConfirmations: 0,
    };
    this.active.set(id, active);
    const runner = this.runner;
    try {
      // everything that touches storage stays inside the try: a database outage fails this task, not the process
      await this.save(active.task);
      await this.emit(id, { type: 'status', status: 'running', message: 'Agent mulai bekerja' });
      const ctx = this.buildContext(active, await this.buildSessionContext(stored), await this.attachmentsOf(stored));
      const { result } = await runner(ctx);
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Dibatalkan');
      await this.finish(active.task, 'completed', { result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        if (controller.signal.aborted) {
          await this.finish(active.task, 'cancelled', { error: message || 'Dibatalkan oleh pengguna' });
        } else {
          log.error(`Task ${id} failed`, err);
          await this.emit(id, { type: 'error', message });
          await this.finish(active.task, 'failed', { error: message });
        }
      } catch (recordErr) {
        log.error(`Task ${id}: the final status could not be stored`, recordErr);
      }
    } finally {
      this.active.delete(id);
      for (const [cid, p] of this.pending) {
        if (p.confirmation.taskId === id) {
          p.resolve({ approved: false, note: 'Task sudah selesai' });
          this.pending.delete(cid);
        }
      }
    }
  }

  private async finish(
    task: Task,
    status: Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>,
    patch: { result?: string; error?: string },
  ): Promise<void> {
    const finished: Task = {
      ...task,
      status,
      progress: status === 'completed' ? 100 : task.progress,
      currentStep: status === 'completed' ? 'Selesai' : status === 'cancelled' ? 'Dibatalkan' : 'Gagal',
      result: patch.result ?? task.result,
      error: patch.error ?? null,
      finishedAt: nowIso(),
    };
    await this.save(finished);
    if (status === 'completed' && patch.result !== undefined) {
      await this.emit(task.id, { type: 'result', text: patch.result });
    }
    await this.emit(task.id, { type: 'status', status, message: patch.error });
  }

  private async save(task: Task): Promise<void> {
    const active = this.active.get(task.id);
    if (active) active.task = task;
    await this.repo.upsertTask(task);
    this.bus.publish({ kind: 'task', task });
  }

  private async emit(taskId: string, payload: TaskEventPayload): Promise<TaskEvent> {
    let seq = this.seq.get(taskId);
    if (seq === undefined) seq = (await this.repo.listEvents(taskId)).length;
    seq += 1;
    this.seq.set(taskId, seq);
    const event = { ...payload, id: newId('evt'), taskId, seq, at: nowIso() } as TaskEvent;
    await this.repo.appendEvent(event);
    this.bus.publish({ kind: 'event', event });
    return event;
  }

  /** The task's attachments in the order they were attached. */
  private async attachmentsOf(task: Task): Promise<Attachment[]> {
    const ids = task.attachmentIds ?? [];
    if (ids.length === 0) return [];
    const found = new Map((await this.repo.listAttachments({ ids })).map((a) => [a.id, a]));
    const list = ids.map((id) => found.get(id)).filter((a): a is Attachment => Boolean(a));
    if (list.length < ids.length) log.warn(`Task ${task.id}: ${ids.length - list.length} attached document(s) no longer exist`);
    return list;
  }

  private async buildSessionContext(task: Task): Promise<string> {
    const previous = (await this.repo.listTasks({ limit: 6, sessionId: task.sessionId }))
      .filter((t) => t.id !== task.id && TERMINAL_TASK_STATUSES.includes(t.status))
      .slice(0, 5)
      .reverse();
    if (previous.length === 0) return '';
    const parts: string[] = [];
    for (const t of previous) {
      const artifacts = await this.repo.listArtifacts(t.id);
      const attached = await this.attachmentsOf(t);
      const answer = (t.result ?? t.error ?? '').trim();
      parts.push(
        [
          `<previous_task id="${t.id}" status="${t.status}" created="${t.createdAt}">`,
          `<user_request>\n${t.prompt.trim()}\n</user_request>`,
          `<agent_answer>\n${answer.length > 6000 ? `${answer.slice(0, 6000)}\n[answer shortened for context]` : answer}\n</agent_answer>`,
          attached.length
            ? `<attached_documents>\n${attached.map((a) => `- ${a.id} | ${a.kind} | ${a.name}`).join('\n')}\n</attached_documents>`
            : '',
          artifacts.length
            ? `<artifacts>\n${artifacts.map((a) => `- ${a.id} | ${a.kind} | ${a.name} | ${a.title}`).join('\n')}\n</artifacts>`
            : '',
          '</previous_task>',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
    return parts.join('\n\n');
  }

  private buildContext(active: ActiveTask, sessionContext: string, attachments: Attachment[]): TaskRunContext {
    const id = active.task.id;
    return {
      get task() {
        return active.task;
      },
      signal: active.controller.signal,
      sessionContext,
      attachments,
      emit: async (payload) => {
        await this.emit(id, payload);
      },
      delta: (text, channel = 'text') => this.bus.publish({ kind: 'delta', taskId: id, channel, text }),
      step: async (step) => {
        // while an approval is pending the UI keeps showing what is being waited for
        if (active.task.status === 'awaiting_confirmation') return;
        if (active.task.currentStep !== step) await this.save({ ...active.task, currentStep: step });
      },
      progress: async (progress, step, detail) => {
        const value = Math.max(active.task.progress, Math.min(99, Math.round(progress)));
        const currentStep = active.task.status === 'awaiting_confirmation' ? active.task.currentStep : step;
        await this.save({ ...active.task, progress: value, currentStep });
        await this.emit(id, { type: 'progress', progress: value, step, detail });
      },
      addUsage: async (u) => {
        const prev = active.task.usage;
        const usage: TaskUsage = {
          apiCalls: prev.apiCalls + 1,
          inputTokens: prev.inputTokens + u.inputTokens,
          outputTokens: prev.outputTokens + u.outputTokens,
          cacheReadTokens: prev.cacheReadTokens + u.cacheReadTokens,
          cacheWriteTokens: prev.cacheWriteTokens + u.cacheWriteTokens,
          costUsd: Number((prev.costUsd + u.costUsd).toFixed(6)),
        };
        await this.save({ ...active.task, usage });
        await this.emit(id, { type: 'usage', usage });
      },
      createArtifact: async (input) => {
        const artifact = await this.artifacts.create({ ...input, taskId: id });
        await this.emit(id, { type: 'artifact', artifact });
        return artifact;
      },
      listArtifacts: () => this.artifacts.list(id),
      confirm: (request) => this.requestConfirmation(active, request),
    };
  }

  private async requestConfirmation(active: ActiveTask, request: ConfirmationRequest): Promise<ConfirmationDecision> {
    if (active.controller.signal.aborted) return { approved: false, note: 'Task dibatalkan' };
    const confirmation: Confirmation = {
      id: newId('conf'),
      taskId: active.task.id,
      ...request,
      status: 'pending',
      createdAt: nowIso(),
      resolvedAt: null,
      note: null,
    };
    await this.repo.upsertConfirmation(confirmation);
    active.pendingConfirmations += 1;
    if (active.task.status !== 'awaiting_confirmation') {
      await this.save({ ...active.task, status: 'awaiting_confirmation', currentStep: `Menunggu persetujuan: ${request.displayName}` });
      await this.emit(active.task.id, { type: 'status', status: 'awaiting_confirmation', message: request.reason });
    }
    await this.emit(active.task.id, { type: 'confirmation_requested', confirmation });

    const decision = await new Promise<ConfirmationDecision>((resolve) => {
      let settled = false;
      const settle = (d: ConfirmationDecision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active.controller.signal.removeEventListener('abort', onAbort);
        this.pending.delete(confirmation.id);
        resolve(d);
      };
      const onAbort = () => settle({ approved: false, note: 'Task dibatalkan' });
      const timer = setTimeout(
        () => settle({ approved: false, note: 'Tidak ada jawaban sampai batas waktu konfirmasi', expired: true }),
        this.options.confirmationTimeoutMs,
      );
      active.controller.signal.addEventListener('abort', onAbort);
      this.pending.set(confirmation.id, { confirmation, resolve: settle });
      // a cancel that landed during the awaits above never fires the listener
      if (active.controller.signal.aborted) onAbort();
    });

    const resolved: Confirmation = {
      ...confirmation,
      status: decision.approved ? 'approved' : decision.expired ? 'expired' : 'rejected',
      resolvedAt: nowIso(),
      note: decision.note,
    };
    await this.repo.upsertConfirmation(resolved);
    await this.emit(active.task.id, {
      type: 'confirmation_resolved',
      confirmationId: confirmation.id,
      approved: decision.approved,
      note: decision.note ?? undefined,
    });
    active.pendingConfirmations -= 1;
    if (active.pendingConfirmations === 0 && !active.controller.signal.aborted && this.active.has(active.task.id)) {
      await this.save({ ...active.task, status: 'running', currentStep: decision.approved ? 'Disetujui, melanjutkan' : 'Ditolak, melanjutkan' });
      await this.emit(active.task.id, { type: 'status', status: 'running' });
    }
    return decision;
  }
}
