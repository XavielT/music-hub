// A song someone has asked an admin device to fetch from YouTube.
//
// Mirrors `public.download_requests` exactly. Members insert these; only an
// admin device moves one past 'pending', which RLS enforces rather than the UI.
export interface DownloadRequestRow {
  id: string;
  requested_by: string;
  video_id: string;
  // Empty when the request came from a pasted link on a device with no way to
  // look YouTube up. The worker fills both in from what it downloads.
  title: string;
  artist: string;
  thumbnail: string | null;
  duration: number;
  status: DownloadRequestStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  song_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type DownloadRequestStatus = 'pending' | 'working' | 'done' | 'failed';

// Still occupying a slot against the per-member cap, and still worth watching
// in the UI.
export function isActive(request: DownloadRequestRow): boolean {
  return request.status === 'pending' || request.status === 'working';
}

// What to call a request that may have arrived as a bare video id.
export function requestLabel(request: DownloadRequestRow): string {
  return request.title.trim() || `youtube.com/watch?v=${request.video_id}`;
}
