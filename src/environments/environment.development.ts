// Supabase connection settings (dev / `npm start`).
// Same project as production unless you create a separate Supabase project for dev.
export const environment = {
  production: false,
  // TODO: paste from Supabase dashboard → Project Settings → API → Project URL
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  // TODO: paste from Supabase dashboard → Project Settings → API → anon public key
  // Never paste the service_role key here.
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
};
