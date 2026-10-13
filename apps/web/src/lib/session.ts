const KEY = 'solar.sessionId';

/**
 * The conversation is per account: two people taking turns on one browser must not continue each other's
 * conversation (the key carries the user id; the server keeps conversations per user too).
 */
function keyOf(userId: string | null | undefined): string {
  return userId ? `${KEY}.${userId}` : KEY;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const memory = new Map<string, string>();

/** The chat session groups tasks so the agent gets the context of earlier requests (one per user on this device). */
export function getSessionId(userId?: string | null): string {
  const key = keyOf(userId);
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    if (!memory.has(key)) memory.set(key, randomId());
    return memory.get(key)!;
  }
}

export function newSessionId(userId?: string | null): string {
  const id = randomId();
  try {
    localStorage.setItem(keyOf(userId), id);
  } catch {
    memory.set(keyOf(userId), id);
  }
  return id;
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`solar.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`solar.${key}`, JSON.stringify(value));
  } catch {
    // preferences are a convenience only
  }
}
