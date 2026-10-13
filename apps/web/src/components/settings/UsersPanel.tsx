import { assignableRoles, canActOnUser, ROLES, type Role, type User, type UserAction, type UserStatus } from '@solar/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorCode } from '../../lib/api';
import { roleDescription, roleName as roleNameNow, useAuth, useRoleName } from '../../lib/auth';
import { useFocusTrap } from '../../lib/focus';
import { formatDate, formatTime } from '../../lib/format';
import { useLang, useT, type Dict } from '../../lib/i18n';
import { collapseOut, popIn, pressHandlers, shake, staggerIn } from '../../lib/motion';
import { useSolar } from '../../lib/store';
import { DEFAULT_POLICY, msgText, PasswordField, serverError, TextField, validateAccount, validatePassword, type FieldErrors, type Msg } from '../auth/fields';
import { BanIcon, CheckCircleIcon, ChevronDownIcon, ClockIcon, KeyIcon, PlusIcon, RefreshIcon, SpinnerIcon, TrashIcon } from '../Icons';
import { Avatar, RoleBadge } from '../UserMenu';

type Filter = UserStatus | 'all';
const FILTERS: Filter[] = ['pending', 'active', 'disabled', 'all'];
const STATUS_ORDER: Record<UserStatus, number> = { pending: 0, active: 1, disabled: 2 };

/** A readable random password for a reset or a new account ("Kp7m-Qx2r-Tz9w-Hb4n": no 0/O, 1/l/I). */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * A refused action in plain words, as a resolver that follows a language switch (the server's own message for anything
 * else: it is in the language of the request).
 */
