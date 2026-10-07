import gsap from 'gsap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@solar/shared';
import { AgentBubble } from '../components/AgentBubble';
import { AttachmentStrip } from '../components/Attachments';
import { Composer, type ComposerHandle } from '../components/Composer';
import { PlusIcon, VolumeIcon } from '../components/Icons';
import { isActive } from '../lib/format';
import { speakableSummary } from '../lib/markdown';
import { readPref } from '../lib/session';
import { useSolar } from '../lib/store';
import type { CharacterState } from '../character/CharacterScene';
import { CharacterStage } from '../character/CharacterStage';
import { CharacterSwitcher, useCharacter } from '../components/CharacterPicker';
import { speak, stopSpeaking, ttsAvailable } from '../voice/tts';
import { useVoicePrefs } from '../voice/useVoice';

const QUICK_PROMPTS = [
  {
    label: 'Dari dokumen',
    text: 'Pelajari semua dokumen terlampir, lalu buatkan paket arsitektur lengkap (model ArchiMate, sequence diagram skenario utama dan error, serta Technical Specification Document) sesuai isinya. Catat asumsi dan pertanyaan terbuka. Fokus: ',
  },
  {
    label: 'Paket lengkap',
    text: 'Buatkan paket arsitektur lengkap dalam sekali proses: model ArchiMate (Layered View dan Application Cooperation View), sequence diagram untuk skenario utama dan alur error, serta Technical Specification Document. Sistem: ',
  },
  { label: 'Diagram ArchiMate', text: 'Buatkan model ArchiMate 3.2 (Layered View) untuk sistem berikut: ' },
  { label: 'Sequence diagram', text: 'Buatkan sequence diagram (happy path dan error path) untuk alur: ' },
  { label: 'Technical Spec', text: 'Susun Technical Specification Document (TSD) lengkap untuk: ' },
  { label: 'Backlog Plane', text: 'Buat backlog di Plane (plane.mesthi.com) dari TSD terakhir: epic per komponen, story per functional requirement.' },
  { label: 'Publish GitHub', text: 'Publish semua artefak dari task terakhir ke GitHub di folder docs/architecture/' },
];

const GREETING = 'Halo! Saya SOLAR AI AGENT, asisten solution architect Anda. Ketik atau ucapkan kebutuhan Anda.';

export function AgentPage() {
  const { tasks, events, sessionId, submit, startNewSession, lastFinished, config, connected } = useSolar();
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
    () => Object.values(tasks).filter((t) => t.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasks, sessionId],
  );
  const current: Task | undefined = [...sessionTasks].reverse().find((t) => isActive(t.status));

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
        speak(speakableSummary(result), prefs.lang, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) });
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
    if (!connected) return { text: 'Menghubungkan ke server SOLAR AI AGENT…', sub: '' };
    if (config && !config.llmConfigured)
      return { text: 'Model AI belum siap', sub: 'Isi OPENAI_API_KEY di .env, atau tambahkan provider di Pengaturan → Model AI.' };
    if (listening) return { text: 'Saya mendengarkan…', sub: 'Bicaralah, saya berhenti otomatis saat Anda diam.' };
    if (mood === 'happy') return { text: 'Selesai! Semua deliverable siap.', sub: 'Lihat artefak di panel percakapan.' };
    if (mood === 'sad') return { text: 'Ada kendala…', sub: 'Detail error ada di percakapan dan monitor.' };
    if (current?.status === 'awaiting_confirmation') return { text: 'Butuh persetujuan Anda', sub: current.currentStep ?? '' };
    if (current) return { text: current.currentStep ?? 'Sedang bekerja…', sub: `${current.progress}% · ${current.title}` };
    if (speaking) return { text: 'Ringkasan hasil…', sub: '' };
    return { text: GREETING, sub: 'Klik saya untuk mulai bicara.' };
  }, [connected, config, listening, mood, current, speaking]);

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
            {QUICK_PROMPTS.map((q) => (
              <button key={q.label} type="button" className="chip" onClick={() => composerRef.current?.insert(q.text)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section
        className="chat"
        aria-label="Percakapan"
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
              Lepaskan untuk melampirkan dokumen
              <small>PDF, Word, Excel, PowerPoint, Markdown atau teks</small>
            </div>
          </div>
        )}
        <div className="chat-head">
          <h2>Percakapan</h2>
          {speaking && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                stopSpeaking();
                setSpeaking(false);
              }}
            >
              <VolumeIcon /> Hentikan suara
            </button>
          )}
          <button type="button" className="btn small" onClick={startNewSession} title="Mulai percakapan baru (konteks sebelumnya tidak dibawa)">
            <PlusIcon size={16} /> Percakapan baru
          </button>
        </div>
        <div className="chat-log" ref={logRef}>
          {sessionTasks.length === 0 ? (
            <div className="empty">
              <p>
                <strong>Mulai dengan satu perintah.</strong>
              </p>
              <p>
                Contoh: “Buatkan paket arsitektur lengkap untuk sistem pemesanan online dengan pembayaran via payment gateway, deploy di Kubernetes,
                database PostgreSQL.”
              </p>
              <p>Punya dokumen proyek? Lampirkan PDF, Word, Excel, PowerPoint atau Markdown dengan tombol klip, atau seret file ke sini.</p>
            </div>
          ) : (
            sessionTasks.map((t) => (
              <div key={t.id} style={{ display: 'contents' }}>
                <div className="bubble user">{t.prompt}</div>
                <AttachmentStrip ids={t.attachmentIds ?? []} />
                <AgentBubble task={t} />
              </div>
            ))
          )}
        </div>
        <Composer ref={composerRef} onSubmit={handleSubmit} onListeningChange={setListening} />
      </section>
    </main>
  );
}
