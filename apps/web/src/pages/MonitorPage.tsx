import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskEvent, TaskStats, TaskStatus } from '@solar/shared';
import { ArtifactList } from '../components/Artifacts';
import { AttachmentTable } from '../components/Attachments';
import { AlertIcon, CheckCircleIcon, ClockIcon, HandIcon, RefreshIcon, SpinnerIcon, StopIcon } from '../components/Icons';
import { ProgressMeter, StatusBadge } from '../components/Status';
import { api } from '../lib/api';
import { formatClock, formatCompact, formatDuration, formatTime, formatUsd, isActive, STATUS_LABEL } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { navigate } from '../lib/router';
import { useSolar } from '../lib/store';

type Filter = 'all' | 'active' | 'awaiting_confirmation' | 'completed' | 'failed';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'active', label: 'Aktif' },
  { id: 'awaiting_confirmation', label: 'Menunggu' },
  { id: 'completed', label: 'Selesai' },
  { id: 'failed', label: 'Gagal' },
];

function matches(task: Task, filter: Filter, query: string): boolean {
  if (filter === 'active' && !isActive(task.status)) return false;
  if (filter !== 'all' && filter !== 'active' && task.status !== filter) return false;
  if (query && !`${task.title} ${task.prompt} ${task.id}`.toLowerCase().includes(query.toLowerCase())) return false;
  return true;
}

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
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
  }, [value, format]);
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
  const { tasks, refreshTasks } = useSolar();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [now, setNow] = useState(Date.now());

  const list = useMemo(() => Object.values(tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [tasks]);
  const visible = list.filter((t) => matches(t, filter, query));
  const statusKey = list.map((t) => `${t.id}:${t.status}`).join('|');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.stats().then(setStats).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [statusKey]);

  useEffect(() => {
    const hasActive = list.some((t) => isActive(t.status));
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
          <h1>Monitor Task</h1>
          <div className="hint">Pembaruan realtime dari agent SOLAR - progres, langkah kerja, persetujuan, biaya dan artefak.</div>
        </div>
        <button type="button" className="btn small" onClick={() => void refreshTasks()}>
          <RefreshIcon /> Muat ulang
        </button>
      </div>

      <section className="kpis" aria-label="Ringkasan">
        <Kpi label="Total task" icon={<ClockIcon />} value={stats?.total ?? 0} />
        <Kpi label="Sedang berjalan" icon={<SpinnerIcon />} value={by('running') + by('queued')} sub={`${by('queued')} antre`} />
        <Kpi label="Menunggu konfirmasi" icon={<HandIcon />} value={by('awaiting_confirmation')} />
        <Kpi label="Selesai" icon={<CheckCircleIcon />} value={by('completed')} />
        <Kpi label="Gagal / batal" icon={<AlertIcon />} value={by('failed') + by('cancelled')} sub={`${by('cancelled')} dibatalkan`} />
        <Kpi label="Estimasi biaya API" icon={<span aria-hidden="true">$</span>} value={stats?.costUsd ?? 0} format={formatUsd} />
      </section>

      <div className="filters">
        <div className="seg" role="group" aria-label="Filter status">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="input" type="search" placeholder="Cari task…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Cari task" />
      </div>

      <div className="monitor-grid">
        <section className="panel" aria-label="Daftar task">
          <div className="panel-head">
            <h2>Task ({visible.length})</h2>
          </div>
          {visible.length === 0 ? (
            <p className="empty" style={{ padding: 24 }}>
              Belum ada task untuk filter ini.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="task-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th style={{ minWidth: 140 }}>Progres</th>
                    <th className="hide-sm">Mulai</th>
                    <th className="hide-sm">Durasi</th>
                    <th className="hide-sm">Biaya</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr
                      key={t.id}
                      aria-selected={t.id === selectedId}
                      tabIndex={0}
                      onClick={() => navigate(`/monitor/${t.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/monitor/${t.id}`)}
                    >
                      <td>
                        <div className="task-title">{t.title}</div>
                        <div className="task-step">{isActive(t.status) ? t.currentStep : t.id}</div>
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                      <td>
                        <ProgressMeter value={t.progress} status={t.status} label={`Progres ${t.title}`} />
                      </td>
                      <td className="num hide-sm">{formatTime(t.startedAt ?? t.createdAt)}</td>
                      <td className="num hide-sm">{formatDuration(t.startedAt, t.finishedAt, now)}</td>
                      <td className="num hide-sm">{formatUsd(t.usage.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-label="Detail task">
          {selected ? <TaskDetailPanel task={selected} now={now} /> : <p className="empty" style={{ padding: 24 }}>Pilih task untuk melihat detail, langkah kerja dan artefaknya.</p>}
        </section>
      </div>
    </main>
  );
}

function eventView(e: TaskEvent): { dot: string; title: string; detail?: string; json?: unknown } | null {
  switch (e.type) {
    case 'status':
      return { dot: e.status === 'failed' ? 'err' : e.status === 'completed' ? 'ok' : e.status === 'awaiting_confirmation' ? 'wait' : 'info', title: `Status: ${STATUS_LABEL[e.status]}`, detail: e.message };
    case 'progress':
      return { dot: 'info', title: `Progres ${e.progress}% · ${e.step}`, detail: e.detail };
    case 'thinking':
      return { dot: '', title: 'Penalaran (ringkasan)', detail: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text };
    case 'text':
      return { dot: '', title: 'Catatan agent', detail: e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text };
    case 'tool_call':
      return { dot: 'info', title: `▶ ${e.displayName}${e.pluginId ? ` (${e.pluginId})` : ''}`, json: e.input };
    case 'tool_result':
      return { dot: e.ok ? 'ok' : 'err', title: `${e.ok ? '✓' : '✕'} ${e.tool} · ${(e.durationMs / 1000).toFixed(1)} dtk`, detail: e.summary };
    case 'confirmation_requested':
      return { dot: 'wait', title: `Minta persetujuan: ${e.confirmation.displayName}`, detail: e.confirmation.reason, json: e.confirmation.input };
    case 'confirmation_resolved':
      return { dot: e.approved ? 'ok' : 'err', title: e.approved ? 'Disetujui pengguna' : 'Ditolak pengguna', detail: e.note };
    case 'artifact':
      return { dot: 'ok', title: `Artefak: ${e.artifact.name}`, detail: e.artifact.description ?? undefined };
    case 'log':
      return { dot: e.level === 'info' ? '' : 'err', title: e.message };
    case 'error':
      return { dot: 'err', title: 'Error', detail: e.message };
    case 'result':
      return { dot: 'ok', title: 'Jawaban akhir dikirim' };
    case 'usage':
      return null;
  }
}

function TaskDetailPanel({ task, now }: { task: Task; now: number }) {
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
            <StopIcon /> Batalkan
          </button>
        )}
      </div>
      <div className="detail-section">
        <ProgressMeter value={task.progress} status={task.status} />
        <div className="stat-line" style={{ marginTop: 8 }}>
          <span>Langkah: {task.currentStep ?? '-'}</span>
          <span>Durasi: {formatDuration(task.startedAt, task.finishedAt, now)}</span>
          <span>Model: {task.model}</span>
          <span>API call: {u.apiCalls}</span>
          <span>
            Token: {formatCompact(u.inputTokens)} in · {formatCompact(u.outputTokens)} out · {formatCompact(u.cacheReadTokens)} cache
          </span>
          <span>Biaya: {formatUsd(u.costUsd)}</span>
        </div>
      </div>
      <div className="detail-section">
        <h3>Permintaan</h3>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{task.prompt}</div>
      </div>
      {(task.attachmentIds?.length ?? 0) > 0 && (
        <div className="detail-section">
          <h3>Dokumen terlampir ({task.attachmentIds.length})</h3>
          <AttachmentTable ids={task.attachmentIds} />
        </div>
      )}
      {(resultHtml || task.error) && (
        <div className="detail-section">
          <h3>Hasil</h3>
          {task.error && <div className="error-box">{task.error}</div>}
          {resultHtml && <div className="markdown" dangerouslySetInnerHTML={{ __html: resultHtml }} />}
        </div>
      )}
      {(artifacts[task.id]?.length ?? 0) > 0 && (
        <div className="detail-section">
          <h3>Artefak ({artifacts[task.id]!.length})</h3>
          <ArtifactList taskId={task.id} artifacts={artifacts[task.id]!} />
        </div>
      )}
      <div className="detail-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h3>Timeline ({list.length} event)</h3>
      </div>
      <ol className="timeline">
        {list.map((e) => {
          const v = eventView(e);
          if (!v) return null;
          return (
            <li key={e.id}>
              <time dateTime={e.at}>{formatClock(e.at)}</time>
              <span className={`dot ${v.dot}`} aria-hidden="true" />
              <div className="body">
                {v.title}
                {v.detail && <small>{v.detail}</small>}
                {v.json !== undefined && (
                  <details>
                    <summary className="hint">Input</summary>
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
