import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PluginStatus } from '@solar/shared';
import { loadConfig } from '../src/config.js';
import { buildArchimate } from '../src/generators/archimate/index.js';
import { buildSequence } from '../src/generators/sequence/index.js';
import { textWidth } from '../src/generators/validation.js';
import { PlaneClient, retryAfterMs } from '../src/integrations/plane.js';
import { McpManager } from '../src/plugins/mcpManager.js';
import { PluginStore } from '../src/plugins/pluginStore.js';
import { localOnlyMiddleware } from '../src/routes/api.js';
import { EventBus } from '../src/tasks/eventBus.js';

/** Regression tests for the findings of the pre-merge review. */

const svgWidth = (svg: string) => Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)![1]);

describe('sequence diagrams', () => {
  it('emits "--++" in PlantUML when a message both ends and starts an activation', () => {
    const res = buildSequence({
      title: 'Hand-off',
      participants: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' },
        { id: 'C', label: 'C' },
      ],
      steps: [
        { type: 'message', from: 'A', to: 'B', text: 'start', activate: true },
        { type: 'message', from: 'B', to: 'C', text: 'forward and done', activate: true, deactivate: true },
        { type: 'message', from: 'C', to: 'A', text: 'done', style: 'reply', deactivate: true },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.plantuml).toContain('B -> C --++ : forward and done');
    expect(res.output.plantuml).not.toContain('++ --');
  });

  it('wraps long participant labels and sizes the canvas to the title, notes and dividers', () => {
    const title = 'Order checkout with payment authorization and fraud screening';
    const divider = 'Asynchronous settlement with the acquiring bank and reconciliation at the end of the business day';
    const res = buildSequence({
      title,
      description: 'Shows the complete checkout including the synchronous payment authorization and the asynchronous fraud screening.',
      participants: [
        { id: 'CRM', label: 'Customer Relationship Management (Salesforce Sales Cloud)' },
        { id: 'ESB', label: 'Enterprise Service Bus (IBM App Connect Enterprise)' },
      ],
      steps: [
        { type: 'message', from: 'CRM', to: 'ESB', text: 'sync' },
        { type: 'divider', text: divider },
        { type: 'note', over: ['ESB'], text: 'A rather long note over the last participant that needs wrapping inside its box' },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { svg } = res.output;
    const width = svgWidth(svg);
    expect(width).toBeGreaterThanOrEqual(24 + textWidth(title, 17));
    expect(width).toBeGreaterThanOrEqual(2 * 24 + textWidth(divider, 11.5));
    // every head label line fits in the 200px head box
    const labels = [...svg.matchAll(/font-size="12.5" font-weight="600"[^>]*>([^<]+)</g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThan(4);
    for (const l of labels) expect(textWidth(l, 12.5)).toBeLessThanOrEqual(184);
    // nothing is positioned left of the canvas or right of its width
    for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="[\d.]+" width="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(width);
    }
  });
});

describe('ArchiMate', () => {
  it('rejects a relationship through a junction that is invalid end to end', () => {
    const res = buildArchimate({
      name: 'Junction',
      elements: [
        { id: 'order', type: 'DataObject', name: 'Order' },
        { id: 'j', type: 'OrJunction', name: 'j' },
        { id: 'ship', type: 'ApplicationProcess', name: 'Ship' },
      ],
      relationships: [
        { type: 'Triggering', source: 'order', target: 'j' },
        { type: 'Triggering', source: 'j', target: 'ship' },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.message).join('\n')).toMatch(/Via junction "j", Triggering connects DataObject "Order" to ApplicationProcess "Ship"/);
  });

  it('accepts a valid relationship through chained junctions', () => {
    const res = buildArchimate({
      name: 'Junction ok',
      elements: [
        { id: 'p1', type: 'BusinessProcess', name: 'Receive order' },
        { id: 'j1', type: 'AndJunction', name: 'j1' },
        { id: 'j2', type: 'AndJunction', name: 'j2' },
        { id: 'p2', type: 'BusinessProcess', name: 'Check stock' },
        { id: 'p3', type: 'BusinessProcess', name: 'Charge card' },
      ],
      relationships: [
        { type: 'Triggering', source: 'p1', target: 'j1' },
        { type: 'Triggering', source: 'j1', target: 'j2' },
        { type: 'Triggering', source: 'j2', target: 'p2' },
        { type: 'Triggering', source: 'j2', target: 'p3' },
      ],
    });
    expect(res.ok, res.ok ? '' : JSON.stringify(res.errors)).toBe(true);
  });

  it('keeps generated exchange identifiers apart from user ids and rejects blank names', () => {
    const res = buildArchimate({
      name: 'Shop',
      elements: [
        { id: 'model-shop', type: 'ApplicationComponent', name: 'Model shop' },
        { id: 'b', type: 'ApplicationService', name: 'B' },
        { id: 'v1-n-b', type: 'ApplicationService', name: 'Collides with a view node id' },
      ],
      relationships: [{ type: 'Realization', source: 'model-shop', target: 'b' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = [...res.output.exchangeXml.matchAll(/identifier="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);

    const blank = buildArchimate({ name: 'x', elements: [{ id: 'a', type: 'ApplicationComponent', name: '   ' }] });
    expect(blank.ok).toBe(false);
  });

  it('widens small views so the title and subtitle are not clipped', () => {
    const res = buildArchimate({
      name: 'Order Platform - Target Architecture',
      elements: [
        { id: 'a', type: 'ApplicationComponent', name: 'A' },
        { id: 'b', type: 'ApplicationService', name: 'B' },
      ],
      relationships: [{ type: 'Realization', source: 'a', target: 'b' }],
      views: [{ name: 'Application cooperation', viewpoint: 'Application Cooperation' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { svg } = res.output.views[0]!;
    const subtitle = /font-size="11.5" fill="#57606a">([^<]+)</.exec(svg)![1]!.replace('&amp;', '&');
    expect(subtitle).not.toContain('…');
    expect(svgWidth(svg)).toBeGreaterThanOrEqual(textWidth(subtitle, 11.5) + 2 * 24);
  });
});

describe('Plane throttling', () => {
  let server: Server | undefined;
  afterAll(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  it('parses Retry-After', () => {
    expect(retryAfterMs('2')).toBe(2250);
    expect(retryAfterMs(null)).toBe(60_000);
    expect(retryAfterMs('9999')).toBe(120_250);
  });

  it('retries after 429 and reports what was created when an item fails', async () => {
    let posts = 0;
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url?.startsWith('/api/v1/workspaces/ws/projects/p1/')) {
        res.end(JSON.stringify({ id: 'p1', name: 'Backlog', identifier: 'BL' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/v1/workspaces/ws/projects/p1/issues/') {
        posts += 1;
        if (posts === 1) {
          res.writeHead(429, { 'Retry-After': '0' });
          res.end(JSON.stringify({ detail: 'Request was throttled.' }));
          return;
        }
        if (posts === 4) {
          res.writeHead(500);
          res.end(JSON.stringify({ detail: 'boom' }));
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => res.end(JSON.stringify({ id: `i${posts}`, name: (JSON.parse(body) as { name: string }).name, sequence_id: posts })));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const plane = new PlaneClient({ apiKey: 'k', workspaceSlug: 'ws', hostUrl: `http://127.0.0.1:${port}` });
    const result = await plane.createBacklog(
      'p1',
      [
        { ref: 'E1', name: 'Epic' },
        { ref: 'S1', name: 'Story 1', parentRef: 'E1' },
        { ref: 'S2', name: 'Story 2', parentRef: 'E1' },
      ],
      { skipExisting: false },
    );
    // POST 1 throttled and retried (2), S1 created (3), S2 failed (4)
    expect(result.created.map((c) => c.ref)).toEqual(['E1', 'S1']);
    expect(result.error).toMatch(/500/);
  });
});

describe('plugins', () => {
  it('derives a valid id from a long plugin name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solar-plugins-'));
    writeFileSync(join(dir, 'defaults.json'), '[]');
    const store = new PluginStore(dir, join(dir, 'defaults.json'));
    await store.init();
    const created = await store.create({ name: 'Confluence Cloud Engineering Knowledge Base', transport: 'http', url: 'https://x.example/mcp' });
    expect(created.id.length).toBeLessThanOrEqual(40);
    expect(created.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });

  it('reports an invalid plugin URL as an error instead of hanging in "connecting"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solar-plugins-'));
    writeFileSync(join(dir, 'defaults.json'), '[]');
    const store = new PluginStore(dir, join(dir, 'defaults.json'));
    await store.init();
    await store.create({ id: 'bad', name: 'Bad', transport: 'http', url: 'mcp.example.com/mcp' });
    const mcp = new McpManager(store, new EventBus());
    await expect(mcp.connect('bad')).rejects.toThrow(/http/);
    const status: PluginStatus = mcp.status('bad');
    expect(status.state).toBe('error');
    expect(status.error).toContain('mcp.example.com/mcp');
  });
});

describe('local-only API guard (DNS rebinding)', () => {
  const run = (token: string | undefined, headers: Record<string, string>) => {
    let error: unknown = 'not called';
    localOnlyMiddleware(token, '127.0.0.1')({ headers } as never, {} as never, (err?: unknown) => {
      error = err;
    });
    return error as { status?: number } | undefined;
  };

  it('accepts requests for this computer', () => {
    expect(run(undefined, { host: '127.0.0.1:8790' })).toBeUndefined();
    expect(run(undefined, { host: 'localhost:5173', origin: 'http://localhost:5173' })).toBeUndefined();
    expect(run(undefined, { host: '[::1]:8790', origin: 'http://[::1]:8790' })).toBeUndefined();
  });

  it('rejects a rebound host name or a foreign origin', () => {
    expect(run(undefined, { host: 'evil.example:8790' })?.status).toBe(403);
    expect(run(undefined, { host: '127.0.0.1:8790', origin: 'http://evil.example:8790' })?.status).toBe(403);
    expect(run(undefined, { host: '127.0.0.1:8790', origin: 'null' })?.status).toBe(403);
  });

  it('leaves token-protected deployments alone', () => {
    expect(run('secret', { host: 'solar.internal.example' })).toBeUndefined();
  });
});

describe('config', () => {
  it('replaces a leftover Anthropic model from an old .env with the OpenAI default', () => {
    const config = loadConfig({ SOLAR_ROOT: tmpdir(), SOLAR_MODEL: 'claude-opus-5-5' });
    expect(config.openai.model).toBe('gpt-6.1-sol');
    expect(loadConfig({ SOLAR_ROOT: tmpdir(), SOLAR_MODEL: 'gpt-6-astra' }).openai.model).toBe('gpt-6-astra');
  });
});
