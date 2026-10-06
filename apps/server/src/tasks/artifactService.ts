import type { Artifact, ArtifactKind } from '@solar/shared';
import type { ObjectStore } from '../storage/objectStore.js';
import type { Repository } from '../storage/repository.js';
import { KeyedQueue } from '../util/fs.js';
import { newId, nowIso } from '../util/ids.js';

export interface NewArtifact {
  taskId: string;
  name: string;
  title: string;
  kind: ArtifactKind;
  mimeType: string;
  bundle: string;
  description?: string;
  content: string | Buffer;
}

const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

/** Stores artifact bytes in the object store and metadata in the repository. */
export class ArtifactService {
  /** Serialises creation per task so concurrent tool calls never pick the same file name. */
  private readonly queue = new KeyedQueue();

  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
  ) {}

  create(input: NewArtifact): Promise<Artifact> {
    return this.queue.run(input.taskId, () => this.createNow(input));
  }

  private async createNow(input: NewArtifact): Promise<Artifact> {
    const id = newId('art');
    const name = await this.uniqueName(input.taskId, input.name.replace(SAFE_NAME, '-').replace(/^-+/, '') || `${id}.bin`);
    const body = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
    const storageKey = `tasks/${input.taskId}/${id}/${name}`;
    await this.store.put(storageKey, body, input.mimeType);
    const artifact: Artifact = {
      id,
      taskId: input.taskId,
      name,
      title: input.title,
      kind: input.kind,
      mimeType: input.mimeType,
      size: body.byteLength,
      storageKey,
      bundle: input.bundle,
      description: input.description ?? null,
      createdAt: nowIso(),
    };
    await this.repo.saveArtifact(artifact);
    return artifact;
  }

  /** File names are unique per task so a task folder can be published as-is (e.g. to GitHub). */
  private async uniqueName(taskId: string, name: string): Promise<string> {
    const taken = new Set((await this.repo.listArtifacts(taskId)).map((a) => a.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.indexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) {
      const candidate = `${stem}-${n}${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  get(id: string): Promise<Artifact | null> {
    return this.repo.getArtifact(id);
  }

  list(taskId: string): Promise<Artifact[]> {
    return this.repo.listArtifacts(taskId);
  }

  async read(artifact: Artifact): Promise<Buffer> {
    return this.store.get(artifact.storageKey);
  }

  async readText(artifact: Artifact): Promise<string> {
    return (await this.read(artifact)).toString('utf8');
  }
}
