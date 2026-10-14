import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type Task } from '@solar/shared';
import type { RunningServer } from '../src/server.js';
import { FileRepository } from '../src/storage/fileRepository.js';
import {
  authTestConfig, Client, message, startAuthServer, StatelessModel,
  STRONG_PASSWORD, TEST_ACCESS_TOKEN, tokenClient, userClient,
} from './helpers/authServer.js';

interface Page {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

const totalSeeded = 223;
const seededTask = (i: number): Task => ({
  id: `task_paging${String(i).padStart(4, '0')}`,
  sessionId: 'historical-session',
  title: i === 222 ? 'Unique 50%_done review' : (i % 2 ? 'Architecture review' : 'Approval request'),
  prompt: `Historical task ${i}`,
  status: i % 3 === 0 ? 'failed' : 'completed',
  progress: 100,
  currentStep: null,
  model: 'model',
  // Deliberately identical timestamps to check stable tie-breaking across page boundaries.
  createdAt: '2026-10-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  usage: { ...EMPTY_USAGE },
  attachmentIds: [],
  language: 'id',
});

describe('server-side full-history Monitor pages', () => {
  let server: RunningServer;
  let admin: Client;
  let staff: Client;
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'solar-task-page-'));
    const tasksDir = join(root, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    for (let i = 0; i < totalSeeded; i++) {
      const task = seededTask(i);
      writeFileSync(join(tasksDir, `${task.id}.json`), JSON.stringify(task));
    }
    server = await startAuthServer({
      config: authTestConfig({
        SOLAR_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
        SOLAR_ADMIN_USERNAME: 'root',
        SOLAR_ADMIN_EMAIL: 'root@solar.test',
        SOLAR_ADMIN_PASSWORD: STRONG_PASSWORD,
      }, root),
      responses: new StatelessModel(() => [message('done')]),
    });
    admin = tokenClient(server.url);
    staff = (await userClient(server.url, admin, 'paginationstaff', 'staff', 'Pagination Staff')).client;
  }, 60_000);

  afterAll(async () => { await server?.close(); });

  it('retrieves every task beyond the old 200-item client cache with a stable order', async () => {
    const ids: string[] = [];
    for (let offset = 0; offset < totalSeeded; offset += 50) {
      const response = await admin.get<Page>(`/api/tasks/page?limit=50&offset=${offset}`);
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(totalSeeded);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(offset);
      expect(response.body.hasNext).toBe(offset + 50 < totalSeeded);
      ids.push(...response.body.items.map((task) => task.id));
    }
    expect(ids).toHaveLength(totalSeeded);
    expect(new Set(ids).size).toBe(totalSeeded);
    expect(ids).toEqual([...ids].sort((a, b) => b.localeCompare(a)));
    const beyond = await admin.get<Page>('/api/tasks/page?limit=5&offset=500');
    expect(beyond.body).toMatchObject({ total: totalSeeded, items: [], hasNext: false });
  });

  it('searches the entire authorized history with literal percent and underscore', async () => {
    const review = await admin.get<Page>('/api/tasks/page?limit=5&search=architecture');
    expect(review.status).toBe(200);
    expect(review.body.total).toBe(111);
    expect(review.body.items).toHaveLength(5);
    const wildcard = await admin.get<Page>('/api/tasks/page?limit=5&search=50%25_done');
    expect(wildcard.body.total).toBe(1);
    expect(wildcard.body.items[0]?.id).toBe('task_paging0222');
    const fromPrompt = await admin.get<Page>('/api/tasks/page?limit=5&search=Historical%20task%2013');
    expect(fromPrompt.body.total).toBeGreaterThan(0);
  });

  it('filters statuses including active union and counts from the same authorized set', async () => {
    const failed = await admin.get<Page>('/api/tasks/page?limit=10&status=failed');
    expect(failed.status).toBe(200);
    expect(failed.body.total).toBe(75);
    expect(failed.body.items.every((task) => task.status === 'failed')).toBe(true);
    const active = await admin.get<Page>('/api/tasks/page?limit=5&status=active');
    expect(active.body).toMatchObject({ total: 0, items: [] });
    const invalid = await admin.get('/api/tasks/page?limit=200');
    expect(invalid.status).toBe(400);
  });

  it('enforces roles for items, counts and search; retains the legacy array endpoint', async () => {
    const own = await staff.post<Task>('/api/tasks', { prompt: 'My private pagination request', sessionId: 'staff-paging' });
    expect(own.status).toBe(201);
    const scoped = await staff.get<Page>('/api/tasks/page?limit=5');
    expect(scoped.status).toBe(200);
    expect(scoped.body.total).toBe(1);
    expect(scoped.body.items[0]?.id).toBe(own.body.id);
    const denied = await staff.get<Page>('/api/tasks/page?limit=100&owner=none&search=Architecture');
    expect(denied.body).toMatchObject({ total: 0, items: [] });
    const legacy = await admin.get<Task[]>('/api/tasks?limit=5');
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    const ownerless = await admin.get<Page>('/api/tasks/page?limit=5&owner=none');
    expect(ownerless.body.total).toBe(totalSeeded);
    const outsider = await new Client(server.url).get('/api/tasks/page');
    expect(outsider.status).toBe(401);
  });
});

describe('local repository mirrors the pagination predicates', () => {
  it('combines active statuses, owner scope, search and count without truncation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'solar-page-local-'));
    const repo = new FileRepository(root);
    await repo.init();
    try {
      for (let i = 0; i < 225; i++) {
        await repo.upsertTask({
          ...seededTask(i),
          ownerId: i % 2 ? 'user_a' : 'user_b',
          status: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'queued' : 'awaiting_confirmation',
        });
      }
      const filter = { status: 'active' as const, ownerId: 'user_a', search: 'task 22' };
      // Title/ID not necessarily matching, but prompt always includes 'Historical task i'.
      const count = await repo.countTasks(filter);
      const page1 = await repo.listTasks({ ...filter, offset: 0, limit: 5 });
      const page2 = await repo.listTasks({ ...filter, offset: 5, limit: 5 });
      expect(count).toBeGreaterThan(0);
      expect(page1.length + page2.length).toBe(count);
      expect(page1.every((t) => t.ownerId === 'user_a')).toBe(true);
      expect(page1.concat(page2).every((t) => ['running','queued','awaiting_confirmation'].includes(t.status))).toBe(true);
    } finally {
      await repo.close();
    }
  });
});
