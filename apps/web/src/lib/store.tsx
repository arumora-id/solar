import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Artifact, Confirmation, PluginStatus, PublicConfig, StreamMessage, Task, TaskEvent } from '@solar/shared';
import { api, ApiError, setToken, withToken } from './api';
import { getSessionId, newSessionId } from './session';

interface Draft {
  text: string;
  thinking: string;
}

interface State {
  config: PublicConfig | null;
  connected: boolean;
  authRequired: boolean;
  sessionId: string;
  tasks: Record<string, Task>;
  events: Record<string, TaskEvent[]>;
  artifacts: Record<string, Artifact[]>;
  drafts: Record<string, Draft>;
  plugins: PluginStatus[];
  confirmations: Confirmation[];
  lastFinished: { taskId: string; status: Task['status']; at: number } | null;
}

type Action =
  | { type: 'config'; config: PublicConfig }
  | { type: 'auth'; required: boolean }
  | { type: 'connected'; value: boolean }
  | { type: 'session'; id: string }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'task'; task: Task }
  | { type: 'detail'; task: Task; events: TaskEvent[]; artifacts: Artifact[] }
  | { type: 'event'; event: TaskEvent }
  | { type: 'deltas'; items: Array<{ taskId: string; channel: 'text' | 'thinking'; text: string }> }
  | { type: 'plugins'; plugins: PluginStatus[] }
  | { type: 'confirmations'; list: Confirmation[] };

const MAX_EVENTS = 3000;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'config':
      return { ...state, config: action.config, authRequired: false };
    case 'auth':
      return { ...state, authRequired: action.required };
    case 'connected':
      return { ...state, connected: action.value };
    case 'session':
      return { ...state, sessionId: action.id };
    case 'tasks': {
      const tasks = { ...state.tasks };
      for (const t of action.tasks) tasks[t.id] = t;
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
      return {
        ...state,
        tasks: { ...state.tasks, [action.task.id]: action.task },
        events: { ...state.events, [action.task.id]: action.events },
        artifacts: { ...state.artifacts, [action.task.id]: action.artifacts },
      };
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
  submit(prompt: string): Promise<Task>;
  cancel(taskId: string): Promise<void>;
  loadTask(taskId: string): Promise<void>;
  refreshTasks(): Promise<void>;
  resolveConfirmation(id: string, approved: boolean, note?: string): Promise<void>;
  startNewSession(): void;
  reloadConfig(): Promise<void>;
  submitToken(token: string): void;
}

const SolarContext = createContext<SolarContextValue | null>(null);

export function SolarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    config: null,
    connected: false,
    authRequired: false,
    sessionId: getSessionId(),
    tasks: {},
    events: {},
    artifacts: {},
    drafts: {},
    plugins: [],
    confirmations: [],
    lastFinished: null,
  }));
  const deltaBuffer = useRef<Array<{ taskId: string; channel: 'text' | 'thinking'; text: string }>>([]);
  const flushScheduled = useRef(false);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) dispatch({ type: 'auth', required: true });
    else console.error(err);
  }, []);

  const reloadConfig = useCallback(async () => {
    try {
      dispatch({ type: 'config', config: await api.config() });
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const refreshTasks = useCallback(async () => {
    try {
      const [tasks, confirmations] = await Promise.all([api.listTasks({ limit: 200 }), api.confirmations()]);
      dispatch({ type: 'tasks', tasks });
      dispatch({ type: 'confirmations', list: confirmations });
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const loadTask = useCallback(
    async (taskId: string) => {
      try {
        const d = await api.task(taskId);
        dispatch({ type: 'detail', task: d.task, events: d.events, artifacts: d.artifacts });
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  // live stream
  useEffect(() => {
    if (state.authRequired) return;
    void reloadConfig();
    void refreshTasks();
    const source = new EventSource(withToken('/api/stream'));
    let wasDisconnected = false;
    source.onopen = () => {
      dispatch({ type: 'connected', value: true });
      if (wasDisconnected) void refreshTasks();
      wasDisconnected = false;
    };
    source.onerror = () => {
      dispatch({ type: 'connected', value: false });
      wasDisconnected = true;
      // a 401 makes EventSource retry forever: check once with a normal request
      void api.config().catch(handleError);
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
          dispatch({ type: 'task', task: msg.task });
          break;
        case 'event':
          dispatch({ type: 'event', event: msg.event });
          break;
        case 'plugins':
          dispatch({ type: 'plugins', plugins: msg.plugins });
          break;
        case 'delta':
          deltaBuffer.current.push({ taskId: msg.taskId, channel: msg.channel, text: msg.text });
          if (!flushScheduled.current) {
            flushScheduled.current = true;
            requestAnimationFrame(() => {
              flushScheduled.current = false;
              const items = deltaBuffer.current;
              deltaBuffer.current = [];
              if (items.length) dispatch({ type: 'deltas', items });
            });
          }
          break;
        case 'hello':
          break;
      }
    };
    return () => source.close();
  }, [state.authRequired, reloadConfig, refreshTasks, handleError]);

  const submit = useCallback(
    async (prompt: string) => {
      const task = await api.createTask(prompt, state.sessionId);
      dispatch({ type: 'task', task });
      return task;
    },
    [state.sessionId],
  );

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

  const startNewSession = useCallback(() => dispatch({ type: 'session', id: newSessionId() }), []);

  const submitToken = useCallback((token: string) => {
    setToken(token.trim());
    dispatch({ type: 'auth', required: false });
  }, []);

  const value = useMemo<SolarContextValue>(
    () => ({ ...state, submit, cancel, loadTask, refreshTasks, resolveConfirmation, startNewSession, reloadConfig, submitToken }),
    [state, submit, cancel, loadTask, refreshTasks, resolveConfirmation, startNewSession, reloadConfig, submitToken],
  );
  return <SolarContext.Provider value={value}>{children}</SolarContext.Provider>;
}

export function useSolar(): SolarContextValue {
  const ctx = useContext(SolarContext);
  if (!ctx) throw new Error('useSolar must be used inside <SolarProvider>');
  return ctx;
}
