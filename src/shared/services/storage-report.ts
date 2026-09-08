import { SongModel } from '../models/song.model';

// Supabase's free tier: 1 GB of Storage, and 5 GB of egress a month.
export const EGRESS_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

// Above this a song is worth compressing: 320 kbps is roughly 7 MB for a
// four-minute track, and AAC 160k halves it with no audible loss on a phone.
export const HIGH_BITRATE_BPS = 200_000;
// What `tools/compress-for-cloud.sh` re-encodes to by default.
export const TARGET_BITRATE_BPS = 160_000;

export interface StorageReport {
  cloudSongs: number;
  cloudBytes: number;
  averageBytes: number;
  // How many more songs fit at the current average, which is the only estimate
  // anyone actually wants from a quota bar.
  roomForSongs: number;
  onDeviceSongs: number;
  onDeviceBytes: number;
  // Songs stored well above the bitrate a phone can tell apart, with what
  // re-encoding them would give back.
  heavy: HeavySong[];
  reclaimableBytes: number;
}

export interface HeavySong {
  song: SongModel;
  bitrate: number;
  wouldSaveBytes: number;
}

/**
 * A song's bitrate, worked out from what is actually stored rather than from
 * anything the file claims. Returns 0 when there is nothing to divide by — a
 * song whose duration never got read would otherwise look infinitely dense.
 */
export function bitrateOf(song: SongModel): number {
  if (!song.duration || !song.sizeBytes) return 0;
  return (song.sizeBytes * 8) / song.duration;
}

/**
 * What re-encoding at the target bitrate would save. Never negative: a song
 * already below the target would grow, and "compress this to make it bigger"
 * is not advice worth showing.
 */
export function savingFrom(song: SongModel): number {
  const bitrate = bitrateOf(song);
  if (bitrate <= TARGET_BITRATE_BPS) return 0;
  const target = (TARGET_BITRATE_BPS * song.duration) / 8;
  return Math.max(0, Math.round(song.sizeBytes - target));
}

export function buildStorageReport(songs: SongModel[], quotaBytes: number): StorageReport {
  const cloud = songs.filter(s => s.syncState === 'synced' && s.storagePath);
  const cloudBytes = cloud.reduce((total, s) => total + (s.sizeBytes || 0), 0);
  const averageBytes = cloud.length ? Math.round(cloudBytes / cloud.length) : 0;

  const onDevice = songs.filter(s => s.downloaded);

  const heavy = cloud
    .filter(s => bitrateOf(s) > HIGH_BITRATE_BPS && savingFrom(s) > 0)
    .map(song => ({ song, bitrate: bitrateOf(song), wouldSaveBytes: savingFrom(song) }))
    .sort((a, b) => b.wouldSaveBytes - a.wouldSaveBytes);

  return {
    cloudSongs: cloud.length,
    cloudBytes,
    averageBytes,
    roomForSongs: averageBytes
      ? Math.max(0, Math.floor((quotaBytes - cloudBytes) / averageBytes))
      : 0,
    onDeviceSongs: onDevice.length,
    onDeviceBytes: onDevice.reduce((total, s) => total + (s.sizeBytes || 0), 0),
    heavy,
    reclaimableBytes: heavy.reduce((total, h) => total + h.wouldSaveBytes, 0),
  };
}

export function formatBytes(bytes: number): string {
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

export function formatBitrate(bps: number): string {
  return bps ? `${Math.round(bps / 1000)} kbps` : 'unknown';
}
