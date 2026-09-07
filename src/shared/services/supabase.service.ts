import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

// Key used by supabase-js to persist the session. Fixed on purpose so the
// auth service can read the stored session back when the device is offline.
export const AUTH_STORAGE_KEY = 'music-hub-auth';

// Single SupabaseClient for the whole app. Auth is configured for the
// Capacitor WebView: the session lives in localStorage, which survives app
// restarts on Android/iOS.
//
// `detectSessionInUrl` is on because the password-recovery link comes back to
// /auth/reset with a PKCE `?code=`, which supabase-js has to exchange for a
// session before the new password can be set. Inside the Capacitor shell the
// app opens at a plain local URL with no code to find, so it is a no-op there.
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: localStorage,
      storageKey: AUTH_STORAGE_KEY,
      flowType: 'pkce',
    },
  });
}
