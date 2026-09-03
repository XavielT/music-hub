// Supabase connection settings (production build).
// The anon key is public-safe (RLS protects the data), so these files stay committed.
// Project: x-core (shared backend for all personal apps).
export const environment = {
  production: true,
  supabaseUrl: 'https://nakgrkcqyuycadeuenuw.supabase.co',
  // anon public key. Never paste the service_role key here.
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ha2dya2NxeXV5Y2FkZXVlbnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjE1NjUsImV4cCI6MjEwNDAzNzU2NX0.83aqu6TlnXDs4eg-waT0FQlycvFc6hQinwgg42SSCwE',
};
