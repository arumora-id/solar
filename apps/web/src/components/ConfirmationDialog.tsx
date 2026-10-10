import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useSolar } from '../lib/store';
import { HandIcon } from './Icons';

/** Human-in-the-loop: the first pending approval request (e.g. every Visual Paradigm call). */
export function ConfirmationDialog() {
  const { confirmations, resolveConfirmation, tasks } = useSolar();
  const t = useT();
  const current = confirmations[0];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNote('');
    setError('');
    if (current && ref.current) gsap.fromTo(ref.current, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true });
  }, [current?.id]);

  if (!current) return null;
  const task = tasks[current.taskId];

  const decide = async (approved: boolean) => {
    setBusy(true);
    setError('');
    try {
      await resolveConfirmation(current.id, approved, note.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal" ref={ref}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="badge" data-status="awaiting_confirmation">
            <HandIcon /> {t.agent.confirmation.badge}
          </span>
          {confirmations.length > 1 && <span className="hint">{t.agent.confirmation.more(confirmations.length - 1)}</span>}
        </div>
        <h3 id="confirm-title">{current.displayName}</h3>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          {current.reason}
          {current.pluginName ? ` · ${t.agent.confirmation.plugin(current.pluginName)}` : ''}
        </p>
        {task && <p className="hint">{t.agent.confirmation.task(task.title)}</p>}
        <div className="field">
          <span>{t.agent.confirmation.data}</span>
          <pre className="json">{typeof current.input === 'string' ? current.input : JSON.stringify(current.input, null, 2)}</pre>
        </div>
        <label className="field">
          <span>{t.agent.confirmation.noteLabel}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.agent.confirmation.notePlaceholder} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void decide(false)}>
            {t.common.reject}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void decide(true)}>
            {t.agent.confirmation.approve}
          </button>
        </div>
      </div>
    </div>
  );
}
