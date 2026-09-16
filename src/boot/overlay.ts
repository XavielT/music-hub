/**
 * The `?debug=1` panel: what this device is, and how far each of the last two
 * boots got.
 *
 * Built with DOM calls rather than a template because it has to be able to
 * appear when Angular never started — which is the case it exists for. It is
 * also why it carries its own styles inline on the elements: styles.scss is a
 * separate request, and a boot that died may well have died before it landed.
 *
 * Inline *styles* are fine under the CSP (style-src already allows
 * 'unsafe-inline' for Angular's own); inline *scripts* are not, and there are
 * none here.
 */
import { BootEntry, currentLog, previousLog } from './boot-log';
import { APP_VERSION } from '../version';
import { setDebug } from './flags';

const PANEL_ID = 'music-hub-debug';

export function showDebugOverlay(): void {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Diagnostics');
  style(panel, {
    position: 'fixed',
    inset: 'auto 0 0 0',
    maxHeight: '70vh',
    overflowY: 'auto',
    zIndex: '2147483647',
    background: '#111',
    color: '#eee',
    font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '12px 14px calc(12px + env(safe-area-inset-bottom))',
    borderTop: '2px solid #f97316',
    WebkitOverflowScrolling: 'touch',
  });

  const report = buildReport();

  const heading = document.createElement('div');
  style(heading, { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' });

  const title = document.createElement('strong');
  title.textContent = `Music Hub ${APP_VERSION}`;
  style(title, { color: '#f97316', flex: '1' });
  heading.appendChild(title);
  heading.appendChild(button('Copy', () => copy(report)));
  heading.appendChild(
    button('Off', () => {
      setDebug(false);
      panel.remove();
    })
  );
  heading.appendChild(button('Close', () => panel.remove()));
  panel.appendChild(heading);

  const body = document.createElement('pre');
  body.textContent = report;
  style(body, { margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' });
  panel.appendChild(body);

  document.body.appendChild(panel);
}

/** The same text the Copy button puts on the clipboard. */
export function buildReport(): string {
  const lines: string[] = [];
  lines.push(`version   ${APP_VERSION}`);
  lines.push(`url       ${safely(() => location.href)}`);
  lines.push(`ua        ${safely(() => navigator.userAgent)}`);
  lines.push(`ios       ${iosVersion() ?? 'n/a'}`);
  lines.push(`display   ${displayMode()}`);
  lines.push(`online    ${safely(() => String(navigator.onLine))}`);
  lines.push(`lang      ${safely(() => navigator.language)}`);
  lines.push(`screen    ${safely(() => `${screen.width}x${screen.height} @${devicePixelRatio}`)}`);
  lines.push(`sw        ${swState()}`);
  lines.push('');

  const previous = previousLog();
  if (previous.length) {
    // The important half after a crash: this is the boot that died.
    lines.push('--- previous boot ---');
    lines.push(...previous.map(format));
    lines.push('');
  }
  lines.push('--- this boot ---');
  lines.push(...currentLog().map(format));

  return lines.join('\n');
}

function format(entry: BootEntry): string {
  const mark = entry.kind === 'milestone' ? '·' : entry.kind === 'warn' ? '!' : '×';
  return `${String(entry.at).padStart(6)}ms ${mark} ${entry.text}`;
}

function iosVersion(): string | null {
  try {
    const match = /OS (\d+)[._](\d+)/.exec(navigator.userAgent);
    if (!match) return null;
    return `${match[1]}.${match[2]}`;
  } catch {
    return null;
  }
}

function displayMode(): string {
  try {
    if ((navigator as { standalone?: boolean }).standalone) return 'standalone (ios)';
    for (const mode of ['standalone', 'minimal-ui', 'fullscreen']) {
      if (matchMedia(`(display-mode: ${mode})`).matches) return mode;
    }
    return 'browser';
  } catch {
    return 'unknown';
  }
}

function swState(): string {
  try {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    return navigator.serviceWorker.controller ? 'controlled' : 'not controlling';
  } catch {
    return 'unknown';
  }
}

function safely(read: () => string): string {
  try {
    return read();
  } catch {
    return 'unavailable';
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  style(el, {
    background: '#333',
    color: '#eee',
    border: '1px solid #555',
    borderRadius: '6px',
    padding: '4px 10px',
    font: 'inherit',
  });
  el.addEventListener('click', onClick);
  return el;
}

function copy(text: string): void {
  // navigator.clipboard needs a secure context and a user gesture; this has the
  // gesture, but an install served over plain http would not have the context.
  navigator.clipboard?.writeText(text).catch(() => selectFallback(text));
}

function selectFallback(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch {
    /* nothing else to try; the text is on screen to read */
  }
  area.remove();
}

function style(el: HTMLElement, rules: Record<string, string>): void {
  Object.assign(el.style, rules);
}
