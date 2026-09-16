/**
 * The screen somebody gets when bootstrap never finishes.
 *
 * It offers two links and takes no action of its own. That restraint is the
 * whole point: an automatic reload is what turns one failed boot into Safari's
 * "A problem repeatedly occurred", because the counter it trips is reloads of
 * the same URL. A page that sits still and says what happened is both kinder
 * and less likely to make things worse.
 *
 * Both languages are inlined. The dictionaries are lazy chunks and this screen
 * exists precisely for the case where a chunk never arrived, so it cannot use
 * them — and a visitor staring at a dead app should not also have to read a
 * language they do not speak.
 */
import { milestone } from './boot-log';

const TIMEOUT_MS = 15_000;

const COPY = {
  es: {
    title: 'La aplicación tardó demasiado en abrir',
    body: 'Algo se quedó a medias al iniciar. Puedes reintentar, o abrirla en modo seguro (sin caché).',
    retry: 'Reintentar',
    safe: 'Abrir en modo seguro',
  },
  en: {
    title: 'The app took too long to open',
    body: 'Something stalled while starting. You can try again, or open it in safe mode (no cache).',
    retry: 'Try again',
    safe: 'Open in safe mode',
  },
};

let settled = false;

/** Called by main.ts once bootstrapApplication() resolves or rejects. */
export function bootSettled(): void {
  settled = true;
}

export function startWatchdog(): void {
  setTimeout(() => {
    if (settled) return;
    // A tab in the background is throttled hard by iOS; it has not failed, it
    // has been put away. Waking it up to an error screen would be a lie.
    if (document.visibilityState !== 'visible') return;
    milestone('boot-timeout');
    showTimeoutScreen();
  }, TIMEOUT_MS);
}

function showTimeoutScreen(): void {
  const host = document.createElement('div');
  host.className = 'boot-fallback';
  host.setAttribute('role', 'alert');

  for (const lang of ['es', 'en'] as const) {
    const copy = COPY[lang];
    const block = document.createElement('section');
    block.lang = lang;

    const h = document.createElement('h1');
    h.textContent = copy.title;
    block.appendChild(h);

    const p = document.createElement('p');
    p.textContent = copy.body;
    block.appendChild(p);

    const actions = document.createElement('p');
    actions.className = 'boot-fallback-actions';
    actions.appendChild(link(copy.retry, location.pathname));
    actions.appendChild(link(copy.safe, '?safe=1'));
    block.appendChild(actions);

    host.appendChild(block);
  }

  document.body.appendChild(host);
}

function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}
