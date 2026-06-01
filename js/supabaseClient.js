// js/supabaseClient.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const existingSupabase = window.xhsSupabase || null;
const createdSupabase = (!existingSupabase && SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const supabase = existingSupabase || createdSupabase;

if (supabase && !window.xhsSupabase) {
  window.xhsSupabase = supabase;
}

export async function getCurrentUserId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id || null;
}

export function getCurrentUserName() {
  return window.currentUser?.name || localStorage.getItem('xhs_user_name') || '未知用户';
}
