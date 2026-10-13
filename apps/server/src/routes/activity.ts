import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  ACTIVITY_ACTIONS,
  can,
  PERMISSIONS,
  ROLE_INFO,
  ROLE_PERMISSIONS,
  ROLES,
  type ActivityAction,
  type ActivityActionInfo,
  type ActivityEntry,
  type ActivityPage,
  type RoleInfo,
} from '@solar/shared';
import {
  actionLabel,
  decodeCursor,
  encodeCursor,
  principalActor,
  summarizeActivity,
  toItem,
  type ActivityActor,
  type ActivityLog,
  type ActivityTarget,
} from '../activity/activityLog.js';
import { principalOf, requestMeta, requirePermission } from '../auth/http.js';
import { t, type Lang } from '../i18n.js';
import { formatZodIssues, zodErrorMap } from '../i18n/zodIssues.js';
import type { ActivityQuery } from '../storage/repository.js';
import { HttpError } from './httpError.js';

/** The actor, client address and user agent of a request, for ActivityLog.record. */
export function requestActivity(req: Request): { actor: ActivityActor; ip: string | null; userAgent: string | null } {
  const meta = requestMeta(req);
  return { actor: principalActor(req.principal), ip: meta.ip, userAgent: meta.userAgent };
}

/** The roles of the code (ROLE_INFO + ROLE_PERMISSIONS), names in `lang`: `GET /api/roles` for both storage backends. */
export function roleInfos(lang: Lang): RoleInfo[] {
  return ROLES.map((id) => ({
    id,
    name: ROLE_INFO[id].name[lang],
    description: ROLE_INFO[id].description[lang],
    names: { ...ROLE_INFO[id].name },
    descriptions: { ...ROLE_INFO[id].description },
    permissions: PERMISSIONS.filter((p) => ROLE_PERMISSIONS[id].includes(p)),
    sortOrder: ROLE_INFO[id].sortOrder,
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Every action code with its group and label in `lang` (`GET /api/activity/actions`). */
export function activityActions(lang: Lang): ActivityActionInfo[] {
  return ACTIVITY_ACTIONS.map((action) => ({ action, group: action.slice(0, action.lastIndexOf('.')), label: actionLabel(action, lang) }));
}

const KNOWN = new Set<string>(ACTIVITY_ACTIONS);
/** Rows of one CSV export at most. */
export const MAX_EXPORT_ROWS = 100_000;

const filterSchema = z.object({
  /** A user id ("me" = oneself); ignored for viewers without activity.view_all (they always get their own). */
  actor: z.string().trim().max(200).optional(),
  /** Comma-separated action codes; "user.*" = every action starting with "user.". */
  action: z.string().trim().max(2000).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  q: z.string().trim().max(200).optional(),
});

const pageSchema = filterSchema.extend({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function parse<T extends z.ZodType>(schema: T, value: unknown, lang: Lang): z.output<T> {
  const r = schema.safeParse(value ?? {}, { error: zodErrorMap(lang) });
  if (!r.success) throw new HttpError(400, formatZodIssues(r.error.issues, lang, true), 'invalid_input');
  return r.data;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An ISO date or date-time as an instant; a date alone is the start of that day (UTC), or of the next one for `to`. */
function instant(value: string | undefined, field: 'from' | 'to', lang: Lang): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(ms)) throw new HttpError(400, t(lang, 'activity.invalidDate', { field }), 'invalid_input');
  return new Date(field === 'to' && DATE_ONLY.test(value) ? ms + 86_400_000 : ms).toISOString();
}

/**
 * The repository query of a request's filters. Who sees what: with `activity.view_all` (superadmin, Head of IT, the
 * access token) every entry, optionally one actor's; otherwise only the requester's own entries, whatever `actor` says.
 */
function queryOf(req: Request, f: z.output<typeof filterSchema>, limit: number): ActivityQuery {
  const lang = req.lang;
  const principal = principalOf(req);
  const query: ActivityQuery = { limit };
  if (can(principal.role, 'activity.view_all')) {
    if (f.actor) query.actorId = f.actor === 'me' ? principal.id : f.actor;
  } else {
    query.actorId = principal.id;
  }
  if (f.action) {
    for (const code of f.action.split(',').map((a) => a.trim()).filter(Boolean)) {
      if (code.endsWith('.*') && code.length > 2) (query.actionPrefixes ??= []).push(code.slice(0, -1));
      else if (KNOWN.has(code)) (query.actions ??= []).push(code);
      else throw new HttpError(400, t(lang, 'activity.unknownAction', { action: code.slice(0, 80) }), 'invalid_input');
    }
  }
  if (f.outcome) query.outcome = f.outcome;
  query.from = instant(f.from, 'from', lang);
  query.to = instant(f.to, 'to', lang);
  if (f.q) query.q = f.q;
  return query;
}

// ---- CSV ------------------------------------------------------------------------------------------------------------

/**
 * One CSV cell: always quoted (quotes doubled). A value that a spreadsheet would run as a formula (starting with = + - @,
 * a tab or a carriage return, also after leading spaces) gets a leading apostrophe, so it is shown as text.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[\t\r]/.test(text) || /^\s*[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  'id',
  'at',
  'actor_id',
  'actor_name',
  'actor_role',
  'actor_kind',
  'action',
  'action_label',
  'outcome',
  'target_type',
  'target_id',
  'target_label',
  'summary',
  'ip',
  'user_agent',
  'details',
] as const;

export function csvRow(e: ActivityEntry, lang: Lang): string {
  return [
    e.id,
    e.at,
    e.actorId,
    e.actorName,
    e.actorRole,
    e.actorKind,
    e.action,
    actionLabel(e.action, lang),
    e.outcome,
    e.targetType,
    e.targetId,
    e.targetLabel,
    summarizeActivity(e, lang),
    e.ip,
    e.userAgent,
    e.details,
  ]
    .map(csvCell)
    .join(',');
}

// ---- routes ---------------------------------------------------------------------------------------------------------

/**
 * `/api/roles` (every logged-in user: the UI's role names) and the activity log: `/api/activity` (own entries; every
 * entry with activity.view_all), `/api/activity/actions` and `/api/activity.csv` (activity.view_all). Registered on the
 * API router after requireUser.
 */
export function registerActivityRoutes(
  r: Router,
  deps: {
    activity: ActivityLog;
    /** Records an attempt refused by a permission check (the CSV export by someone without activity.view_all). */
    refused?: (action: ActivityAction, target: (req: Request) => ActivityTarget | null) => (req: Request) => void;
  },
): void {
  const { activity, refused } = deps;
  const viewOwn = requirePermission('activity.view_own');

  r.get('/roles', (req, res) => {
    res.json(roleInfos(req.lang));
  });

  r.get('/activity/actions', viewOwn, (req, res) => {
    res.json(activityActions(req.lang));
  });

  r.get('/activity', viewOwn, async (req, res) => {
    const q = parse(pageSchema, req.query, req.lang);
    const query = queryOf(req, q, q.limit);
    if (q.cursor) {
      const before = decodeCursor(q.cursor);
      if (!before) throw new HttpError(400, t(req.lang, 'activity.invalidCursor'), 'invalid_input');
      query.before = before;
    }
    const page = await activity.list(query);
    const body: ActivityPage = { items: page.items.map((e) => toItem(e, req.lang)), nextCursor: page.next ? encodeCursor(page.next) : null };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  const exportAll = requirePermission('activity.view_all', refused?.('activity.export', () => ({ type: 'activity', id: null, label: 'CSV' })));
  r.get('/activity.csv', exportAll, async (req: Request, res: Response) => {
    const lang = req.lang;
    const f = parse(filterSchema, req.query, lang);
    const query = queryOf(req, f, 1000);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="solar-activity-${day}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // a BOM so that spreadsheet programs read the UTF-8 (names, Indonesian text) correctly
    res.write(`\ufeff${CSV_COLUMNS.join(',')}\r\n`);
    let rows = 0;
    let before = query.before;
    while (rows < MAX_EXPORT_ROWS) {
      const page = await activity.list({ ...query, before, limit: Math.min(1000, MAX_EXPORT_ROWS - rows) });
      if (page.items.length) res.write(`${page.items.map((e) => csvRow(e, lang)).join('\r\n')}\r\n`);
      rows += page.items.length;
      if (!page.next || res.destroyed) break;
      before = page.next;
    }
    res.end();
    activity.record({
      ...requestActivity(req),
      action: 'activity.export',
      target: { type: 'activity', label: 'CSV' },
      details: {
        rows,
        filters: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')),
      },
    });
  });
}
