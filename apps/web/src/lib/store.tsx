import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Artifact, Attachment, Confirmation, PluginStatus, PublicConfig, StreamMessage, Task, TaskEvent } from '@solar/shared';
import { api, ApiError, withLang } from './api';
import { useLang } from './i18n';
import { getSessionId, newSessionId } from './session';

interface Draft {
  text: string;
  thinking: string;
}

interface State {
  config: PublicConfig | null;
  connected: boolean;
  sessionId: string;
  tasks: Record<string, Task>;
  events: Record<string, TaskEvent[]>;
  artifacts: Record<string, Artifact[]>;
  /** Attachment metadata by id (from uploads and task details). */
  attachments: Record<string, Attachment>;
  drafts: Record<string, Draft>;
  plugins: PluginStatus[];
  confirmations: Confirmation[];
  lastFinished: { taskId: string; status: Task['status']; at: number } | null;
  /** Registrations waiting for approval (users.view only; live from `users_changed`). */
  pendingCount: number;
  /** Bumped by every `users_changed` message: the user list reloads. */
  usersVersion: number;
}

type Action =
  | { type: 'config'; config: PublicConfig }
  | { type: 'users'; pendingCount: number; changed: boolean }
  | { type: 'connected'; value: boolean }
  | { type: 'session'; id: string }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'task'; task: Task }
  | { type: 'detail'; task: Task; events: TaskEvent[]; artifacts: Artifact[]; attachments: Attachment[] }
  | { type: 'attachments'; list: Attachment[] }
  | { type: 'artifact'; taskId: string; artifact: Artifact }
  | { type: 'event'; event: TaskEvent }
  | { type: 'deltas'; items: Array<{ taskId: string; channel: 'text' | 'thinking'; text: string }> }
  | { type: 'plugins'; plugins: PluginStatus[] }
  | { type: 'confirmations'; list: Confirmation[] };

const MAX_EVENTS = 3000;
const TERMINAL: ReadonlyArray<Task['status']> = ['completed', 'failed', 'cancelled'];

/** HTTP snapshots can be older than what SSE already delivered: never move a finished task back to an active state. */
function mergeTask(prev: Task | undefined, next: Task): Task {
  if (prev && TERMINAL.includes(prev.status) && !TERMINAL.includes(next.status)) return prev;
  return next;
}

function mergeEvents(current: TaskEvent[] | undefined, incoming: TaskEvent[]): TaskEvent[] {
  if (!current?.length) return incoming.slice(-MAX_EVENTS);
  const byId = new Map<string, TaskEvent>();
  for (const e of incoming) byId.set(e.id, e);
  for (const e of current) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
}

