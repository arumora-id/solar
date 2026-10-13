import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { AuthMe } from '@solar/shared';
import { api, ApiError, errorCode } from '../../lib/api';
import { roleName, useAuth } from '../../lib/auth';
import { useLang, useT, type Dict } from '../../lib/i18n';
import { pressHandlers, reducedMotion } from '../../lib/motion';
import { readPref, writePref } from '../../lib/session';
import { AlertIcon, CheckCircleIcon, ClockIcon, ShieldIcon, SpinnerIcon } from '../Icons';
import {
  clockText,
  msgText,
  PasswordField,
  PolicyList,
  serverError,
  StrengthMeter,
  TextField,
  validateAccount,
  type AccountInput,
  type FieldErrors,
  type Msg,
  type PasswordPolicy,
} from './fields';
import type { RoboHandle } from './Robo';

export type AuthView = 'login' | 'register' | 'registered' | 'setup' | 'pending' | 'disabled';

/** What Robo says besides the screen's own line. */
export type RoboMood = null | 'error' | 'password' | { welcome: string };

/** What the forms may ask of the screen around them (components/auth/AuthScreen.tsx). */
export interface AuthScreenApi {
  policy: PasswordPolicy;
  robo: RefObject<RoboHandle | null>;
  setMood(mood: RoboMood): void;
  /** Something went wrong: Robo shakes its head, the target (default: the card) shakes. */
  fail(target?: Element | Element[] | null): void;
  go(view: AuthView, options?: { identifier?: string; username?: string }): void;
  /** Logged in (login or setup): plays the success transition, then enters the app. */
  succeed(me: AuthMe): void;
}

export const AuthScreenContext = createContext<AuthScreenApi | null>(null);

function useScreen(): AuthScreenApi {
  const ctx = useContext(AuthScreenContext);
  if (!ctx) throw new Error('auth forms must be inside <AuthScreen>');
  return ctx;
}

/** On touch screens a focused field opens the keyboard over Robo: let the user tap first. */
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/** "Check the highlighted fields" in the current language (shown only while a field is still marked). */
const FIX_FIELDS: Msg = (d: Dict) => d.auth.errors.fixFields;
/** Rate limits and a busy server: the submit button counts down, so these texts carry no time of their own. */
const RATE_LIMITED: Msg = (d: Dict) => d.auth.errors.rateLimitedWait;
const REGISTER_LIMITED: Msg = (d: Dict) => d.auth.errors.registerRateLimited;
const BUSY: Msg = (d: Dict) => d.auth.errors.busy;

const PREF_IDENTIFIER = 'auth.identifier';
const PREF_REMEMBER = 'auth.remember';

/** The invalid fields of a form, for the shake (all of them shake together). */
function invalidFields(form: HTMLFormElement | null): Element[] {
  return form ? Array.from(form.querySelectorAll('.auth-field.invalid')) : [];
}

/**
 * After a refused submit: the first marked field, or else the form's message, scrolled into view and focused (the
 * submit button may be far below it on a phone, and focus must not drop to the page).
 */
function focusProblem(form: HTMLFormElement | null): void {
  if (!form) return;
  const field = form.querySelector<HTMLInputElement>('.auth-field.invalid input');
  if (field) {
    field.focus();
    return;
  }
  const alert = form.querySelector<HTMLElement>('.auth-alert.shown');
  if (!alert) return;
  alert.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  alert.focus({ preventScroll: true });
}

/** Runs callbacks once the next render is on screen (marked fields, the message), e.g. to focus or shake them. */
function useAfterRender(): (fn: () => void) => void {
  const queue = useRef<Array<() => void>>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fns = queue.current;
    queue.current = [];
    for (const fn of fns) fn();
  }, [tick]);
  return useCallback((fn: () => void) => {
    queue.current.push(fn);
    setTick((n) => n + 1);
  }, []);
}

/** The wait of a rate limit (Retry-After), counted down every second. */
function useRetryCountdown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  const start = useCallback((seconds: number) => {
    setUntil(Date.now() + seconds * 1000);
    setNow(Date.now());
  }, []);
  return { waiting: until > now ? (until - now) / 1000 : 0, start };
}

