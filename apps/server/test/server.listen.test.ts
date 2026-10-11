import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

function testConfig(): AppConfig {
  const dataDir = mkdtempSync(join(tmpdir(), 'solar-listen-'));
  const config = loadConfig({
    ...process.env,
    SOLAR_ROOT: fileURLToPath(new URL('../../..', import.meta.url)),
    DATA_DIR: dataDir,
    PLUGINS_DEFAULT_FILE: join(dataDir, 'no-plugins.json'),
    DATABASE_URL: '',
    S3_BUCKET: '',
    SOLAR_ACCESS_TOKEN: '',
    KNOWLEDGE_DIR: '',
    HOST: '127.0.0.1',
  });
  config.databaseUrl = undefined;
  config.s3 = null;
  config.accessToken = undefined;
  return config;
}

describe('startServer on a port that is taken', () => {
  let busy: Server | undefined;
  afterAll(async () => {
    await new Promise<void>((resolve) => (busy ? busy.close(() => resolve()) : resolve()));
  });

  it('rejects with EADDRINUSE (the desktop app then starts on a free port)', async () => {
    busy = createServer();
    const port = await new Promise<number>((resolve) => busy!.listen(0, '127.0.0.1', () => resolve((busy!.address() as { port: number }).port)));
    const config = testConfig();

    await expect(startServer({ config, port })).rejects.toMatchObject({ code: 'EADDRINUSE' });

    // the desktop app's fallback: a random free port
    const running = await startServer({ config, port: 0 });
    try {
      expect(running.port).not.toBe(port);
      expect((await fetch(`${running.url}/api/health`)).status).toBe(200);
    } finally {
      await running.close();
    }
  });
});
