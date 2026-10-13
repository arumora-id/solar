import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ROLE_INFO, type AuthMe, type AuthState, type Permission, type Role, type User } from '@solar/shared';
import { api, ApiError, clearLegacyToken, isUnreachable, onUnauthorized } from './api';
import { getLang, useLang } from './i18n';

/*
 * Who is using SOLAR. On start the UI asks GET /api/auth/state: no account yet -> the first-superadmin setup; nobody
 * logged in -> the login screen; otherwise the app. A 401 from any API call outside the auth routes (lib/api.ts
 * onUnauthorized) or a `signed_out` message on the event stream (lib/store.tsx) means the session ended: back to the
 * login screen with a short notice. The URL is left as it is, so the user lands where they were after logging in again.
 *
 * All tabs of a browser share one session cookie, so they must show the same account: a login or logout is announced
 * to the other tabs (BroadcastChannel), and a tab checks the account again when it becomes visible or gets focus (for
 * browsers without BroadcastChannel). A tab that finds another account logged in switches to it; one on the login
 * screen enters the app as it. The server also ends the session a new login replaces (its event streams get
 * `signed_out`).
 */

export type AuthStatus = 'loading' | 'unreachable' | 'signedOut' | 'signedIn';

/** Why the login screen is shown (a notice above the form). */
export type SignedOutNotice = 'loggedOut' | 'sessionEnded' | 'setupDone' | null;

/** How a logout went: only 'ok' ends the session; otherwise the user is still logged in on this device. */
export type LogoutResult = 'ok' | 'unreachable' | 'failed';

interface AuthContextValue {
  status: AuthStatus;
  /** Answer of GET /api/auth/state (setup needed, registration open, password policy) - without the account itself. */
  authState: AuthState | null;
  me: AuthMe | null;
  /** The account (null while signed out, or for the access token). */
  user: User | null;
  role: Role | null;
  notice: SignedOutNotice;
  /** The app was just entered from the login screen: the shell plays its entrance once. */
  justEntered: boolean;
  can(permission: Permission): boolean;
  /** Reads GET /api/auth/state again (retry after "server unreachable", setup done elsewhere). */
  reload(): Promise<void>;
  /** Tells the other tabs of this browser that a login succeeded here (as soon as the server answered). */
  announceLogin(me: AuthMe): void;
  /** A login or setup succeeded (the screen has played its exit). */
  enter(me: AuthMe): void;
  /** Ends the session on the server; the screen changes only when the server confirmed it. */
  logout(): Promise<LogoutResult>;
  /** The server ended the session (401, signed_out): back to the login screen. */
  sessionEnded(): void;
  /** Reads GET /api/auth/me again (own name changed). */
  refreshMe(): Promise<void>;
  clearNotice(): void;
  showNotice(notice: SignedOutNotice): void;
  markEntered(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Messages between the tabs of one browser. */
type TabMessage = { type: 'login'; userId: string | null } | { type: 'logout' };

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel('solar-auth') : null;
  } catch {
    return null;
  }
}

/** The login state without the account in it: `me` is kept in one place only, and dropped at sign-out. */
function withoutMe(state: AuthState): AuthState {
  return { ...state, me: null };
}

const idOf = (me: AuthMe | null | undefined) => me?.user?.id ?? null;

