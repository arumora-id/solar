import gsap from 'gsap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@solar/shared';
import { AgentBubble } from '../components/AgentBubble';
import { AttachmentStrip } from '../components/Attachments';
import { Composer, type ComposerHandle } from '../components/Composer';
import { PlusIcon, VolumeIcon } from '../components/Icons';
import { isActive } from '../lib/format';
import { localeOf, useT, type Dict } from '../lib/i18n';
import { speakableSummary } from '../lib/markdown';
import { readPref } from '../lib/session';
import { useSolar } from '../lib/store';
import type { CharacterState } from '../character/CharacterScene';
import { CharacterStage } from '../character/CharacterStage';
import { CharacterSwitcher, useCharacter } from '../components/CharacterPicker';
import { speak, stopSpeaking, ttsAvailable } from '../voice/tts';
import { useVoicePrefs } from '../voice/useVoice';

/**
 * Quick prompt chips, in this order. Label and text are in `t.agent.quickPrompts`: the text is written in the interface
 * language, so the agent answers in it.
 */
const QUICK_PROMPTS: ReadonlyArray<keyof Dict['agent']['quickPrompts']> = [
  'fromDocuments',
  'fullPackage',
  'archimate',
  'sequence',
  'techSpec',
  'planeBacklog',
  'publishGithub',
];

/** Speech language for the voice preference; 'auto' (when available) follows the interface language. */
function speechLang(pref: string): string {
  return pref === 'auto' ? localeOf() : pref;
}

