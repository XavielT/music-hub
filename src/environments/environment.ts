// Supabase connection settings (production build).
// The anon key is public-safe (RLS protects the data), so these files stay committed.
export const environment = {
  production: true,
  // TODO: paste from Supabase dashboard → Project Settings → API → Project URL
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  // TODO: paste from Supabase dashboard → Project Settings → API → anon public key
  // Never paste the service_role key here.
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
};
