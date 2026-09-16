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
// /auth/reset carrying the session, which supabase-js has to pick up before the
// new password can be set. Inside the Capacitor shell the app opens at a plain
// local URL with nothing to find, so it is a no-op there.
//
// `flowType` is 'implicit' for one specific reason. Under 'pkce',
// resetPasswordForEmail stores a code verifier in *this browser's*
// localStorage, so the emailed link only works where it was requested —
// asking for a reset in the installed PWA and then opening the link from the
// phone's mail app fails, which is the main way this app is used. The stronger
// alternative (a `token_hash` link exchanged with verifyOtp, which
// /auth/reset still supports) needs the email template edited, and Supabase
// locks template editing behind custom SMTP.
//
// The trade-off is deliberate: an implicit link carries the tokens in its URL
// fragment rather than a browser-bound code, so a leaked reset link is usable
// by whoever holds it until it expires or is consumed. It is still single-use
// and short-lived, and supabase-js strips the fragment once it has read it.
// Nothing else here depends on PKCE — the app has no OAuth providers, so the
// recovery link is the only flow `flowType` governs.
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: safeStorage(),
      storageKey: AUTH_STORAGE_KEY,
      flowType: 'implicit',
    },
  });
}

/**
 * localStorage, or something shaped like it that cannot throw.
 *
 * This is a class field on a root service that every other service reaches
 * through, so anything it throws happens during bootstrap and takes the whole
 * app with it — a blank screen, not a failed sign-in. Lockdown mode, blocked
 * cookies and a handful of embedded WebViews all make `localStorage` throw on
 * access rather than merely returning null, and Safari throws on setItem when
 * the private-mode quota is zero.
 *
 * Falling back to memory means the session lasts for the tab instead of for the
 * device: the user signs in again next launch, which is a small indignity next
 * to an app that will not open.
 */
function safeStorage(): Storage {
  try {
    const probe = '__music-hub-probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: key => void memory.delete(key),
      clear: () => memory.clear(),
      key: index => Array.from(memory.keys())[index] ?? null,
      get length() {
        return memory.size;
      },
    } as Storage;
  }
}
