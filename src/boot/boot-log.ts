/**
 * A record of how far the last boot got, kept where a crash cannot take it.
 *
 * The iOS crash this was written for leaves nothing to inspect: WebKit kills
 * the WebContent process, so `window.onerror` never fires, the console is gone
 * with the process, and the page that comes back has no memory of the one that
 * died. Without a Mac there is no Web Inspector to attach either.
 *
 * So the log is written to sessionStorage as it happens, and the *previous*
 * load's copy is kept alongside the current one. After a crash and a reload,
 * `?debug=1` can show how far the attempt that died had got — which is the
 * only question worth asking.
 *
 * Everything here has to survive storage being unavailable (private mode, or a
 * browser that throws on access), so every read and write is guarded and the
 * in-memory copy is always the real one.
 */

const CURRENT_KEY = 'music-hub.bootlog';
const PREVIOUS_KEY = 'music-hub.bootlog.previous';
const MAX_ENTRIES = 50;

export interface BootEntry {
  /** Milliseconds since the module was first evaluated. */
  at: number;
  kind: 'milestone' | 'warn' | 'error';
  text: string;
}

const started = Date.now();
const entries: BootEntry[] = [];
let previous: BootEntry[] = [];

function write(): void {
  try {
    sessionStorage.setItem(CURRENT_KEY, JSON.stringify(entries));
  } catch {
    // Private mode, or storage disabled: the in-memory copy still serves this
    // load, which is the one an attached console can read anyway.
  }
}

/** Moves the last load's log aside so a crash-and-reload keeps both. */
export function rotate(): void {
  try {
    const raw = sessionStorage.getItem(CURRENT_KEY);
    if (raw) {
      previous = JSON.parse(raw) as BootEntry[];
      sessionStorage.setItem(PREVIOUS_KEY, raw);
    } else {
      const older = sessionStorage.getItem(PREVIOUS_KEY);
      if (older) previous = JSON.parse(older) as BootEntry[];
    }
    sessionStorage.removeItem(CURRENT_KEY);
  } catch {
    previous = [];
  }
}

export function record(kind: BootEntry['kind'], text: string): void {
  entries.push({ at: Date.now() - started, kind, text: String(text).slice(0, 500) });
  // A boot that loops would otherwise fill storage with the same line; the
  // oldest entries are the least interesting once that happens.
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  write();
}

export const milestone = (name: string): void => record('milestone', name);

export function currentLog(): BootEntry[] {
  return entries.slice();
}

export function previousLog(): BootEntry[] {
  return previous.slice();
}

/**
 * Catches what the boot log exists for: an exception thrown before Angular is
 * up, a promise nobody handled, and the warnings a service prints on its way
 * down. Console methods are wrapped rather than replaced, so everything still
 * reaches the real console for anyone who can see it.
 */
export function installErrorHooks(): void {
  window.addEventListener('error', event => {
    const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
    record('error', `${event.message}${where}`);
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = (event as PromiseRejectionEvent).reason;
    record('error', `unhandled rejection: ${reason?.message ?? reason}`);
  });

  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level === 'warn' ? 'warn' : 'error', args.map(describe).join(' '));
      original(...args);
    };
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
