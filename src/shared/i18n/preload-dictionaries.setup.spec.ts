import { I18nService } from '../services/i18n.service';

/**
 * Warms both dictionaries before any suite runs.
 *
 * The dictionaries are lazy chunks, so `t()` answers with the bare key until the
 * one it needs has been imported. In the app that gap never exists — bootstrap
 * awaits `I18nService.init()` before anything paints. In Karma there is no
 * bootstrap, so without this the suites that assert real prose would read back
 * `'companion.workerNotSignedIn'` instead of a sentence.
 *
 * A top-level `beforeAll` runs before the first suite, and the dictionary cache
 * is module-level, so one warm-up covers the whole run. It lives in its own file
 * rather than in the specs that happen to need it: relying on some earlier suite
 * to have loaded a language is exactly the order-dependence that makes a suite
 * pass alone and fail in a shuffle.
 */
beforeAll(async () => {
  await I18nService.preload('en');
  await I18nService.preload('es');
});