/** Focus and visibility checks of the account: at most one per this many milliseconds. */
const RECHECK_MS = 1500;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [notice, setNotice] = useState<SignedOutNotice>(null);
  const [justEntered, setJustEntered] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const meRef = useRef(me);
  meRef.current = me;
  const channel = useRef<BroadcastChannel | null>(null);
  const lastCheck = useRef(0);

  /** Shows what GET /api/auth/state answered: the app for its account, else the login (or setup) screen. */
  const apply = useCallback((state: AuthState) => {
    setAuthState(withoutMe(state));
    if (state.me && !state.setupRequired) {
      statusRef.current = 'signedIn';
      setMe(state.me);
      setStatus('signedIn');
    } else {
      statusRef.current = 'signedOut';
      setMe(null);
      setStatus('signedOut');
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      apply(await api.authState());
    } catch (err) {
      if (!isUnreachable(err) && !(err instanceof ApiError && err.status >= 500)) console.error(err);
      statusRef.current = 'unreachable';
      setStatus('unreachable');
    }
  }, [apply]);

  useEffect(() => {
    // older versions kept SOLAR_ACCESS_TOKEN in the browser; the session cookie replaces it
    clearLegacyToken();
    void reload();
  }, [reload]);

  /** Back to the login screen; the account's profile leaves the page's state at once. */
  const signOutHere = useCallback((why: SignedOutNotice) => {
    statusRef.current = 'signedOut';
    setMe(null);
    setAuthState((s) => (s ? { ...s, me: null } : s));
    setNotice(why);
    setJustEntered(false);
    setStatus('signedOut');
  }, []);

  const sessionEnded = useCallback(() => {
    if (statusRef.current !== 'signedIn') return;
    // the account's profile leaves the page's state at once; the splash shows while the state is read again
    statusRef.current = 'loading';
    setMe(null);
    setAuthState((s) => (s ? { ...s, me: null } : s));
    setJustEntered(false);
    setStatus('loading');
    // registration may have opened or closed meanwhile; and if another tab logged in (its login replaced this
    // session), this browser is logged in again: follow it instead of asking for a login
    void api
      .authState()
      .then((state) => {
        if (statusRef.current !== 'loading') return;
        if (state.me && !state.setupRequired) {
          setNotice(null);
          apply(state);
        } else {
          setAuthState(withoutMe(state));
          signOutHere('sessionEnded');
        }
      })
      .catch(() => {
        if (statusRef.current === 'loading') signOutHere('sessionEnded');
      });
  }, [apply, signOutHere]);

  useEffect(() => onUnauthorized(() => sessionEnded()), [sessionEnded]);

  /**
   * Is this tab still showing the account the browser is logged in as? Another tab may have logged in as someone else
   * (the cookie is shared) or the account may have been renamed.
   */
  const recheck = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheck.current < RECHECK_MS) return;
    lastCheck.current = now;
    if (statusRef.current === 'signedIn') {
      let fresh: AuthMe;
      try {
        fresh = await api.me();
      } catch {
        return; // a 401 ends the session through onUnauthorized; anything else: try again later
      }
      if (statusRef.current !== 'signedIn') return;
      if (idOf(fresh) !== idOf(meRef.current)) void reload();
      else if (JSON.stringify(fresh) !== JSON.stringify(meRef.current)) setMe(fresh);
    } else if (statusRef.current === 'signedOut') {
      try {
        const state = await api.authState();
        if (statusRef.current !== 'signedOut') return;
        if (state.me && !state.setupRequired) {
          setNotice(null);
          apply(state);
        } else setAuthState(withoutMe(state));
      } catch {
        // unreachable for now: the login form says so when it is used
      }
    }
  }, [apply, reload]);

  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    window.addEventListener('focus', onShow);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener('focus', onShow);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [recheck]);

  // the other tabs of this browser
  useEffect(() => {
    const ch = openChannel();
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<TabMessage>) => {
      const msg = e.data;
      if (msg?.type === 'logout') {
        if (statusRef.current === 'signedIn') signOutHere('loggedOut');
      } else if (msg?.type === 'login') {
        if (statusRef.current === 'signedIn' && idOf(meRef.current) === msg.userId) return;
        if (statusRef.current === 'signedIn' || statusRef.current === 'signedOut') {
          lastCheck.current = 0;
          void reload();
        }
      }
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [reload, signOutHere]);

  const announceLogin = useCallback((next: AuthMe) => {
    try {
      channel.current?.postMessage({ type: 'login', userId: idOf(next) } satisfies TabMessage);
    } catch {
      // the other tabs notice on their next focus
    }
  }, []);

  const enter = useCallback((next: AuthMe) => {
    statusRef.current = 'signedIn';
    setMe(next);
    setNotice(null);
    setJustEntered(true);
    setAuthState((s) => (s ? { ...s, setupRequired: false, setupCodeRequired: false, registrationOpen: true, me: null } : s));
    setStatus('signedIn');
  }, []);

  const logout = useCallback(async (): Promise<LogoutResult> => {
    try {
      await api.logout();
    } catch (err) {
      // the cookie is HttpOnly: only the server can end the session. Without its answer the user is still logged in
      // here (and in a new tab), so the screen must not claim otherwise. A 401 means the session was already gone.
      if (!(err instanceof ApiError && err.status === 401)) return isUnreachable(err) ? 'unreachable' : 'failed';
    }
    try {
      channel.current?.postMessage({ type: 'logout' } satisfies TabMessage);
    } catch {
      // the other tabs get `signed_out` on their event stream anyway
    }
    signOutHere('loggedOut');
    return 'ok';
  }, [signOutHere]);

  const refreshMe = useCallback(async () => {
    try {
      const fresh = await api.me();
      if (statusRef.current !== 'signedIn') return;
      if (idOf(fresh) !== idOf(meRef.current)) void reload();
      else setMe(fresh);
    } catch {
      // a 401 is handled by onUnauthorized
    }
  }, [reload]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(me?.permissions ?? []);
    return {
      status,
      authState,
      me,
      user: me?.user ?? null,
      role: me?.role ?? null,
      notice,
      justEntered,
      can: (permission) => permissions.has(permission),
      reload,
      announceLogin,
      enter,
      logout,
      sessionEnded,
      refreshMe,
      clearNotice: () => setNotice(null),
      showNotice: setNotice,
      markEntered: () => setJustEntered(false),
    };
  }, [status, authState, me, notice, justEntered, reload, announceLogin, enter, logout, sessionEnded, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Name of a role in the interface language (from the shared ROLE_INFO, like the server's GET /api/roles). */
export function roleName(role: Role, lang = getLang()): string {
  return ROLE_INFO[role]?.name[lang] ?? role;
}

export function roleDescription(role: Role, lang = getLang()): string {
  return ROLE_INFO[role]?.description[lang] ?? '';
}

/** roleName() that follows language switches. */
export function useRoleName(): (role: Role) => string {
  const lang = useLang();
  return (role) => roleName(role, lang);
}

/** Up to two initials of a display name ("Budi Santoso" -> "BS"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}
