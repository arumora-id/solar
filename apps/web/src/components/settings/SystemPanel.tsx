import { useState } from 'react';
import { getToken } from '../../lib/api';
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
}

export function currentTheme(): ThemePref {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function SystemPanel() {
  const { config, submitToken } = useSolar();
  const [theme, setTheme] = useState<ThemePref>(currentTheme);
  const [token, setTokenValue] = useState(getToken());
  const [compact, setCompact] = useState(readPref('compactStage', false));

  const rows: Array<[string, string]> = config
    ? [
        ['Versi', `${config.appName} ${config.version}`],
        ['Model', `${config.model} (effort ${config.effort})`],
        ['API key Anthropic', config.anthropicConfigured ? 'Terisi' : 'BELUM diisi (ANTHROPIC_API_KEY)'],
        ['Database', config.storage.database === 'neon-postgres' ? 'Neon Postgres (DATABASE_URL)' : 'File lokal (data/)'],
        ['Penyimpanan artefak', config.storage.objects === 's3' ? 'Object storage S3 (Neon/S3)' : 'File lokal (data/artifacts)'],
        ['GitHub', config.github.configured ? `Terhubung · repo default: ${config.github.defaultRepo ?? '-'} (${config.github.defaultBranch})` : 'Belum (GITHUB_TOKEN)'],
        ['Plane', config.plane.hostUrl],
        ['Akses token', config.authRequired ? 'Wajib' : 'Tidak wajib (hanya localhost)'],
      ]
    : [];

  return (
    <div>
      <div className="field">
        <span>Tema</span>
        <div className="seg" role="group" aria-label="Tema">
          {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => {
                setTheme(t);
                applyTheme(t);
              }}
            >
              {t === 'system' ? 'Ikuti sistem' : t === 'light' ? 'Terang' : 'Gelap'}
            </button>
          ))}
        </div>
      </div>
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
        Mode ringkas (sembunyikan tombol cepat di bawah kelinci)
      </label>

      <h4>Konfigurasi server</h4>
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
      <p className="hint">Kredensial (Anthropic, Neon, S3, GitHub, Plane, Visual Paradigm) diatur di file .env - lihat README.</p>

      <label className="field">
        <span>Token akses SOLAR (SOLAR_ACCESS_TOKEN)</span>
        <input className="input" type="password" value={token} onChange={(e) => setTokenValue(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="btn small" onClick={() => submitToken(token)}>
        Simpan token
      </button>
    </div>
  );
}
