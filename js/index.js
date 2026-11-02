import { supabase, isConfigured, STATUS_LABELS, NOT_CONFIGURED_MESSAGE, showToast } from './supabase.js';

function renderQr() {
  if (!window.QRCode) return;
  new window.QRCode(document.getElementById('qr'), {
    text: `${location.origin}/`, width: 160, height: 160,
  });
}

function buildLink(station) {
  const link = document.createElement('a');
  link.className = 'station-link';
  link.href = `/station?id=${station.id}`;

  const name = document.createElement('span');
  name.textContent = station.name;

  const status = document.createElement('span');
  status.className = `pill bg-${station.status}`;
  status.textContent = STATUS_LABELS[station.status];

  link.append(name, status);
  return link;
}

async function start() {
  renderQr();
  if (!isConfigured) {
    showToast(NOT_CONFIGURED_MESSAGE);
    return;
  }
  const { data, error } = await supabase.from('stations').select('*').order('position');
  if (error) {
    showToast(`Could not load stations: ${error.message}`);
    return;
  }
  document.getElementById('stations').replaceChildren(...data.map(buildLink));
}

start();
