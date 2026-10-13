/**
 * Authenticated access for tests that exercise the API itself (not its access control): SOLAR_ACCESS_TOKEN acts as a
 * superadmin, so these tests keep every permission without weakening the auth layer.
 */
export const TEST_ACCESS_TOKEN = 'test-access-token-for-solar-tests';

/** fetch() with `Authorization: Bearer <TEST_ACCESS_TOKEN>` (unless the request sets its own Authorization). */
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) headers.set('Authorization', `Bearer ${TEST_ACCESS_TOKEN}`);
  return fetch(input, { ...init, headers });
}
