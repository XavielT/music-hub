// Row of the Supabase `profiles` table (1 per auth user).
export interface ProfileModel {
  id: string;
  display_name: string;
  created_at: string;
  // Admins own the shared cloud library: only they can upload, replace or
  // delete its songs. Everyone else reads, streams and downloads it.
  is_admin: boolean;
}
