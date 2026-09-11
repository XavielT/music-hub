import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService, AdminUserRow } from '../../../shared/services/admin.service';
import { AppSettingsService } from '../../../shared/services/app-settings.service';
import { AuthService } from '../../../shared/services/auth.service';
import { InvitesService } from '../../../shared/services/invites.service';
import { ToastService } from '../../../shared/services/toast.service';
import { STORAGE_QUOTA_BYTES } from '../../../shared/services/cloud-library.service';
import { UserRole } from '../../../shared/models/profile.model';
import { I18nService } from '../../../shared/services/i18n.service';
import { PendingSongsService, PendingSongRow } from '../../../shared/services/pending-songs.service';
import { TPipe } from '../../../shared/i18n/t.pipe';

/**
 * Users, invites and settings for whoever runs the library.
 *
 * Every control here is a request the database or the Edge Function is free to
 * refuse: the panel shows what came back rather than what it asked for, and a
 * refusal is a sentence on screen, not a silent no-op.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent implements OnInit {
  readonly roles: UserRole[] = ['admin', 'member', 'listener'];
  readonly quotaLabel = formatBytes(STORAGE_QUOTA_BYTES);

  tab = signal<'users' | 'pending' | 'invites' | 'settings'>('users');

  // Deleting takes a person's account and their songs with it, so it asks for
  // the name to be typed rather than for a second tap.
  deleting = signal<AdminUserRow | null>(null);
  confirmName = '';

  inviteEmail = '';
  inviteNote = '';

  maxUploadMb = signal(0);
  language = signal('es');

  usedPercent = computed(() =>
    Math.min(100, Math.round((this.admin.totalBytes() / STORAGE_QUOTA_BYTES) * 100))
  );

  activeUsers = computed(() => this.admin.users().filter(u => !u.disabled).length);

  constructor(
    public admin: AdminService,
    public auth: AuthService,
    public invites: InvitesService,
    public settings: AppSettingsService,
    public pendingSongs: PendingSongsService,
    private toast: ToastService,
    private router: Router,
    private i18n: I18nService
  ) {}

  // The member quota, in whole MB, as the settings tab edits it.
  memberQuotaMb = signal(0);

  // Rejecting takes somebody's upload and its audio, so it asks twice.
  confirmingReject = signal<string | null>(null);

  async approve(item: PendingSongRow): Promise<void> {
    if (await this.pendingSongs.approve(item.id)) {
      this.toast.show(this.i18n.t('admin.approved'));
      // The library gains a song the moment it is approved, and the panel's
      // own totals are computed from the user overview.
      void this.admin.load();
    } else {
      this.toast.error(this.pendingSongs.error() || this.i18n.t('admin.actionFailed'));
    }
  }

  async reject(item: PendingSongRow): Promise<void> {
    if (this.confirmingReject() !== item.id) {
      this.confirmingReject.set(item.id);
      return;
    }
    this.confirmingReject.set(null);
    if (await this.pendingSongs.reject(item)) {
      this.toast.show(this.i18n.t('admin.rejected'));
      void this.admin.load();
    } else {
      this.toast.error(this.pendingSongs.error() || this.i18n.t('admin.actionFailed'));
    }
  }

  async saveMemberQuota(): Promise<void> {
    const mb = Math.round(this.memberQuotaMb());
    if (!Number.isFinite(mb) || mb <= 0) {
      this.toast.error(this.i18n.t('admin.badMegabytes'));
      return;
    }
    const failed = await this.settings.save('member_quota_mb', mb);
    if (failed) this.toast.error(failed);
    else this.toast.show(this.i18n.t('admin.quotaSaved'));
  }

  ngOnInit(): void {
    void this.admin.load();
    void this.pendingSongs.load();
    void this.invites.load();
    void this.settings.load().then(() => {
      this.maxUploadMb.set(this.settings.maxUploadMb());
      this.language.set(this.settings.defaultLanguage());
      this.memberQuotaMb.set(this.settings.memberQuotaMb());
    });
  }

  formatBytes = formatBytes;

  formatDate(value: string | null): string {
    if (!value) return 'never';
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  initial(user: AdminUserRow): string {
    return (user.display_name.trim()[0] || user.email?.[0] || '?').toUpperCase();
  }

  async changeRole(user: AdminUserRow, event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as UserRole;
    if (role === user.role) return;
    const ok = await this.admin.setRole(user.id, role);
    if (ok) this.toast.show(`${this.label(user)} is now a ${role}.`);
    else {
      this.toast.error(this.admin.error() ?? this.i18n.t('admin.actionFailed'));
      // Put the picker back where the database still has it.
      (event.target as HTMLSelectElement).value = user.role;
    }
  }

  async toggleDisabled(user: AdminUserRow): Promise<void> {
    const ok = await this.admin.setDisabled(user.id, !user.disabled);
    if (ok) {
      this.toast.show(
        user.disabled
          ? `${this.label(user)} can sign in again.`
          : `${this.label(user)} is disabled and signed out everywhere.`
      );
    } else {
      this.toast.error(this.admin.error() ?? this.i18n.t('admin.actionFailed'));
    }
  }

  async sendReset(user: AdminUserRow): Promise<void> {
    const ok = await this.admin.sendReset(user.id);
    if (ok) this.toast.show(this.i18n.t('settings.resetSentTo', { email: user.email ?? '' }));
    else this.toast.error(this.admin.error() ?? this.i18n.t('admin.sendFailed'));
  }

  askDelete(user: AdminUserRow): void {
    this.deleting.set(user);
    this.confirmName = '';
  }

  canConfirmDelete = computed(() => {
    const user = this.deleting();
    return !!user && this.confirmName.trim() === (user.display_name.trim() || user.email);
  });

  async confirmDelete(): Promise<void> {
    const user = this.deleting();
    if (!user) return;
    const ok = await this.admin.deleteUser(user.id);
    this.deleting.set(null);
    if (ok) this.toast.show(`${this.label(user)} and everything they uploaded are gone.`);
    else this.toast.error(this.admin.error() ?? this.i18n.t('admin.actionFailed'));
  }

  async addInvite(): Promise<void> {
    if (!this.inviteEmail.trim()) return;
    const ok = await this.invites.add(this.inviteEmail, this.inviteNote);
    if (ok) {
      this.inviteEmail = '';
      this.inviteNote = '';
    }
  }

  async saveUploadLimit(): Promise<void> {
    const mb = Math.round(this.maxUploadMb());
    if (!(mb > 0)) {
      this.toast.error(this.i18n.t('admin.badMegabytes'));
      return;
    }
    const failed = await this.settings.save('max_upload_mb', mb);
    if (failed) this.toast.error(failed);
    else this.toast.show(this.i18n.t('admin.uploadLimitSaved', { mb }));
  }

  async saveLanguage(): Promise<void> {
    const failed = await this.settings.save('default_language', this.language());
    if (failed) this.toast.error(failed);
    else this.toast.show(this.i18n.t('admin.languageSaved'));
  }

  private label(user: AdminUserRow): string {
    return user.display_name.trim() || user.email || this.i18n.t('admin.thatAccount');
  }

  back(): void {
    void this.router.navigateByUrl('/settings');
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
