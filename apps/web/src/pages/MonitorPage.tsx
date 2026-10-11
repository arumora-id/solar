import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskEvent, TaskStats, TaskStatus } from '@solar/shared';
import { ArtifactList } from '../components/Artifacts';
import { AttachmentTable } from '../components/Attachments';
import { AlertIcon, CheckCircleIcon, ClockIcon, HandIcon, RefreshIcon, SpinnerIcon, StopIcon } from '../components/Icons';
import { ProgressMeter, StatusBadge } from '../components/Status';
import { api } from '../lib/api';
import { formatClock, formatCompact, formatDuration, formatNumber, formatTime, formatUsd, isActive } from '../lib/format';
import { useLang, useT, type Dict } from '../lib/i18n';
import { renderMarkdown } from '../lib/markdown';
import { navigate } from '../lib/router';
import { useSolar } from '../lib/store';

type Filter = 'all' | 'active' | 'awaiting_confirmation' | 'completed' | 'failed';

/** The status filters; their names are `t.monitor.filters[filter]`. */
const FILTERS: Filter[] = ['all', 'active', 'awaiting_confirmation', 'completed', 'failed'];

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
  const { tasks, refreshTasks } = useSolar();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [now, setNow] = useState(Date.now());

  const list = useMemo(() => Object.values(tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [tasks]);
  const visible = list.filter((task) => matches(task, filter, query));
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

  return (
    <main className="monitor">
      <div className="row">
        <div style={{ flex: 1 }}>
          <h1>{t.monitor.title}</h1>
          <div className="hint">{t.monitor.intro}</div>
        </div>
        <button type="button" className="btn small" onClick={() => void refreshTasks()}>
          <RefreshIcon /> {t.common.reload}
        </button>
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
                    <th>{t.common.status}</th>
                    <th style={{ minWidth: 140 }}>{t.common.progress}</th>
                    <th className="hide-sm">{t.monitor.list.columns.started}</th>
                    <th className="hide-sm">{t.common.duration}</th>
                    <th className="hide-sm">{t.common.cost}</th>
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
                      </td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td>
                        <ProgressMeter value={task.progress} status={task.status} label={t.monitor.list.progressOf(task.title)} />
                      </td>
                      <td className="num hide-sm">{formatTime(task.startedAt ?? task.createdAt)}</td>
                      <td className="num hide-sm">{formatDuration(task.startedAt, task.finishedAt, now)}</td>
                      <td className="num hide-sm">{formatUsd(task.usage.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-label={t.monitor.detail.label}>
          {selected ? (
            <TaskDetailPanel task={selected} now={now} />
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

function TaskDetailPanel({ task, now }: { task: Task; now: number }) {
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
        </div>
      </div>
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
