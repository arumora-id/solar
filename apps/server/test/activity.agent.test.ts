import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@solar/shared';
import { createBuiltinTools } from '../src/agent/builtinTools.js';
import type { AppConfig } from '../src/config.js';
import type { ArtifactService } from '../src/tasks/artifactService.js';
import type { TaskActivityInput, TaskRunContext } from '../src/tasks/taskManager.js';

const GITHUB_TOKEN = 'ghp_unit_test_token_never_logged';

const artifact: Artifact = {
  id: 'art_tsd1',
  taskId: 'task_1',
  name: 'order.md',
  title: 'Order TSD',
  kind: 'tsd-markdown',
  mimeType: 'text/markdown',
  size: 5,
  storageKey: 'k',
  bundle: 'b',
  description: null,
  createdAt: '2026-10-12T00:00:00.000Z',
};

function publishTool() {
  const artifacts = { get: async (id: string) => (id === artifact.id ? artifact : null), read: async () => Buffer.from('# TSD') } as unknown as ArtifactService;
  const config = { github: { token: GITHUB_TOKEN, defaultRepo: 'acme/docs', defaultBranch: 'main', publishConfirm: 'never' }, plane: {} } as AppConfig;
  return createBuiltinTools({ config, skills: {} as never, artifacts, attachments: {} as never }).find((t) => t.name === 'publish_artifacts_to_github')!;
}

function context(recorded: TaskActivityInput[]): TaskRunContext {
  return {
    task: { id: 'task_1', language: 'en' },
    signal: new AbortController().signal,
    canReadArtifact: async () => true,
    recordActivity: (input: TaskActivityInput) => recorded.push(input),
  } as unknown as TaskRunContext;
}

/** A GitHub API that answers the calls of one commit (or fails them all with `status`). */
function fakeGithub(status = 200) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (status !== 200) return new Response(JSON.stringify({ message: 'Bad credentials' }), { status });
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body =
      method === 'GET' && path.includes('/git/ref/heads/')
        ? { object: { sha: 'head1' } }
        : method === 'GET' && path.includes('/git/commits/')
          ? { tree: { sha: 'tree0' } }
          : path.endsWith('/git/blobs')
            ? { sha: 'blob1' }
            : path.endsWith('/git/trees')
              ? { sha: 'tree1' }
              : path.endsWith('/git/commits')
                ? { sha: 'commit1', html_url: 'https://github.com/acme/docs/commit/commit1' }
                : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent tools in the activity log', () => {
  it('publish_artifacts_to_github records the commit as the task owner (never the token)', async () => {
    vi.stubGlobal('fetch', fakeGithub());
    const recorded: TaskActivityInput[] = [];
    const tool = publishTool();
    const parsed = tool.parse({ path: 'docs/order', artifact_ids: [artifact.id], commit_message: 'Add TSD' });
    if (!parsed.ok) throw new Error(parsed.error);
    const out = await tool.execute(parsed.value, context(recorded));
    expect(out.isError).toBeFalsy();
    expect(recorded).toEqual([
      {
        action: 'artifact.publish_github',
        outcome: 'success',
        target: { type: 'artifact', id: artifact.id, label: 'acme/docs/docs/order' },
        details: {
          repository: 'acme/docs',
          branch: 'main',
          path: 'docs/order',
          files: 1,
          artifactIds: [artifact.id],
          commitSha: 'commit1',
          commitUrl: 'https://github.com/acme/docs/commit/commit1',
          createdBranch: false,
        },
      },
    ]);
    expect(JSON.stringify(recorded)).not.toContain(GITHUB_TOKEN);
  });

  it('a failed publish is recorded as a failure', async () => {
    vi.stubGlobal('fetch', fakeGithub(401));
    const recorded: TaskActivityInput[] = [];
    const tool = publishTool();
    const parsed = tool.parse({ path: 'docs/order', artifact_ids: [artifact.id], commit_message: 'Add TSD' });
    if (!parsed.ok) throw new Error(parsed.error);
    await expect(tool.execute(parsed.value, context(recorded))).rejects.toThrow(/Bad credentials/);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ action: 'artifact.publish_github', outcome: 'failure', details: { reason: 'error', repository: 'acme/docs' } });
    expect(JSON.stringify(recorded)).not.toContain(GITHUB_TOKEN);
  });
});
