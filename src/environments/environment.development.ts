// Supabase connection settings (dev / `npm start`).
// Same x-core project as production — there is no separate dev project.
export const environment = {
  production: false,
  supabaseUrl: 'https://nakgrkcqyuycadeuenuw.supabase.co',
  // anon public key. Never paste the service_role key here.
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ha2dya2NxeXV5Y2FkZXVlbnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjE1NjUsImV4cCI6MjEwNDAzNzU2NX0.83aqu6TlnXDs4eg-waT0FQlycvFc6hQinwgg42SSCwE',
  // Where the deployed web app lives. The Android app has no usable origin of
  // its own — inside the WebView `location.origin` is https://localhost — so
  // emailed links (password reset) have to point here instead.
  siteUrl: 'https://music-hub-xaviel.vercel.app',
  // GitHub repo the Android app checks for a newer release (owner/name).
  // The web app updates itself through the service worker instead.
  updateRepo: 'XavielT/music-hub',
};
