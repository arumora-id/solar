import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentProposal, ContentProposalInput, Role } from '@solar/shared';
import { writeFileAtomic } from '../util/fs.js';
import { newId, nowIso } from '../util/ids.js';

type ReviewerRole = 'superadmin' | 'head_of_it';

/**
 * Immutable on submission: drafts live only in this private staging file.
 * The Skill/Knowledge stores change exclusively when a separately approved
 * proposal is explicitly published by an authorized reviewer.
 */
export class ContentProposalStore {
  private readonly file: string;
  private entries: ContentProposal[] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = join(dataDir, 'content-proposals.json');
  }

  async init(): Promise<void> {
    try {
      this.entries = JSON.parse(await readFile(this.file, 'utf8')) as ContentProposal[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.entries = [];
    }
  }

  private exclusive<T>(op: () => Promise<T>): Promise<T> {
    const next = this.pending.then(op);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }

  private persist(): Promise<void> {
    return writeFileAtomic(this.file, JSON.stringify(this.entries, null, 2), { mode: 0o600 });
  }

  private get(id: string): ContentProposal {
    const value = this.entries.find((e) => e.id === id);
    if (!value) throw new Error('Proposal not found');
    return value;
  }

  list(role: Role, principalId: string): ContentProposal[] {
    const list = role === 'staff'
      ? this.entries.filter((p) => p.authorId === principalId)
      : this.entries;
    return list.map((p) => structuredClone(p)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(input: ContentProposalInput, authorId: string): Promise<ContentProposal> {
    return this.exclusive(async () => {
      if (this.entries.length >= 2000) throw new Error('Proposal queue reached its safety limit');
      const now = nowIso();
      const item: ContentProposal = {
        ...input, id: newId('proposal'), authorId, createdAt: now,
        updatedAt: now, status: 'draft', approvals: {},
      };
      this.entries.push(item);
      await this.persist();
      return structuredClone(item);
    });
  }

  update(id: string, authorId: string, input: ContentProposalInput): Promise<ContentProposal> {
    return this.exclusive(async () => {
      const item = this.get(id);
      if (item.authorId !== authorId) throw new Error('Only the original author may edit a proposal');
      if (item.status !== 'draft') throw new Error('Only Draft proposals can be edited');
      Object.assign(item, input, { updatedAt: nowIso() });
      await this.persist();
      return structuredClone(item);
    });
  }

  submit(id: string, authorId: string): Promise<ContentProposal> {
    return this.exclusive(async () => {
      const item = this.get(id);
      if (item.authorId !== authorId) throw new Error('Only the original author may submit');
      if (item.status !== 'draft') throw new Error('Only Draft proposals can be submitted');
      const now = nowIso();
      item.status = 'submitted';
      item.submittedAt = now;
      item.updatedAt = now;
      await this.persist();
      return structuredClone(item);
    });
  }

  review(id: string, role: ReviewerRole, reviewerId: string, approved: boolean, reason: string): Promise<ContentProposal> {
    return this.exclusive(async () => {
      const item = this.get(id);
      if (item.status !== 'submitted') throw new Error('Only Submitted proposals may be reviewed');
      if (item.approvals[role]) throw new Error('This reviewer role has already approved this proposal');
      const now = nowIso();
      if (!approved) {
        if (!reason.trim()) throw new Error('A rejection reason is required');
        item.status = 'rejected';
        item.rejectionReason = reason.trim();
        item.reviewedAt = now;
      } else {
        item.approvals[role] = { reviewerId, at: now };
        if (item.approvals.superadmin && item.approvals.head_of_it) {
          item.status = 'approved';
          item.reviewedAt = now;
        }
      }
      item.updatedAt = now;
      await this.persist();
      return structuredClone(item);
    });
  }

  publish(id: string, role: ReviewerRole, publisherId: string, action: (proposal: ContentProposal) => Promise<string>): Promise<ContentProposal> {
    return this.exclusive(async () => {
      const item = this.get(id);
      if (item.status !== 'approved' || !item.approvals.superadmin || !item.approvals.head_of_it) {
        throw new Error('Both reviewers must approve before publishing');
      }
      const publishedId = await action(structuredClone(item));
      const now = nowIso();
      item.publishedId = publishedId;
      item.publishedBy = publisherId;
      item.publishedAt = now;
      item.updatedAt = now;
      item.status = 'published';
      await this.persist();
      return structuredClone(item);
    });
  }
}
