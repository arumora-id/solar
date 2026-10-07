// Collects the licence texts of the npm packages bundled into the server, the web app and the desktop app (found
// through the bundles' source maps) for the release files. Run after `npm run build`:
//   node scripts/third-party-licenses.mjs   ->  release/THIRD_PARTY_LICENSES.txt
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARK = '/node_modules/';

function sourceMaps(root) {
  const maps = [];
  for (const dir of ['apps/server/dist', 'apps/web/dist/assets', 'apps/desktop/dist']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir))) if (/\.[cm]?js\.map$/.test(name)) maps.push(join(root, dir, name));
  }
  return maps;
}

/** Licence texts of every package whose code ends up in a bundle, sorted by name. */
export function thirdPartyLicenses(root) {
  const maps = sourceMaps(root);
  if (!maps.length) throw new Error('No source maps found - run "npm run build" first.');
  /** @type {Map<string, { name: string; version: string; license?: unknown }>} */
  const packages = new Map();
  for (const map of maps) {
    const { sources = [], sourceRoot = '' } = JSON.parse(readFileSync(map, 'utf8'));
    for (const source of sources) {
      const path = resolve(dirname(map), sourceRoot, source.replace(/^[a-z]+:\/\//i, '')).split('\\').join('/');
      const at = path.lastIndexOf(MARK);
      if (at < 0) continue;
      const parts = path.slice(at + MARK.length).split('/');
      const dir = path.slice(0, at + MARK.length) + parts.slice(0, parts[0]?.startsWith('@') ? 2 : 1).join('/');
      if (packages.has(dir) || !existsSync(join(dir, 'package.json'))) continue;
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      // nested copies of the same release are listed once
      const seen = [...packages.values()].some((p) => p.name === pkg.name && p.version === pkg.version);
      if (pkg.name && !pkg.name.startsWith('@solar/') && !seen) packages.set(dir, pkg);
    }
  }
  const sections = [...packages]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)))
    .map(([dir, pkg]) => {
      const texts = readdirSync(dir)
        .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
        .sort()
        .map((f) => readFileSync(join(dir, f), 'utf8').trim());
      const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'UNKNOWN');
      return `${pkg.name}@${pkg.version} (${license})\n${'-'.repeat(72)}\n${texts.length ? texts.join('\n\n') : `License: ${license}`}\n`;
    });
  return (
    'SOLAR AI AGENT - third-party software\n\n' +
    'The server, web app and desktop app bundle the following packages. Their licences follow.\n' +
    'See THIRD_PARTY_NOTICES.md for other material (e.g. the ArchiMate relationship table from Archi).\n\n' +
    `${sections.join('\n')}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const out = join(root, 'release', 'THIRD_PARTY_LICENSES.txt');
  mkdirSync(dirname(out), { recursive: true });
  const text = thirdPartyLicenses(root);
  writeFileSync(out, text);
  console.log(`${relative(root, out)}: ${(text.match(/^-{72}$/gm) ?? []).length} packages`);
}