function mergeArtifacts(current: Artifact[] | undefined, incoming: Artifact[]): Artifact[] {
  if (!current?.length) return incoming;
  const ids = new Set(incoming.map((a) => a.id));
  return [...incoming, ...current.filter((a) => !ids.has(a.id))];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'config':
      return { ...state, config: action.config };
    case 'users':
      return { ...state, pendingCount: action.pendingCount, usersVersion: action.changed ? state.usersVersion + 1 : state.usersVersion };
    case 'connected':
      return { ...state, connected: action.value };
    case 'session':
      return { ...state, sessionId: action.id };
    case 'tasks': {
      const tasks = { ...state.tasks };
      for (const t of action.tasks) tasks[t.id] = mergeTask(tasks[t.id], t);
      return { ...state, tasks };
    }
    case 'task': {
      const prev = state.tasks[action.task.id];
      const finished =
        prev && prev.status !== action.task.status && ['completed', 'failed'].includes(action.task.status)
          ? { taskId: action.task.id, status: action.task.status, at: Date.now() }
          : state.lastFinished;
      const drafts = ['completed', 'failed', 'cancelled'].includes(action.task.status)
        ? Object.fromEntries(Object.entries(state.drafts).filter(([k]) => k !== action.task.id))
        : state.drafts;
      return { ...state, tasks: { ...state.tasks, [action.task.id]: action.task }, lastFinished: finished, drafts };
    }
    case 'detail':
      // merge, don't replace: SSE events published while the snapshot was in flight must survive
      return {
        ...state,
        tasks: { ...state.tasks, [action.task.id]: mergeTask(state.tasks[action.task.id], action.task) },
        events: { ...state.events, [action.task.id]: mergeEvents(state.events[action.task.id], action.events) },
        artifacts: { ...state.artifacts, [action.task.id]: mergeArtifacts(state.artifacts[action.task.id], action.artifacts) },
        attachments: action.attachments.length ? { ...state.attachments, ...Object.fromEntries(action.attachments.map((a) => [a.id, a])) } : state.attachments,
      };
    case 'artifact': {
      // also announced by an 'artifact' event on the stream: whichever arrives second is a no-op
      const current = state.artifacts[action.taskId] ?? [];
      if (current.some((a) => a.id === action.artifact.id)) return state;
      return { ...state, artifacts: { ...state.artifacts, [action.taskId]: [...current, action.artifact] } };
    }
    case 'attachments':
      return action.list.length ? { ...state, attachments: { ...state.attachments, ...Object.fromEntries(action.list.map((a) => [a.id, a])) } } : state;
    case 'event': {
      const e = action.event;
      const list = state.events[e.taskId] ?? [];
      if (list.some((x) => x.id === e.id)) return state;
      const events = { ...state.events, [e.taskId]: [...list, e].slice(-MAX_EVENTS) };
      let { artifacts, confirmations, drafts } = state;
      if (e.type === 'artifact') {
        const current = artifacts[e.taskId] ?? [];
        if (!current.some((a) => a.id === e.artifact.id)) artifacts = { ...artifacts, [e.taskId]: [...current, e.artifact] };
      } else if (e.type === 'confirmation_requested') {
        if (!confirmations.some((c) => c.id === e.confirmation.id)) confirmations = [...confirmations, e.confirmation];
      } else if (e.type === 'confirmation_resolved') {
        confirmations = confirmations.filter((c) => c.id !== e.confirmationId);
      } else if (e.type === 'text' || e.type === 'thinking') {
        const d = drafts[e.taskId];
        if (d) drafts = { ...drafts, [e.taskId]: e.type === 'text' ? { ...d, text: '' } : { ...d, thinking: '' } };
      }
      return { ...state, events, artifacts, confirmations, drafts };
    }
    case 'deltas': {
      const drafts = { ...state.drafts };
      for (const d of action.items) {
        const task = state.tasks[d.taskId];
        if (task && TERMINAL.includes(task.status)) continue;
        const cur = drafts[d.taskId] ?? { text: '', thinking: '' };
        drafts[d.taskId] = d.channel === 'text' ? { ...cur, text: cur.text + d.text } : { ...cur, thinking: (cur.thinking + d.text).slice(-4000) };
      }
      return { ...state, drafts };
    }
    case 'plugins':
      return { ...state, plugins: action.plugins };
    case 'confirmations':
      return { ...state, confirmations: action.list };
  }
}

interface SolarContextValue extends State {
  submit(prompt: string, attachmentIds?: string[]): Promise<Task>;
  rememberAttachments(list: Attachment[]): void;
  /** Adds an artifact made outside an agent run (e.g. the Word file of an older TSD) to its task's list. */
  rememberArtifact(taskId: string, artifact: Artifact): void;
  cancel(taskId: string): Promise<void>;
  loadTask(taskId: string): Promise<void>;
  refreshTasks(): Promise<void>;
  /**
   * Loads tasks the general list may not hold (it has the newest 200 only; for roles that see every task, of all
   * users) - e.g. one owner's tasks for the monitor's owner filter - and keeps them with the others.
   */
  fetchTasks(params: { owner?: string; status?: Task['status'] }): Promise<void>;
  resolveConfirmation(id: string, approved: boolean, note?: string): Promise<void>;
  startNewSession(): void;
  reloadConfig(): Promise<void>;
  /** Reads the number of registrations waiting (after an approval made here). */
  refreshPendingCount(): Promise<void>;
}

const SolarContext = createContext<SolarContextValue | null>(null);

interface SolarProviderProps {
  children: ReactNode;
  /** The logged-in account (the conversation is kept per user). Mount the provider with `key={userId}`. */
  userId: string | null;
  /** The account may list users (users.view): it receives `users_changed` and shows the pending-approval count. */
  watchUsers: boolean;
  /** The event stream said the session ended (`signed_out`). */
  onSignedOut(): void;
  /** Accounts changed (`users_changed`), or the stream reconnected after a gap: the own account may have been renamed. */
  onAccountsChanged(): void;
}

