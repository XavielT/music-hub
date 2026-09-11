// Privileged user administration.
//
// Everything here needs the service_role key, which is exactly why it is here:
// that key must never reach the Angular app, where anyone with devtools could
// read it and own the shared library. The app calls this function with its own
// user JWT; the function decides whether that user is allowed.
//
// The rule is checked twice on purpose. This function refuses a caller who is
// not an enabled admin, and the database refuses the dangerous parts anyway
// (the last-admin guard is a trigger, not a policy). Neither trusts the UI.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Where password-reset links are allowed to land. Taken from a fixed list
// rather than from the request: a redirect the caller chooses is a redirect an
// attacker chooses.
const SITE_URL = 'https://music-hub-xaviel.vercel.app';

const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://localhost', // the Capacitor WebView's origin on Android
  'http://localhost:4200',
  'http://localhost:8100',
];

const ROLES = ['admin', 'member', 'listener'];

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : SITE_URL;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

// The service client bypasses RLS, so it is built once and used only after the
// caller has been checked.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function callerProfile(authorization: string) {
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, disabled, display_name')
    .eq('id', data.user.id)
    .single();
  return profile ?? null;
}

// Remove everything a user has in the buckets. Their songs rows go with the
// profile through the FK cascade; the objects have no such thing.
async function wipeStorage(userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of ['songs', 'covers']) {
    const { data } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    const paths = (data ?? []).map(entry => `${userId}/${entry.name}`);
    if (paths.length) {
      await admin.storage.from(bucket).remove(paths);
      removed += paths.length;
    }
  }
  return removed;
}

// GoTrue can revoke every session a user has, which is the difference between
// "cannot sign in again" and "is out right now". supabase-js has no wrapper
// for it, so this is the admin endpoint directly.
async function revokeSessions(userId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json({ error: 'Sign in first.' }, 401, origin);
  }

  const caller = await callerProfile(authorization);
  if (!caller) return json({ error: 'Sign in first.' }, 401, origin);
  if (caller.role !== 'admin' || caller.disabled) {
    return json({ error: 'Only an admin can do that.' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const action = String(body.action ?? '');
  const userId = String(body.userId ?? '');

  try {
    switch (action) {
      case 'set-role': {
        const role = String(body.role ?? '');
        if (!ROLES.includes(role)) return json({ error: `Unknown role "${role}".` }, 400, origin);
        // The database refuses to strip the last admin; this turns that into a
        // sentence rather than a Postgres error string.
        const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
        if (error) return json({ error: error.message }, 409, origin);
        return json({ ok: true, userId, role }, 200, origin);
      }

      case 'set-disabled': {
        const disabled = body.disabled === true;
        if (disabled && userId === caller.id) {
          return json({ error: 'You cannot disable your own account.' }, 409, origin);
        }
        const { error } = await admin.from('profiles').update({ disabled }).eq('id', userId);
        if (error) return json({ error: error.message }, 409, origin);
        // Policies already refuse a disabled user, but a live session would
        // keep its cached library on screen until it next reloaded.
        if (disabled) await revokeSessions(userId);
        return json({ ok: true, userId, disabled }, 200, origin);
      }

      case 'delete-user': {
        if (userId === caller.id) {
          return json({ error: 'You cannot delete your own account.' }, 409, origin);
        }
        // Storage first: once the auth user is gone the profile cascades away
        // and nothing is left to say which folder was theirs.
        const objects = await wipeStorage(userId);
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) return json({ error: error.message }, 409, origin);
        return json({ ok: true, userId, objectsRemoved: objects }, 200, origin);
      }

      case 'send-reset': {
        const { data: target, error: lookup } = await admin.auth.admin.getUserById(userId);
        if (lookup || !target?.user?.email) {
          return json({ error: 'That account has no email address.' }, 404, origin);
        }
        // Same landing page the app's own "forgot password" uses, so the
        // emailed link behaves identically however it was asked for.
        const recover = `${SUPABASE_URL}/auth/v1/recover` +
          `?redirect_to=${encodeURIComponent(`${SITE_URL}/auth/reset`)}`;
        const response = await fetch(recover, {
          method: 'POST',
          headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: target.user.email,
            // eslint-disable-next-line camelcase
            gotrue_meta_security: {},
          }),
        });
        if (!response.ok) {
          const detail = await response.text();
          // The free tier sends two confirmation emails an hour; past that this
          // is a 429 that says nothing useful on its own.
          return json(
            { error: response.status === 429
                ? 'Too many emails for now — Supabase allows two an hour on the free plan.'
                : `Supabase refused to send it: ${detail.slice(0, 200)}` },
            response.status === 429 ? 429 : 502,
            origin
          );
        }
        return json({ ok: true, email: target.user.email }, 200, origin);
      }

      default:
        return json({ error: `Unknown action "${action}".` }, 400, origin);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, origin);
  }
});
