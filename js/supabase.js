import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured =
  !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STATUS_LABELS = { green: 'Running', yellow: 'Attention', red: 'Line Down' };

// mm:ss, or h:mm:ss past one hour.
export function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${String(minutes).padStart(2, '0')}:${ss}`;
}

// Clamped at zero because a phone's clock can run behind the database's.
export function formatElapsed(since) {
  return formatDuration(Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000)));
}

export function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}

export const NOT_CONFIGURED_MESSAGE = 'Supabase is not configured yet. Fill in js/config.js.';
