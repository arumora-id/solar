import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ContentProposalStore } from '../src/approvals/contentProposalStore.js';

const draft = () => ({
  kind: 'skill' as const,
  title: 'Incident summary',
  description: 'Team standard',
  content: '# Incident Summary\n\nUse concise, sourced facts.',
});

async function store() {
  const root = mkdtempSync(join(tmpdir(), 'solar-proposal-'));
  const s = new ContentProposalStore(root);
  await s.init();
  return { s, root };
}

describe('Skill/Knowledge workflow: Draft → Submitted → Approved / Rejected → Published', () => {
  it('keeps a Staff draft editable and hidden from other Staff', async () => {
    const { s, root } = await store();
    const first = await s.create(draft(), 'staff-a');
    expect(first.status).toBe('draft');
    expect(s.list('staff', 'staff-b')).toEqual([]);
    expect(s.list('staff', 'staff-a').map((p) => p.id)).toEqual([first.id]);
    expect(s.list('superadmin', 'admin')).toHaveLength(1);
    await expect(s.update(first.id, 'staff-b', draft())).rejects.toThrow('author');
    const changed = await s.update(first.id, 'staff-a', { ...draft(), title: 'Corrected incident' });
    expect(changed.title).toBe('Corrected incident');
    expect(changed.status).toBe('draft');
    const reopened = new ContentProposalStore(root);
    await reopened.init();
    expect(reopened.list('staff', 'staff-a')[0]?.title).toBe('Corrected incident');
  });

  it('freezes the submitted body, waits for both role approvals, and publishes only on explicit action', async () => {
    const { s } = await store();
    const first = await s.create(draft(), 'staff-a');
    await expect(s.review(first.id, 'superadmin', 'sa-1', true, '')).rejects.toThrow('Submitted');
    await expect(s.publish(first.id, 'superadmin', 'sa-1', async () => 'published')).rejects.toThrow('Both');
    const submitted = await s.submit(first.id, 'staff-a');
    expect(submitted.status).toBe('submitted');
    await expect(s.update(first.id, 'staff-a', draft())).rejects.toThrow('Draft');
    await expect(s.submit(first.id, 'staff-a')).rejects.toThrow('Draft');
    await expect(s.submit(first.id, 'staff-b')).rejects.toThrow('author');
    const a = await s.review(first.id, 'superadmin', 'sa-1', true, '');
    expect(a.status).toBe('submitted');
    expect(a.approvals.superadmin?.reviewerId).toBe('sa-1');
    await expect(s.review(first.id, 'superadmin', 'sa-2', true, '')).rejects.toThrow('already approved');
    const b = await s.review(first.id, 'head_of_it', 'head-1', true, '');
    expect(b.status).toBe('approved');
    expect(b.publishedId).toBeUndefined();
    const publish = vi.fn(async () => 'skill-incident-summary');
    const c = await s.publish(first.id, 'head_of_it', 'head-1', publish);
    expect(publish).toHaveBeenCalledOnce();
    expect(c.status).toBe('published');
    expect(c.publishedId).toBe('skill-incident-summary');
    expect(c.publishedBy).toBe('head-1');
    await expect(s.publish(first.id, 'superadmin', 'sa-1', publish)).rejects.toThrow('Both');
    expect(publish).toHaveBeenCalledOnce();
  });

  it('requires a reason to reject, then closes the proposal without publishing', async () => {
    const { s } = await store();
    const p = await s.create({ kind: 'knowledge', title: 'Network', path: 'systems/network.md', content: '# Network' }, 'staff-a');
    await s.submit(p.id, 'staff-a');
    await expect(s.review(p.id, 'head_of_it', 'head-1', false, '')).rejects.toThrow('reason');
    const rejected = await s.review(p.id, 'head_of_it', 'head-1', false, 'Missing source of truth.');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Missing source of truth.');
    await expect(s.review(p.id, 'superadmin', 'sa-1', true, '')).rejects.toThrow('Submitted');
    await expect(s.publish(p.id, 'superadmin', 'sa-1', async () => 'bad')).rejects.toThrow('Both');
  });

  it('keeps Approved state when publication fails and allows retry', async () => {
    const { s } = await store();
    const p = await s.create(draft(), 'staff-a');
    await s.submit(p.id, 'staff-a');
    await s.review(p.id, 'head_of_it', 'head-1', true, '');
    await s.review(p.id, 'superadmin', 'sa-1', true, '');
    await expect(s.publish(p.id, 'head_of_it', 'head-1', async () => { throw new Error('Destination already exists'); }))
      .rejects.toThrow('Destination already exists');
    expect(s.list('staff', 'staff-a')[0]?.status).toBe('approved');
    expect((await s.publish(p.id, 'superadmin', 'sa-1', async () => 'new-id')).status).toBe('published');
  });
});