export function AgentPage() {
  const { tasks, events, sessionId, submit, startNewSession, lastFinished, config, connected } = useSolar();
  const t = useT();
  const voicePrefs = useVoicePrefs();
  const composerRef = useRef<ComposerHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const speechRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [mood, setMood] = useState<'happy' | 'sad' | null>(null);
  const [dragging, setDragging] = useState(false);

  // a drag that ends anywhere (drop elsewhere, Esc, leaving the window) must hide the overlay
  useEffect(() => {
    const stop = () => setDragging(false);
    window.addEventListener('drop', stop);
    window.addEventListener('dragend', stop);
    return () => {
      window.removeEventListener('drop', stop);
      window.removeEventListener('dragend', stop);
    };
  }, []);
  const [compact, setCompact] = useState(() => readPref('compactStage', false));

  useEffect(() => {
    const on = () => setCompact(readPref('compactStage', false));
    window.addEventListener('solar:layout', on);
    return () => window.removeEventListener('solar:layout', on);
  }, []);

  const sessionTasks = useMemo(
    () => Object.values(tasks).filter((task) => task.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasks, sessionId],
  );
  const current: Task | undefined = [...sessionTasks].reverse().find((task) => isActive(task.status));

  // react to a finished task: celebrate (or not) and read the summary aloud
  const handled = useRef<string | null>(null);
  // the effect below is keyed on lastFinished only: later task updates (another task's progress)
  // must not cancel the pending "back to normal + read the summary" timer
  const latest = useRef({ tasks, sessionId, voicePrefs });
  latest.current = { tasks, sessionId, voicePrefs };
  const finishTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(finishTimer.current), []);
  useEffect(() => {
    if (!lastFinished || handled.current === `${lastFinished.taskId}:${lastFinished.at}`) return;
    handled.current = `${lastFinished.taskId}:${lastFinished.at}`;
    const task = latest.current.tasks[lastFinished.taskId];
    if (!task || task.sessionId !== latest.current.sessionId) return;
    setMood(lastFinished.status === 'completed' ? 'happy' : 'sad');
    window.clearTimeout(finishTimer.current);
    finishTimer.current = window.setTimeout(() => {
      setMood(null);
      const { tasks: now, voicePrefs: prefs } = latest.current;
      const result = (now[lastFinished.taskId] ?? task).result;
      if (lastFinished.status === 'completed' && prefs.speakReplies && ttsAvailable() && result) {
        speak(speakableSummary(result), speechLang(prefs.lang), { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
      }
    }, 1800);
  }, [lastFinished]);

  const character = useCharacter();
  const characterState: CharacterState = useMemo(() => {
    if (listening) return 'listening';
    if (mood) return mood;
    if (current?.status === 'awaiting_confirmation') return 'asking';
    if (current) {
      // a tool call without its result yet = the character is working; otherwise it is thinking
      const open = new Set<string>();
      for (const e of events[current.id] ?? []) {
        if (e.type === 'tool_call' && e.tool !== 'update_progress') open.add(e.toolUseId);
        else if (e.type === 'tool_result') open.delete(e.toolUseId);
      }
      return open.size > 0 ? 'working' : 'thinking';
    }
    if (speaking) return 'talking';
    return 'idle';
  }, [listening, mood, current, speaking, events]);

  const bubble = useMemo(() => {
    const say = t.agent.speech;
    if (!connected) return { text: say.connecting, sub: '' };
    if (config && !config.llmConfigured) return { text: say.llmMissing, sub: say.llmMissingSub };
    if (listening) return { text: say.listening, sub: say.listeningSub };
    if (mood === 'happy') return { text: say.done, sub: say.doneSub };
    if (mood === 'sad') return { text: say.failed, sub: say.failedSub };
    // the step texts come from the server, in the language of the task
    if (current?.status === 'awaiting_confirmation') return { text: say.needsApproval, sub: current.currentStep ?? '' };
    if (current) return { text: current.currentStep ?? say.working, sub: `${current.progress}% · ${current.title}` };
    if (speaking) return { text: say.speaking, sub: '' };
    return { text: t.agent.greeting, sub: say.idleSub };
  }, [t, connected, config, listening, mood, current, speaking]);

  useEffect(() => {
    if (speechRef.current) gsap.fromTo(speechRef.current, { y: -6, opacity: 0.4 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' });
  }, [bubble.text]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [sessionTasks.length, current?.progress]);

  const handleSubmit = useCallback(
    async (text: string, attachmentIds: string[]) => {
      stopSpeaking();
      setSpeaking(false);
      await submit(text, attachmentIds);
    },
    [submit],
  );

  const hasFiles = (e: { dataTransfer: DataTransfer }) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <main className="agent-page">
      <section className="stage-card" aria-label="SOLAR AI AGENT">
        <div className="speech" ref={speechRef} role="status">
          {bubble.text}
          {bubble.sub && <span className="sub">{bubble.sub}</span>}
        </div>
        <div className="stage-area">
          <CharacterStage character={character} state={characterState} onCharacterClick={() => composerRef.current?.toggleVoice()} />
          <CharacterSwitcher />
        </div>
        {!compact && (
          <div className="stage-footer">
            {QUICK_PROMPTS.map((key) => {
              const q = t.agent.quickPrompts[key];
              return (
                <button key={key} type="button" className="chip" onClick={() => composerRef.current?.insert(q.text)}>
                  {q.label}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="chat"
        aria-label={t.agent.chat.title}
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return;
          // only when the pointer really left the chat (streamed answers replace nodes under the pointer)
          const to = e.relatedTarget as Node | null;
          if (!to || !e.currentTarget.contains(to)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <div>
              {t.agent.chat.dropTitle}
              <small>{t.agent.chat.dropFormats}</small>
            </div>
          </div>
        )}
        <div className="chat-head">
          <h2>{t.agent.chat.title}</h2>
          {speaking && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                stopSpeaking();
                setSpeaking(false);
              }}
            >
              <VolumeIcon /> {t.agent.chat.stopSpeaking}
            </button>
          )}
          <button type="button" className="btn small" onClick={startNewSession} title={t.agent.chat.newConversationTitle}>
            <PlusIcon size={16} /> {t.agent.chat.newConversation}
          </button>
        </div>
        <div className="chat-log" ref={logRef}>
          {sessionTasks.length === 0 ? (
            <div className="empty">
              <p>
                <strong>{t.agent.chat.emptyTitle}</strong>
              </p>
              <p>{t.agent.chat.emptyExample}</p>
              <p>{t.agent.chat.emptyAttach}</p>
            </div>
          ) : (
            sessionTasks.map((task) => (
              <div key={task.id} style={{ display: 'contents' }}>
                <div className="bubble user">{task.prompt}</div>
                <AttachmentStrip ids={task.attachmentIds ?? []} />
                <AgentBubble task={task} />
              </div>
            ))
          )}
        </div>
        <Composer ref={composerRef} onSubmit={handleSubmit} onListeningChange={setListening} />
      </section>
    </main>
  );
}
