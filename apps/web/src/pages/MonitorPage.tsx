import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Confirmation, Task, TaskEvent, TaskOwner, TaskStats, TaskStatus, User } from '@solar/shared';
import type { CharacterState } from '../character/CharacterScene';
import { CharacterStage } from '../character/CharacterStage';
import { useCharacter } from '../components/CharacterPicker';
import { ArtifactList } from '../components/Artifacts';
import { AttachmentTable } from '../components/Attachments';
import { AlertIcon, CheckCircleIcon, ClockIcon, HandIcon, RefreshIcon, SpinnerIcon, StopIcon } from '../components/Icons';
import { ProgressMeter, StatusBadge } from '../components/Status';
import { RoleBadge } from '../components/UserMenu';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatClock, formatCompact, formatDuration, formatNumber, formatTime, formatUsd, isActive, ownerLabel } from '../lib/format';
import { useLang, useT, type Dict } from '../lib/i18n';
import { renderMarkdown } from '../lib/markdown';
import { navigate } from '../lib/router';
import { useSolar } from '../lib/store';

type Filter = 'all' | 'active' | 'awaiting_confirmation' | 'completed' | 'failed';

/** The status filters; their names are `t.monitor.filters[filter]`. */
const FILTERS: Filter[] = ['all', 'active', 'awaiting_confirmation', 'completed', 'failed'];

/** Owner filter (roles with tasks.all): everyone, mine, tasks from before accounts, or one user (`u:<id>`). */
type OwnerFilter = 'all' | 'mine' | 'none' | `u:${string}`;

function matchesOwner(task: Task, owner: OwnerFilter, myId: string | null): boolean {
  if (owner === 'all') return true;
  if (owner === 'mine') return Boolean(myId) && task.ownerId === myId;
  if (owner === 'none') return !task.ownerId;
  return task.ownerId === owner.slice(2);
}

/** The owner filter asks the server for that owner's tasks (`owner` of GET /api/tasks); undefined for everyone. */
function ownerParam(owner: OwnerFilter): string | undefined {
  if (owner === 'all') return undefined;
  if (owner === 'mine') return 'me';
  if (owner === 'none') return 'none';
  return owner.slice(2);
}

/** Option texts stay short: a <select> is as wide as its longest option (display names may have 80 characters). */
function clip(text: string, max = 36): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function OwnerCell({ task, myId }: { task: Task; myId: string | null }) {
  const t = useT();
  const owner = task.owner;
  return (
    <span className="owner-cell" data-deleted={owner?.deleted ? 'true' : undefined} data-legacy={!owner ? 'true' : undefined}>
      <span className="owner-name">{ownerLabel(task, t, myId)}</span>
      {owner && !owner.deleted && owner.kind === 'user' && owner.role && <RoleBadge role={owner.role} />}
    </span>
  );
}

function matches(task: Task, filter: Filter, query: string): boolean {
  if (filter === 'active' && !isActive(task.status)) return false;
  if (filter !== 'all' && filter !== 'active' && task.status !== filter) return false;
  if (query && !`${task.title} ${task.prompt} ${task.id}`.toLowerCase().includes(query.toLowerCase())) return false;
  return true;
}

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  // the tween writes the text itself, so a language switch must run it again to re-format the number
  const lang = useLang();
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const obj = { n: last.current };
    const tween = gsap.to(obj, {
      n: value,
      duration: reduce ? 0 : 0.8,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = format(obj.n);
      },
    });
    last.current = value;
    return () => void tween.kill();
  }, [value, format, lang]);
  return <span ref={ref}>{format(value)}</span>;
}

