const KEY = 'solar.sessionId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let memory: string | null = null;

/** The chat session groups tasks so the agent gets the context of earlier requests. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    memory ??= randomId();
    return memory;
  }
}

export function newSessionId(): string {
  const id = randomId();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    memory = id;
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
