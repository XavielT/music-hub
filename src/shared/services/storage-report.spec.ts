import {
  bitrateOf,
  buildStorageReport,
  formatBitrate,
  formatBytes,
  savingFrom,
} from './storage-report';
import { SongModel } from '../models/song.model';

// Every number on the storage page is advice someone might act on — deleting
// songs, re-encoding a library. Advice that is wrong in the reassuring
// direction is the dangerous kind, so the edges are pinned: a song with no
// duration, a song already small enough, a library with nothing in it.

const MB = 1024 * 1024;

function song(over: Partial<SongModel> & { id: string }): SongModel {
  return {
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 240,
    source: 'local',
    coverColor: '#ff9000',
    addedAt: 0,
    ownerId: 'owner',
    sizeBytes: 4 * MB,
    syncState: 'synced',
    storagePath: `owner/${over.id}.mp3`,
    downloaded: false,
    hasCover: false,
    ...over,
  };
}

describe('bitrateOf', () => {
  it('works it out from what is actually stored', () => {
    // 7 MB over 4 minutes is about 245 kbps.
    expect(Math.round(bitrateOf(song({ id: 'a', sizeBytes: 7 * MB, duration: 240 })) / 1000)).toBe(
      245
    );
  });

  it('refuses to divide by a duration nobody read', () => {
    expect(bitrateOf(song({ id: 'a', duration: 0 }))).toBe(0);
    expect(bitrateOf(song({ id: 'a', sizeBytes: 0 }))).toBe(0);
  });
});

describe('savingFrom', () => {
  it('is the difference down to the target bitrate', () => {
    const saving = savingFrom(song({ id: 'a', sizeBytes: 10 * MB, duration: 240 }));
    // 160 kbps over 4 minutes is 4.8 MB, so about 5.2 MB comes back.
    expect(Math.round(saving / MB)).toBe(5);
  });

  it('never promises a saving for a song already below the target', () => {
    // 128 kbps: re-encoding at 160 would make it *bigger*.
    expect(savingFrom(song({ id: 'a', sizeBytes: 3.5 * MB, duration: 240 }))).toBe(0);
  });

  it('says nothing about a song whose duration is unknown', () => {
    expect(savingFrom(song({ id: 'a', sizeBytes: 40 * MB, duration: 0 }))).toBe(0);
  });
});

describe('buildStorageReport', () => {
  const quota = 1024 * MB;

  it('counts only what is actually in the cloud', () => {
    const report = buildStorageReport(
      [
        song({ id: 'a', sizeBytes: 5 * MB }),
        // Local-only: on this device, not in the shared budget.
        song({ id: 'b', sizeBytes: 90 * MB, syncState: 'local-only', storagePath: undefined }),
      ],
      quota
    );

    expect(report.cloudSongs).toBe(1);
    expect(report.cloudBytes).toBe(5 * MB);
  });

  it('estimates how many more songs fit at the current average', () => {
    const report = buildStorageReport(
      [song({ id: 'a', sizeBytes: 4 * MB }), song({ id: 'b', sizeBytes: 6 * MB })],
      100 * MB
    );

    expect(report.averageBytes).toBe(5 * MB);
    // 90 MB left, 5 MB each.
    expect(report.roomForSongs).toBe(18);
  });

  it('does not divide by zero on an empty library', () => {
    const report = buildStorageReport([], quota);
    expect(report.cloudSongs).toBe(0);
    expect(report.averageBytes).toBe(0);
    expect(report.roomForSongs).toBe(0);
    expect(report.reclaimableBytes).toBe(0);
  });

  it('never reports room left once the quota is blown', () => {
    const report = buildStorageReport([song({ id: 'a', sizeBytes: 120 * MB })], 100 * MB);
    expect(report.roomForSongs).toBe(0);
  });

  it('lists the heaviest songs first, and leaves the sensible ones out', () => {
    const report = buildStorageReport(
      [
        song({ id: 'small', sizeBytes: 3.5 * MB, duration: 240 }), // ~122 kbps
        song({ id: 'big', sizeBytes: 12 * MB, duration: 240 }), // ~420 kbps
        song({ id: 'mid', sizeBytes: 8 * MB, duration: 240 }), // ~280 kbps
      ],
      quota
    );

    expect(report.heavy.map(h => h.song.id)).toEqual(['big', 'mid']);
    expect(report.reclaimableBytes).toBe(report.heavy[0].wouldSaveBytes + report.heavy[1].wouldSaveBytes);
  });

  it('measures the device separately from the cloud', () => {
    const report = buildStorageReport(
      [
        song({ id: 'a', sizeBytes: 5 * MB, downloaded: true }),
        song({ id: 'b', sizeBytes: 5 * MB, downloaded: false }),
      ],
      quota
    );

    expect(report.cloudSongs).toBe(2);
    expect(report.onDeviceSongs).toBe(1);
    expect(report.onDeviceBytes).toBe(5 * MB);
  });
});

describe('formatting', () => {
  it('scales bytes to something readable', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * MB)).toBe('5.0 MB');
    expect(formatBytes(1024 * MB)).toBe('1.0 GB');
  });

  it('says "unknown" rather than "0 kbps"', () => {
    expect(formatBitrate(0)).toBe('unknown');
    expect(formatBitrate(160_000)).toBe('160 kbps');
  });
});
