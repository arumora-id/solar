import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3Config } from '../config.js';
import { resolveInside, writeFileAtomic } from '../util/fs.js';

/** Binary storage for generated artifacts (diagrams, documents, models). */
export interface ObjectStore {
  readonly kind: 's3' | 'local-file';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Removes the object; a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export class LocalObjectStore implements ObjectStore {
  readonly kind = 'local-file' as const;
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, 'artifacts');
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = resolveInside(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(resolveInside(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await rm(resolveInside(this.root, key), { force: true });
  }
}

/** Neon object storage / AWS S3 / Cloudflare R2 / MinIO - anything that speaks the S3 API. */
export class S3ObjectStore implements ObjectStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // S3-compatible providers (Neon, R2, MinIO, ...) often reject the SDK's default CRC32 checksums
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private fullKey(key: string): string {
    return `${this.cfg.prefix}${key}`.replace(/^\/+/, '');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key), Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key) }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.fullKey(key) }));
  }
}
