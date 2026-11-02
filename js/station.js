import {
  supabase, isConfigured, STATUS_LABELS, NOT_CONFIGURED_MESSAGE, formatElapsed, showToast,
} from './supabase.js';

const el = (id) => document.getElementById(id);
const allButtons = () => document.querySelectorAll('#station button');

const rawId = new URLSearchParams(location.search).get('id') ?? '';
const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;

let station = null;
let pendingStatus = null;

function showMessage(title) {
  el('message-title').textContent = title;
  el('message').hidden = false;
  el('station').hidden = true;
}

function renderStatus() {
  document.title = `${station.name} · Pocket Andon`;
  el('status-block').className = `status-block bg-${station.status}`;
  el('station-name').textContent = station.name;
  el('status-label').textContent = STATUS_LABELS[station.status];
  el('status-reason').textContent = station.reason ?? '';
  el('status-note').textContent = station.note ?? '';
  el('status-timer').textContent = formatElapsed(station.status_since);
  document.querySelectorAll('[data-status]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.status === station.status));
  });
}

// A slow update response can land after a newer realtime change, so ignore older rows.
function applyRow(row) {
  if (station && Date.parse(row.updated_at) < Date.parse(station.updated_at)) return;
  station = row;
  renderStatus();
}

function openReasons(status) {
  pendingStatus = status;
  el('reason-title').textContent = `${STATUS_LABELS[status]}: what's the reason?`;
  el('reason-title').className = `reason-title bg-${status}`;
  el('status-buttons').hidden = true;
  el('reason-panel').hidden = false;
}

function closeReasons() {
  pendingStatus = null;
  el('note').value = '';
  el('reason-panel').hidden = true;
  el('status-buttons').hidden = false;
}

async function submit(status, reason, note) {
  allButtons().forEach((button) => { button.disabled = true; });
  const { data, error } = await supabase
    .from('stations')
    .update({ status, reason, note })
    .eq('id', id)
    .select()
    .maybeSingle();
  allButtons().forEach((button) => { button.disabled = false; });

  if (error) {
    showToast(`Update failed: ${error.message}`);
    return;
  }
  if (data) applyRow(data);
  closeReasons();
}

async function refresh() {
  const { data, error } = await supabase.from('stations').select('*').eq('id', id).maybeSingle();
  if (error) {
    showToast(`Could not load station: ${error.message}`);
    if (!station) showMessage('Could not load station');
    return false;
  }
  if (!data) {
    showMessage('Station not found');
    return false;
  }
  applyRow(data);
  el('message').hidden = true;
  el('station').hidden = false;
  return true;
}

document.querySelectorAll('[data-status]').forEach((button) => {
  button.addEventListener('click', () => {
    const { status } = button.dataset;
    if (status === 'green') submit('green', null, null);
    else openReasons(status);
  });
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    submit(pendingStatus, chip.textContent, el('note').value.trim() || null);
  });
});

el('cancel').addEventListener('click', closeReasons);

async function start() {
  if (id === null) {
    showMessage('Station not found');
    return;
  }
  if (!isConfigured) {
    showMessage(NOT_CONFIGURED_MESSAGE);
    return;
  }
  if (!(await refresh())) return;

  supabase
    .channel(`station-${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'stations', filter: `id=eq.${id}` },
      (payload) => applyRow(payload.new),
    )
    // Catches anything missed before the channel joined or while it was reconnecting.
    .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });

  // Phones suspend sockets while locked, so catch up when the page comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  setInterval(() => {
    el('status-timer').textContent = formatElapsed(station.status_since);
  }, 1000);
}

start();
