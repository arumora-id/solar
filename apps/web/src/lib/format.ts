import type { TaskStatus } from '@solar/shared';
import { localeOf, t } from './i18n';

/*
 * Formatting in the current interface language (lib/i18n.ts): call these while rendering, so a language switch, which
 * re-renders the app, also re-formats every date, number and duration.
 */

/** Name of a task status in the current language. */
export function statusLabel(status: TaskStatus): string {
  return t().monitor.status[status];
}

const STATUSES: TaskStatus[] = ['queued', 'running', 'awaiting_confirmation', 'completed', 'failed', 'cancelled'];

/**
 * Status names as a lookup table (`STATUS_LABEL[status]`) for existing callers; every read follows the current
 * language. New code: statusLabel(status) or `useT().monitor.status[status]`.
 */
export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = Object.defineProperties(
  {} as Record<TaskStatus, string>,
  Object.fromEntries(STATUSES.map((s) => [s, { get: () => statusLabel(s), enumerable: true }])),
);

/** "45 dtk" / "45 s", "3 mnt 5 dtk" / "3 min 5 s", "1 jam 20 mnt" / "1 h 20 min"; "-" when it has not started. */
export function formatDuration(startIso: string | null, endIso: string | null, now = Date.now()): string {
  if (!startIso) return '-';
  const ms = Math.max(0, (endIso ? Date.parse(endIso) : now) - Date.parse(startIso));
  const units = t().monitor.duration;
  const s = Math.round(ms / 1000);
  if (s < 60) return units.seconds(s);
  const m = Math.floor(s / 60);
  if (m < 60) return units.minutes(m, s % 60);
  return units.hours(Math.floor(m / 60), m % 60);
}

/** Day, month and time: "09 Okt, 15.51" / "Oct 09, 03:51 PM". */
export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(localeOf(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Date only: "9 Okt 2026" / "Oct 9, 2026". */
export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(localeOf(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Time of day with seconds: "15.51.27" / "03:51:27 PM". */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A number with the separators of the current language: "12.345,5" / "12,345.5". */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeOf(), options).format(n);
}

/** "1,2 jt" / "1.2M". */
export function formatCompact(n: number): string {
  return formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 });
}

/** US dollars (LLM cost): "$0,123" / "$0.123". */
export function formatUsd(n: number): string {
  return formatNumber(n, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 1 ? 3 : 2,
  });
}

/** "512 B", "1,5 KB" / "1.5 KB", "2,3 MB" / "2.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, oneDecimal)} KB`;
  return `${formatNumber(n / 1024 / 1024, oneDecimal)} MB`;
}

export function isActive(status: TaskStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_confirmation';
}
