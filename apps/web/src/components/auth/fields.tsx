import { forwardRef, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { useT, type Dict } from '../../lib/i18n';
import { CheckCircleIcon, EyeIcon, EyeOffIcon } from '../Icons';

/*
 * Form fields of the login, registration and setup screens, the change-password dialog and the user administration:
 * a label, the input, a hint and an error, wired with aria-describedby / aria-invalid.
 */

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

interface FieldProps extends InputProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Extra content after the input (e.g. the strength meter). */
  after?: ReactNode;
  /** Ids of other elements that describe the input too (e.g. a notice above the form). */
  describedBy?: string;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField({ label, hint, error, after, describedBy, className, ...input }, ref) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`auth-field${error ? ' invalid' : ''}`} data-anim="field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={ref}
        id={id}
        className={`input${className ? ` ${className}` : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId, describedBy].filter(Boolean).join(' ') || undefined}
        {...input}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {after}
    </div>
  );
});

/**
 * A password input with a show/hide button and a Caps Lock warning. `visible` controls the show/hide state from outside
 * (a generated password is shown so it can be handed over); without it the field keeps its own state.
 */
export const PasswordField = forwardRef<HTMLInputElement, FieldProps & { onReveal?: (shown: boolean) => void; visible?: boolean }>(function PasswordField(
  { label, hint, error, after, describedBy, onReveal, visible, onKeyDown, onKeyUp, onBlur, ...input },
  ref,
) {
  const t = useT();
  const id = useId();
  const [ownShown, setShown] = useState(false);
  const shown = visible ?? ownShown;
  const [caps, setCaps] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const capsId = caps ? `${id}-caps` : undefined;
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'));
  };
  return (
    <div className={`auth-field${error ? ' invalid' : ''}`} data-anim="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          ref={ref}
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, capsId, hintId, describedBy].filter(Boolean).join(' ') || undefined}
          onKeyDown={(e) => {
            checkCaps(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            checkCaps(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          {...input}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-controls={id}
          aria-pressed={shown}
          aria-label={shown ? t.auth.fields.hidePassword : t.auth.fields.showPassword}
          title={shown ? t.auth.fields.hidePassword : t.auth.fields.showPassword}
          onClick={() => {
            setShown(!shown);
            onReveal?.(!shown);
          }}
        >
          {shown ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>
      {caps && (
        <p id={capsId} className="caps-hint" role="status">
          ⇪ {t.auth.fields.capsLock}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {after}
    </div>
  );
});

// ---- password rules -----------------------------------------------------------------------------------------------

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

export const DEFAULT_POLICY: PasswordPolicy = { minLength: 10, maxLength: 128 };

/** Length as the server counts it (Unicode NFKC, code points). */
export function passwordLength(password: string): number {
  return Array.from(password.normalize('NFKC')).length;
}

/** 0 (too short) .. 4 (strong): length first, then variety; obvious patterns stay weak. */
export function passwordStrength(password: string, policy: PasswordPolicy = DEFAULT_POLICY, identity: string[] = []): 0 | 1 | 2 | 3 | 4 {
  const length = passwordLength(password);
  if (length < policy.minLength || !password.trim()) return 0;
  const lower = password.toLowerCase();
  if (identity.some((v) => v && lower === v.toLowerCase())) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9\s]/, /\s/].filter((r) => r.test(password)).length;
  const unique = new Set(Array.from(lower)).size;
  const obvious = /^(.)\1+$/.test(lower) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|password|sandi|solar)/.test(lower) || unique < 5;
  let score = 1;
  if (length >= 12) score++;
  if (length >= 16 || classes >= 3) score++;
  if (length >= 20 || (length >= 14 && classes >= 4)) score++;
  if (obvious) score = Math.min(score, 1);
  return Math.min(4, score) as 1 | 2 | 3 | 4;
}

export function StrengthMeter({ password, policy, identity }: { password: string; policy: PasswordPolicy; identity: string[] }) {
  const t = useT();
  if (!password) return null;
  const score = passwordStrength(password, policy, identity);
  const words = t.auth.strength;
  const label = [words.level0, words.level1, words.level2, words.level3, words.level4][score];
  return (
    <div className="strength" data-score={score}>
      <div className="strength-bar" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} data-on={score >= i ? 'true' : undefined} />
        ))}
      </div>
      <span className="strength-label">
        {words.label}: <b>{label}</b>
      </span>
    </div>
  );
}

/** The password rules as a checklist that ticks itself while typing. */
export function PolicyList({ password, confirm, policy, identity }: { password: string; confirm?: string; policy: PasswordPolicy; identity: string[] }) {
  const t = useT();
  const words = t.auth.policy;
  const length = passwordLength(password);
  const lower = password.toLowerCase();
  const rules: Array<[string, boolean]> = [
    [words.length(policy.minLength, policy.maxLength), length >= policy.minLength && length <= policy.maxLength && password.trim().length > 0],
    [words.notIdentity, password.length > 0 && !identity.some((v) => v && lower === v.toLowerCase())],
  ];
  if (confirm !== undefined) rules.push([words.match, password.length > 0 && password === confirm]);
  return (
    <ul className="policy" aria-label={words.label}>
      {rules.map(([text, ok]) => (
        <li key={text} data-ok={ok ? 'true' : undefined}>
          <CheckCircleIcon size={14} aria-hidden="true" />
          <span>{text}</span>
          <span className="sr-only"> ({ok ? words.met : words.notMet})</span>
        </li>
      ))}
    </ul>
  );
}

// ---- validation --------------------------------------------------------------------------------------------------

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountInput {
  username: string;
  email: string;
  name: string;
  password: string;
  confirm: string;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Client-side checks of an account form (the server checks the same rules again). */
export function validateAccount(input: AccountInput, policy: PasswordPolicy, t: Dict): FieldErrors<keyof AccountInput> {
  const e = t.auth.errors;
  const errors: FieldErrors<keyof AccountInput> = {};
  const username = input.username.normalize('NFKC').trim().toLowerCase();
  if (!username) errors.username = e.required;
  else if (!USERNAME_PATTERN.test(username)) errors.username = e.usernameFormat;
  const email = input.email.trim();
  if (!email) errors.email = e.required;
  else if (!EMAIL_PATTERN.test(email)) errors.email = e.emailFormat;
  const name = input.name.trim();
  if (!name) errors.name = e.required;
  else if (Array.from(name).length > 80) errors.name = e.nameLength;
  const passwordError = validatePassword(input.password, policy, [username, email], t);
  if (passwordError) errors.password = passwordError;
  if (!input.confirm) errors.confirm = e.required;
  else if (input.confirm !== input.password) errors.confirm = e.mismatch;
  return errors;
}

export function validatePassword(password: string, policy: PasswordPolicy, identity: string[], t: Dict): string | undefined {
  const e = t.auth.errors;
  if (!password) return e.required;
  const length = passwordLength(password);
  if (length < policy.minLength) return e.passwordShort(policy.minLength);
  if (length > policy.maxLength) return e.passwordLong(policy.maxLength);
  if (!password.trim()) return e.passwordBlank;
  const lower = password.normalize('NFKC').toLowerCase();
  if (identity.some((v) => v && lower === v.toLowerCase())) return e.passwordSameAsIdentity;
  return undefined;
}

/** "14 menit 32 detik" / "14 minutes 32 seconds" for a rate limit. */
export function waitText(seconds: number, t: Dict): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return t.auth.time.seconds(s);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? t.auth.time.minutesSeconds(m, rest) : t.auth.time.minutes(m);
}

/** "14:32" for the countdown on a button. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A message kept in state: a resolver (re-rendered in the current language after a language switch) or a plain string
 * (the server's own text, already in the language of the request).
 */
export type Msg = string | ((t: Dict) => string);

export function msgText(msg: Msg | undefined, t: Dict): string | undefined {
  if (msg === undefined) return undefined;
  return typeof msg === 'function' ? msg(t) : msg;
}

/** Fields the server names at the start of a validation message ("username: ...", "password: ..."). */
const FIELD_PREFIX = /^(username|email|name|password|newPassword|setupCode)\s*:\s*/i;

/**
 * Where a server error belongs: a field (by code, or by the field the message starts with) or the whole form. Known
 * codes get the interface's own words (resolvers: they follow a language switch); anything else keeps the server's text.
 */
export function serverError(err: unknown): { field?: keyof AccountInput | 'setupCode' | 'identifier'; message: Msg; retryAfter?: number } {
  if (!(err instanceof ApiError)) return { message: err instanceof Error ? err.message : String(err) };
  switch (err.code) {
    case 'username_taken':
      return { field: 'username', message: (t) => t.auth.errors.usernameTaken };
    case 'email_taken':
      return { field: 'email', message: (t) => t.auth.errors.emailTaken };
    case 'registration_closed':
      return { message: (t) => t.auth.errors.registrationClosed };
    case 'setup_code_invalid':
      return { field: 'setupCode', message: (t) => t.auth.errors.setupCodeInvalid };
    case 'setup_forbidden':
      return { message: (t) => t.auth.errors.setupForbidden };
    case 'rate_limited': {
      const wait = err.retryAfter ?? 60;
      return { message: (t) => t.auth.errors.rateLimited(waitText(wait, t)), retryAfter: wait };
    }
    case 'busy':
      return { message: (t) => t.auth.errors.busy, retryAfter: err.retryAfter };
    case 'weak_password':
    case 'invalid_input': {
      const match = FIELD_PREFIX.exec(err.message);
      if (match) {
        const name = match[1]!.toLowerCase();
        const field = name === 'newpassword' ? 'password' : name === 'setupcode' ? 'setupCode' : (name as keyof AccountInput);
        const text = err.message.slice(match[0].length);
        return { field, message: text ? text.charAt(0).toUpperCase() + text.slice(1) : err.message };
      }
      return { field: err.code === 'weak_password' ? 'password' : undefined, message: err.message };
    }
    default:
      return { message: err.message };
  }
}
