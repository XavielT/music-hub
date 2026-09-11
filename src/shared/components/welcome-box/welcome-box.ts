import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../../services/auth.service';
import { AppSettingsService } from '../../services/app-settings.service';
import { I18nService, LANGUAGES, Lang } from '../../services/i18n.service';
import { TPipe } from '../../i18n/t.pipe';

type Step = 'language' | 'name' | 'tour-add' | 'tour-offline' | 'tour-install';

const SEEN_PREFIX = 'music-hub.onboarded.';

/**
 * The one-time welcome box: language, then the name everyone else will see,
 * then three slides on what the app can do.
 *
 * Shown once per account. `profiles.onboarded_at` is what decides that, so it
 * follows the user to a new device rather than greeting them again on every
 * browser; a per-user localStorage key backs it up, because the write needs a
 * network and being asked twice offline would be worse than asking once.
 *
 * Every slide is its own step with its own dot, rather than three slides hiding
 * behind a third dot: on a five-dot row you can see how much is left, which is
 * the only question anybody has during one of these.
 */
@Component({
  selector: 'app-welcome-box',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './welcome-box.html',
  styleUrl: './welcome-box.scss',
})
export class WelcomeBox {
  readonly languages = LANGUAGES;
  // Inside the installed Android app there is nothing to install, so that slide
  // is not part of the sequence at all — not merely hidden, or the dots would
  // count a step that never arrives.
  readonly steps: Step[] = Capacitor.isNativePlatform()
    ? ['language', 'name', 'tour-add', 'tour-offline']
    : ['language', 'name', 'tour-add', 'tour-offline', 'tour-install'];

  index = signal(0);
  step = computed(() => this.steps[this.index()]);
  isLast = computed(() => this.index() === this.steps.length - 1);

  name = '';
  private dismissed = signal(false);

  visible = computed(() => {
    if (this.dismissed()) return false;
    const profile = this.auth.profile();
    if (!profile || profile.disabled) return false;
    if (profile.onboarded_at) return false;
    return !this.seenLocally(profile.id);
  });

  constructor(
    private auth: AuthService,
    private settings: AppSettingsService,
    public i18n: I18nService
  ) {
    // Pre-fill from whatever the account already has, and pre-select the
    // language the admin set as the library's default — the first question is
    // then a confirmation rather than a blank.
    effect(() => {
      const profile = this.auth.profile();
      if (profile && !this.name) this.name = profile.display_name ?? '';
    });
  }

  /** Applies the choice immediately, so the rest of the box is in that language. */
  async choose(lang: Lang): Promise<void> {
    this.i18n.use(lang);
    await this.auth.saveLanguage(lang);
  }

  defaultLanguage(): string {
    return this.settings.defaultLanguage();
  }

  next(): void {
    if (this.isLast()) {
      void this.finish();
      return;
    }
    this.index.set(this.index() + 1);
  }

  back(): void {
    if (this.index() > 0) this.index.set(this.index() - 1);
  }

  /** Skipping still records it: nobody should be asked this twice. */
  async skip(): Promise<void> {
    await this.finish();
  }

  private async finish(): Promise<void> {
    const profile = this.auth.profile();
    // Close first. The writes need a network, and the box has no business
    // staying on screen while they resolve.
    this.dismissed.set(true);
    if (profile) this.rememberLocally(profile.id);
    if (this.name.trim()) await this.auth.saveDisplayName(this.name);
    await this.auth.markOnboarded();
  }

  private seenLocally(userId: string): boolean {
    try {
      return localStorage.getItem(SEEN_PREFIX + userId) === '1';
    } catch {
      return false;
    }
  }

  private rememberLocally(userId: string): void {
    try {
      localStorage.setItem(SEEN_PREFIX + userId, '1');
    } catch {
      // Private mode: the profile row is still the real record.
    }
  }
}