export function SolarProvider({ children, userId, watchUsers, onSignedOut, onAccountsChanged }: SolarProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    config: null,
    connected: false,
    sessionId: getSessionId(userId),
    tasks: {},
    events: {},
    artifacts: {},
    attachments: {},
    drafts: {},
    plugins: [],
    confirmations: [],
    lastFinished: null,
    pendingCount: 0,
    usersVersion: 0,
  }));
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;
  const accountsChangedRef = useRef(onAccountsChanged);
  accountsChangedRef.current = onAccountsChanged;
  const deltaBuffer = useRef<Array<{ taskId: string; channel: 'text' | 'thinking'; text: string }>>([]);
  const flushScheduled = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  // bumped to (re)open the event stream after it was closed for good
  const [streamNonce, setStreamNonce] = useState(0);
  // the stream carries the interface language (an EventSource cannot send headers): plugin statuses arrive in it, so a
  // switch reopens the stream
  const lang = useLang();
  /** Survives stream re-creation: the next successful open must resync what was missed. */
  const missedEvents = useRef(false);

  // a 401 ends the session through lib/api.ts onUnauthorized (lib/auth.tsx): nothing to do here
  const handleError = useCallback((err: unknown) => {
    if (!(err instanceof ApiError && err.status === 401)) console.error(err);
  }, []);

  const refreshPendingCount = useCallback(async () => {
    if (!watchUsers) return;
    try {
      const { count } = await api.pendingCount();
      dispatch({ type: 'users', pendingCount: count, changed: false });
    } catch (err) {
      handleError(err);
    }
  }, [watchUsers, handleError]);

  const reloadConfig = useCallback(async () => {
    try {
      dispatch({ type: 'config', config: await api.config() });
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const refreshTasks = useCallback(async () => {
    try {
      // the newest tasks (for superadmin and Head of IT Solar: of all users), plus the current conversation, which is
      // always the user's own and may be older than the newest 200
      const [tasks, conversation, confirmations] = await Promise.all([
        api.listTasks({ limit: 200 }),
        api.listTasks({ sessionId: stateRef.current.sessionId, limit: 200 }),
        api.confirmations(),
      ]);
      dispatch({ type: 'tasks', tasks: [...tasks, ...conversation] });
      dispatch({ type: 'confirmations', list: confirmations });
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const fetchTasks = useCallback(
    async (params: { owner?: string; status?: Task['status'] }) => {
      try {
        dispatch({ type: 'tasks', tasks: await api.listTasks({ ...params, limit: 200 }) });
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  const loadTask = useCallback(
    async (taskId: string) => {
      try {
        const d = await api.task(taskId);
        dispatch({ type: 'detail', task: d.task, events: d.events, artifacts: d.artifacts, attachments: d.attachments ?? [] });
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  // live stream (the session cookie identifies the user; it is HttpOnly and sent by the browser)
  useEffect(() => {
    void reloadConfig();
    void refreshTasks();
    void refreshPendingCount();
    const source = new EventSource(withLang('/api/stream', lang));
    let ended = false;
    let retryTimer: number | undefined;
    let ownersTimer: number | undefined;
    // deltas are batched per animation frame; flush them before any event/task message so ordering holds
    // (a 'text' event clears the draft the deltas belong to)
    const flushDeltas = () => {
      flushScheduled.current = false;
      const items = deltaBuffer.current;
      deltaBuffer.current = [];
      if (items.length) dispatch({ type: 'deltas', items });
    };
    source.onopen = () => {
      dispatch({ type: 'connected', value: true });
      if (missedEvents.current) {
        // an account change may have been missed too (the own name)
        accountsChangedRef.current();
        // events published while disconnected were missed: reload the tasks and every task on screen
        void refreshTasks().then(() => {
          const s = stateRef.current;
          const ids = new Set(Object.keys(s.events));
          for (const t of Object.values(s.tasks)) if (!TERMINAL.includes(t.status)) ids.add(t.id);
          for (const id of ids) void loadTask(id);
        });
      }
      missedEvents.current = false;
    };
    source.onerror = () => {
      if (ended) return;
      dispatch({ type: 'connected', value: false });
      missedEvents.current = true;
      // a 401 makes EventSource retry forever: check once with a normal request
      void api
        .config()
        .then(() => {
          // a non-200 answer (e.g. a proxy's 502 while the server restarts) closes EventSource for good
          if (source.readyState === EventSource.CLOSED) {
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => setStreamNonce((n) => n + 1), 3000);
          }
        })
        .catch((err: unknown) => {
          handleError(err);
          if (!(err instanceof ApiError && err.status === 401) && source.readyState === EventSource.CLOSED) {
            window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => setStreamNonce((n) => n + 1), 5000);
          }
        });
    };
    source.onmessage = (ev) => {
      let msg: StreamMessage;
      try {
        msg = JSON.parse(ev.data as string) as StreamMessage;
      } catch {
        return;
      }
      switch (msg.kind) {
        case 'task':
          flushDeltas();
          dispatch({ type: 'task', task: msg.task });
          break;
        case 'event':
          flushDeltas();
          dispatch({ type: 'event', event: msg.event });
          break;
        case 'plugins':
          dispatch({ type: 'plugins', plugins: msg.plugins });
          break;
        case 'delta':
          deltaBuffer.current.push({ taskId: msg.taskId, channel: msg.channel, text: msg.text });
          if (!flushScheduled.current) {
            flushScheduled.current = true;
            requestAnimationFrame(flushDeltas);
          }
          break;
        case 'users_changed':
          dispatch({ type: 'users', pendingCount: msg.pendingCount, changed: true });
          // task owners may have been renamed, had their role changed or been deleted - the own account too: reload the
          // list and the own account (once per burst)
          window.clearTimeout(ownersTimer);
          ownersTimer = window.setTimeout(() => {
            void refreshTasks();
            accountsChangedRef.current();
          }, 600);
          break;
        case 'signed_out':
          // the server closes the stream after this: do not reconnect, return to the login screen
          ended = true;
          source.close();
          signedOutRef.current();
          break;
        case 'hello':
          break;
      }
    };
    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(ownersTimer);
      // closing an open stream (language switch, new token) leaves a gap: the next open resyncs what it missed
      if (source.readyState === EventSource.OPEN) missedEvents.current = true;
      source.close();
    };
  }, [streamNonce, lang, reloadConfig, refreshTasks, refreshPendingCount, loadTask, handleError]);

  const submit = useCallback(
    async (prompt: string, attachmentIds: string[] = []) => {
      const task = await api.createTask(prompt, state.sessionId, attachmentIds);
      dispatch({ type: 'task', task });
      return task;
    },
    [state.sessionId],
  );

  const rememberAttachments = useCallback((list: Attachment[]) => dispatch({ type: 'attachments', list }), []);
  const rememberArtifact = useCallback((taskId: string, artifact: Artifact) => dispatch({ type: 'artifact', taskId, artifact }), []);

  const cancel = useCallback(
    async (taskId: string) => {
      try {
        await api.cancelTask(taskId);
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  const resolveConfirmation = useCallback(
    async (id: string, approved: boolean, note?: string) => {
      await api.resolveConfirmation(id, approved, note);
      dispatch({ type: 'confirmations', list: state.confirmations.filter((c) => c.id !== id) });
    },
    [state.confirmations],
  );

  const startNewSession = useCallback(() => dispatch({ type: 'session', id: newSessionId(userId) }), [userId]);

  const value = useMemo<SolarContextValue>(
    () => ({
      ...state,
      submit,
      rememberAttachments,
      rememberArtifact,
      cancel,
      loadTask,
      refreshTasks,
      fetchTasks,
      resolveConfirmation,
      startNewSession,
      reloadConfig,
      refreshPendingCount,
    }),
    [state, submit, rememberAttachments, rememberArtifact, cancel, loadTask, refreshTasks, fetchTasks, resolveConfirmation, startNewSession, reloadConfig, refreshPendingCount],
  );
  return <SolarContext.Provider value={value}>{children}</SolarContext.Provider>;
}

export function useSolar(): SolarContextValue {
  const ctx = useContext(SolarContext);
  if (!ctx) throw new Error('useSolar must be used inside <SolarProvider>');
  return ctx;
}
