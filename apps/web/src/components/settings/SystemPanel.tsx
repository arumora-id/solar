import { useState } from 'react';
import { getToken } from '../../lib/api';
import { LANGUAGE_NATIVE_NAME, LANGUAGES, setLang, useLang, useT } from '../../lib/i18n';
import { installApp, isElectron, syncThemeColor, usePwa } from '../../lib/pwa';
import { readPref, writePref } from '../../lib/session';
import { useSolar } from '../../lib/store';

export type ThemePref = 'system' | 'light' | 'dark';

export function applyTheme(theme: ThemePref): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem('solar.theme');
    else localStorage.setItem('solar.theme', theme);
  } catch {
    // ignore
  }
  syncThemeColor();
}

export function currentTheme(): ThemePref {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function SystemPanel() {
  const { config, submitToken } = useSolar();
  const t = useT();
  const [theme, setTheme] = useState<ThemePref>(currentTheme);
  const [token, setTokenValue] = useState(getToken());
  const [compact, setCompact] = useState(readPref('compactStage', false));

  const words = t.settings.system;
  const row = words.rows;
  const rows: Array<[string, string]> = config
    ? [
        [row.version, `${config.appName} ${config.version}`],
        [row.primaryModel, row.primaryModelValue(config.provider, config.model, config.effort)],
        [row.modelRoute, config.modelRoute.join(' → ')],
        [row.modelStatus, config.llmConfigured ? row.modelReady : row.modelMissingKey],
        [row.knowledgeBase, t.common.files(config.knowledgeFiles)],
        [row.database, config.storage.database === 'neon-postgres' ? row.databaseNeon : row.databaseLocal],
        [row.artifactStorage, config.storage.objects === 's3' ? row.storageS3 : row.storageLocal],
        [row.github, config.github.configured ? row.githubConnected(config.github.defaultRepo ?? '-', config.github.defaultBranch) : row.githubMissing],
        [row.plane, config.plane.hostUrl],
        [row.accessToken, config.authRequired ? row.tokenRequired : row.tokenNotRequired],
      ]
    : [];

  return (
    <div>
      <div className="field">
        <span id="theme-field-label">{words.theme}</span>
        <div className="seg" role="group" aria-labelledby="theme-field-label">
          {(['system', 'light', 'dark'] as ThemePref[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => {
                setTheme(option);
                applyTheme(option);
              }}
            >
              {words.themes[option]}
            </button>
          ))}
        </div>
      </div>
      <LanguageField />
      <label className="toggle" style={{ display: 'flex', marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={compact}
          onChange={(e) => {
            setCompact(e.target.checked);
            writePref('compactStage', e.target.checked);
            window.dispatchEvent(new CustomEvent('solar:layout'));
          }}
        />
        {words.compactMode}
      </label>

      {!isElectron && <AppInstall />}

      <h4>{words.serverConfig}</h4>
      <table className="task-table" style={{ marginBottom: 14 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ cursor: 'default' }}>
              <td style={{ width: 180, color: 'var(--ink-2)' }}>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{words.credentialsHint}</p>

      <label className="field">
        <span>{words.tokenLabel}</span>
        <input className="input" type="password" value={token} onChange={(e) => setTokenValue(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="btn small" onClick={() => submitToken(token)}>
        {words.saveToken}
      </button>
    </div>
  );
}

/** Interface language: each option in its own language, so it can be found whatever the current one is. */
function LanguageField() {
  const t = useT();
  const lang = useLang();
  return (
    <div className="field">
      <span id="language-field-label">{t.app.language.label}</span>
      <div className="seg" role="group" aria-labelledby="language-field-label">
        {LANGUAGES.map((l) => (
          <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
            {LANGUAGE_NATIVE_NAME[l]}
          </button>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t.app.language.hint}
      </p>
    </div>
  );
}

/** Installing the web UI as an app (PWA): its own window, start menu / home screen icon, opens offline. */
function AppInstall() {
  const { canInstall, standalone, iosManualInstall } = usePwa();
  const words = useT().settings.system.app;
  return (
    <div className="field">
      <span>{words.label}</span>
      {standalone ? (
        <p className="hint">{words.standalone}</p>
      ) : canInstall ? (
        <div>
          <button type="button" className="btn small" onClick={() => void installApp()}>
            {words.install}
          </button>
          <p className="hint">{words.installHint}</p>
        </div>
      ) : iosManualInstall ? (
        <p className="hint">{words.iosHint}</p>
      ) : (
        <p className="hint">{words.browserHint}</p>
      )}
    </div>
  );
}
