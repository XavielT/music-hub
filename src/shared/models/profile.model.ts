// Row of the Supabase `profiles` table (1 per auth user).
export interface ProfileModel {
  id: string;
  display_name: string;
  created_at: string;
}
