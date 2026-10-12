import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import { can, ROLES, USER_STATUSES, type ActivityAction, type AuthState, type Role } from '@solar/shared';
import { APP_NAME, APP_VERSION, type AppConfig } from '../config.js';
import { langOf, t, type Lang } from '../i18n.js';
import { formatZodIssues, zodErrorMap } from '../i18n/zodIssues.js';
import type { AuthService, Principal } from '../auth/authService.js';
import {
  authHttpError,
  clearedSessionCookie,
  isLoopbackRequest,
  isSecure,
  principalOf,
  requestMeta,
  requirePermission,
  requireUser,
  sessionCookie,
} from '../auth/http.js';
import { HttpError } from './httpError.js';

export interface AuthRouteDeps {
  config: AppConfig;
  auth: AuthService;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, lang: Lang): z.output<T> {
  const r = schema.safeParse(value ?? {}, { error: zodErrorMap(lang) });
  if (!r.success) throw new HttpError(400, formatZodIssues(r.error.issues, lang, true), 'invalid_input');
  return r.data;
}

/** Runs an AuthService call; its AuthError becomes the HTTP answer in the language of the request. */
async function call<T>(req: Request, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    throw authHttpError(err, req);
  }
}

// Field shapes only; the rules (username pattern, email, name, password policy) are checked by the AuthService with
// messages of their own. The limits here only keep absurd inputs from being hashed or stored.
const text = (max: number) => z.string().max(max);
const accountBody = z.object({
  username: text(64),
  email: text(320),
  name: text(200),
  password: text(1024),
});
const roleField = z.enum(ROLES as [Role, ...Role[]]);
const USER_ID = /^usr_[A-Za-z0-9]+$/;

/** Logs a principal in: the session cookie and the AuthMe body. */
function signIn(req: Request, res: Response, auth: AuthService, session: { principal: Principal; token: string; maxAgeSeconds: number }, status = 200): void {
  res.append('Set-Cookie', sessionCookie(session.token, session.maxAgeSeconds, isSecure(req)));
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(auth.me(session.principal));
}

/**
 * `/api/auth/*`: login state, registration, login/logout, own password, first-superadmin setup. Public: state, login,
 * register, setup (and logout, which is harmless); the rest needs a logged-in user.
 */
