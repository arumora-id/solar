import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentProposal, Role } from '@solar/shared';
import { writeFileAtomic } from '../util/fs.js';
import { newId, nowIso } from '../util/ids.js';

/** Persistent staging area. Proposals are never part of the live agent's Skills or Knowledge until dual approval. */
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

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(this.entries, null, 2), { mode: 0o600 });
  }

  list(role: Role, id: string): ContentProposal[] {
    const view = role === 'staff' ? this.entries.filter((e) => e.authorId === id) : this.entries;
    return view.map((e) => structuredClone(e)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(input: Pick<ContentProposal, 'kind' | 'title' | 'path' | 'description' | 'content'>, authorId: string): Promise<ContentProposal> {
    return this.exclusive(async () => {
      if (this.entries.length >= 2000) throw new Error('Proposal queue reached its safety limit');
      const entry: ContentProposal = {
        ...input, id: newId('proposal'), authorId, createdAt: nowIso(), status: 'pending', approvals: {},
      };
      this.entries.push(entry);
      await this.save();
      return structuredClone(entry);
    });
  }

  /**
   * A Superadmin AND a Head of IT must approve an immutable proposal.
   * Only on the second distinct role approval does the approved content enter the live store.
   * An error in publication leaves the proposal pending for retry; it never exposes half-reviewed content.
   */
  review(
    proposalId: string,
    role: 'superadmin' | 'head_of_it',
    reviewerId: string,
    approved: boolean,
    rejectionReason: string,
    publish: (entry: ContentProposal) => Promise<string>,
  ): Promise<ContentProposal> {
    return this.exclusive(async () => {
      const item = this.entries.find((p) => p.id === proposalId);
      if (!item) throw new Error('Proposal not found');
      if (item.status !== 'pending') throw new Error('Proposal is already closed');
      if (item.approvals[role]) throw new Error('This reviewer role has already approved');
      if (!approved) {
        item.status = 'rejected';
        item.rejectionReason = rejectionReason;
        item.reviewedAt = nowIso();
      } else {
        const approvals = { ...item.approvals, [role]: { reviewerId, at: nowIso() } };
        if (approvals.superadmin && approvals.head_of_it) {
          // Publishing is strictly create-only; never overwrite an administrator's existing content.
          const publishedId = await publish(item);
          item.publishedId = publishedId;
          item.status = 'approved';
          item.reviewedAt = nowIso();
        }
        item.approvals = approvals;
      }
      await this.save();
      return structuredClone(item);
    });
  }
}
