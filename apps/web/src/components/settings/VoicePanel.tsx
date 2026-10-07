import { useState } from 'react';
import { browserSpeechAvailable, isElectron, microphoneAvailable } from '../../voice/recognition';
import { speak, ttsAvailable } from '../../voice/tts';
import { loadVoicePrefs, resolveEngine, saveVoicePrefs, WHISPER_MODELS, type VoicePrefs } from '../../voice/useVoice';

export function VoicePanel() {
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const update = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveVoicePrefs(next);
  };
  const engine = resolveEngine(prefs, false);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Mesin aktif: <strong>{engine === 'browser' ? 'Web Speech API (browser)' : engine === 'whisper' ? 'Whisper lokal (offline setelah unduh model)' : 'tidak tersedia'}</strong>
        {isElectron() ? ' · Aplikasi desktop memakai Whisper lokal.' : ''}
      </p>
      <div className="grid-2">
        <label className="field">
          <span>Bahasa</span>
          <select className="select" value={prefs.lang} onChange={(e) => update({ lang: e.target.value as VoicePrefs['lang'] })}>
            <option value="id-ID">Bahasa Indonesia</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
        <label className="field">
          <span>Mesin pengenalan suara</span>
          <select className="select" value={prefs.engine} onChange={(e) => update({ engine: e.target.value as VoicePrefs['engine'] })}>
            <option value="auto">Otomatis</option>
            <option value="browser" disabled={!browserSpeechAvailable()}>
              Web Speech API (Chrome/Edge)
            </option>
            <option value="whisper" disabled={!microphoneAvailable()}>
              Whisper lokal
            </option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Model Whisper</span>
        <select className="select" value={prefs.whisperModel} onChange={(e) => update({ whisperModel: e.target.value })}>
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="hint">Model diunduh sekali dari Hugging Face lalu disimpan di cache browser/aplikasi.</span>
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input type="checkbox" checked={prefs.autoSend} onChange={(e) => update({ autoSend: e.target.checked })} />
        Kirim otomatis setelah selesai bicara
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 12 }}>
        <input type="checkbox" checked={prefs.speakReplies} disabled={!ttsAvailable()} onChange={(e) => update({ speakReplies: e.target.checked })} />
        Karakter membacakan ringkasan hasil (text-to-speech)
      </label>
      <button
        type="button"
        className="btn small"
        disabled={!ttsAvailable()}
        onClick={() => speak(prefs.lang === 'id-ID' ? 'Halo, saya SOLAR AI Agent. Siap membantu desain arsitektur Anda.' : 'Hi, I am SOLAR AI Agent, ready to help with your architecture.', prefs.lang)}
      >
        Tes suara
      </button>
    </div>
  );
}
