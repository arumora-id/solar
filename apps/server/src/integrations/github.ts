import { APP_NAME, APP_VERSION } from '../config.js';

export interface GithubFile {
  path: string;
  content: Buffer;
}

export interface GithubPublishResult {
  commitSha: string;
  commitUrl: string;
  treeUrl: string;
  branch: string;
  createdBranch: boolean;
  files: string[];
}

class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Minimal GitHub REST client (git data API) used to publish artifacts in a single commit. */
export class GithubClient {
  constructor(private readonly token: string) {}

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${APP_NAME}/${APP_VERSION}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // keep raw text
      }
      throw new GithubError(`GitHub ${method} ${path} failed (${res.status}): ${message}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Commits `files` under `basePath` on `branch` (created from the default branch when missing).
   * Existing files at the same paths are overwritten; other files are untouched.
   */
  async publish(
    repo: string,
    branch: string,
    basePath: string,
    files: GithubFile[],
    message: string,
    signal?: AbortSignal,
  ): Promise<GithubPublishResult> {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`Invalid repository "${repo}" (expected owner/name)`);
    const base = basePath.replace(/^\/+|\/+$/g, '');
    if (base.split('/').some((seg) => seg === '..' || seg === '.')) throw new Error('Path must not contain "." or ".." segments');

    let createdBranch = false;
    let headSha: string;
    try {
      const ref = await this.request<{ object: { sha: string } }>('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, signal);
      headSha = ref.object.sha;
    } catch (err) {
      if (!(err instanceof GithubError) || err.status !== 404) throw err;
      const info = await this.request<{ default_branch: string }>('GET', `/repos/${repo}`, undefined, signal);
      let defaultRef: { object: { sha: string } };
      try {
        defaultRef = await this.request('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`, undefined, signal);
      } catch (inner) {
        if (inner instanceof GithubError && (inner.status === 404 || inner.status === 409)) {
          throw new Error(`Repository ${repo} is empty. Create an initial commit (e.g. a README) on GitHub first, then publish again.`);
        }
        throw inner;
      }
      await this.request('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: defaultRef.object.sha }, signal);
      headSha = defaultRef.object.sha;
      createdBranch = true;
    }

    const headCommit = await this.request<{ tree: { sha: string } }>('GET', `/repos/${repo}/git/commits/${headSha}`, undefined, signal);
    const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
    for (const file of files) {
      const blob = await this.request<{ sha: string }>(
        'POST',
        `/repos/${repo}/git/blobs`,
        { content: file.content.toString('base64'), encoding: 'base64' },
        signal,
      );
      tree.push({ path: base ? `${base}/${file.path}` : file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await this.request<{ sha: string }>('POST', `/repos/${repo}/git/trees`, { base_tree: headCommit.tree.sha, tree }, signal);
    const commit = await this.request<{ sha: string; html_url: string }>(
      'POST',
      `/repos/${repo}/git/commits`,
      { message, tree: newTree.sha, parents: [headSha] },
      signal,
    );
    await this.request('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false }, signal);

    return {
      commitSha: commit.sha,
      commitUrl: commit.html_url || `https://github.com/${repo}/commit/${commit.sha}`,
      treeUrl: `https://github.com/${repo}/tree/${encodeURIComponent(branch)}/${base}`,
      branch,
      createdBranch,
      files: tree.map((t) => t.path),
    };
  }
}
