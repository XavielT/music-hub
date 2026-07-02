export type SongSource = 'local' | 'remote';

export interface SongModel {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  source: SongSource;
  url?: string; // stream url when source is 'remote'
  coverColor: string;
  addedAt: number;
}