/** Robo follows the text being typed with its eyes (towards the form, a little down). */
function lookAtText(robo: RoboHandle | null, text: string): void {
  robo?.look(-0.3 + (Math.min(text.length, 28) / 28) * 1.3, 0.55);
}

function Alert({ message: msg, tone = 'error' }: { message: Msg; tone?: 'error' | 'info' }) {
  const t = useT();
  const message = msgText(msg, t) ?? '';
  // always rendered: a live region must exist before its text changes to be announced
  return (
    <div
      className={`auth-alert${message ? ' shown' : ''}`}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      tabIndex={-1}
    >
      {message && (
        <>
          {tone === 'error' ? <AlertIcon size={16} /> : <CheckCircleIcon size={16} />}
          <span>{message}</span>
        </>
      )}
    </div>
  );
}

/**
 * The submit button. While busy or counting down it is only marked disabled (aria-disabled; the form ignores the
 * submit): a really disabled button would drop the keyboard focus to the page. The countdown is in readable contrast.
 */
function SubmitButton({ busy, waiting = 0, label, busyLabel }: { busy: boolean; waiting?: number; label: string; busyLabel: string }) {
  const t = useT();
  const counting = !busy && waiting > 0;
  return (
    <button
      type="submit"
      className="btn primary auth-submit"
      aria-disabled={busy || counting || undefined}
      aria-busy={busy || undefined}
      data-waiting={counting ? 'true' : undefined}
      data-anim="field"
      {...(busy || counting ? {} : pressHandlers())}
    >
      {busy && <SpinnerIcon size={16} />}
      {counting && <ClockIcon size={16} />}
      {busy ? busyLabel : counting ? t.auth.login.waitButton(clockText(waiting)) : label}
    </button>
  );
}

// ---- login ---------------------------------------------------------------------------------------------------------

