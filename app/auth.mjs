// Optional accounts (PRD §5.1, §5.8) — Supabase auth + the profile/history it
// persists. Every export here is a safe no-op when window.AMYGDALA_SUPABASE
// isn't configured, so guest play is completely unaffected: this module simply
// isn't in the loop unless an account is turned on.
//
// Both Google OAuth and the email link are redirect-based: the browser leaves
// the page and comes back (Google to its own login page; email to whatever
// link the player clicks in their inbox). That's a real navigation, not an
// in-page popup — Supabase's default project ships a clickable magic-link
// email, not a typed-in code, so this follows what the project is actually
// configured for rather than assuming a passwordless-code UI it doesn't send.
// One shared "did we just arrive back from an auth redirect" path handles both.

import { createClient } from './vendor/supabase.mjs';

const cfg = typeof window !== 'undefined' ? window.AMYGDALA_SUPABASE : null;

export const enabled = Boolean(cfg?.url && cfg?.anonKey);

const client = enabled
  ? createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true, // stay signed in across reloads (localStorage)
        autoRefreshToken: true,
        detectSessionInUrl: true, // parse the tokens Google/the email link append to the URL
      },
    })
  : null;

/** The current session's user, or null if signed out / not configured. */
export async function getUser() {
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

/** Fires immediately with the current state, then on every sign-in/out. A
 *  no-op subscription (never fires) when accounts aren't configured, so
 *  callers don't need to branch on `enabled` themselves. */
export function onAuthChange(cb) {
  if (!client) return () => {};
  client.auth.getUser().then(({ data }) => cb(data.user ?? null));
  const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => sub.subscription.unsubscribe();
}

/** Redirects to Google's login, then back to this same page. */
export async function signInWithGoogle() {
  if (!client) throw new Error('NOT_CONFIGURED');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: cleanUrl() },
  });
  if (error) throw error;
}

/** Emails a sign-in link. Supabase's default template sends a clickable link
 *  (not a code) — see the module comment — so this resolves once the request
 *  is accepted, not once the player is actually signed in; onAuthChange fires
 *  later, when they click the link and land back here. */
export async function sendSignInEmail(email) {
  if (!client) throw new Error('NOT_CONFIGURED');
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: cleanUrl(), shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}

// Strip any query/hash Supabase (or a prior load) left on the URL, so the
// redirect target — and the URL the player is looking at afterward — is clean.
function cleanUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

/** The row from `profiles` (docs/supabase-schema.sql), or null if signed out /
 *  not configured / the row hasn't been created yet (a fresh sign-up races the
 *  trigger that creates it — this treats "not found" as "no data" rather than
 *  an error). */
export async function fetchProfile(userId) {
  if (!client) return null;
  const { data } = await client
    .from('profiles')
    .select('nickname, chips, wins, losses, pushes')
    .eq('id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Persist the session's nickname and running totals to the account (called
 *  after each resolved hand). This writes absolute values, not increments —
 *  correct for one browser tab playing at a time, which is this project's
 *  actual usage; a second concurrent tab could race and overwrite (documented
 *  in DEPLOY.md, not silently assumed away). */
export async function syncProfile(userId, { nickname, chips, wins, losses, pushes }) {
  if (!client) return;
  await client.from('profiles').update({ nickname, chips, wins, losses, pushes }).eq('id', userId);
}

/** One row per resolved hand (docs/supabase-schema.sql `match_history`). */
export async function recordHand(userId, { roomCode, result, payout }) {
  if (!client) return;
  await client.from('match_history').insert({
    user_id: userId,
    game: 'blackjack',
    room_code: roomCode,
    result,
    payout,
  });
}
