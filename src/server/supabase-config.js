// Central Supabase configuration for the desktop host and the local web client.
//
// These are the public project URL and the publishable (anon) key — both are
// safe to ship in the client. The anon key only grants what RLS policies allow.
// Override via env (SUPABASE_URL / SUPABASE_ANON_KEY) when needed.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yqbkdajkvjxqwcmlxtja.supabase.co';
// Legacy anon JWT key — broadly accepted by Realtime, Auth and PostgREST. It is
// public/safe to ship (RLS still governs access). Swap to a publishable key via
// SUPABASE_ANON_KEY if you rotate to the modern key format.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYmtkYWprdmp4cXdjbWx4dGphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MTMwMjQsImV4cCI6MjA5NzI4OTAyNH0.KjLOR2ihEFm-axJYLtM7eRoGT-y7EnVvhul7bFGQuxw';

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  // Edge Functions base + the two functions we deploy.
  functionsUrl: `${SUPABASE_URL}/functions/v1`,
  registerSessionUrl: `${SUPABASE_URL}/functions/v1/register-session`,
  appUrl: `${SUPABASE_URL}/functions/v1/app`,
  // The phone web client. Defaults to the edge-function page, but set
  // PCPHONE_WEB_URL to your deployed site (e.g. https://pcphone.vercel.app)
  // so the QR / shared link points there instead.
  webAppUrl: process.env.PCPHONE_WEB_URL || `${SUPABASE_URL}/functions/v1/app`,
};
