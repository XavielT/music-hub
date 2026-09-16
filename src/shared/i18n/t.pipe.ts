import { Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../services/i18n.service';
import type { TranslationKey } from './en';

/**
 * `{{ 'library.title' | t }}`, and `{{ 'admin.deleteUser' | t: { name: x } }}`
 * where a string takes parameters.
 *
 * Impure on purpose, which is worth explaining because "pure" is the usual
 * advice. A pure pipe is re-evaluated only when its *input* changes, and the
 * input here is a constant key — so switching language would leave every
 * already-rendered string exactly as it was. Reading the signal inside does not
 * help: pure-pipe caching is keyed on the argument, not on what the transform
 * touched.
 *
 * The cost of impure is that `transform` runs on every change-detection pass.
 * That is paid back by caching the last answer: an unchanged key, parameters
 * and language return the previous string without a lookup, so the per-pass
 * work is a handful of comparisons.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TPipe implements PipeTransform {
  private lastKey?: string;
  private lastLang?: string;
  private lastLoadedAt?: number;
  private lastParamsJson?: string;
  private lastValue = '';

  constructor(private i18n: I18nService) {}

  transform(key: TranslationKey | string, params?: Record<string, string | number>): string {
    const lang = this.i18n.lang();
    // A dictionary arriving is as much a reason to recompute as a language
    // change: when the first load fails and a later one succeeds, the language
    // never changed, so this is the only input that moved.
    const loadedAt = this.i18n.loadedAt();
    // Cheap when there are no parameters, which is the overwhelming majority.
    const paramsJson = params ? JSON.stringify(params) : '';
    if (
      key === this.lastKey &&
      lang === this.lastLang &&
      loadedAt === this.lastLoadedAt &&
      paramsJson === this.lastParamsJson
    ) {
      return this.lastValue;
    }
    this.lastKey = key;
    this.lastLang = lang;
    this.lastLoadedAt = loadedAt;
    this.lastParamsJson = paramsJson;
    this.lastValue = this.i18n.t(key, params);
    return this.lastValue;
  }
}