export function LoginForm({ initialIdentifier }: { initialIdentifier?: string }) {
  const t = useT();
  const screen = useScreen();
  const { authState, notice, clearNotice } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [identifier, setIdentifier] = useState(() => initialIdentifier ?? readPref<string>(PREF_IDENTIFIER, ''));
  const [remember, setRemember] = useState(() => readPref<boolean>(PREF_REMEMBER, true));
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ identifier?: Msg; password?: Msg }>({});
  const [alert, setAlert] = useState<Msg>('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const noticeId = useId();
  const after = useAfterRender();
  const { waiting, start: startWait } = useRetryCountdown();

  // the countdown is over: so is the message about it
  useEffect(() => {
    if (!waiting && (alert === RATE_LIMITED || alert === BUSY)) setAlert('');
  }, [waiting, alert]);

  useEffect(() => {
    if (coarsePointer()) return;
    (identifier ? passwordRef : identifierRef).current?.focus();
    // first render only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || waiting > 0) return;
    const next: typeof errors = {};
    if (!identifier.trim()) next.identifier = (d) => d.auth.errors.required;
    if (!password) next.password = (d) => d.auth.errors.required;
    setErrors(next);
    setAlert('');
    if (next.identifier || next.password) {
      after(() => {
        screen.fail(invalidFields(formRef.current));
        focusProblem(formRef.current);
      });
      return;
    }
    setBusy(true);
    try {
      const me = await api.login(identifier.trim(), password);
      writePref(PREF_REMEMBER, remember);
      writePref(PREF_IDENTIFIER, remember ? identifier.trim() : '');
      screen.robo.current?.shy(false);
      screen.succeed(me);
    } catch (err) {
      setBusy(false);
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'account_pending' || code === 'account_disabled') {
        writePref(PREF_REMEMBER, remember);
        writePref(PREF_IDENTIFIER, remember ? identifier.trim() : '');
        screen.go(code === 'account_pending' ? 'pending' : 'disabled', { identifier: identifier.trim() });
        return;
      }
      let message: Msg;
      if (code === 'invalid_credentials') {
        message = (d) => d.auth.errors.invalidCredentials;
        setPassword('');
        setErrors({ password: ' ' });
        passwordRef.current?.focus();
      } else if (code === 'rate_limited' || code === 'busy') {
        startWait((err as ApiError).retryAfter ?? (code === 'busy' ? 5 : 60));
        message = code === 'busy' ? BUSY : RATE_LIMITED;
      } else {
        message = err instanceof Error ? err.message : String(err);
      }
      // (a function given to a state setter is an updater: wrap the resolver)
      setAlert(() => message);
      screen.fail();
      // the message in view and focused (the button, disabled while checking, has lost the focus)
      if (code !== 'invalid_credentials') after(() => focusProblem(formRef.current));
    }
  };

  const noticeText = notice ? t.auth.notice[notice] : '';

  return (
    <form ref={formRef} className="auth-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="auth-title">
      <header className="auth-head" data-anim="field">
        <h2 id="auth-title" tabIndex={-1}>
          {t.auth.login.title}
        </h2>
        <p>{t.auth.login.subtitle}</p>
      </header>
      {noticeText && (
        <div className="auth-notice" id={noticeId} role="status" data-anim="field">
          {notice === 'sessionEnded' ? <ClockIcon size={16} /> : <CheckCircleIcon size={16} />}
          <span>{noticeText}</span>
        </div>
      )}
      <Alert message={alert} />
      <TextField
        ref={identifierRef}
        label={t.auth.fields.identifier}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t.auth.fields.identifierPlaceholder}
        value={identifier}
        error={msgText(errors.identifier, t)}
        describedBy={noticeText ? noticeId : undefined}
        onChange={(e) => {
          setIdentifier(e.target.value);
          setErrors((x) => ({ ...x, identifier: undefined }));
          lookAtText(screen.robo.current, e.target.value);
          if (notice) clearNotice();
        }}
        onFocus={(e) => lookAtText(screen.robo.current, e.target.value)}
        onBlur={() => screen.robo.current?.look(0, 0)}
      />
      <PasswordField
        ref={passwordRef}
        label={t.auth.fields.password}
        name="password"
        autoComplete="current-password"
        value={password}
        error={msgText(errors.password, t)?.trim() || undefined}
        describedBy={noticeText ? noticeId : undefined}
        aria-invalid={errors.password ? true : undefined}
        onChange={(e) => {
          setPassword(e.target.value);
          setErrors((x) => ({ ...x, password: undefined }));
        }}
        onFocus={() => {
          if (!shown) screen.robo.current?.shy(true);
          screen.setMood('password');
        }}
        onBlur={() => {
          screen.robo.current?.shy(false);
          screen.setMood(null);
        }}
        onReveal={(on) => {
          setShown(on);
          screen.robo.current?.shy(!on && document.activeElement === passwordRef.current);
        }}
      />
      <label className="auth-check" data-anim="field">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t.auth.fields.remember}</span>
      </label>
      <SubmitButton busy={busy} waiting={waiting} label={t.auth.login.submit} busyLabel={t.auth.login.submitting} />
      <p className="auth-forgot" data-anim="field">
        {t.auth.login.forgot}
      </p>
      {authState?.registrationOpen && (
        <p className="auth-switch" data-anim="field">
          {t.auth.login.noAccount}{' '}
          <button type="button" className="link-btn" onClick={() => screen.go('register')}>
            {t.auth.login.register}
          </button>
        </p>
      )}
    </form>
  );
}

// ---- registration and setup ----------------------------------------------------------------------------------------

type AccountField = keyof AccountInput | 'setupCode';

/** The account fields shared by the registration and the first-superadmin setup. */
function useAccountForm(policy: PasswordPolicy) {
  const t = useT();
  const [input, setInput] = useState<AccountInput>({ username: '', email: '', name: '', password: '', confirm: '' });
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<AccountField, Msg>>>({});
  const local = submitted ? validateAccount(input, policy, t) : {};
  // a server error wins over the local check of the same field (cleared server errors are undefined: skipped)
  const errors: FieldErrors<AccountField> = { ...local };
  for (const [field, message] of Object.entries(serverErrors) as Array<[AccountField, Msg | undefined]>) {
    const text = msgText(message, t);
    if (text) errors[field] = text;
  }
  const set = (field: keyof AccountInput, value: string) => {
    setInput((x) => ({ ...x, [field]: value }));
    setServerErrors((x) => ({ ...x, [field]: undefined }));
  };
  return { input, set, errors, setSubmitted, serverErrors, setServerErrors, validate: () => validateAccount(input, policy, t) };
}

