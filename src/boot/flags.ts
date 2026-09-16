/**
 * The three query flags that make a phone debuggable from across a room.
 *
 * Without a Mac there is no Web Inspector for iOS Safari, so the only way to
 * ask a device a question is to send someone a URL. These are the questions
 * worth asking when the app will not open:
 *
 *   ?debug=1  show what happened during this boot and the one before it
 *   ?safe=1   boot with no service worker at all, so a poisoned cache is ruled
 *             out without waiting for one to expire
 *   ?reset=1  safe mode, plus throw away every local trace of the app and
 *             reload clean — the last resort before "reinstall it"
 *
 * `debug` is sticky (kept in localStorage) because a crashing app cannot keep a
 * query string: Safari reloads the bare URL. `safe` deliberately is not — it is
 * a diagnostic, and an app that quietly stopped being a PWA would be a worse
 * bug than the one being chased.
 */

const DEBUG_KEY = 'music-hub.debug';
const LOCAL_PREFIX = 'music-hub.';
const AUTH_KEY = 'music-hub-auth';

function params(): URLSearchParams {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
}

function flag(name: string): boolean {
  const value = params().get(name);
  return value === '1' || value === 'true';
}

/** Sticky: the URL turns it on, and Settings → Diagnostics turns it off. */
export function debugEnabled(): boolean {
  if (flag('debug')) {
    setDebug(true);
    return true;
  }
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebug(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1');
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    /* storage unavailable: the flag lasts for this load */
  }
}

export function safeMode(): boolean {
  return flag('safe') || flag('reset');
}

export function resetRequested(): boolean {
  return flag('reset');
}

/**
 * Unregisters every service worker and deletes the caches Angular's worker
 * keeps. Both halves matter: dropping the registration alone leaves the caches
 * to be adopted by the next worker that installs.
 */
export async function disableServiceWorkers(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map(r => r.unregister().catch(() => false)));
  } catch {
    /* no service worker support, or blocked: nothing to undo */
  }
  try {
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.filter(k => k.startsWith('ngsw:')).map(k => caches.delete(k)));
  } catch {
    /* no Cache Storage: same */
  }
}

/**
 * Everything this app put on the device, short of the IndexedDB library — the
 * songs are the one thing a user would mind losing, and a boot problem is
 * never their fault.
 */
export function clearLocalState(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(LOCAL_PREFIX) || key === AUTH_KEY)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: there was nothing to clear anyway */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* same */
  }
}

/** Drops the flags from the address bar so a reload does not repeat them. */
export function reloadWithoutFlags(): void {
  try {
    const url = new URL(location.href);
    for (const name of ['safe', 'reset', 'debug']) url.searchParams.delete(name);
    location.replace(url.toString());
  } catch {
    location.replace('/');
  }
}
