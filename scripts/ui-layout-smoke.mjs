/**
 * Live-browser regression smoke for restored Agent/Monitor layout and Conversation-only fullscreen.
 * GitHub CI runs this after typecheck, server tests and build.
 * Uses a temporary local server and disposable superadmin. Never touches production data.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = 8799;
const origin = `http://127.0.0.1:${port}`;
const tempData = await mkdtemp(join(tmpdir(), 'solar-ui-layout-'));
const screenshots = join(process.env.RUNNER_TEMP ?? tmpdir(), 'solar-ui-screenshots');
await mkdir(screenshots, { recursive: true });

const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempData,
    SOLAR_ADMIN_USERNAME: 'layoutsmoke',
    SOLAR_ADMIN_EMAIL: 'layoutsmoke@example.test',
    SOLAR_ADMIN_PASSWORD: 'Horizon#8241RoadSafe',
    SOLAR_ADMIN_NAME: 'Layout Smoke Tester',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (data) => {
    serverLog = (serverLog + data.toString()).slice(-12000);
  });
}
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${server.exitCode}\n${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/auth/state`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Wait for server initialization (file repository, skills, auth).
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, `Server did not start\n${serverLog}`);

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => {
    // Browser runtime exceptions must fail the smoke, not merely appear in logs.
    pageErrors.push(error.message);
  });
  const pageErrors = [];
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.auth-form input[name="username"]').fill('layoutsmoke');
  await page.locator('.auth-form input[name="password"]').fill('Horizon#8241RoadSafe');
  await page.locator('.auth-form button[type="submit"]').click();
  await page.locator('.agent-page .chat').waitFor({ timeout: 20000 });

  function ensureBox(box, label) {
    assert(box && box.width > 0 && box.height > 0, `Missing/hidden ${label}: ${JSON.stringify(box)}`);
    return box;
  }
  async function noHorizontalOverflow(label) {
    const dims = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(dims.scroll <= dims.viewport + 2, `${label}: horizontal overflow ${JSON.stringify(dims)}`);
  }
  async function checkConversation(width, height, name) {
    await page.setViewportSize({ width, height });
    const stage = ensureBox(await page.locator('.stage-card').boundingBox(), `${name} original stage`);
    const robot = ensureBox(await page.locator('.stage-area .character-stage').boundingBox(), `${name} original robot`);
    const chat = ensureBox(await page.locator('.chat').boundingBox(), `${name} chat`);
    const composer = ensureBox(await page.locator('.chat .composer').boundingBox(), `${name} composer`);
    assert.equal(await page.locator('.floating-robot').count(), 0, `${name}: robot floats only in fullscreen`);
    assert.equal(await page.locator('.chat').getAttribute('class'), 'chat', `${name}: normal chat should not be fullscreen`);
    assert(robot.width >= 180 && robot.height >= 220, `${name}: character was unexpectedly made mini`);
    if (width > 1020) {
      assert(chat.x >= stage.x + stage.width - 2, `${name}: original desktop Agent must have character beside Conversation`);
      assert(Math.abs(stage.y - chat.y) <= 4, `${name}: original Agent columns must align at the top`);
      assert(chat.width <= 565, `${name}: original Conversation max-width unexpectedly changed`);
    } else {
      assert(chat.y >= stage.y + stage.height - 2, `${name}: original narrow Agent must stack character and Conversation`);
    }
    const placeholder = await page.locator('.composer textarea').getAttribute('placeholder');
    if (width <= 640) {
      assert(placeholder && !placeholder.includes('Shift+Enter') && placeholder.length < 32,
        `${name}: mobile placeholder must fit (got ${placeholder})`);
    } else {
      assert(placeholder?.includes('Shift+Enter'), `${name}: desktop keyboard hint lost`);
    }
    assert(composer.width > 0, `${name}: composer disappeared`);
    assert.equal(await page.locator('.chat-fullscreen-toggle').getAttribute('aria-pressed'), 'false');
    await page.screenshot({ path: join(screenshots, `agent-original-${name}.png`), fullPage: true });
  }
  async function checkFullscreen(width, height, name, exitWithEscape = false) {
    await page.setViewportSize({ width, height });
    await page.locator('.chat-fullscreen-toggle').click();
    assert.equal(await page.locator('.chat-fullscreen-toggle').getAttribute('aria-pressed'), 'true', `${name}: fullscreen toggle did not activate`);
    assert.equal(await page.locator('.stage-card').count(), 0, `${name}: large character should be hidden in fullscreen`);
    const float = ensureBox(await page.locator('.floating-robot .character-stage').boundingBox(), `${name} floating robot`);
    const chat = ensureBox(await page.locator('.chat.chat-fullscreen').boundingBox(), `${name} expanded Conversation`);
    const composer = ensureBox(await page.locator('.chat .composer').boundingBox(), `${name} fullscreen composer`);
    assert(Math.abs(chat.x) < 2 && Math.abs(chat.y) < 2, `${name}: fullscreen chat must start at viewport origin`);
    assert(Math.abs(chat.width - width) <= 2 && Math.abs(chat.height - height) <= 2,
      `${name}: fullscreen chat must fill viewport (${JSON.stringify(chat)})`);
    assert(float.width > 40 && float.width < 165, `${name}: robot must be a small floating widget`);
    assert(float.x >= 0 && float.x + float.width <= width + 2, `${name}: floating character outside viewport`);
    assert(float.y >= 0 && float.y + float.height <= height + 2, `${name}: floating character vertically outside viewport`);
    assert(composer.y >= 0 && composer.y + composer.height <= height + 2, `${name}: composer outside fullscreen viewport`);
    await noHorizontalOverflow(`${name} fullscreen`);
    await page.screenshot({ path: join(screenshots, `conversation-fullscreen-${name}.png`), fullPage: true });
    if (exitWithEscape) await page.keyboard.press('Escape');
    else await page.locator('.chat-fullscreen-toggle').click();
    assert.equal(await page.locator('.chat-fullscreen-toggle').getAttribute('aria-pressed'), 'false', `${name}: fullscreen did not close`);
    assert.equal(await page.locator('.floating-robot').count(), 0, `${name}: floating widget not removed`);
    assert.equal(await page.locator('.stage-card').count(), 1, `${name}: original character stage not restored`);
  }
  async function checkMonitor(width, height, name) {
    await page.setViewportSize({ width, height });
    const monitor = ensureBox(await page.locator('.monitor').boundingBox(), `${name} monitor`);
    const list = ensureBox(await page.locator('.monitor-grid').boundingBox(), `${name} monitor grid`);
    assert.equal(await page.locator('.monitor-robot').count(), 0, `${name}: Monitoring must NOT gain a new robot`);
    assert.equal(await page.locator('.monitor-header').count(), 0, `${name}: Monitoring header must remain original`);
    assert(monitor.width <= 1402, `${name}: original Monitoring max-width of 1400px was removed`);
    if (width >= 1600) assert(monitor.x >= 140, `${name}: original monitor should be centered`);
    assert(list.x >= -2 && list.x + list.width <= width + 2, `${name}: monitor grid exceeds viewport`);
    await page.screenshot({ path: join(screenshots, `monitor-original-${name}.png`), fullPage: true });
  }

  await checkConversation(1920, 1080, 'wide-desktop');
  await checkConversation(1360, 900, 'desktop');
  await checkConversation(1024, 768, 'small-desktop');
  await checkConversation(768, 1024, 'tablet');
  await checkConversation(390, 780, 'mobile');
  await checkConversation(320, 568, 'small-mobile');
  await checkConversation(844, 390, 'landscape');

  await checkFullscreen(1920, 1080, 'wide-desktop');
  await checkFullscreen(1360, 900, 'desktop');
  await checkFullscreen(768, 1024, 'tablet', true);
  await checkFullscreen(390, 780, 'mobile');
  await checkFullscreen(320, 568, 'small-mobile', true);
  await checkFullscreen(844, 390, 'landscape', true);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator('.character-switch > button').click();
  const picker = ensureBox(await page.locator('.character-menu').boundingBox(), 'normal character menu');
  assert(picker.x >= -1 && picker.x + picker.width <= 391, 'Character menu overflows mobile viewport');
  await page.locator('.character-menu [role="menuitemradio"]').nth(1).click();
  assert.equal(await page.locator('.stage-area .character-stage').getAttribute('data-character'), 'mochi');

  // The same character should appear inside the expanded Conversation widget.
  await page.locator('.chat-fullscreen-toggle').click();
  assert.equal(await page.locator('.floating-robot .character-stage').getAttribute('data-character'), 'mochi');
  await page.locator('.floating-robot .character-switch > button').click();
  const floatMenu = ensureBox(await page.locator('.floating-robot .character-menu').boundingBox(), 'floating character menu');
  assert(floatMenu.x >= -1 && floatMenu.x + floatMenu.width <= 391, 'Floating picker overflows viewport');
  await page.locator('.floating-robot .character-menu [role="menuitemradio"]').first().click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.stage-area .character-stage').getAttribute('data-character'), 'robot');

  await page.locator('.stage-footer .chip').first().click();
  assert((await page.locator('.composer textarea').inputValue()).trim().length > 0, 'Quick prompt failed to fill composer');

  // Real attachment upload/read/remove against the disposable local server.
  await page.locator('.composer input[type="file"]').setInputFiles({
    name: 'solar-layout-smoke.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('SOLAR isolated UI regression check.\\n'),
  });
  await page.locator('.composer .att-chip').waitFor({ timeout: 10000 });
  await page.locator('.composer .att-chip button.att-open').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.composer .att-chip.error').count(), 0, 'Attachment upload or extraction failed');
  await page.locator('.composer .att-remove').click();
  await page.locator('.composer .att-chip').waitFor({ state: 'detached', timeout: 10000 });

  await page.locator('.topbar a[href="/monitor"]').click();
  await page.locator('.monitor-grid').waitFor();
  await checkMonitor(1920, 1080, 'wide-desktop');
  await checkMonitor(1360, 900, 'desktop');
  await checkMonitor(1024, 768, 'small-desktop');
  await checkMonitor(390, 780, 'mobile');
  await checkMonitor(320, 568, 'small-mobile');
  await checkMonitor(844, 390, 'landscape');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator('.topbar button.btn.ghost.icon').click();
  await checkMonitor(390, 780, 'mobile-dark');
  await page.locator('.topbar a[href="/"]').click();
  await page.locator('.chat').waitFor();
  await checkConversation(390, 780, 'mobile-dark');
  await checkFullscreen(390, 780, 'mobile-dark', true);
  await page.locator('.topbar .lang-switch button').first().click();
  assert.equal(await page.locator('.composer textarea').getAttribute('placeholder'), 'Ketik perintah…');
  await page.locator('.topbar .lang-switch button').last().click();
  await page.locator('.topbar a[href="/monitor"]').click();
  await page.locator('.monitor-grid').waitFor();
  const firstFilter = page.locator('.filters .seg button').nth(1);
  await firstFilter.click();
  assert.equal(await firstFilter.getAttribute('aria-pressed'), 'true', 'Task filter did not activate');
  assert.equal(pageErrors.length, 0, `Browser runtime errors: ${pageErrors.join('; ')}`);
  console.log('Responsive UI smoke passed: original Agent two-column/mobile stack, original max-width Monitoring without robot, Conversation-only fullscreen+floating character (desktop/mobile/landscape, Esc/toggle), character switcher, quick prompts, attachment upload/remove, dark theme, language, monitor filter.');
  console.log('Screenshots:', screenshots);
} catch (error) {
  console.error('Responsive UI smoke FAILED:', error);
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
  await rm(tempData, { recursive: true, force: true }).catch(() => undefined);
}
