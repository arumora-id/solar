/**
 * Rules for the identifiers of an account. Usernames and emails are stored and compared in lower case; a username can
 * never contain "@", so a login identifier with "@" is an email and one without is a username.
 */

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;

// one "@", no white space, a dot in the domain, no leading/trailing dot in the parts
const EMAIL_PATTERN = /^[^\s@"<>()[\]\\,;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Control characters, line/paragraph separators and bidi overrides: never part of a name shown to people or the agent. */
// eslint-disable-next-line no-control-regex
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** A display name with runs of white space collapsed. */
export function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email) && !email.split('@')[0]!.startsWith('.') && !email.split('@')[0]!.endsWith('.');
}

export function isValidName(name: string): boolean {
  const length = [...name].length;
  return length >= 1 && length <= NAME_MAX_LENGTH && !NAME_FORBIDDEN.test(name);
}

/** The login identifier as stored: lower case. */
export function normalizeIdentifier(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}