function AccountFields({ form, policy, onLook }: { form: ReturnType<typeof useAccountForm>; policy: PasswordPolicy; onLook: (text: string) => void }) {
  const t = useT();
  const screen = useScreen();
  const f = t.auth.fields;
  const { input, set, errors } = form;
  const identity = [input.username.trim().toLowerCase(), input.email.trim().toLowerCase()];
  const shy = {
    onFocus: () => {
      screen.robo.current?.shy(true);
      screen.setMood('password');
    },
    onBlur: () => {
      screen.robo.current?.shy(false);
      screen.setMood(null);
    },
    onReveal: (on: boolean) => screen.robo.current?.shy(!on),
  };
  const look = {
    onFocus: (e: { target: HTMLInputElement }) => onLook(e.target.value),
    onBlur: () => screen.robo.current?.look(0, 0),
  };
  return (
    <>
      <TextField
        label={f.username}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={32}
        placeholder={f.usernamePlaceholder}
        hint={f.usernameHint}
        value={input.username}
        error={errors.username}
        onChange={(e) => {
          // usernames are stored in lower case: show it that way while typing
          set('username', e.target.value.toLowerCase().replace(/\s/g, ''));
          onLook(e.target.value);
        }}
        {...look}
      />
      <TextField
        label={f.email}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={f.emailPlaceholder}
        value={input.email}
        error={errors.email}
        onChange={(e) => {
          set('email', e.target.value);
          onLook(e.target.value);
        }}
        {...look}
      />
      <TextField
        label={f.name}
        name="name"
        autoComplete="name"
        maxLength={80}
        placeholder={f.namePlaceholder}
        hint={f.nameHint}
        value={input.name}
        error={errors.name}
        onChange={(e) => {
          set('name', e.target.value);
          onLook(e.target.value);
        }}
        {...look}
      />
      <PasswordField
        label={f.password}
        name="new-password"
        autoComplete="new-password"
        maxLength={policy.maxLength * 2}
        value={input.password}
        error={errors.password}
        onChange={(e) => set('password', e.target.value)}
        after={<StrengthMeter password={input.password} policy={policy} identity={identity} />}
        {...shy}
      />
      <PasswordField
        label={f.confirmPassword}
        name="confirm-password"
        autoComplete="new-password"
        value={input.confirm}
        error={errors.confirm}
        onChange={(e) => set('confirm', e.target.value)}
        after={<PolicyList password={input.password} confirm={input.confirm} policy={policy} identity={identity} />}
        {...shy}
      />
    </>
  );
}

/** Puts a server error on its field (or returns it for the form's alert). */
function placeServerError(err: unknown, form: ReturnType<typeof useAccountForm>): Msg | null {
  const placed = serverError(err);
  if (placed.field && placed.field !== 'identifier') {
    form.setServerErrors({ [placed.field === 'confirm' ? 'password' : placed.field]: placed.message });
    return null;
  }
  return placed.message;
}

