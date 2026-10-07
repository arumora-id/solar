import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { useSolar } from '../lib/store';
import { HandIcon } from './Icons';

/** Human-in-the-loop: the first pending approval request (e.g. every Visual Paradigm call). */
export function ConfirmationDialog() {
  const { confirmations, resolveConfirmation, tasks } = useSolar();
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
            <HandIcon /> Perlu persetujuan Anda
          </span>
          {confirmations.length > 1 && <span className="hint">+{confirmations.length - 1} permintaan lain</span>}
        </div>
        <h3 id="confirm-title">{current.displayName}</h3>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          {current.reason}
          {current.pluginName ? ` · Plugin: ${current.pluginName}` : ''}
        </p>
        {task && <p className="hint">Task: {task.title}</p>}
        <div className="field">
          <span>Data yang akan dikirim</span>
          <pre className="json">{JSON.stringify(current.input, null, 2)}</pre>
        </div>
        <label className="field">
          <span>Catatan untuk SOLAR (opsional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. gunakan project 'Order Platform' saja" />
        </label>
        {error && <div className="error-box">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void decide(false)}>
            Tolak
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void decide(true)}>
            Setujui &amp; lanjutkan
          </button>
        </div>
      </div>
    </div>
  );
}
