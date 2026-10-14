/**
 * Full-browser QA for SOLAR staff submissions, dual approval, publication and
 * image Skill access. Uses disposable local DATA_DIR, never live endpoints or paid image calls.
 * Runs with Chromium after the standard server build.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = 8813;
const origin = `http://127.0.0.1:${port}`;
const root = await mkdtemp(join(tmpdir(), 'solar-governance-browser-'));
const screenshots = join(process.env.RUNNER_TEMP ?? tmpdir(), 'solar-governance-screenshots');
await mkdir(screenshots, { recursive: true });

const password = 'QA#Browser2026SecurePass';
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: root,
    SOLAR_ADMIN_USERNAME: 'qasmokeadmin',
    SOLAR_ADMIN_EMAIL: 'qasmokeadmin@example.test',
    SOLAR_ADMIN_PASSWORD: password,
    SOLAR_ADMIN_NAME: 'QA Superadmin',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (data) => { serverLog = (serverLog + data.toString()).slice(-16000); });
}

let browser;
const pages = [];
try {
  let available = false;
  for (let n = 0; n < 120; n++) {
    if (server.exitCode !== null) throw new Error(`QA server exited early: ${server.exitCode}\n${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/auth/state`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { available = true; break; }
    } catch { /* server initialization */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(available, `Disposable QA server failed to start\n${serverLog}`);
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const pageErrors = [];
  const newUserPage = async (username, mobile = false) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 780 } : { width: 1360, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (e) => pageErrors.push(`${username}: ${e.message}`));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.auth-form input[name="username"]').fill(username);
    await page.locator('.auth-form input[name="password"]').fill(password);
    await page.locator('.auth-form button[type="submit"]').click();
    await page.locator('.agent-page .chat').waitFor({ timeout: 20000 });
    // Select English consistently; internationalization itself is covered by responsive smoke.
    await page.locator('.lang-switch button[aria-label="English"]').click();
    return page;
  };
  const apiRequest = async (page, method, path, data) => {
    const response = await page.context().request.fetch(`${origin}${path}`, {
      method, data, headers: { Origin: origin },
    });
    return { status: response.status(), body: await response.json().catch(() => null) };
  };
  const openSettings = async (page, tab) => {
    await page.locator('.topbar button[aria-label="Settings"]').click();
    await page.locator('#settings-tab-proposals').waitFor();
    await page.locator(`#settings-tab-${tab}`).click();
    await page.locator('.drawer [role="tabpanel"]').waitFor();
  };
  const selectTab = async (page, tab) => {
    await page.locator(`#settings-tab-${tab}`).click();
  };
  const closeSettings = async (page) => {
    await page.locator('.drawer-head button').click();
    await page.locator('.drawer').waitFor({ state: 'detached' });
  };
  const cardFor = (page, title) => page.locator('.content-proposals section.card').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
  const statusIs = async (page, title, status) => {
    await cardFor(page, title).locator(`[aria-label="${status}"]`).waitFor({ timeout: 12000 });
  };
  const draftEditor = (page) => page.locator('.content-proposals section[aria-label="Draft editor"]');
  const fillDraft = async (page, { kind = 'skill', title, description = '', path = '', content }) => {
    const editor = draftEditor(page);
    await editor.locator('select').selectOption(kind);
    await editor.locator('input').first().fill(title);
    await editor.locator('input').nth(1).fill(kind === 'skill' ? description : path);
    await editor.locator('textarea').fill(content);
    await editor.getByRole('button', { name: 'Save Draft' }).click();
    await statusIs(page, title, 'draft');
  };

  const admin = await newUserPage('qasmokeadmin');
  for (const [username, role] of [['qahead', 'head_of_it'], ['qastaff', 'staff'], ['qaother', 'staff']]) {
    const user = await apiRequest(admin, 'POST', '/api/users', {
      username, role, email: `${username}@example.test`, name: username, password,
    });
    assert.equal(user.status, 201, `create ${role}: ${JSON.stringify(user.body)}`);
  }
  await openSettings(admin, 'proposals');
  const staff = await newUserPage('qastaff', true);
  const other = await newUserPage('qaother');
  const head = await newUserPage('qahead');

  // A Staff can only propose, never see administrator Skills, Knowledge or settings.
  await openSettings(staff, 'proposals');
  for (const tab of ['skills', 'knowledge', 'models', 'plugins']) {
    assert.equal(await staff.locator(`#settings-tab-${tab}`).count(), 0, `Staff sees restricted ${tab} tab`);
  }
  for (const path of ['/api/skills', '/api/knowledge', '/api/plugins']) {
    assert.equal((await apiRequest(staff, 'GET', path)).status, 403, `Staff accessed ${path}`);
  }

  const skillTitle = 'QA Browser Skill';
  await fillDraft(staff, {
    title: skillTitle, description: 'QA only', content: '# First version of this review skill',
  });
  assert.equal(await cardFor(admin, skillTitle).count(), 0, 'Staff Draft exposed to reviewer before Submit');
  await cardFor(staff, skillTitle).getByRole('button', { name: 'Edit Draft' }).click();
  await draftEditor(staff).locator('textarea').fill('# Final reviewed checklist');
  await draftEditor(staff).getByRole('button', { name: 'Save Draft' }).click();
  await cardFor(staff, skillTitle).getByRole('button', { name: 'Submit for review' }).click();
  await statusIs(staff, skillTitle, 'submitted');
  assert.equal(await cardFor(staff, skillTitle).getByRole('button', { name: 'Edit Draft' }).count(), 0, 'Submitted draft editable');

  await openSettings(other, 'proposals');
  assert.equal(await cardFor(other, skillTitle).count(), 0, 'Another Staff sees private proposal');
  await openSettings(head, 'proposals');
  await statusIs(head, skillTitle, 'submitted');
  await cardFor(head, skillTitle).getByRole('button', { name: 'Approve' }).click();
  await statusIs(head, skillTitle, 'submitted');
  assert.equal(await cardFor(head, skillTitle).getByRole('button', { name: 'Publish' }).count(), 0, 'Single approval enabled Publish');

  // Reload the Admin review list to pick up the first review.
  await selectTab(admin, 'character');
  await selectTab(admin, 'proposals');
  await statusIs(admin, skillTitle, 'submitted');
  await cardFor(admin, skillTitle).getByRole('button', { name: 'Approve' }).click();
  await statusIs(admin, skillTitle, 'approved');
  assert.equal((await apiRequest(admin, 'GET', '/api/skills')).body.some((s) => s.id === 'qa-browser-skill'), false,
    'Approved skill published without explicit action');
  admin.once('dialog', (dialog) => dialog.accept());
  await cardFor(admin, skillTitle).getByRole('button', { name: 'Publish' }).click();
  await statusIs(admin, skillTitle, 'published');
  const published = await apiRequest(admin, 'GET', '/api/skills/qa-browser-skill');
  assert.equal(published.status, 200);
  assert.equal(published.body.enabled, false, 'Newly published skill auto-enabled');
  assert(published.body.content.includes('# Final reviewed checklist'));

  // Rejection is terminal, and a Staff can start a new Draft from the rejected text.
  const knowledgeTitle = 'QA Rejection Example';
  await fillDraft(staff, {
    kind: 'knowledge', title: knowledgeTitle, path: 'reference/qa-rejected.md', content: '# Pending review',
  });
  await cardFor(staff, knowledgeTitle).getByRole('button', { name: 'Submit for review' }).click();
  await statusIs(staff, knowledgeTitle, 'submitted');
  await selectTab(head, 'character');
  await selectTab(head, 'proposals');
  await statusIs(head, knowledgeTitle, 'submitted');
  const rejection = cardFor(head, knowledgeTitle);
  await rejection.locator('input').fill('Needs verified source');
  await rejection.getByRole('button', { name: 'Reject' }).click();
  await statusIs(head, knowledgeTitle, 'rejected');
  assert.equal((await apiRequest(admin, 'GET', '/api/knowledge/file?path=reference/qa-rejected.md')).status, 404);

  // Refresh Staff queue from the server; rejected content remains in its own history.
  await selectTab(staff, 'character');
  await selectTab(staff, 'proposals');
  await statusIs(staff, knowledgeTitle, 'rejected');
  await cardFor(staff, knowledgeTitle).getByRole('button', { name: 'Revise as new Draft' }).click();
  assert.equal(await draftEditor(staff).locator('input').first().inputValue(), knowledgeTitle);
  await staff.screenshot({ path: join(screenshots, 'staff-mobile-revision.png'), fullPage: true });
  assert.equal(await staff.locator('body').evaluate((e) => e.scrollWidth <= window.innerWidth + 2), true,
    'Staff proposal drawer overflows mobile screen');

  // Head of IT sees configuration but cannot use/activate Image Generation.
  await selectTab(head, 'skills');
  const imageCardHead = head.locator('#settings-panel .card').filter({ hasText: 'Image Generation and Editing' });
  await imageCardHead.waitFor();
  assert.equal(await imageCardHead.locator('input[type="checkbox"]').isDisabled(), true,
    'Head of IT can toggle image Skill');
  assert.equal((await apiRequest(head, 'PUT', '/api/skills/image-creation', { enabled: true })).status, 403);
  await head.screenshot({ path: join(screenshots, 'head-review-and-image-permissions.png'), fullPage: true });

  await selectTab(admin, 'skills');
  const imageCard = admin.locator('#settings-panel .card').filter({ hasText: 'Image Generation and Editing' });
  await imageCard.waitFor();
  assert.equal(await imageCard.locator('input[type="checkbox"]').isChecked(), false,
    'Image skill not disabled by default');
  await imageCard.locator('input[type="checkbox"]').check();
  await admin.waitForFunction(async () => {
    const res = await fetch('/api/skills/image-creation');
    return res.ok && (await res.json()).enabled === true;
  });
  assert.equal(await imageCard.locator('input[type="checkbox"]').isChecked(), true, 'Superadmin image activation failed');
  await admin.screenshot({ path: join(screenshots, 'superadmin-image-enabled.png'), fullPage: true });
  await imageCard.locator('input[type="checkbox"]').uncheck();
  await admin.waitForFunction(async () => {
    const res = await fetch('/api/skills/image-creation');
    return res.ok && (await res.json()).enabled === false;
  });

  // Real browser uploader + real backend validation: no external Images API call.
  await closeSettings(admin);
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64',
  );
  await admin.locator('.composer input[type="file"]').setInputFiles({
    name: 'qa-image.png', mimeType: 'image/png', buffer: onePixelPng,
  });
  await admin.locator('.composer .att-chip button.att-open').waitFor({ timeout: 30000 });
  assert.equal(await admin.locator('.composer .att-chip.error').count(), 0, 'Superadmin image upload failed');
  await admin.locator('.composer .att-remove').click();
  await admin.locator('.composer .att-chip').waitFor({ state: 'detached' });
  await closeSettings(staff);
  assert.equal((await staff.locator('.composer input[type="file"]').getAttribute('accept')).includes('.png'), false,
    'Staff composer offers forbidden image input');
  await staff.locator('.composer input[type="file"]').setInputFiles({
    name: 'restricted.png', mimeType: 'image/png', buffer: onePixelPng,
  });
  await staff.locator('.composer .att-chip.error').waitFor();
  assert.equal((await apiRequest(staff, 'POST', '/api/attachments?name=restricted.png&sessionId=qa-test', onePixelPng)).status, 403,
    'Staff bypassed image upload permission on API');

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);
  console.log('Governance browser QA passed: 4 user roles, Staff privacy, Draft/edit/Submit, dual approvals, separate Publish, rejection/revision, image Skill permissions, PNG upload, API 403, mobile.');
  console.log('Screenshots:', screenshots);
} catch (error) {
  console.error('Governance browser QA FAILED:', error);
  console.error('Recent server log:', serverLog);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(resolve, 5500).unref();
  });
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
