import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

// Key used by supabase-js to persist the session. Fixed on purpose so the
// auth service can read the stored session back when the device is offline.
export const AUTH_STORAGE_KEY = 'music-hub-auth';

// Single SupabaseClient for the whole app. Auth is configured for the
// Capacitor WebView: the session lives in localStorage (which survives app
// restarts on Android/iOS) and there is no OAuth redirect to parse.
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: localStorage,
      storageKey: AUTH_STORAGE_KEY,
      flowType: 'pkce',
    },
  });
}
