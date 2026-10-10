import gsap from 'gsap';
import { useEffect, useMemo, useRef } from 'react';
import type { Task, TaskEvent } from '@solar/shared';
import { formatDuration, formatUsd, isActive } from '../lib/format';
import { useT, type Dict } from '../lib/i18n';
import { renderMarkdown } from '../lib/markdown';
import { useSolar } from '../lib/store';
import { ArtifactList } from './Artifacts';
import { StopIcon } from './Icons';
import { ProgressMeter, StatusBadge } from './Status';

interface ActivityItem {
  id: string;
  label: string;
  state: 'running' | 'ok' | 'error' | 'info' | 'wait';
  detail?: string;
}

/** The work steps of a task, labelled in the language of `t` (tool names and step texts come from the server). */
export function activityFromEvents(events: TaskEvent[], t: Dict): ActivityItem[] {
  const words = t.agent.bubble;
  const items: ActivityItem[] = [];
  const byTool = new Map<string, ActivityItem>();
  for (const e of events) {
    if (e.type === 'tool_call') {
      if (e.tool === 'update_progress') continue;
      const item: ActivityItem = { id: e.toolUseId, label: e.displayName, state: 'running' };
      byTool.set(e.toolUseId, item);
      items.push(item);
    } else if (e.type === 'tool_result') {
      const item = byTool.get(e.toolUseId);
      if (item) {
        item.state = e.ok ? 'ok' : 'error';
        item.detail = e.summary;
      }
    } else if (e.type === 'progress') {
      items.push({ id: e.id, label: `${e.progress}% · ${e.step}`, state: 'info', detail: e.detail });
    } else if (e.type === 'confirmation_requested') {
      items.push({ id: e.id, label: words.awaitingApproval(e.confirmation.displayName), state: 'wait' });
    } else if (e.type === 'confirmation_resolved') {
      const label = e.approved ? words.approved : e.note ? words.rejectedWithNote(e.note) : words.rejected;
      items.push({ id: e.id, label, state: e.approved ? 'ok' : 'error' });
    } else if (e.type === 'log' && e.level !== 'info') {
      items.push({ id: e.id, label: e.message, state: 'error' });
    }
  }
  return items;
}

const MARK: Record<ActivityItem['state'], string> = { running: '…', ok: '✓', error: '✕', info: '•', wait: '⏸' };

export function AgentBubble({ task }: { task: Task }) {
  const { events, artifacts, drafts, loadTask, cancel } = useSolar();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const taskEvents = events[task.id] ?? [];
  const draft = drafts[task.id];
  const active = isActive(task.status);

  useEffect(() => {
    void loadTask(task.id);
    if (ref.current) gsap.fromTo(ref.current, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out', overwrite: true });
  }, [task.id, loadTask]);

  const activity = useMemo(() => activityFromEvents(taskEvents, t), [taskEvents, t]);
  const interimNotes = useMemo(
    () => taskEvents.filter((e): e is Extract<TaskEvent, { type: 'text' }> => e.type === 'text').map((e) => e.text),
    [taskEvents],
  );

  const body = task.status === 'completed' ? (task.result ?? '') : [...(active ? interimNotes : []), draft?.text ?? ''].filter(Boolean).join('\n\n');
  const html = useMemo(() => (body ? renderMarkdown(body) : ''), [body]);

  return (
    <div className="bubble agent" ref={ref} aria-live={active ? 'polite' : undefined}>
      <div className="agent-meta">
        <StatusBadge status={task.status} />
        <span className="step">{active ? (task.currentStep ?? '') : formatDuration(task.startedAt, task.finishedAt)}</span>
        {task.usage.costUsd > 0 && <span title={t.agent.bubble.costTitle}>{formatUsd(task.usage.costUsd)}</span>}
        {active && (
          <button type="button" className="btn ghost small" onClick={() => void cancel(task.id)}>
            <StopIcon /> {t.agent.bubble.cancelTask}
          </button>
        )}
      </div>
      {active && <ProgressMeter value={task.progress} status={task.status} label={t.agent.bubble.progressLabel(task.title)} />}
      {active && draft?.thinking && <div className="thinking-draft">{draft.thinking.slice(-280)}</div>}
      {html && <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />}
      {task.status === 'failed' && task.error && <div className="error-box">{task.error}</div>}
      {task.status === 'cancelled' && <div className="hint">{t.agent.bubble.cancelled}</div>}
      <ArtifactList taskId={task.id} artifacts={artifacts[task.id] ?? []} active={active} />
      {activity.length > 0 && (
        <details className="activity" open={active}>
          <summary>{t.agent.bubble.steps(activity.filter((a) => a.state !== 'info').length)}</summary>
          <ol>
            {activity.map((a) => (
              <li key={a.id}>
                <span aria-hidden="true">{MARK[a.state]}</span> {a.label}
                {a.detail ? <span className="hint"> - {a.detail}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