export function createAuthRouter({ config, auth }: AuthRouteDeps): Router {
  const r = express.Router();

  r.get('/state', async (req, res) => {
    const body: AuthState = {
      appName: APP_NAME,
      version: APP_VERSION,
      setupRequired: await auth.setupRequired(),
      setupCodeRequired: false,
      registrationOpen: true,
      me: req.principal ? auth.me(req.principal) : null,
      passwordPolicy: auth.passwordPolicy(),
    };
    // while no account exists, registration waits for the setup (which asks for the setup code, unless the access token
    // is used)
    if (body.setupRequired) {
      body.registrationOpen = false;
      body.setupCodeRequired = req.principal?.kind !== 'token';
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  r.post('/register', async (req, res) => {
    const body = parse(accountBody, req.body, req.lang);
    await call(req, () => auth.register(body, requestMeta(req)));
    res.status(201).json({ status: 'pending' });
  });

  r.post('/login', async (req, res) => {
    const body = parse(z.object({ identifier: text(320).min(1), password: text(1024).min(1) }), req.body, req.lang);
    const session = await call(req, () => auth.login(body.identifier, body.password, requestMeta(req)));
    signIn(req, res, auth, session);
  });

  r.post('/logout', async (req, res) => {
    await auth.logout(req.principal ?? null, requestMeta(req));
    res.append('Set-Cookie', clearedSessionCookie(isSecure(req)));
    res.status(204).end();
  });

  r.post('/setup', async (req, res) => {
    const body = parse(accountBody.extend({ setupCode: text(64).optional() }), req.body, req.lang);
    const session = await call(req, () => auth.setup(body, req.principal ?? null, isLoopbackRequest(req, config), requestMeta(req), body.setupCode));
    signIn(req, res, auth, session, 201);
  });

  r.get('/me', requireUser, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(auth.me(principalOf(req)));
  });

  r.post('/password', requireUser, async (req, res) => {
    const body = parse(z.object({ currentPassword: text(1024).min(1), newPassword: text(1024) }), req.body, req.lang);
    await call(req, () => auth.changeOwnPassword(principalOf(req), body.currentPassword, body.newPassword, requestMeta(req)));
    res.status(204).end();
  });

  return r;
}

/**
 * `/api/users/*`: account administration. Listing needs `users.view` (superadmin, Head of IT); what may be changed on
 * which account is decided per action by the AuthService (shared canActOnUser / assignableRoles).
 */
export function createUsersRouter({ auth }: AuthRouteDeps): Router {
  const r = express.Router();
  r.use(requireUser);

  const userId = (req: Request) => {
    const id = String(req.params.id ?? '');
    if (!USER_ID.test(id)) throw new HttpError(404, t(langOf(req), 'users.notFound'), 'user_not_found');
    return id;
  };

  /** Records an attempt refused by the route's permission check (the account the URL names, when it is an id). */
  const refused = (action: ActivityAction) => (req: Request) => {
    const id = typeof req.params.id === 'string' && USER_ID.test(req.params.id) ? req.params.id : null;
    auth.auditForbidden(principalOf(req), requestMeta(req), action, { type: 'user', id, label: null });
  };
  /** A permission check that records who was refused. */
  const allowed = (permission: Parameters<typeof requirePermission>[0], action: ActivityAction) => requirePermission(permission, refused(action));

  r.get('/', requirePermission('users.view'), async (req, res) => {
    const q = parse(z.object({ status: z.enum(USER_STATUSES as [string, ...string[]]).optional() }), req.query, req.lang);
    res.json(await call(req, () => auth.listUsers(principalOf(req), { status: q.status as (typeof USER_STATUSES)[number] | undefined })));
  });

  r.get('/pending-count', requirePermission('users.view'), async (req, res) => {
    res.json({ count: await call(req, () => auth.pendingCount(principalOf(req))) });
  });

  r.get('/:id', requirePermission('users.view'), async (req, res) => {
    res.json(await call(req, () => auth.getUserFor(principalOf(req), userId(req))));
  });

  r.post('/', allowed('users.manage', 'user.create'), async (req, res) => {
    const body = parse(accountBody.extend({ role: roleField.default('staff') }), req.body, req.lang);
    res.status(201).json(await call(req, () => auth.createUser(principalOf(req), body, requestMeta(req))));
  });

  r.patch('/:id', async (req, res) => {
    const id = userId(req);
    const body = parse(
      z.object({ role: roleField.optional(), status: z.string().optional(), name: text(200).optional() }),
      req.body,
      req.lang,
    );
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
      throw new HttpError(400, t(req.lang, 'users.cannotSetPending'), 'invalid_input');
    }
    // without any user permission there is nothing this route can do
    const principal = principalOf(req);
    if (!(['users.approve', 'users.disable', 'users.manage'] as const).some((p) => can(principal.role, p))) {
      const action: ActivityAction =
        body.role !== undefined ? 'user.role_change' : body.status === 'disabled' ? 'user.disable' : body.status === 'active' ? 'user.enable' : 'user.rename';
      auth.auditForbidden(principal, requestMeta(req), action, { type: 'user', id, label: null }, body.role !== undefined ? { to: body.role } : undefined);
      throw new HttpError(403, t(req.lang, 'auth.forbidden'), 'forbidden');
    }
    const status = body.status as 'active' | 'disabled' | undefined;
    res.json(await call(req, () => auth.updateUser(principal, id, { role: body.role, status, name: body.name }, requestMeta(req))));
  });

  r.post('/:id/approve', allowed('users.approve', 'user.approve'), async (req, res) => {
    const id = userId(req);
    const body = parse(z.object({ role: roleField.optional() }), req.body, req.lang);
    res.json(await call(req, () => auth.approve(principalOf(req), id, body.role, requestMeta(req))));
  });

  r.post('/:id/password', allowed('users.manage', 'user.password_reset'), async (req, res) => {
    const id = userId(req);
    const body = parse(z.object({ password: text(1024) }), req.body, req.lang);
    await call(req, () => auth.resetPassword(principalOf(req), id, body.password, requestMeta(req)));
    res.status(204).end();
  });

  r.delete('/:id', allowed('users.manage', 'user.delete'), async (req, res) => {
    const id = userId(req);
    await call(req, () => auth.deleteUser(principalOf(req), id, requestMeta(req)));
    res.status(204).end();
  });

  return r;
}
