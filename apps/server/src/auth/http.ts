import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { can, type Permission } from '@solar/shared';
import type { AppConfig } from '../config.js';
import { langOf, t } from '../i18n.js';
import { HttpError } from '../routes/httpError.js';
import { AuthError, busyAsAuthError, SESSION_COOKIE, type AuthService, type Principal, type RequestMeta } from './authService.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Who makes the request (set by authenticate): an account's session, the access token, or null (anonymous). */
      principal?: Principal | null;
    }
  }
}

/** An AuthError as the HTTP answer, in the language of the request (429 carries Retry-After). */
export function authHttpError(error: unknown, req: Request): unknown {
  const err = busyAsAuthError(error);
  if (!(err instanceof AuthError)) return err;
  const headers = err.retryAfterSeconds ? { 'Retry-After': String(err.retryAfterSeconds) } : undefined;
  return new HttpError(err.status, err.in(langOf(req)), err.code, headers);
}

// ---- cookies -------------------------------------------------------------------------------------------------------

/** The cookies of a request (first value of each name wins; malformed parts are skipped). */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (!cookies.has(name)) {
      try {
        cookies.set(name, decodeURIComponent(value));
      } catch {
        // a value that is not valid percent-encoding is not one of ours
      }
    }
  }
  return cookies;
}

/**
 * The session cookie: HttpOnly (no script can read it), SameSite=Lax (not sent on cross-site requests other than
 * top-level navigations), Path=/, and Secure when the request came over HTTPS (directly, or through a trusted proxy -
 * TRUST_PROXY). Max-Age = the absolute session lifetime; the server enforces the idle expiry itself.
 */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** HTTPS as Express sees it: a TLS socket, or X-Forwarded-Proto from a trusted proxy (`trust proxy` = TRUST_PROXY). */
export function isSecure(req: Request): boolean {
  return req.secure === true;
}

// ---- client address and loopback ------------------------------------------------------------------------------------

/** The client address for rate limits: the socket's, or the one a trusted proxy reports (TRUST_PROXY). */
export function clientIp(req: Request): string | null {
  return req.ip || req.socket?.remoteAddress || null;
}

export function requestMeta(req: Request): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: clientIp(req), userAgent: typeof ua === 'string' ? ua : null };
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (a === '::1') return true;
  return isIP(a) === 4 && a.startsWith('127.');
}

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
}

/** Headers a reverse proxy adds: a request with any of them did not come straight from this computer. */
const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via'];

/**
 * True only for a request that looks like it was made on the server computer itself, directly: the TCP peer is a
 * loopback address, no reverse proxy is configured (TRUST_PROXY) or visible (forwarding headers), the Host names this
 * computer (no DNS-rebound name) and a browser Origin, when sent, is local too. Used for the first-superadmin setup -
 * as a necessary condition only: a reverse proxy on the same computer that rewrites Host to 127.0.0.1 and adds no
 * forwarding headers (nginx's default `proxy_pass`) makes outside requests pass this check, so the setup also asks for
 * the one-time setup code only the operator can read (AuthService.setupCode()).
 */
