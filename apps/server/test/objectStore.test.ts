import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ObjectStore } from '../src/storage/objectStore.js';

/** Minimal path-style S3 endpoint: stores PUT bodies and serves them on GET. */
let server: Server;
let endpoint = '';
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: Array<{ method: string; url: string; headers: Record<string, unknown> }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      const key = decodeURIComponent((req.url ?? '').split('?')[0]!);
      if (req.method === 'PUT') {
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? '') });
        res.writeHead(200, { ETag: '"etag"' }).end();
      } else if (req.method === 'GET' && objects.has(key)) {
        const o = objects.get(key)!;
        res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': o.body.length, ETag: '"etag"' }).end(o.body);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('S3ObjectStore (S3-compatible, path style)', () => {
  it('round-trips artifact bytes under the configured prefix without aws-chunked encoding', async () => {
    const store = new S3ObjectStore({
      endpoint,
      region: 'auto',
      bucket: 'solar-artifacts',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      forcePathStyle: true,
      prefix: 'solar/',
    });
    const body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await store.put('tasks/t1/a1/view.svg', body, 'image/svg+xml');
    expect(objects.get('/solar-artifacts/solar/tasks/t1/a1/view.svg')?.body.equals(body)).toBe(true);
    expect(objects.get('/solar-artifacts/solar/tasks/t1/a1/view.svg')?.type).toBe('image/svg+xml');
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.headers['content-encoding']).toBeUndefined();
    expect(Object.keys(put.headers).some((h) => h.startsWith('x-amz-checksum-'))).toBe(false);
    const read = await store.get('tasks/t1/a1/view.svg');
    expect(read.equals(body)).toBe(true);
  });
});