function userError(err: unknown): Msg {
  switch (errorCode(err)) {
    case 'self_action':
      return (d) => d.users.errors.selfAction;
    case 'last_superadmin':
      return (d) => d.users.errors.lastSuperadmin;
    case 'forbidden':
      return (d) => d.users.errors.forbidden;
    case 'not_pending':
      return (d) => d.users.errors.notPending;
    case 'user_not_found':
      return (d) => d.users.errors.notFound;
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

function StatusPill({ status }: { status: UserStatus }) {
  const t = useT();
  return (
    <span className="badge" data-user-status={status}>
      {status === 'pending' ? <ClockIcon /> : status === 'active' ? <CheckCircleIcon /> : <BanIcon />}
      {t.users.status[status]}
    </span>
  );
}

/**
 * Settings → Pengguna (users.view: superadmin, Head of IT Solar). What each button may do is decided by the shared
 * canActOnUser / assignableRoles - the same rules the server applies - so only possible actions are offered; the server
 * still has the last word (self_action, last_superadmin, forbidden are shown in plain words).
 */
export function UsersPanel({ initialFilter }: { initialFilter?: Filter }) {
  const t = useT();
  const lang = useLang();
  const roleName = useRoleName();
  const { user: me, role: myRole, can, refreshMe } = useAuth();
  const { usersVersion, refreshPendingCount } = useSolar();
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter | null>(initialFilter ?? null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<Msg>('');
  const [errors, setErrors] = useState<Record<string, Msg>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [approveRole, setApproveRole] = useState<Record<string, Role>>({});
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const noticeTimer = useRef<number | undefined>(undefined);
  /** After an action: the card, its place in the list (if it leaves it) and the control that had the focus. */
  const focusAfter = useRef<{ id: string; index: number; from: HTMLElement | null } | null>(null);
  const manager = can('users.manage');
  const actor = me && myRole ? { id: me.id, role: myRole } : null;

  const load = useCallback(async () => {
    try {
      const list = await api.users();
      setUsers(list);
      setLoadError('');
      // the first view: registrations waiting first, if there are any
      setFilter((f) => f ?? (list.some((u) => u.status === 'pending') ? 'pending' : 'all'));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // first load, and again whenever an account changes anywhere (users_changed on the stream)
  useEffect(() => {
    void load();
  }, [load, usersVersion]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const say = (text: Msg) => {
    window.clearTimeout(noticeTimer.current);
    // (a function given to a state setter is an updater: wrap the resolver)
    setNotice(() => text);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 7000);
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, active: 0, disabled: 0, all: 0 };
    for (const u of users ?? []) {
      c[u.status]++;
      c.all++;
    }
    return c;
  }, [users]);

  const current = filter ?? 'all';
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? [])
      .filter((u) => current === 'all' || u.status === current)
      .filter((u) => !q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => (current === 'all' ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] : 0) || a.createdAt.localeCompare(b.createdAt));
  }, [users, current, query]);

  // after an action: back to the same card, or to the one that took its place, or to the confirmation above the list
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || busyId) return;
    focusAfter.current = null;
    const usable = (el: Element | null | undefined): boolean => el instanceof HTMLElement && el.isConnected && !(el as HTMLButtonElement).disabled;
    const active = document.activeElement;
    const from = target.from;
    // the user already went on (clicked or tabbed elsewhere): leave the focus there
    if (active !== from && active !== document.body && usable(active)) return;
    // the same control, else the next one in its row (a saved name or role disables its button)
    if (from && usable(from)) {
      from.focus();
      return;
    }
    const row = from?.isConnected ? from.closest('.manage-row') : null;
    const near = row?.querySelector<HTMLElement>('input:not([hidden]), select, button:not(:disabled)');
    if (near && usable(near)) {
      near.focus();
      return;
    }
    const remaining = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.user-card') ?? []);
    const card = cards.current.get(target.id) ?? remaining[Math.min(Math.max(target.index, 0), remaining.length - 1)];
    const control = card?.querySelector<HTMLElement>('.user-actions button:not(:disabled), .user-actions select');
    (control ?? noticeRef.current)?.focus();
  }, [users, busyId]);

  // a new filter or search (and the first load): the cards come in one after the other
  const loaded = users !== null;
  useLayoutEffect(() => {
    if (loaded && listRef.current) staggerIn(listRef.current.children);
  }, [current, query, loaded]);

  const may = (u: User, action: UserAction) => Boolean(actor && canActOnUser(actor, u, action));

  /** Runs an action on an account; `leaves`: the card disappears from the current filter (it collapses away first). */
  const act = async (u: User, op: () => Promise<unknown>, done: Msg, leaves = false) => {
    // the focus must not drop to the page (the buttons are disabled meanwhile, and the card may go away)
    const from = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    focusAfter.current = { id: u.id, index: visible.findIndex((x) => x.id === u.id), from };
    setBusyId(u.id);
    setErrors(({ [u.id]: _, ...rest }) => rest);
    try {
      await op();
      if (leaves) await collapseOut(cards.current.get(u.id) ?? null);
      say(done);
      if (u.id === me?.id) void refreshMe();
      await load();
      void refreshPendingCount();
      return true;
    } catch (err) {
      setErrors((x) => ({ ...x, [u.id]: userError(err) }));
      shake(cards.current.get(u.id) ?? null);
      const code = errorCode(err);
      if (code === 'user_not_found' || code === 'not_pending') void load();
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const approve = (u: User) => {
    const role = manager ? (approveRole[u.id] ?? 'staff') : 'staff';
    void act(u, () => api.approveUser(u.id, role), (d) => d.users.done.approved(u.name, roleNameNow(role)), current === 'pending');
  };
  const setStatus = (u: User, status: 'active' | 'disabled') => {
    const done: Msg = (d) => (status === 'active' ? d.users.done.enabled(u.name) : u.status === 'pending' ? d.users.done.rejected(u.name) : d.users.done.disabled(u.name));
    void act(u, () => api.updateUser(u.id, { status }), done, current !== 'all');
  };

  if (!users && loadError) {
    return (
      <div>
        <div className="error-box">{loadError}</div>
        <button type="button" className="btn small" onClick={() => void load()}>
          <RefreshIcon /> {t.common.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="users-panel">
      <div className="users-head">
        <p className="hint">{manager ? t.users.introAdmin : t.users.introHead}</p>
        {manager && (
          <button type="button" className="btn primary small" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            <PlusIcon size={16} /> {t.users.create.button}
          </button>
        )}
      </div>

      <div className="users-toolbar">
        <div className="seg" role="group" aria-label={t.users.filters.label}>
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={current === f} onClick={() => setFilter(f)}>
              {t.users.filters[f]}
              <span className="seg-count" data-alert={f === 'pending' && counts.pending > 0 ? 'true' : undefined}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <input className="input" type="search" placeholder={t.users.search.placeholder} aria-label={t.users.search.label} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className={`users-notice${notice ? ' shown' : ''}`} role="status" aria-live="polite" ref={noticeRef} tabIndex={-1}>
        {notice && (
          <>
            <CheckCircleIcon size={16} /> {msgText(notice, t)}
          </>
        )}
      </div>

      {creating && manager && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            say((d) => d.users.done.created(u.name));
            void load();
          }}
        />
      )}

      {users === null ? (
        <p className="hint">
          <SpinnerIcon /> {t.common.loading}
        </p>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <CheckCircleIcon size={22} />
          <p>{query.trim() ? t.users.empty.search : t.users.empty[current]}</p>
        </div>
      ) : (
        <ul className="user-list" ref={listRef} aria-label={t.users.count(visible.length)}>
          {visible.map((u) => {
            const isMe = u.id === me?.id;
            const busy = busyId === u.id;
            const actions: ReactNode[] = [];
            if (u.status === 'pending' && may(u, 'approve')) {
              const roles = assignableRoles(myRole);
              actions.push(
                <span key="approve" className="approve-group">
                  {manager && roles.length > 1 && (
                    <label className="approve-role">
                      <span className="sr-only">{t.users.actions.approveAs}</span>
                      <select
                        className="select"
                        value={approveRole[u.id] ?? 'staff'}
                        onChange={(e) => setApproveRole((x) => ({ ...x, [u.id]: e.target.value as Role }))}
                        aria-label={`${t.users.actions.approveAs} (${u.name})`}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {roleName(r)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className="btn primary small" disabled={busy} onClick={() => approve(u)} {...pressHandlers()}>
                    {/* without a role choice (Head of IT Solar), the button says which role the account gets */}
                    <CheckCircleIcon size={15} /> {manager && roles.length > 1 ? t.users.actions.approve : `${t.users.actions.approveAs} ${roleName('staff')}`}
                  </button>
                </span>,
              );
            }
            if (u.status === 'pending' && may(u, 'disable')) {
              actions.push(
                <button key="reject" type="button" className="btn small danger" disabled={busy} title={t.users.actions.rejectTitle} onClick={() => setStatus(u, 'disabled')}>
                  {t.users.actions.reject}
                </button>,
              );
            }
            if (u.status === 'active' && may(u, 'disable')) {
              actions.push(
                <button key="disable" type="button" className="btn small" disabled={busy} onClick={() => setStatus(u, 'disabled')}>
                  <BanIcon size={15} /> {t.users.actions.disable}
                </button>,
              );
            }
            if (u.status === 'disabled' && may(u, 'enable')) {
              actions.push(
                <button key="enable" type="button" className="btn small" disabled={busy} onClick={() => setStatus(u, 'active')}>
                  <CheckCircleIcon size={15} /> {t.users.actions.enable}
                </button>,
              );
            }
            const manageOpen = manageId === u.id;
            return (
              <li
                key={u.id}
                className="user-card"
                data-status={u.status}
                ref={(el) => {
                  if (el) cards.current.set(u.id, el);
                  else cards.current.delete(u.id);
                }}
              >
                <div className="user-main">
                  <Avatar name={u.name} role={u.role} size={40} />
                  <div className="user-info">
                    <div className="user-name">
                      <strong>{u.name}</strong>
                      {isMe && <span className="you-tag">{t.users.you}</span>}
                    </div>
                    <div className="user-sub">
                      @{u.username} · {u.email}
                    </div>
                    <div className="user-meta">
                      {t.users.joined(formatDate(u.createdAt))} · {u.lastLoginAt ? t.users.lastLogin(formatTime(u.lastLoginAt)) : t.users.neverLoggedIn}
                    </div>
                  </div>
                  <div className="user-badges">
                    <RoleBadge role={u.role} />
                    <StatusPill status={u.status} />
                  </div>
                </div>
                {errors[u.id] && (
                  <div className="error-box" role="alert">
                    {msgText(errors[u.id], t)}
                  </div>
                )}
                {(actions.length > 0 || manager) && (
                  <div className="user-actions">
                    {busy && <SpinnerIcon aria-hidden="true" />}
                    {actions}
                    {manager && (
                      <button
                        type="button"
                        className="btn ghost small manage-toggle"
                        aria-expanded={manageOpen}
                        aria-label={t.users.actions.manageLabel(u.name)}
                        onClick={() => setManageId(manageOpen ? null : u.id)}
                      >
                        {manageOpen ? t.users.actions.manageClose : t.users.actions.manage}
                        <ChevronDownIcon size={14} style={{ transform: manageOpen ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
                      </button>
                    )}
                  </div>
                )}
                {actions.length === 0 && !manager && <p className="hint user-readonly">{isMe ? t.users.actions.self : t.users.actions.readOnly}</p>}
                {manageOpen && manager && (
                  <ManagePanel
                    user={u}
                    isMe={isMe}
                    busy={busy}
                    onRole={(role) => act(u, () => api.updateUser(u.id, { role }), (d) => d.users.done.role(u.name, roleNameNow(role)))}
                    onRename={(name) => act(u, () => api.updateUser(u.id, { name }), (d) => d.users.done.renamed(name))}
                    onReset={(password) => act(u, () => api.resetPassword(u.id, password), (d) => d.users.done.passwordReset(u.name))}
                    onDelete={() => setConfirmDelete(u)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details className="roles-help">
        <summary>{t.users.rolesHelp}</summary>
        <dl>
          {ROLES.map((r) => (
            <div key={r}>
              <dt>
                <RoleBadge role={r} />
              </dt>
              <dd>{roleDescription(r, lang)}</dd>
            </div>
          ))}
        </dl>
      </details>

      {confirmDelete && (
        <ConfirmDelete
          user={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const u = confirmDelete;
            setConfirmDelete(null);
            setManageId(null);
            await act(u, () => api.deleteUser(u.id), (d) => d.users.done.deleted(u.name), true);
          }}
        />
      )}
    </div>
  );
}

/** Superadmin: role, display name, password reset and deletion of one account. */
function ManagePanel({
  user,
  isMe,
  busy,
  onRole,
  onRename,
  onReset,
  onDelete,
}: {
  user: User;
  isMe: boolean;
  busy: boolean;
  onRole: (role: Role) => Promise<boolean>;
  onRename: (name: string) => Promise<boolean>;
  onReset: (password: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useT();
  const roleName = useRoleName();
  const { authState } = useAuth();
  const policy = authState?.passwordPolicy ?? DEFAULT_POLICY;
  const words = t.users.actions;
  const ref = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<Role>(user.role);
  const [name, setName] = useState(user.name);
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  /** The password just set: kept in the field (to hand it over) until it is edited again. */
  const [resetDone, setResetDone] = useState(false);
  const [passwordMsg, setPasswordError] = useState<Msg>('');
  const [nameMsg, setNameError] = useState<Msg>('');
  const passwordError = msgText(passwordMsg, t) ?? '';
  const nameError = msgText(nameMsg, t) ?? '';

  useEffect(() => popIn(ref.current, { y: -4, scale: 0.99 }), []);

  return (
    <div className="manage-panel" ref={ref}>
      {isMe ? (
        <p className="hint" style={{ margin: 0 }}>
          {words.self}
        </p>
      ) : (
        <div className="manage-row">
          <label className="manage-label" htmlFor={`${user.id}-role`}>
            {words.role}
          </label>
          <div className="manage-inline">
            <select id={`${user.id}-role`} className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleName(r)}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" disabled={busy || role === user.role} onClick={() => void onRole(role)}>
              {words.saveRole}
            </button>
          </div>
          <p className="hint">{words.roleHint}</p>
        </div>
      )}

      <form
        className="manage-row"
        onSubmit={(e) => {
          e.preventDefault();
          const next = name.trim();
          if (!next || Array.from(next).length > 80) {
            setNameError(() => (d: Dict) => (next ? d.auth.errors.nameLength : d.auth.errors.required));
            return;
          }
          setNameError('');
          void onRename(next);
        }}
      >
        <label className="manage-label" htmlFor={`${user.id}-name`}>
          {words.rename}
        </label>
        <div className="manage-inline">
          <input
            id={`${user.id}-name`}
            className="input"
            value={name}
            maxLength={80}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${user.id}-name-error` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError('');
            }}
          />
          <button type="submit" className="btn small" disabled={busy || name.trim() === user.name}>
            {words.saveName}
          </button>
        </div>
        {nameError && (
          <p id={`${user.id}-name-error`} className="field-error">
            {nameError}
          </p>
        )}
      </form>

      {!isMe && (
        <form
          className="manage-row"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const error = validatePassword(password, policy, [user.username, user.email], t);
            setPasswordError(() => (error ? (d: Dict) => validatePassword(password, policy, [user.username, user.email], d) ?? '' : ''));
            if (error) return;
            if (await onReset(password)) setResetDone(true);
          }}
        >
          {/* who the new password is for, so a password manager does not file it under the admin's own login */}
          <input type="text" name="username" autoComplete="off" value={user.username} readOnly hidden />
          <PasswordField
            label={words.resetPassword}
            autoComplete="new-password"
            value={password}
            error={passwordError}
            hint={resetDone ? <strong className="reset-done">{words.resetDone(user.name)}</strong> : words.resetHint}
            visible={passwordShown}
            onReveal={setPasswordShown}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError('');
              setResetDone(false);
            }}
          />
          <div className="row">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                // shown, so it can be copied and handed over
                setPassword(generatePassword());
                setPasswordShown(true);
                setPasswordError('');
                setResetDone(false);
              }}
            >
              <KeyIcon size={15} /> {words.generate}
            </button>
            <button type="submit" className="btn small" disabled={busy || !password || resetDone}>
              {words.resetPassword}
            </button>
          </div>
        </form>
      )}

      {!isMe && (
        <div className="manage-row danger-zone">
          <span className="danger-title">{words.dangerZone}</span>
          <p className="hint">{words.deleteHint}</p>
          <button type="button" className="btn small danger" disabled={busy} onClick={onDelete}>
            <TrashIcon size={15} /> {words.delete}
          </button>
        </div>
      )}
    </div>
  );
}

function ConfirmDelete({ user, onCancel, onConfirm }: { user: User; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Tab stays in the dialog; Cancel gives the focus back to the delete button
  useFocusTrap(ref);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    popIn(ref.current, { y: 10, scale: 0.97 });
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="backdrop" style={{ zIndex: 60 }} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal narrow" ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-body">
        <h3 id="del-title">{t.users.confirmDelete.title(user.name)}</h3>
        <p id="del-body" style={{ color: 'var(--ink-2)' }}>
          {t.users.confirmDelete.body}
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn danger-solid" onClick={onConfirm} {...pressHandlers()}>
            <TrashIcon size={15} /> {t.users.confirmDelete.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Superadmin: an account that is active right away. */
function CreateUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (user: User) => void }) {
  const t = useT();
  const roleName = useRoleName();
  const { authState } = useAuth();
  const policy = authState?.passwordPolicy ?? DEFAULT_POLICY;
  const ref = useRef<HTMLFormElement>(null);
  const [input, setInput] = useState({ username: '', email: '', name: '', password: '' });
  const [role, setRole] = useState<Role>('staff');
  const [passwordShown, setPasswordShown] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setErrors] = useState<Partial<Record<'username' | 'email' | 'name' | 'password', Msg>>>({});
  const [alertMsg, setAlert] = useState<Msg>('');
  const alert = msgText(alertMsg, t) ?? '';
  // the local checks run at every render (they follow a language switch); a server error of a field wins
  const local: FieldErrors<'username' | 'email' | 'name' | 'password'> = submitted ? validateAccount({ ...input, confirm: input.password }, policy, t) : {};
  const errors: FieldErrors<'username' | 'email' | 'name' | 'password'> = { ...local };
  for (const [field, m] of Object.entries(serverErrors) as Array<['username' | 'email' | 'name' | 'password', Msg | undefined]>) {
    const text = msgText(m, t);
    if (text) errors[field] = text;
  }
  const [busy, setBusy] = useState(false);
  const f = t.auth.fields;

  useEffect(() => {
    popIn(ref.current, { y: -6, scale: 0.99 });
    ref.current?.querySelector('input')?.focus();
  }, []);

  const set = (key: keyof typeof input, value: string) => {
    setInput((x) => ({ ...x, [key]: value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateAccount({ ...input, confirm: input.password }, policy, t);
    delete found.confirm;
    setSubmitted(true);
    setErrors({});
    setAlert('');
    if (Object.keys(found).length) {
      requestAnimationFrame(() => shake(Array.from(ref.current?.querySelectorAll('.auth-field.invalid') ?? [])));
      return;
    }
    setBusy(true);
    try {
      const user = await api.createUser({ username: input.username.trim().toLowerCase(), email: input.email.trim(), name: input.name.trim(), password: input.password, role });
      onCreated(user);
    } catch (err) {
      const placed = serverError(err);
      if (placed.field && placed.field in input) setErrors({ [placed.field]: placed.message });
      else {
        const message = err instanceof ApiError && !placed.field ? userError(err) : placed.message;
        setAlert(() => message);
      }
      requestAnimationFrame(() => shake(ref.current));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={ref} className="create-user card" onSubmit={(e) => void submit(e)} noValidate>
      <h4>{t.users.create.title}</h4>
      <p className="hint">{t.users.create.intro}</p>
      {alert && (
        <div className="error-box" role="alert">
          {alert}
        </div>
      )}
      <div className="grid-2">
        <TextField
          label={f.username}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
          value={input.username}
          error={errors.username}
          hint={errors.username ? f.usernameHint : undefined}
          onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))}
        />
        <TextField label={f.email} type="email" autoComplete="off" value={input.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        <TextField label={f.name} autoComplete="off" maxLength={80} value={input.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
        <div className="auth-field">
          <label htmlFor="new-user-role">{t.users.actions.role}</label>
          <select id="new-user-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleName(r)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <PasswordField
        label={f.password}
        autoComplete="new-password"
        value={input.password}
        error={errors.password}
        hint={t.auth.policy.length(policy.minLength, policy.maxLength)}
        visible={passwordShown}
        onReveal={setPasswordShown}
        onChange={(e) => set('password', e.target.value)}
      />
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            set('password', generatePassword());
            setPasswordShown(true);
          }}
        >
          <KeyIcon size={15} /> {t.users.actions.generate}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button type="submit" className="btn primary small" disabled={busy} {...pressHandlers()}>
          {busy && <SpinnerIcon />} {t.users.create.submit}
        </button>
      </div>
    </form>
  );
}
