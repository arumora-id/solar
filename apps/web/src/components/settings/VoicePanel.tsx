import { useState } from 'react';
import { t as dictionary, useLang, useT } from '../../lib/i18n';
import { browserSpeechAvailable, isElectron, microphoneAvailable } from '../../voice/recognition';
import { speak, ttsAvailable } from '../../voice/tts';
import {
  loadVoicePrefs,
  resolveEngine,
  saveVoicePrefs,
  SPEECH_LOCALES,
  speechLocale,
  WHISPER_MODELS,
  type VoicePrefs,
} from '../../voice/useVoice';

export function VoicePanel() {
  const t = useT();
  const lang = useLang();
  const words = t.voice.panel;
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const update = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveVoicePrefs(next);
  };
  const engine = resolveEngine(prefs, false);
  // 'auto' follows the interface language; shown in the option so the user sees which one that is now
  const locale = speechLocale(prefs.lang);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        {words.activeEngine} <strong>{words.engines[engine ?? 'none']}</strong>
        {isElectron() ? ` · ${words.desktopNote}` : ''}
      </p>
      {/* start: the hint under the language makes that column taller, the engine field keeps its own height (hints in a
          field: regular weight and color, not those of the field label) */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <label className="field">
          <span>{words.language}</span>
          <select className="select" value={prefs.lang} onChange={(e) => update({ lang: e.target.value as VoicePrefs['lang'] })}>
            <option value="auto">{words.languageAuto(t.common.languageName[lang])}</option>
            {SPEECH_LOCALES.map((l) => (
              <option key={l} value={l}>
                {words.languages[l]}
              </option>
            ))}
          </select>
          <span className="hint" style={{ fontWeight: 400, color: 'var(--ink-3)' }}>
            {words.languageAutoHint}
          </span>
        </label>
        <label className="field">
          <span>{words.engine}</span>
          <select className="select" value={prefs.engine} onChange={(e) => update({ engine: e.target.value as VoicePrefs['engine'] })}>
            <option value="auto">{words.engineAuto}</option>
            <option value="browser" disabled={!browserSpeechAvailable()}>
              {words.engineBrowser}
            </option>
            <option value="whisper" disabled={!microphoneAvailable()}>
              {words.engineWhisper}
            </option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>{words.whisperModel}</span>
        <select className="select" value={prefs.whisperModel} onChange={(e) => update({ whisperModel: e.target.value })}>
          {WHISPER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {words.whisperModels[m.size]}
            </option>
          ))}
        </select>
        <span className="hint" style={{ fontWeight: 400, color: 'var(--ink-3)' }}>
          {words.whisperHint}
        </span>
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 8 }}>
        <input type="checkbox" checked={prefs.autoSend} onChange={(e) => update({ autoSend: e.target.checked })} />
        {words.autoSend}
      </label>
      <label className="toggle" style={{ display: 'flex', marginBottom: 12 }}>
        <input type="checkbox" checked={prefs.speakReplies} disabled={!ttsAvailable()} onChange={(e) => update({ speakReplies: e.target.checked })} />
        {words.speakReplies}
      </label>
      <button
        type="button"
        className="btn small"
        disabled={!ttsAvailable()}
        // the test sentence is in the speech language (its own dictionary), whatever the interface language
        onClick={() => speak(dictionary(locale === 'en-US' ? 'en' : 'id').voice.panel.testPhrase, locale)}
      >
        {words.test}
      </button>
    </div>
  );
}
