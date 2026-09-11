// What a member may do. Enforced in the database, mirrored here only so the
// UI can stop offering what would be refused.
//  admin    : owns the shared library — upload, edit, delete, and the panel
//  member   : plays everything, keeps playlists, may ask for a song
//  listener : plays and downloads, but never grows or shrinks the library
export type UserRole = 'admin' | 'member' | 'listener';

// Row of the Supabase `profiles` table (1 per auth user).
export interface ProfileModel {
  id: string;
  display_name: string;
  created_at: string;
  // Admins own the shared cloud library: only they can upload, replace or
  // delete its songs. Everyone else reads, streams and downloads it.
  //
  // Kept alongside `role` because app builds already installed on family
  // phones read it; the database derives it from the role by trigger.
  is_admin: boolean;
  role: UserRole;
  // A disabled account can still hold a session until it expires, but every
  // policy refuses it, so the app signs it out rather than showing an empty
  // library that looks like a bug.
  disabled: boolean;
  // The language this account chose, or null when it never has. Null is not
  // the same as 'en': it is what lets the device's own choice, and then the
  // library default, still have a say.
  language: 'es' | 'en' | null;
  // When the welcome box was finished or skipped. Null means it has not been
  // seen, which is also true of every account that existed before it did.
  onboarded_at: string | null;
}