export function RegisterForm() {
  const t = useT();
  const screen = useScreen();
  const { reload } = useAuth();
  const policy = screen.policy;
  const form = useAccountForm(policy);
  const formRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Msg>('');
  const after = useAfterRender();
  const { waiting, start: startWait } = useRetryCountdown();
  // "check the highlighted fields" goes once nothing is highlighted any more
  const shownAlert = alert === FIX_FIELDS && !Object.keys(form.errors).length ? '' : alert;

  useEffect(() => {
    if (!coarsePointer()) firstRef.current?.querySelector('input')?.focus();
  }, []);

  useEffect(() => {
    if (!waiting && (alert === REGISTER_LIMITED || alert === BUSY)) setAlert('');
  }, [waiting, alert]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || waiting > 0) return;
    form.setSubmitted(true);
    setAlert('');
    const errors = form.validate();
    if (Object.keys(errors).length) {
      setAlert(() => FIX_FIELDS);
      after(() => {
        screen.fail(invalidFields(formRef.current));
        focusProblem(formRef.current);
      });
      return;
    }
    setBusy(true);
    try {
      const username = form.input.username.trim().toLowerCase();
      await api.register({ username, email: form.input.email.trim(), name: form.input.name.trim(), password: form.input.password });
      screen.robo.current?.cheer();
      screen.go('registered', { username, identifier: username });
    } catch (err) {
      setBusy(false);
      const code = errorCode(err);
      let message: Msg | null;
      if (code === 'rate_limited' || code === 'busy') {
        // registrations are counted per network address: say so, and count down on the button
        startWait((err as ApiError).retryAfter ?? (code === 'busy' ? 5 : 60));
        message = code === 'busy' ? BUSY : REGISTER_LIMITED;
      } else message = placeServerError(err, form);
      setAlert(() => message ?? FIX_FIELDS);
      if (code === 'registration_closed') void reload();
      after(() => {
        const fields = invalidFields(formRef.current);
        screen.fail(fields.length ? fields : undefined);
        focusProblem(formRef.current);
      });
    }
  };

  return (
    <form ref={formRef} className="auth-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="auth-title">
      <header className="auth-head" data-anim="field">
        <h2 id="auth-title" tabIndex={-1}>
          {t.auth.register.title}
        </h2>
        <p>{t.auth.register.subtitle}</p>
      </header>
      <Alert message={shownAlert} />
      <div ref={firstRef} className="auth-fields">
        <AccountFields form={form} policy={policy} onLook={(text) => lookAtText(screen.robo.current, text)} />
      </div>
      <div className="auth-next" data-anim="field">
        <ClockIcon size={16} />
        <div>
          <strong>{t.auth.register.nextTitle}</strong>
          <p>{t.auth.register.next}</p>
        </div>
      </div>
      <SubmitButton busy={busy} waiting={waiting} label={t.auth.register.submit} busyLabel={t.auth.register.submitting} />
      <p className="auth-switch" data-anim="field">
        {t.auth.register.haveAccount}{' '}
        <button type="button" className="link-btn" onClick={() => screen.go('login')}>
          {t.auth.register.login}
        </button>
      </p>
    </form>
  );
}

/**
 * The desktop app (apps/desktop) may hand over the one-time setup code of the server it runs. Kept in memory only (form
 * state), and asked again after the server refused a code: the desktop shell reads the current one at every call.
 */
