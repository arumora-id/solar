import type { Attachment } from '@solar/shared';
import { createLogger } from '../logger.js';
import { detectKind, DocumentError, extractDocument, outlineOf } from '../documents/index.js';
import type { ObjectStore } from '../storage/objectStore.js';
import type { Repository } from '../storage/repository.js';
import { newId, nowIso } from '../util/ids.js';

const log = createLogger('attachments');

/** Keeps recently read extracted texts in memory (the agent reads documents in several chunks). */
const CACHE_ENTRIES = 24;
const CACHE_MAX_CHARS = 30_000_000;

/** Removes path components and control characters from an uploaded file name. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 200) return cleaned;
  // keep the extension when shortening
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, 200 - ext.length)}${ext}`;
}

/** Stores uploaded project documents and their extracted Markdown. */
export class AttachmentService {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
    private readonly options: { maxFileBytes: number },
  ) {}

  /** Validates, extracts and stores a document. Throws DocumentError with a user-facing message. */
  async create(sessionId: string, rawName: string, body: Buffer): Promise<Attachment> {
    const name = cleanFileName(rawName);
    if (!name) throw new DocumentError('Nama file kosong.');
    if (body.length > this.options.maxFileBytes) {
      throw new DocumentError(`"${name}" terlalu besar (maks ${Math.round(this.options.maxFileBytes / 1024 / 1024)} MB).`, 413);
    }
    const { mimeType } = detectKind(name);
    const started = Date.now();
    const extracted = await extractDocument(body, name);
    const id = newId('att');
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'document';
    const storageKey = `attachments/${id}/${safe}`;
    const textKey = `attachments/${id}/extracted.md`;
    await this.store.put(storageKey, body, mimeType);
    await this.store.put(textKey, Buffer.from(extracted.markdown, 'utf8'), 'text/markdown; charset=utf-8');
    const attachment: Attachment = {
      id,
      sessionId,
      name,
      kind: extracted.kind,
      mimeType,
      size: body.length,
      parts: extracted.parts,
      chars: extracted.markdown.length,
      outline: outlineOf(extracted.markdown),
      warnings: extracted.warnings,
      storageKey,
      textKey,
      createdAt: nowIso(),
    };
    await this.repo.saveAttachment(attachment);
    this.remember(id, extracted.markdown);
    log.info(`Attachment ${id} "${name}" (${extracted.kind}, ${body.length} bytes → ${attachment.chars} chars) in ${Date.now() - started} ms`);
    return attachment;
  }

  get(id: string): Promise<Attachment | null> {
    return this.repo.getAttachment(id);
  }

  listForSession(sessionId: string): Promise<Attachment[]> {
    return this.repo.listAttachments({ sessionId });
  }

  /** Attachments in the order of `ids` (unknown ids are skipped). */
  async listByIds(ids: string[]): Promise<Attachment[]> {
    if (ids.length === 0) return [];
    const found = new Map((await this.repo.listAttachments({ ids })).map((a) => [a.id, a]));
    return ids.map((id) => found.get(id)).filter((a): a is Attachment => Boolean(a));
  }

  async readText(attachment: Attachment): Promise<string> {
    const cached = this.cache.get(attachment.id);
    if (cached !== undefined) {
      // refresh LRU position
      this.cache.delete(attachment.id);
      this.cache.set(attachment.id, cached);
      return cached;
    }
    const text = (await this.store.get(attachment.textKey)).toString('utf8');
    this.remember(attachment.id, text);
    return text;
  }

  readOriginal(attachment: Attachment): Promise<Buffer> {
    return this.store.get(attachment.storageKey);
  }

  /** Deletes an attachment that no task uses yet; returns false when a task references it. */
  async remove(id: string): Promise<'deleted' | 'in-use' | 'not-found'> {
    const attachment = await this.repo.getAttachment(id);
    if (!attachment) return 'not-found';
    if (await this.repo.isAttachmentReferenced(id)) return 'in-use';
    await this.repo.deleteAttachment(id);
    this.cache.delete(id);
    await Promise.all([attachment.storageKey, attachment.textKey].map((key) => this.store.delete(key).catch(() => undefined)));
    return 'deleted';
  }

  private remember(id: string, text: string): void {
    this.cache.delete(id);
    this.cache.set(id, text);
    let total = 0;
    for (const v of this.cache.values()) total += v.length;
    for (const key of this.cache.keys()) {
      if (this.cache.size <= CACHE_ENTRIES && total <= CACHE_MAX_CHARS) break;
      total -= this.cache.get(key)!.length;
      this.cache.delete(key);
    }
  }
}
