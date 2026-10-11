// Packs the self-hosted server (bundled, no npm install needed) with the web UI / PWA, skills and knowledge into
// release/SOLAR-AI-AGENT-server-<version>.zip. Run after `npm run build`:  node scripts/pack-server.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { thirdPartyLicenses } from './third-party-licenses.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const top = `solar-ai-agent-${version}`;

/** @type {Record<string, Uint8Array>} */
const files = {};
const add = (from, to = from) => {
  files[`${top}/${to}`] = readFileSync(join(root, from));
};
const addDir = (dir, skip = /\.map$/) => {
  const walk = (d) => {
    for (const name of readdirSync(join(root, d))) {
      const path = `${d}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (!skip.test(name)) add(path);
    }
  };
  walk(dir);
};

for (const required of ['apps/server/dist/index.js', 'apps/server/dist/extract-worker.mjs', 'apps/server/dist/docx-worker.mjs', 'apps/web/dist/index.html', 'apps/web/dist/sw.js']) {
  if (!existsSync(join(root, required))) {
    console.error(`${required} is missing - run "npm run build" first.`);
    process.exit(1);
  }
}

// the server bundle finds its project root through a package.json named "solar"
files[`${top}/package.json`] = new TextEncoder().encode(
  `${JSON.stringify(
    {
      name: 'solar',
      version,
      private: true,
      description: 'SOLAR AI AGENT - self-hosted server with the web UI (installable as a PWA)',
      type: 'module',
      engines: pkg.engines,
      scripts: { start: 'node apps/server/dist/index.js' },
    },
    null,
    2,
  )}\n`,
);
add('apps/server/dist/index.js');
add('apps/server/dist/extract-worker.mjs');
add('apps/server/dist/docx-worker.mjs');
addDir('apps/web/dist');
addDir('skills', /^$/);
addDir('knowledge', /^$/);
addDir('config', /^$/);
add('.env.example');
add('docs/SELF-HOSTING.md', 'README.md');
add('THIRD_PARTY_NOTICES.md');
files[`${top}/THIRD_PARTY_LICENSES.txt`] = new TextEncoder().encode(thirdPartyLicenses(root));

const out = join(root, 'release', `SOLAR-AI-AGENT-server-${version}.zip`);
mkdirSync(dirname(out), { recursive: true });
const zip = zipSync(files, { level: 9 });
writeFileSync(out, zip);
console.log(`${relative(root, out)}: ${Object.keys(files).length} files, ${(zip.length / 1024 / 1024).toFixed(1)} MB`);
