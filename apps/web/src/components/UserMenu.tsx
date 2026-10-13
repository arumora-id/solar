import { useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Role } from '@solar/shared';
import { api, ApiError } from '../lib/api';
import { initials, useAuth, useRoleName } from '../lib/auth';
import { useFocusTrap } from '../lib/focus';
import { useT, type Dict } from '../lib/i18n';
import { popIn, pressHandlers, shake } from '../lib/motion';
import { DEFAULT_POLICY, msgText, PasswordField, PolicyList, StrengthMeter, validatePassword, waitText, type Msg } from './auth/fields';
import { AlertIcon, ChevronDownIcon, KeyIcon, LogOutIcon, ShieldIcon, SpinnerIcon, XIcon } from './Icons';

/** A role as a small coloured badge (top bar menu, user list, activity log, monitor). */
export function RoleBadge({ role }: { role: Role }) {
  const name = useRoleName();
  return (
    <span className="role-badge" data-role={role}>
      {role !== 'staff' && <ShieldIcon size={12} />}
      {name(role)}
    </span>
  );
}

/** Initials in a circle, coloured by role. */
export function Avatar({ name, role, size = 32 }: { name: string; role?: Role | null; size?: number }) {
  return (
    <span className="avatar" data-role={role ?? undefined} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** The account button of the top bar: name and role, change password, log out. */
export function UserMenu() {
  const t = useT();
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** The server did not confirm the logout: still logged in, and the menu says so. */
  const [logoutError, setLogoutError] = useState<'unreachable' | 'failed' | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const name = user?.name ?? t.auth.menu.tokenUser;

  useEffect(() => {
    if (!open) {
      setLogoutError(null);
      return;
    }
    popIn(menuRef.current);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // arrow keys move between the menu items; Tab leaves the menu, which closes (focus goes on from the account button)
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  // focus moved elsewhere (a click into the page, a screen reader jump): the menu closes
  const onMenuBlur = (e: ReactFocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && !menuRef.current?.contains(to) && !buttonRef.current?.contains(to)) setOpen(false);
  };

  const doLogout = async () => {
    if (leaving) return;
    setLeaving(true);
    setLogoutError(null);
    const result = await logout();
    if (result === 'ok') return;
    setLeaving(false);
    setLogoutError(result);
  };

  return (
    <div className="user-menu">
      <button
        ref={buttonRef}
        type="button"
        className="user-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t.auth.menu.button(name)}
        onClick={() => setOpen(!open)}
      >
        <Avatar name={name} role={role} size={30} />
        <span className="user-button-name label-wide">{name}</span>
        <ChevronDownIcon size={14} className="label-wide" />
      </button>
      {open && (
        <div className="menu" id={menuId} ref={menuRef} role="menu" aria-label={t.auth.menu.button(name)} onKeyDown={onMenuKey} onBlur={onMenuBlur}>
          <div className="menu-head">
            <Avatar name={name} role={role} size={40} />
            <div>
              <span className="menu-caption">{t.auth.menu.signedInAs}</span>
              <strong>{name}</strong>
              {user && (
                <span className="menu-sub">
                  @{user.username} · {user.email}
                </span>
              )}
              {role && <RoleBadge role={role} />}
            </div>
          </div>
          {user && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setDialog(true);
              }}
            >
              <KeyIcon size={16} /> {t.auth.menu.changePassword}
            </button>
          )}
          <button type="button" role="menuitem" aria-disabled={leaving || undefined} aria-busy={leaving || undefined} onClick={() => void doLogout()}>
            {leaving ? <SpinnerIcon size={16} /> : <LogOutIcon size={16} />} {t.auth.menu.logout}
          </button>
          <div className="menu-error" role="alert">
            {logoutError && (
              <>
                <AlertIcon size={15} />
                <span>{logoutError === 'unreachable' ? t.auth.menu.logoutUnreachable : t.auth.menu.logoutFailed}</span>
              </>
            )}
          </div>
        </div>
      )}
      {dialog && (
        <ChangePasswordDialog
          onClose={() => {
            setDialog(false);
            buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { user, authState } = useAuth();
  const policy = authState?.passwordPolicy ?? DEFAULT_POLICY;
  const ref = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: Msg; next?: Msg; confirm?: Msg }>({});
  const [alertMsg, setAlert] = useState<Msg>('');
  const alert = msgText(alertMsg, t) ?? '';
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const identity = [user?.username ?? '', user?.email ?? ''];
  const words = t.auth.changePassword;
  // Tab stays in the dialog (it is modal)
  useFocusTrap(ref);
  // after a refused save: the marked field, else the message (the save button lost the focus while it was disabled)
  const [problem, setProblem] = useState(0);
  useEffect(() => {
    if (!problem) return;
    const form = ref.current;
    const field = form?.querySelector<HTMLInputElement>('.auth-field.invalid input');
    if (field) field.focus();
    else form?.querySelector<HTMLElement>('.auth-alert.shown')?.focus();
  }, [problem]);

  // the parent passes a new onClose on every render: the effect below must run once
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    popIn(ref.current, { y: 12, scale: 0.97 });
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found: typeof errors = {};
    if (!current) found.current = (d) => d.auth.errors.required;
    if (validatePassword(next, policy, identity, t)) found.next = (d) => validatePassword(next, policy, identity, d) ?? '';
    else if (next === current) found.next = (d) => d.auth.changePassword.sameAsCurrent;
    if (!confirm) found.confirm = (d) => d.auth.errors.required;
    else if (confirm !== next) found.confirm = (d) => d.auth.errors.mismatch;
    setErrors(found);
    setAlert('');
    if (Object.keys(found).length) {
      requestAnimationFrame(() => {
        shake(Array.from(ref.current?.querySelectorAll('.auth-field.invalid') ?? []));
        ref.current?.querySelector<HTMLInputElement>('.auth-field.invalid input')?.focus();
      });
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'wrong_password') setErrors({ current: (d) => d.auth.errors.wrongPassword });
      else if (code === 'weak_password') setErrors({ next: err instanceof Error ? err.message.replace(/^\w+:\s*/, '') : String(err) });
      else if (code === 'rate_limited') {
        const wait = (err as ApiError).retryAfter ?? 60;
        setAlert(() => (d: Dict) => d.auth.errors.rateLimited(waitText(wait, d)));
      } else setAlert(err instanceof Error ? err.message : String(err));
      requestAnimationFrame(() => shake(ref.current));
      setProblem((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="pw-title" onSubmit={(e) => void submit(e)} noValidate>
        <div className="modal-title">
          <h3 id="pw-title">{words.title}</h3>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label={t.common.close}>
            <XIcon />
          </button>
        </div>
        {done ? (
          <>
            <div className="auth-notice" role="status">
              {words.done}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={onClose} autoFocus>
                {t.common.close}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              {words.intro}
            </p>
            <div className={`auth-alert${alert ? ' shown' : ''}`} role="alert" tabIndex={-1}>
              {alert}
            </div>
            {/* the username lets password managers file the new password under the right account */}
            <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
            <PasswordField
              ref={firstRef}
              label={t.auth.fields.currentPassword}
              autoComplete="current-password"
              value={current}
              error={msgText(errors.current, t)}
              onChange={(e) => {
                setCurrent(e.target.value);
                setErrors((x) => ({ ...x, current: undefined }));
              }}
            />
            <PasswordField
              label={t.auth.fields.newPassword}
              autoComplete="new-password"
              value={next}
              error={msgText(errors.next, t)}
              onChange={(e) => {
                setNext(e.target.value);
                setErrors((x) => ({ ...x, next: undefined }));
              }}
              after={<StrengthMeter password={next} policy={policy} identity={identity} />}
            />
            <PasswordField
              label={t.auth.fields.confirmPassword}
              autoComplete="new-password"
              value={confirm}
              error={msgText(errors.confirm, t)}
              onChange={(e) => {
                setConfirm(e.target.value);
                setErrors((x) => ({ ...x, confirm: undefined }));
              }}
              after={<PolicyList password={next} confirm={confirm} policy={policy} identity={identity} />}
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t.common.cancel}
              </button>
              <button type="submit" className="btn primary" disabled={busy} {...pressHandlers()}>
                {busy && <SpinnerIcon size={16} />} {words.submit}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
