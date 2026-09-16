#!/usr/bin/env node
// Boots the built app in WebKit the way an iPhone would, and fails loudly if
// the page crashes, throws, is refused by the CSP, or stops answering.
//
// WebKit on Linux is not iOS WebKit — it does not have the iPhone's memory
// ceiling or its process watchdog — so a green run here does not prove the app
// survives on a phone. What it does catch is the class of bug that kills a tab
// on iOS for a reason visible anywhere: an exception during bootstrap, a main
// thread that stops answering, a resource the CSP blocks. Those are the ones
// worth a regression test.
//
// The responsiveness probe is the important part. A page that is merely slow
// still answers `1 + 1` within a few milliseconds; a page spinning in a change
// detection loop or a runaway promise chain does not answer at all, and that is
// exactly what the iOS watchdog kills a process for.
//
//   node tools/ios-smoke.mjs [--base http://localhost:4173] [--seconds 20]
//                            [--browser webkit|chromium|both] [--throttle]
import { webkit, chromium, devices } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const has = name => args.includes(name);

const BASE = flag('--base', 'http://localhost:4173');
const SECONDS = Number(flag('--seconds', 20));
const WHICH = flag('--browser', 'both');
const THROTTLE = has('--throttle');
const LOG_PATH = 'tools/ios-smoke.log';

// The paths a first-time visitor actually hits, plus the two diagnostic flags.
const ROUTES = ['/', '/auth', '/?safe=1', '/?debug=1'];

// A hung main thread shows up as an evaluate() that never settles, so every
// probe carries its own timeout rather than awaiting the page indefinitely.
const PROBE_TIMEOUT_MS = 100;

const lines = [];
function log(line) {
  lines.push(line);
  console.log(line);
}

async function probe(page) {
  // Deliberately trivial: this measures whether the thread answers at all, not
  // how fast it computes.
  return await Promise.race([
    page.evaluate(() => 1 + 1).then(() => true).catch(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)),
  ]);
}

async function run(browserType, name) {
  const browser = await browserType.launch();
  // iPhone 14's viewport, scale factor and user agent. WebKit gets the real
  // Safari descriptor; Chromium runs as a control with the same geometry.
  const descriptor = devices['iPhone 14'];
  const context = await browser.newContext({
    ...descriptor,
    ...(name === 'chromium' ? { userAgent: undefined, isMobile: undefined } : {}),
  });

  let failures = 0;

  for (const route of ROUTES) {
    const page = await context.newPage();
    const events = { crash: 0, pageerror: [], csp: [], requestfailed: [], consoleError: [] };

    page.on('crash', () => {
      events.crash += 1;
    });
    page.on('pageerror', err => events.pageerror.push(String(err?.message ?? err)));
    page.on('requestfailed', req => {
      const reason = req.failure()?.errorText ?? '';
      events.requestfailed.push(`${req.url()} — ${reason}`);
    });
    page.on('console', msg => {
      const text = msg.text();
      // WebKit words CSP violations differently from Chromium; both mention the
      // directive, which is enough to tell a refusal from ordinary noise.
      if (/Content Security Policy|Refused to (load|execute|connect)/i.test(text)) {
        events.csp.push(text);
      } else if (msg.type() === 'error') {
        events.consoleError.push(text);
      }
    });

    if (THROTTLE && name === 'chromium') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }

    const url = BASE + route;
    log(`\n[${name}] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      log(`  goto failed: ${err.message}`);
      failures += 1;
    }

    // One probe a second for the whole window, so a thread that seizes up ten
    // seconds in is caught as surely as one that never starts.
    let unresponsive = 0;
    for (let second = 0; second < SECONDS; second += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (events.crash) break;
      const answered = await probe(page);
      if (!answered) unresponsive += 1;
    }

    const shotDir = 'tools/ios-smoke-shots';
    await mkdir(shotDir, { recursive: true });
    const shot = `${shotDir}/${name}${route.replace(/[^a-z0-9]+/gi, '_') || '_root'}.png`;
    if (!events.crash) {
      try {
        await page.screenshot({ path: shot });
      } catch {
        /* a crashed page cannot be photographed */
      }
    }

    const problems = [];
    if (events.crash) problems.push(`CRASHED (${events.crash})`);
    if (events.pageerror.length) problems.push(`${events.pageerror.length} pageerror`);
    if (events.csp.length) problems.push(`${events.csp.length} CSP refusals`);
    if (events.requestfailed.length) problems.push(`${events.requestfailed.length} failed requests`);
    if (unresponsive) problems.push(`unresponsive ${unresponsive}/${SECONDS}s`);

    if (problems.length) {
      failures += 1;
      log(`  FAIL — ${problems.join(', ')}`);
      for (const e of events.pageerror) log(`    pageerror: ${e}`);
      for (const e of events.csp) log(`    csp: ${e}`);
      for (const e of events.requestfailed) log(`    requestfailed: ${e}`);
      for (const e of events.consoleError.slice(0, 10)) log(`    console.error: ${e}`);
    } else {
      log(`  ok — no crash, no errors, responsive ${SECONDS}/${SECONDS}s`);
    }

    await page.close();
  }

  await context.close();
  await browser.close();
  return failures;
}

let failures = 0;
if (WHICH === 'webkit' || WHICH === 'both') failures += await run(webkit, 'webkit');
if (WHICH === 'chromium' || WHICH === 'both') failures += await run(chromium, 'chromium');

await mkdir(dirname(LOG_PATH), { recursive: true });
await writeFile(LOG_PATH, lines.join('\n') + '\n');
log(`\nlog written to ${LOG_PATH}`);

if (failures) {
  log(`\n${failures} route(s) failed.`);
  process.exit(1);
}
log('\nall routes clean.');