export function isLoopbackRequest(req: Request, config: AppConfig): boolean {
  if (config.auth.trustProxy > 0) return false;
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = req.headers.host;
  if (!host || !LOOPBACK_NAMES.has(hostnameOf(host))) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (!LOOPBACK_NAMES.has(new URL(origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---- middleware ----------------------------------------------------------------------------------------------------

/** The access token a request presents: `Authorization: Bearer <token>`, else `?token=` (event stream, downloads). */
function presentedToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && /^bearer\s/i.test(header)) return header.slice(7).trim();
  return typeof req.query.token === 'string' ? req.query.token : null;
}

/**
 * The routes anyone may call (with the router's own path, below /api). A browser may still hold an old access token
 * (rotated or removed SOLAR_ACCESS_TOKEN, sent as Bearer header or ?token=): on these routes a wrong token is ignored
 * instead of refused, so it cannot lock the user out of the login, registration and setup forms.
 */
const PUBLIC_AUTH_ROUTES = new Set(['GET /auth/state', 'HEAD /auth/state', 'POST /auth/login', 'POST /auth/register', 'POST /auth/setup', 'POST /auth/logout']);

function isPublicAuthRoute(req: Request): boolean {
  // Express matches paths case-insensitively and with or without a trailing slash
  return PUBLIC_AUTH_ROUTES.has(`${req.method} ${req.path.toLowerCase().replace(/\/+$/, '')}`);
}

/**
 * Sets `req.principal`: SOLAR_ACCESS_TOKEN (Bearer header or ?token=) acts as a superadmin; otherwise the solar_session
 * cookie's account; otherwise null. A presented token that is wrong is refused (401) instead of being ignored - except
 * on the public auth routes, where it is treated as absent (the cookie, if any, still counts).
 */
export function authenticate(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.principal = null;
      const token = presentedToken(req);
      if (token !== null) {
        const principal = auth.tokenPrincipal(token);
        if (principal) {
          req.principal = principal;
          return next();
        }
        if (!isPublicAuthRoute(req)) throw new HttpError(401, t(langOf(req), 'auth.invalidToken'), 'invalid_token');
      }
      const cookie = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
      if (cookie) req.principal = await auth.sessionPrincipal(cookie);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 401 without a principal (and the stale session cookie, if any, is cleared). */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.principal) return next();
  if (parseCookies(req.headers.cookie).has(SESSION_COOKIE)) res.append('Set-Cookie', clearedSessionCookie(isSecure(req)));
  next(new HttpError(401, t(langOf(req), 'auth.unauthenticated'), 'unauthenticated'));
}

/**
 * 403 unless the principal's role has the permission (use after requireUser). `onDenied` is told about a logged-in
 * principal refused here (the activity log records refused attempts at admin and settings routes); it must not throw
 * and is never awaited.
 */
export function requirePermission(permission: Permission, onDenied?: (req: Request) => void) {
  // generic in the route parameters, so a route keeps its typed req.params
  return <P>(req: Request<P>, _res: Response, next: NextFunction) => {
    if (can(req.principal?.role, permission)) return next();
    if (req.principal && onDenied) {
      try {
        onDenied(req as unknown as Request);
      } catch {
        // recording must never change the answer
      }
    }
    next(new HttpError(req.principal ? 403 : 401, t(langOf(req), req.principal ? 'auth.forbidden' : 'auth.unauthenticated'), req.principal ? 'forbidden' : 'unauthenticated'));
  };
}

/** The principal of a request that passed requireUser. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw new HttpError(401, t(langOf(req), 'auth.unauthenticated'), 'unauthenticated');
  return req.principal;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** "host[:port]" in lower case without the default port of the scheme. */
function normalizeHostPort(host: string, scheme: 'http' | 'https' | null): string {
  const h = host.trim().toLowerCase();
  if (scheme === 'https' && h.endsWith(':443')) return h.slice(0, -4);
  if (scheme === 'http' && h.endsWith(':80')) return h.slice(0, -3);
  return h;
}

/**
 * CSRF defence for cookie authentication: a state-changing request (POST/PUT/PATCH/DELETE) that is not authenticated by
 * a VALID access token must come from SOLAR's own origin (runs after authenticate: merely presenting some token - which
 * a cross-site form can put in ?token= - does not skip the check). A browser sends Origin with every such request: it must name the host
 * the request was sent to (Host, or X-Forwarded-Host from a trusted proxy). Without Origin, Sec-Fetch-Site must not say
 * cross-site / same-site. Requests without either header are not from a browser (scripts, curl) and carry no ambient
 * cookie by accident. SameSite=Lax alone is not enough: other ports and subdomains of the same site count as
 * "same-site" and would still send the cookie.
 */
export function sameOriginGuard(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    // the access token is no ambient credential (a browser never adds it on its own)
    if (req.principal?.kind === 'token') return next();
    const lang = langOf(req);
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let url: URL | null = null;
      try {
        url = new URL(origin);
      } catch {
        // "null" (sandboxed frames, some redirects) and malformed values are refused
      }
      const forwarded = config.auth.trustProxy > 0 ? req.headers['x-forwarded-host'] : undefined;
      const target = (typeof forwarded === 'string' && forwarded ? forwarded.split(',')[0]! : req.headers.host) ?? '';
      const scheme = url?.protocol === 'https:' ? 'https' : url?.protocol === 'http:' ? 'http' : null;
      if (!url || !scheme || !target || normalizeHostPort(url.host, scheme) !== normalizeHostPort(target, scheme)) {
        return next(new HttpError(403, t(lang, 'api.forbiddenOrigin', { origin }), 'forbidden'));
      }
      return next();
    }
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return next(new HttpError(403, t(lang, 'api.forbiddenOrigin', { origin: String(site) }), 'forbidden'));
    next();
  };
}
