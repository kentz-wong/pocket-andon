import {
  supabase, isConfigured, STATUS_LABELS, NOT_CONFIGURED_MESSAGE,
  formatDuration, formatElapsed, showToast,
} from './supabase.js';

const FEED_SIZE = 10;
const BOARD_TITLE = 'Board · Pocket Andon';

const el = (id) => document.getElementById(id);

const stations = new Map();
const downtime = new Map();
let events = [];
let titleFlash = false;
let wasDisconnected = false;
let refreshTimer = null;

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function buildTile(station) {
  const tile = document.createElement('article');
  tile.className = `tile bg-${station.status}`;
  tile.dataset.stationId = station.id;

  const timer = textEl('p', 'tile-timer', formatElapsed(station.status_since));
  timer.dataset.since = station.status_since;

  tile.append(
    textEl('h2', 'tile-name', station.name),
    textEl('p', 'tile-status', STATUS_LABELS[station.status]),
    timer,
  );
  if (station.reason) tile.append(textEl('p', 'tile-reason', station.reason));
  if (station.note) tile.append(textEl('p', 'tile-note', station.note));

  const today = downtime.get(station.id);
  const seconds = today?.downtime_seconds ?? 0;
  const reds = today?.red_count ?? 0;
  tile.append(textEl('p', 'tile-downtime', `Down today ${formatDuration(seconds)} · ${reds}× red`));
  return tile;
}

function renderSummary() {
  const counts = { green: 0, yellow: 0, red: 0 };
  stations.forEach((station) => { counts[station.status] += 1; });
  Object.entries(counts).forEach(([status, count]) => {
    el(`count-${status}`).textContent = count;
  });
}

function renderGrid() {
  el('grid').replaceChildren(...[...stations.values()].map(buildTile));
  renderSummary();
}

function renderTile(station) {
  const existing = el('grid').querySelector(`[data-station-id="${station.id}"]`);
  if (existing) existing.replaceWith(buildTile(station));
}

function renderFeed() {
  const items = events.map((event) => {
    const name = stations.get(event.station_id)?.name ?? `Station ${event.station_id}`;
    const time = new Date(event.created_at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = [`${name} → ${event.to_status.toUpperCase()}`, event.reason, time].filter(Boolean);
    return textEl('li', `feed-item border-${event.to_status}`, parts.join(' · '));
  });
  el('feed').replaceChildren(...items);
}

function tick() {
  document.querySelectorAll('.tile-timer').forEach((timer) => {
    timer.textContent = formatElapsed(timer.dataset.since);
  });

  const reds = [...stations.values()].filter((station) => station.status === 'red');
  titleFlash = !titleFlash;
  document.title = reds.length && titleFlash
    ? `🔴 ${reds.map((station) => station.name).join(', ')} DOWN`
    : BOARD_TITLE;
}

async function fetchDowntime() {
  const { data, error } = await supabase.from('station_downtime_today').select('*');
  if (error) throw error;
  downtime.clear();
  data.forEach((row) => downtime.set(row.station_id, row));
}

async function fetchEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(FEED_SIZE);
  if (error) throw error;
  events = data;
}

async function loadAll() {
  const [{ data, error }] = await Promise.all([
    supabase.from('stations').select('*').order('position'),
    fetchDowntime(),
    fetchEvents(),
  ]);
  if (error) throw error;
  stations.clear();
  data.forEach((station) => stations.set(station.id, station));
  renderGrid();
  renderFeed();
}

// Bursts of events (several operators, or a reset) collapse into one re-fetch.
function scheduleRefresh({ withFeed }) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await Promise.all(withFeed ? [fetchDowntime(), fetchEvents()] : [fetchDowntime()]);
      renderGrid();
      renderFeed();
    } catch (error) {
      showToast(`Could not refresh: ${error.message}`);
    }
  }, 250);
}

function onStationUpdate(payload) {
  const station = { ...stations.get(payload.new.id), ...payload.new };
  stations.set(station.id, station);
  renderTile(station);
  renderSummary();
}

function onEventInsert(payload) {
  if (events.some((event) => event.id === payload.new.id)) return;
  events = [payload.new, ...events].slice(0, FEED_SIZE);
  renderFeed();
  scheduleRefresh({ withFeed: false });
}

function subscribe() {
  supabase
    .channel('board')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stations' }, onStationUpdate)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, onEventInsert)
    // A reset on another screen deletes events, which an INSERT listener alone would never see.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'events' }, () => {
      scheduleRefresh({ withFeed: true });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        el('reconnecting').hidden = true;
        if (wasDisconnected) {
          wasDisconnected = false;
          loadAll().catch((error) => showToast(`Could not refresh: ${error.message}`));
        }
      } else {
        wasDisconnected = true;
        el('reconnecting').hidden = false;
      }
    });
}

function renderQr() {
  if (!window.QRCode) return;
  new window.QRCode(el('qr'), { text: `${location.origin}/`, width: 160, height: 160 });
}

el('reset').addEventListener('click', async () => {
  if (!window.confirm('Reset all stations to green and clear all events?')) return;
  el('reset').disabled = true;
  const { error } = await supabase.rpc('reset_demo');
  el('reset').disabled = false;
  if (error) showToast(`Reset failed: ${error.message}`);
  else scheduleRefresh({ withFeed: true });
});

async function start() {
  renderQr();
  if (!isConfigured) {
    showToast(NOT_CONFIGURED_MESSAGE);
    return;
  }
  try {
    await loadAll();
  } catch (error) {
    showToast(`Could not load board: ${error.message}`);
  }
  subscribe();
  setInterval(tick, 1000);
}

start();