function Kpi({ label, icon, value, sub, format = (n: number) => formatCompact(Math.round(n)) }: { label: string; icon: React.ReactNode; value: number; sub?: string; format?: (n: number) => string }) {
  return (
    <div className="kpi">
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">
        <AnimatedNumber value={value} format={format} />
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function MonitorPage({ selectedId }: { selectedId: string | null }) {
  const t = useT();
  const { tasks, refreshTasks, fetchTasks, usersVersion } = useSolar();
  const character = useCharacter();
  const { can, user } = useAuth();
  // superadmin and Head of IT Solar see every user's tasks, with their owner; staff see their own only (no owner UI)
  const seesAll = can('tasks.all');
  const myId = user?.id ?? null;
  const [filter, setFilter] = useState<Filter>('all');
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [now, setNow] = useState(Date.now());
  /** Every account (users.view), so people whose tasks are older than the loaded ones can be chosen too. */
  const [people, setPeople] = useState<User[]>([]);
  const canListUsers = seesAll && can('users.view');

  useEffect(() => {
    if (!canListUsers) return;
    let live = true;
    api
      .users()
      .then((list) => live && setPeople(list.filter((u) => u.status !== 'pending')))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [canListUsers, usersVersion]);

  // the general list holds the newest tasks only: a chosen owner's tasks are loaded from the server
  const ownerQuery = seesAll ? ownerParam(owner) : undefined;
  useEffect(() => {
    if (ownerQuery) void fetchTasks({ owner: ownerQuery });
  }, [ownerQuery, fetchTasks]);
  const reloadList = () => {
    void refreshTasks();
    if (ownerQuery) void fetchTasks({ owner: ownerQuery });
  };

  const list = useMemo(() => Object.values(tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [tasks]);
  const visible = list.filter((task) => matches(task, filter, query) && (!seesAll || matchesOwner(task, owner, myId)));
  // the people to filter by: every account, plus the owners found in the tasks (deleted accounts, the access token)
  const owners = useMemo(() => {
    const map = new Map<string, TaskOwner>();
    for (const p of people) {
      if (p.id !== myId) map.set(p.id, { id: p.id, name: p.name, username: p.username, role: p.role, kind: 'user', deleted: false });
    }
    for (const task of list) if (task.ownerId && task.owner && task.ownerId !== myId && !map.has(task.ownerId)) map.set(task.ownerId, task.owner);
    // people by name, deleted accounts last
    return [...map.entries()].sort((a, b) => Number(a[1].deleted) - Number(b[1].deleted) || a[1].name.localeCompare(b[1].name));
  }, [list, myId, people]);
  const deletedOwners = owners.filter(([, o]) => o.deleted).length;
  const statusKey = list.map((task) => `${task.id}:${task.status}`).join('|');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.stats().then(setStats).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [statusKey]);

  useEffect(() => {
    const hasActive = list.some((task) => isActive(task.status));
    if (!hasActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [list]);

  const by = (s: TaskStatus) => stats?.byStatus[s] ?? 0;
  const selected = selectedId ? tasks[selectedId] : undefined;
  const characterState: CharacterState = list.some((task) => task.status === 'awaiting_confirmation')
    ? 'asking'
    : list.some((task) => isActive(task.status))
      ? 'working'
      : 'idle';

  return (
    <main className="monitor">
      <div className="monitor-header">
        <div className="monitor-robot">
          <CharacterStage character={character} state={characterState} />
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <h1>{t.monitor.title}</h1>
            <div className="hint">{t.monitor.intro}</div>
          </div>
          <button type="button" className="btn small" onClick={reloadList}>
            <RefreshIcon /> {t.common.reload}
          </button>
        </div>
      </div>

      <section className="kpis" aria-label={t.monitor.kpi.label}>
        <Kpi label={t.monitor.kpi.total} icon={<ClockIcon />} value={stats?.total ?? 0} />
        <Kpi label={t.monitor.kpi.running} icon={<SpinnerIcon />} value={by('running') + by('queued')} sub={t.monitor.kpi.queued(by('queued'))} />
        <Kpi label={t.monitor.kpi.awaiting} icon={<HandIcon />} value={by('awaiting_confirmation')} />
        <Kpi label={t.monitor.kpi.completed} icon={<CheckCircleIcon />} value={by('completed')} />
        <Kpi label={t.monitor.kpi.failedOrCancelled} icon={<AlertIcon />} value={by('failed') + by('cancelled')} sub={t.monitor.kpi.cancelled(by('cancelled'))} />
        <Kpi label={t.monitor.kpi.cost} icon={<span aria-hidden="true">$</span>} value={stats?.costUsd ?? 0} format={formatUsd} />
      </section>

      <div className="filters">
        <div className="seg" role="group" aria-label={t.monitor.filters.label}>
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t.monitor.filters[f]}
            </button>
          ))}
        </div>
        {seesAll && (
          <select className="select owner-filter" value={owner} onChange={(e) => setOwner(e.target.value as OwnerFilter)} aria-label={t.monitor.owner.filterLabel}>
            <option value="all">{t.monitor.owner.all}</option>
            <option value="mine">{t.monitor.owner.mine}</option>
            <option value="none">{t.monitor.owner.none}</option>
            {owners.length > 0 && (
              <optgroup label={t.monitor.owner.users}>
                {owners.map(([id, o]) => (
                  <option key={id} value={`u:${id}`}>
                    {o.deleted
                      ? // several deleted accounts stay apart by the end of their id
                        deletedOwners > 1
                        ? `${t.monitor.owner.deleted} · #${id.slice(-6)}`
                        : t.monitor.owner.deleted
                      : o.kind === 'token'
                        ? t.monitor.owner.token
                        : o.username
                          ? `${clip(o.name)} (@${o.username})`
                          : clip(o.name)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        <input
          className="input"
          type="search"
          placeholder={t.monitor.search.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.monitor.search.label}
        />
      </div>

      <div className="monitor-grid">
        <section className="panel" aria-label={t.monitor.list.label}>
          <div className="panel-head">
            <h2>{t.monitor.list.heading(visible.length)}</h2>
          </div>
          {visible.length === 0 ? (
            <p className="empty" style={{ padding: 24 }}>
              {t.monitor.list.empty}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="task-table">
                <thead>
                  <tr>
                    <th>{t.monitor.list.columns.task}</th>
                    {seesAll && <th className="hide-sm">{t.monitor.owner.column}</th>}
                    <th>{t.common.status}</th>
                    <th style={{ minWidth: 140 }}>{t.common.progress}</th>
                    <th className="hide-sm">{t.monitor.list.columns.started}</th>
                    <th className={seesAll ? 'hide-sm hide-md' : 'hide-sm'}>{t.common.duration}</th>
                    <th className={seesAll ? 'hide-sm hide-md' : 'hide-sm'}>{t.common.cost}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((task) => (
                    <tr
                      key={task.id}
                      aria-selected={task.id === selectedId}
                      tabIndex={0}
                      onClick={() => navigate(`/monitor/${task.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/monitor/${task.id}`)}
                    >
                      <td>
                        <div className="task-title">{task.title}</div>
                        <div className="task-step">{isActive(task.status) ? task.currentStep : task.id}</div>
                        {seesAll && (
                          <div className="task-owner-sm show-sm">
                            <OwnerCell task={task} myId={myId} />
                          </div>
                        )}
                      </td>
                      {seesAll && (
                        <td className="hide-sm">
                          <OwnerCell task={task} myId={myId} />
                        </td>
                      )}
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td>
                        <ProgressMeter value={task.progress} status={task.status} label={t.monitor.list.progressOf(task.title)} />
                      </td>
                      <td className="num hide-sm">{formatTime(task.startedAt ?? task.createdAt)}</td>
                      <td className={seesAll ? 'num hide-sm hide-md' : 'num hide-sm'}>{formatDuration(task.startedAt, task.finishedAt, now)}</td>
                      <td className={seesAll ? 'num hide-sm hide-md' : 'num hide-sm'}>{formatUsd(task.usage.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-label={t.monitor.detail.label}>
          {selected ? (
            <TaskDetailPanel task={selected} now={now} seesAll={seesAll} myId={myId} />
          ) : (
            <p className="empty" style={{ padding: 24 }}>
              {t.monitor.detail.empty}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

/** A timeline entry; the server's own texts (steps, messages, tool names, reasons) arrive in the task's language. */
function eventView(e: TaskEvent, t: Dict): { dot: string; title: string; detail?: string; json?: unknown } | null {
  const tl = t.monitor.timeline;
  switch (e.type) {
    case 'status':
      return {
        dot: e.status === 'failed' ? 'err' : e.status === 'completed' ? 'ok' : e.status === 'awaiting_confirmation' ? 'wait' : 'info',
        title: tl.status(t.monitor.status[e.status]),
        detail: e.message,
      };
    case 'progress':
      return { dot: 'info', title: tl.progress(e.progress, e.step), detail: e.detail };
    case 'thinking':
      return { dot: '', title: tl.thinking, detail: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text };
    case 'text':
      return { dot: '', title: tl.agentNote, detail: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text };
    case 'tool_call':
      return { dot: 'info', title: `▶ ${e.displayName}${e.pluginId ? ` (${e.pluginId})` : ''}`, json: e.input };
    case 'tool_result': {
      const seconds = formatNumber(e.durationMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      return { dot: e.ok ? 'ok' : 'err', title: `${e.ok ? '✓' : '✕'} ${tl.toolResult(e.tool, seconds)}`, detail: e.summary };
    }
    case 'confirmation_requested':
      return { dot: 'wait', title: tl.confirmationRequested(e.confirmation.displayName), detail: e.confirmation.reason, json: e.confirmation.input };
    case 'confirmation_resolved':
      return { dot: e.approved ? 'ok' : 'err', title: e.approved ? tl.approved : tl.rejected, detail: e.note };
    case 'artifact':
      return { dot: 'ok', title: tl.artifact(e.artifact.name), detail: e.artifact.description ?? undefined };
    case 'log':
      return { dot: e.level === 'info' ? '' : 'err', title: e.message };
    case 'error':
      return { dot: 'err', title: tl.error, detail: e.message };
    case 'result':
      return { dot: 'ok', title: tl.result };
    case 'usage':
      return null;
  }
}

/** Approvals of this task, answered here (an admin may answer for another user's task). */
function TaskApprovals({ task, mine }: { task: Task; mine: boolean }) {
  const t = useT();
  const { confirmations, resolveConfirmation } = useSolar();
  const { user } = useAuth();
  const pending = confirmations.filter((c) => c.taskId === task.id);
  if (!pending.length) return null;
  return (
    <div className="detail-section approvals">
      <h3>
        <HandIcon /> {t.monitor.approvals.title}
      </h3>
      {!mine && <p className="hint">{t.monitor.approvals.other(ownerLabel(task, t, user?.id ?? null))}</p>}
      {pending.map((c) => (
        <ApprovalCard key={c.id} confirmation={c} onResolve={resolveConfirmation} />
      ))}
    </div>
  );
}

function ApprovalCard({ confirmation, onResolve }: { confirmation: Confirmation; onResolve: (id: string, approved: boolean, note?: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (approved: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onResolve(confirmation.id, approved, note.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval-card">
      <strong>{confirmation.displayName}</strong>
      <p>
        {confirmation.reason}
        {confirmation.pluginName ? ` · ${t.agent.confirmation.plugin(confirmation.pluginName)}` : ''}
      </p>
      <details>
        <summary className="hint">{t.agent.confirmation.data}</summary>
        <pre className="json">{typeof confirmation.input === 'string' ? confirmation.input : JSON.stringify(confirmation.input, null, 2)}</pre>
      </details>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.agent.confirmation.notePlaceholder} aria-label={t.agent.confirmation.noteLabel} />
      {error && <div className="error-box">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn small danger" disabled={busy} onClick={() => void decide(false)}>
          {t.common.reject}
        </button>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void decide(true)}>
          {t.agent.confirmation.approve}
        </button>
      </div>
    </div>
  );
}

function TaskDetailPanel({ task, now, seesAll, myId }: { task: Task; now: number; seesAll: boolean; myId: string | null }) {
  const t = useT();
  const { events, artifacts, loadTask, cancel } = useSolar();
  useEffect(() => {
    void loadTask(task.id);
  }, [task.id, loadTask]);
  const list = events[task.id] ?? [];
  const resultHtml = useMemo(() => (task.result ? renderMarkdown(task.result) : ''), [task.result]);
  const u = task.usage;

  return (
    <>
      <div className="panel-head">
        <h2 title={task.title}>{task.title}</h2>
        <StatusBadge status={task.status} />
        {isActive(task.status) && (
          <button type="button" className="btn small" onClick={() => void cancel(task.id)}>
            <StopIcon /> {t.monitor.detail.cancel}
          </button>
        )}
      </div>
      <div className="detail-section">
        <ProgressMeter value={task.progress} status={task.status} />
        <div className="stat-line" style={{ marginTop: 8 }}>
          <span>{t.monitor.detail.step(task.currentStep ?? '-')}</span>
          <span>{t.monitor.detail.duration(formatDuration(task.startedAt, task.finishedAt, now))}</span>
          <span>{t.monitor.detail.model(task.model)}</span>
          <span>{t.monitor.detail.apiCalls(formatNumber(u.apiCalls))}</span>
          <span>{t.monitor.detail.tokens(formatCompact(u.inputTokens), formatCompact(u.outputTokens), formatCompact(u.cacheReadTokens))}</span>
          <span>{t.monitor.detail.cost(formatUsd(u.costUsd))}</span>
          {seesAll && <span>{t.monitor.owner.detail(ownerLabel(task, t, myId))}</span>}
        </div>
      </div>
      <TaskApprovals task={task} mine={!task.ownerId || task.ownerId === myId} />
      <div className="detail-section">
        <h3>{t.monitor.detail.request}</h3>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{task.prompt}</div>
      </div>
      {(task.attachmentIds?.length ?? 0) > 0 && (
        <div className="detail-section">
          <h3>{t.monitor.detail.attachments(task.attachmentIds.length)}</h3>
          <AttachmentTable ids={task.attachmentIds} />
        </div>
      )}
      {(resultHtml || task.error) && (
        <div className="detail-section">
          <h3>{t.monitor.detail.result}</h3>
          {task.error && <div className="error-box">{task.error}</div>}
          {resultHtml && <div className="markdown" dangerouslySetInnerHTML={{ __html: resultHtml }} />}
        </div>
      )}
      {(artifacts[task.id]?.length ?? 0) > 0 && (
        <div className="detail-section">
          <h3>{t.monitor.detail.artifacts(artifacts[task.id]!.length)}</h3>
          <ArtifactList taskId={task.id} artifacts={artifacts[task.id]!} active={isActive(task.status)} />
        </div>
      )}
      <div className="detail-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h3>{t.monitor.detail.timeline(list.length)}</h3>
      </div>
      <ol className="timeline">
        {list.map((e) => {
          const v = eventView(e, t);
          if (!v) return null;
          return (
            // the time column grows for a 12-hour clock ("04:11:34 PM" does not fit the 64px of "16.11.34")
            <li key={e.id} style={{ gridTemplateColumns: 'minmax(64px, max-content) 18px 1fr' }}>
              <time dateTime={e.at} style={{ whiteSpace: 'nowrap' }}>
                {formatClock(e.at)}
              </time>
              <span className={`dot ${v.dot}`} aria-hidden="true" />
              <div className="body">
                {v.title}
                {v.detail && <small>{v.detail}</small>}
                {v.json !== undefined && (
                  <details>
                    <summary className="hint">{t.monitor.timeline.input}</summary>
                    <pre className="json">{JSON.stringify(v.json, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
