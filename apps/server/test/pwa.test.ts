import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';

describe('web UI as a progressive web app', () => {
  let solar: RunningServer;

  beforeAll(async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solar-pwa-'));
    const web = join(dataDir, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>SOLAR AI AGENT</title>');
    writeFileSync(join(web, 'sw.js'), "self.addEventListener('fetch', () => {});");
    writeFileSync(join(web, 'manifest.webmanifest'), JSON.stringify({ name: 'SOLAR AI AGENT', start_url: '/' }));
    writeFileSync(join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(web, 'assets', 'index-Ab12Cd34.js'), 'console.log(1);');
    const config = loadConfig({
      ...process.env,
      SOLAR_ROOT: fileURLToPath(new URL('../../..', import.meta.url)),
      DATA_DIR: dataDir,
      WEB_DIST_DIR: web,
      PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    });
    config.databaseUrl = undefined;
    config.s3 = null;
    config.accessToken = undefined;
    solar = await startServer({ config, port: 0 });
  });

  afterAll(async () => {
    await solar?.close();
  });

  const get = (path: string) => fetch(`${solar.url}${path}`);

  it('serves the service worker and the manifest uncached, so new versions are noticed', async () => {
    const sw = await get('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers.get('content-type')).toMatch(/javascript/);
    expect(sw.headers.get('cache-control')).toBe('no-cache');

    const manifest = await get('/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('lets browsers keep hashed build files for good and other files for an hour', async () => {
    const asset = await get('/assets/index-Ab12Cd34.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const icon = await get('/favicon.svg');
    expect(icon.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('still answers app routes with the uncached page and leaves the API alone', async () => {
    const page = await get('/monitor/task-1');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('SOLAR AI AGENT');
    const health = await get('/api/health');
    expect(health.headers.get('cache-control')).not.toBe('public, max-age=31536000, immutable');
  });
});