async function desktopSetupCode(): Promise<string | null> {
  try {
    const code = await window.solarDesktop?.getSetupCode?.();
    return typeof code === 'string' && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

export function SetupForm() {
  const t = useT();
  const lang = useLang();
  const screen = useScreen();
  const { authState, reload } = useAuth();
  const policy = screen.policy;
  const form = useAccountForm(policy);
  const formRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Msg>('');
  const needsCode = authState?.setupCodeRequired ?? true;
  const after = useAfterRender();
  const { waiting, start: startWait } = useRetryCountdown();
  const shownAlert = alert === FIX_FIELDS && !Object.keys(form.errors).length ? '' : alert;

  useEffect(() => {
    if (!waiting && (alert === RATE_LIMITED || alert === BUSY)) setAlert('');
  }, [waiting, alert]);

  useEffect(() => {
    if (!coarsePointer()) firstRef.current?.querySelector('input')?.focus();
    if (!needsCode) return;
    let live = true;
    void desktopSetupCode().then((value) => {
      if (live && value) {
        setCode((current) => current || value);
        setPrefilled(true);
      }
    });
    return () => {
      live = false;
    };
  }, [needsCode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || waiting > 0) return;
    form.setSubmitted(true);
    setAlert('');
    const errors: FieldErrors<AccountField> = form.validate();
    if (needsCode && !code.trim()) errors.setupCode = t.auth.errors.required;
    if (Object.keys(errors).length) {
      if (errors.setupCode) form.setServerErrors((x) => ({ ...x, setupCode: (d: Dict) => d.auth.errors.required }));
      setAlert(() => FIX_FIELDS);
      after(() => {
        screen.fail(invalidFields(formRef.current));
        focusProblem(formRef.current);
      });
      return;
    }
    setBusy(true);
    try {
      const me = await api.setup({
        username: form.input.username.trim().toLowerCase(),
        email: form.input.email.trim(),
        name: form.input.name.trim(),
        password: form.input.password,
        ...(needsCode ? { setupCode: code.trim() } : {}),
      });
      // the next login (after a logout) starts with this account filled in, unless the user turned remembering off
      if (readPref<boolean>(PREF_REMEMBER, true)) writePref(PREF_IDENTIFIER, me.user?.username ?? '');
      screen.succeed(me);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'setup_not_available') {
        // someone else finished the setup meanwhile: log in instead
        await reload();
        screen.go('login');
        return;
      }
      if (err instanceof ApiError && err.code === 'setup_code_invalid') {
        // the desktop app reads the server's current code at every call: if it differs, it replaces the refused one
        const fresh = await desktopSetupCode();
        if (fresh && fresh !== code.trim()) {
          setCode(fresh);
          setPrefilled(true);
          form.setServerErrors((x) => ({ ...x, setupCode: undefined }));
          setAlert(() => (d: Dict) => d.auth.setup.codeRefreshed);
          screen.fail(codeRef.current?.closest('.auth-field') ?? undefined);
          requestAnimationFrame(() => {
            // the field and the message above the form both in view; Enter submits again
            codeRef.current?.focus({ preventScroll: true });
            formRef.current?.querySelector('.auth-alert')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
          });
          return;
        }
      }
      const errCode = errorCode(err);
      let message: Msg | null;
      if (errCode === 'rate_limited' || errCode === 'busy') {
        startWait((err as ApiError).retryAfter ?? (errCode === 'busy' ? 5 : 60));
        message = errCode === 'busy' ? BUSY : RATE_LIMITED;
      } else message = placeServerError(err, form);
      setAlert(() => message ?? FIX_FIELDS);
      after(() => {
        const fields = invalidFields(formRef.current);
        screen.fail(fields.length ? fields : undefined);
        focusProblem(formRef.current);
      });
    }
  };

  return (
    <form ref={formRef} className="auth-form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="auth-title">
      <header className="auth-head" data-anim="field">
        <span className="auth-kicker">
          <ShieldIcon size={14} /> {roleName('superadmin', lang)}
        </span>
        <h2 id="auth-title" tabIndex={-1}>
          {t.auth.setup.title}
        </h2>
        <p>{t.auth.setup.subtitle}</p>
      </header>
      <Alert message={shownAlert} />
      <div ref={firstRef} className="auth-fields">
        {needsCode && (
          <TextField
            ref={codeRef}
            label={t.auth.fields.setupCode}
            name="setup-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mono"
            placeholder={t.auth.setup.codePlaceholder}
            value={code}
            error={form.errors.setupCode}
            hint={
              <>
                {prefilled && <strong className="prefilled">{t.auth.setup.codePrefilled} </strong>}
                {t.auth.setup.codeHint}
              </>
            }
            onChange={(e) => {
              setCode(e.target.value);
              setPrefilled(false);
              form.setServerErrors((x) => ({ ...x, setupCode: undefined }));
            }}
          />
        )}
        <AccountFields form={form} policy={policy} onLook={(text) => lookAtText(screen.robo.current, text)} />
      </div>
      <p className="auth-note" data-anim="field">
        <ShieldIcon size={14} /> {t.auth.setup.roleNote}
        {needsCode ? ` ${t.auth.setup.localOnly}` : ''}
      </p>
      <SubmitButton busy={busy} waiting={waiting} label={t.auth.setup.submit} busyLabel={t.auth.setup.submitting} />
    </form>
  );
}
