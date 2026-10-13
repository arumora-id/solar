/**
 * Live-browser regression smoke for the full-width Conversation/Monitoring layout.
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
    const stage = ensureBox(await page.locator('.stage-card').boundingBox(), `${name} stage`);
    const robot = ensureBox(await page.locator('.stage-area .character-stage').boundingBox(), `${name} robot`);
    const chat = ensureBox(await page.locator('.chat').boundingBox(), `${name} chat`);
    const composer = ensureBox(await page.locator('.chat .composer').boundingBox(), `${name} composer`);
    assert(stage.y + stage.height <= chat.y + 2, `${name}: stage should be above the conversation`);
    assert(robot.width <= 135 && robot.height <= 125, `${name}: robot not compact ${JSON.stringify(robot)}`);
    assert(chat.width >= width - 35, `${name}: chat does not fill viewport (width ${chat.width})`);
    assert(chat.height >= 150, `${name}: insufficient conversation height ${chat.height}`);
    assert(composer.y >= chat.y + 1 && composer.y + composer.height <= chat.y + chat.height + 2,
      `${name}: composer should remain inside chat`);
    await noHorizontalOverflow(name);
    await page.screenshot({ path: join(screenshots, `conversation-${name}.png`), fullPage: true });
  }
  async function checkMonitor(width, height, name) {
    await page.setViewportSize({ width, height });
    const monitor = ensureBox(await page.locator('.monitor').boundingBox(), `${name} monitor`);
    const robot = ensureBox(await page.locator('.monitor-robot .character-stage').boundingBox(), `${name} monitor robot`);
    const list = ensureBox(await page.locator('.monitor-grid').boundingBox(), `${name} monitor grid`);
    assert(monitor.width >= width - 2, `${name}: monitor has fixed max width ${monitor.width}`);
    assert(robot.width <= 100, `${name}: monitor robot too large ${robot.width}`);
    assert(list.x >= 0 && list.x + list.width <= width + 2, `${name}: monitor grid exceeds viewport`);
    await noHorizontalOverflow(name);
    await page.screenshot({ path: join(screenshots, `monitor-${name}.png`), fullPage: true });
  }

  await checkConversation(1360, 900, 'desktop');
  await checkConversation(768, 1024, 'tablet');
  await checkConversation(390, 780, 'mobile');
  // The character picker must remain accessible and not cover the mini robot.
  await page.locator('.character-switch > button').click();
  const picker = ensureBox(await page.locator('.character-menu').boundingBox(), 'character menu');
  const stageRobot = ensureBox(await page.locator('.stage-area').boundingBox(), 'character stage');
  assert(picker.y >= stageRobot.y, 'Picker unexpectedly opens above compact stage');
  assert(picker.x >= -1 && picker.x + picker.width <= 391, 'Character menu overflows mobile viewport');
  await page.locator('.character-menu [role="menuitemradio"]').nth(1).click();
  assert.equal(await page.locator('.stage-area .character-stage').getAttribute('data-character'), 'mochi');
  await page.locator('.character-switch > button').click();
  await page.locator('.character-menu [role="menuitemradio"]').first().click();
  await page.locator('.stage-footer .chip').first().click();
  assert((await page.locator('.composer textarea').inputValue()).trim().length > 0, 'Quick prompt failed to fill composer');

  await page.locator('.topbar a[href="/monitor"]').click();
  await page.locator('.monitor-grid').waitFor();
  await checkMonitor(1360, 900, 'desktop');
  await checkMonitor(390, 780, 'mobile');
  const firstFilter = page.locator('.filters .seg button').nth(1);
  await firstFilter.click();
  assert.equal(await firstFilter.getAttribute('aria-pressed'), 'true', 'Task filter did not activate');
  assert.equal(pageErrors.length, 0, `Browser runtime errors: ${pageErrors.join('; ')}`);
  console.log('Responsive UI smoke passed: desktop/tablet/mobile conversation, character picker, quick prompt, full-width monitor desktop/mobile, filter, no horizontal overflow.');
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
