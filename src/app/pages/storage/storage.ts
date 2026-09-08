import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { SyncService } from '../../../shared/services/sync.service';
import {
  CloudLibraryService,
  STORAGE_QUOTA_BYTES,
} from '../../../shared/services/cloud-library.service';
import {
  EGRESS_QUOTA_BYTES,
  buildStorageReport,
  formatBitrate,
  formatBytes,
} from '../../../shared/services/storage-report';

// Where the 1 GB is going, and what could be got back. The quota bar in
// settings says how full it is; this says what is filling it.
@Component({
  selector: 'app-storage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './storage.html',
  styleUrl: './storage.scss',
})
export class StorageComponent {
  readonly quotaLabel = formatBytes(STORAGE_QUOTA_BYTES);
  readonly egressLabel = formatBytes(EGRESS_QUOTA_BYTES);

  report = computed(() => buildStorageReport(this.library.songs(), STORAGE_QUOTA_BYTES));

  usedPercent = computed(() =>
    Math.round((this.report().cloudBytes / STORAGE_QUOTA_BYTES) * 100)
  );
  nearQuota = computed(() => this.report().cloudBytes / STORAGE_QUOTA_BYTES > 0.85);

  // Only the worst offenders: a list of every song sorted by size is a table,
  // not an answer.
  worstOffenders = computed(() => this.report().heavy.slice(0, 12));

  constructor(
    public library: LibraryService,
    public auth: AuthService,
    public sync: SyncService,
    public cloud: CloudLibraryService
  ) {}

  bytes = formatBytes;
  bitrate = formatBitrate;

  back(): void {
    history.back();
  }
}
