import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { PwaService } from '../../services/pwa.service';

// Explains how to get Music Hub onto the home screen. Hidden once the app is
// already installed, and inside the native Android app where it makes no sense.
@Component({
  selector: 'app-install-hint',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './install-hint.html',
  styleUrl: './install-hint.scss',
})
export class InstallHint {
  readonly isNative = Capacitor.isNativePlatform();

  // iOS Safari has no install prompt API — the user has to use the Share menu.
  showIosSteps = computed(() => !this.isNative && !this.pwa.isInstalled && this.pwa.isIos);
  showInstallButton = computed(() => !this.isNative && !this.pwa.isInstalled && this.pwa.canPrompt());
  visible = computed(() => this.showIosSteps() || this.showInstallButton());

  constructor(public pwa: PwaService) {}
}
