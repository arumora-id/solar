import { ACCESS_TOKEN_PRINCIPAL_ID, type ActivityActionInfo, type ActivityItem, type ActivityOutcome, type User } from '@solar/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type ActivityFilters } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatClock } from '../../lib/format';
import { localeOf, useLang, useT, type Dict } from '../../lib/i18n';
import { staggerIn } from '../../lib/motion';
import { AlertIcon, CheckCircleIcon, DownloadIcon, RefreshIcon, SpinnerIcon } from '../Icons';
import { RoleBadge } from '../UserMenu';

const PAGE = 50;
/** A first load follows the cursor until it has this many entries (pages can be short or empty, see below). */
const FIRST_SCREEN = 20;
/** At most this many requests per click: the rest is left to "load more". */
const MAX_FOLLOW = 4;

/** `YYYY-MM-DD` of a date input as the start of that day in the user's time zone (the server reads plain dates as UTC). */
function startOfLocalDay(date: string, plusDays = 0): string | undefined {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d + plusDays).toISOString();
}

/** The day heading of a group of entries: "Hari ini", "Kemarin" or the full date. */
function dayLabel(iso: string, t: Dict): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const full = date.toLocaleDateString(localeOf(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (same(date, today)) return `${t.activity.today} · ${full}`;
  if (same(date, yesterday)) return `${t.activity.yesterday} · ${full}`;
  return full;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Settings → Aktivitas: the activity log (audit trail), newest first. Everyone sees their own entries; superadmin and
 * Head of IT Solar (activity.view_all) see everyone's, can filter by actor and export CSV. The server reads the log in
 * bounded chunks, so a page can come back short - even empty - with a cursor to go on: the panel follows it a few
 * times by itself and then offers "load more" instead of saying the log has ended.
 */
export function ActivityPanel() {
  const t = useT();
  const lang = useLang();
  const { can } = useAuth();
  const all = can('activity.view_all');
  const words = t.activity;

  const [actions, setActions] = useState<ActivityActionInfo[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState<ActivityOutcome | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** New filters are being applied: the entries on screen are the old ones. */
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState('');
  const [lastShort, setLastShort] = useState(false);
  const request = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shownBefore = useRef(0);

  // the search box waits for a pause in typing
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters = useMemo<ActivityFilters>(
    () => ({
      actor: all ? actor || undefined : undefined,
      action: action || undefined,
      outcome: outcome || undefined,
      from: from ? startOfLocalDay(from) : undefined,
      to: to ? startOfLocalDay(to, 1) : undefined,
      q: q || undefined,
    }),
    [all, actor, action, outcome, from, to, q],
  );
  const filtered = Boolean(filters.actor || filters.action || filters.outcome || filters.from || filters.to || filters.q);

  // action labels (in the interface language) and, for admins, the people to filter by
  useEffect(() => {
    let live = true;
    api
      .activityActions()
      .then((list) => live && setActions(list))
      .catch(() => undefined);
    if (all && can('users.view')) {
      api
        .users()
        .then((list) => live && setPeople([...list].sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, all]);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++request.current;
      setLoading(true);
      setReloading(reset);
      setError('');
      let acc = reset ? [] : items;
      let next = reset ? null : cursor;
      const before = acc.length;
      const want = reset ? FIRST_SCREEN : before + 1;
      let rounds = 0;
      let lastCount = 0;
      try {
        do {
          const page = await api.activity(filters, next, PAGE);
          if (id !== request.current) return;
          acc = [...acc, ...page.items];
          next = page.nextCursor;
          lastCount = page.items.length;
          rounds++;
        } while (next && acc.length < want && rounds < MAX_FOLLOW);
        shownBefore.current = reset ? 0 : before;
        setItems(acc);
        setCursor(next);
        setLastShort(Boolean(next) && lastCount < PAGE);
        setLoaded(true);
      } catch (err) {
        if (id === request.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === request.current) {
          setLoading(false);
          setReloading(false);
        }
      }
    },
    [filters, items, cursor],
  );

  // new filters (and a language switch: summaries and labels are written by the server) start over
  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, lang]);

  // new entries slide in (only the ones just added)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('.activity-item')).slice(shownBefore.current);
    staggerIn(rows, { y: 6, stagger: 0.02 });
  }, [items]);

  const labels = useMemo(() => new Map(actions.map((a) => [a.action, a.label])), [actions]);
  const groups = useMemo(() => {
    const map = new Map<string, ActivityActionInfo[]>();
    for (const a of actions) map.set(a.group, [...(map.get(a.group) ?? []), a]);
    return [...map.entries()];
  }, [actions]);
  const groupName = (group: string) => words.groups[group] ?? group;

  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; items: ActivityItem[] }> = [];
    for (const item of items) {
      const key = dayKey(item.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, label: dayLabel(item.at, t), items: [item] });
    }
    return out;
  }, [items, t]);

  const reset = () => {
    setActor('');
    setAction('');
    setOutcome('');
    setFrom('');
    setTo('');
    setSearch('');
    setQ('');
  };

  const actorName = (item: ActivityItem) => {
    if (item.actorKind === 'user') return item.actorName ?? item.actorId ?? '-';
    return words.actorKind[item.actorKind];
  };

  return (
    <div className="activity-panel">
      <p className="hint" style={{ marginTop: 0 }}>
        {all ? words.introAll : words.introOwn}
      </p>

      <div className="activity-filters" role="search" aria-label={words.filters.label}>
        <input className="input" type="search" value={search} placeholder={words.filters.search} aria-label={words.filters.searchLabel} onChange={(e) => setSearch(e.target.value)} />
        <div className="activity-filter-grid" data-cols={all ? 3 : 2}>
          <label className="field">
            <span>{words.filters.action}</span>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">{words.filters.anyAction}</option>
              {groups.map(([group, list]) => (
                <optgroup key={group} label={groupName(group)}>
                  {list.length > 1 && <option value={`${group}.*`}>{words.filters.wholeGroup(groupName(group))}</option>}
                  {list.map((a) => (
                    <option key={a.action} value={a.action}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {all && (
            <label className="field">
              <span>{words.filters.actor}</span>
              <select className="select" value={actor} onChange={(e) => setActor(e.target.value)}>
                <option value="">{words.filters.anyActor}</option>
                <option value="me">{words.filters.me}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (@{p.username})
                  </option>
                ))}
                <option value={ACCESS_TOKEN_PRINCIPAL_ID}>{words.actorKind.token}</option>
              </select>
            </label>
          )}
          <label className="field outcome">
            <span>{words.filters.outcome}</span>
            <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as ActivityOutcome | '')}>
              <option value="">{t.common.all}</option>
              <option value="success">{words.outcome.success}</option>
              <option value="failure">{words.outcome.failure}</option>
            </select>
          </label>
          <label className="field date">
            <span>{words.filters.from}</span>
            <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field date">
            <span>{words.filters.to}</span>
            <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="row">
          {filtered && (
            <button type="button" className="btn ghost small" onClick={reset}>
              {words.filters.reset}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost small" onClick={() => void load(true)} disabled={loading}>
            <RefreshIcon size={15} /> {t.common.refresh}
          </button>
          {all && (
            <a className="btn small" href={api.activityCsvUrl(filters)} download title={words.exportTitle}>
              <DownloadIcon size={15} /> {words.export}
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="activity-log" ref={listRef} aria-busy={loading || undefined} data-stale={loaded && reloading ? 'true' : undefined}>
        {/* the first load, and new filters later on (the old entries stay, dimmed, until the new ones arrive) */}
        {loading && (!loaded || reloading) && (
          <p className="hint activity-loading">
            <SpinnerIcon /> {words.loading}
          </p>
        )}
        {loaded && items.length === 0 && !cursor && !loading && (
          <div className="empty-state" role="status">
            <CheckCircleIcon size={22} />
            <p>{filtered ? words.empty : words.emptyNoFilter}</p>
          </div>
        )}
        {days.map((day) => (
          <section key={day.key} className="activity-day" aria-label={day.label}>
            <h4 className="activity-day-head">{day.label}</h4>
            <ol className="activity-items">
              {day.items.map((item) => (
                <li key={item.id} className="activity-item" data-outcome={item.outcome}>
                  <span className="activity-dot" aria-hidden="true">
                    {item.outcome === 'failure' ? <AlertIcon size={14} /> : <CheckCircleIcon size={14} />}
                  </span>
                  <div className="activity-body">
                    <div className="activity-summary">{item.summary}</div>
                    <div className="activity-meta">
                      <time dateTime={item.at} title={new Date(item.at).toLocaleString(localeOf())}>
                        {formatClock(item.at)}
                      </time>
                      <span className="activity-actor">
                        {actorName(item)}
                        {item.actorKind === 'user' && item.actorRole && <RoleBadge role={item.actorRole} />}
                      </span>
                      <span className="activity-action">{labels.get(item.action) ?? item.action}</span>
                      {item.outcome === 'failure' && (
                        <span className="badge" data-status="failed">
                          <AlertIcon /> {words.outcome.failure}
                        </span>
                      )}
                    </div>
                    {(item.targetLabel || item.ip || item.userAgent || item.details) && (
                      <details className="activity-details">
                        <summary>{words.details}</summary>
                        <dl>
                          {(item.targetLabel || item.targetId) && (
                            <>
                              <dt>{words.target}</dt>
                              <dd>
                                {item.targetLabel ?? item.targetId}
                                {item.targetType ? <span className="hint"> ({item.targetType})</span> : null}
                              </dd>
                            </>
                          )}
                          {item.ip && (
                            <>
                              <dt>{words.ip}</dt>
                              <dd className="mono">{item.ip}</dd>
                            </>
                          )}
                          {item.userAgent && (
                            <>
                              <dt>{words.userAgent}</dt>
                              <dd>{item.userAgent}</dd>
                            </>
                          )}
                          {item.details && Object.keys(item.details).length > 0 && (
                            <>
                              <dt>{words.data}</dt>
                              <dd>
                                <pre className="json">{JSON.stringify(item.details, null, 2)}</pre>
                              </dd>
                            </>
                          )}
                        </dl>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {loaded && (
        <div className="activity-more" aria-live="polite">
          {items.length > 0 && !reloading && <span className="hint">{words.shown(items.length)}</span>}
          {cursor ? (
            <>
              {lastShort && <p className="hint">{words.scanned}</p>}
              <button type="button" className="btn small" onClick={() => void load(false)} disabled={loading}>
                {loading ? <SpinnerIcon /> : null} {words.loadMore}
              </button>
            </>
          ) : (
            items.length > 0 && <span className="hint">{words.end}</span>
          )}
        </div>
      )}
    </div>
  );
}
