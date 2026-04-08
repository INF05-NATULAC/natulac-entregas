/**
 * ╔══════════════════════════════════════════════════════╗
 *  NATULAC PWA · script.js  v1.1
 * ╚══════════════════════════════════════════════════════╝
 * Cambios v1.1:
 *  - Paleta de colores azul Natulac
 *  - Formulario de despacho simplificado (solo observaciones)
 *  - Link a Google Maps en la tabla de registros
 */

'use strict';

// ─────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ─────────────────────────────────────────────────────────
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyrBJanjqKYykMfoMbVjU2KhnadZoYflmdozq5mZ6aY5IgmGQGdebNvBZZ_p_CUEEaZCQ/exec',
  CLIENTES_CACHE_KEY: 'natulac_clientes_v1',
  SESSION_KEY:        'natulac_session_v1',
  QUEUE_KEY:          'natulac_queue_v1',
  CACHE_TTL_MS:       1000 * 60 * 60 * 6,  // 6 horas
};

// ─────────────────────────────────────────────────────────
//  ESTADO
// ─────────────────────────────────────────────────────────
const State = {
  session:         null,
  clientes:        [],
  currentGeo:      null,
  geoWatchId:      null,
  deferredInstall: null,
};

// ─────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────

function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast-msg toast-${type}`;
  el.innerHTML = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'all .3s ease';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(110%)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function setLoader(visible) {
  document.getElementById('global-loader').classList.toggle('hidden', !visible);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
}

// ─────────────────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────────────────

async function apiGet(params = {}) {
  const url = new URL(CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(payload = {}) {
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────

function loadSession()      { try { const r = localStorage.getItem(CONFIG.SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveSession(s)     { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s)); }
function clearSession()     { localStorage.removeItem(CONFIG.SESSION_KEY); }

function applyRoleUI(session) {
  const isAdmin = session.rol?.toLowerCase() === 'admin';
  const badge   = document.getElementById('role-badge');
  badge.textContent = session.rol || 'User';
  badge.className   = `role-badge${isAdmin ? ' admin' : ''}`;
  document.getElementById('header-user').textContent = session.nombre || session.cedula;

  document.getElementById('tab-btn-registros').classList.remove('hidden-tab');
  if (isAdmin) document.getElementById('tab-btn-admin').classList.remove('hidden-tab');
  else         document.getElementById('tab-btn-admin').classList.add('hidden-tab');
}

async function handleLogin() {
  const cedula = document.getElementById('inp-cedula').value.trim();
  const clave  = document.getElementById('inp-clave').value;
  if (!cedula || !clave) { showToast('Ingresa cédula y clave.', 'error'); return; }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-ring" style="width:20px;height:20px;border-width:3px;margin:0 auto;display:block;"></span>';

  try {
    const res = await apiGet({ action: 'login', cedula, clave });
    if (res.ok) {
      const session = { cedula, nombre: res.nombre, rol: res.rol };
      State.session = session;
      saveSession(session);
      initApp();
    } else {
      showToast(res.mensaje || 'Credenciales incorrectas.', 'error');
    }
  } catch {
    const cached = loadSession();
    if (cached && cached.cedula === cedula) {
      State.session = cached;
      showToast('Sin conexión – sesión reanudada.', 'info');
      initApp();
    } else {
      showToast('Error de conexión. Verifica internet.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Ingresar';
  }
}

// ─────────────────────────────────────────────────────────
//  CLIENTES
// ─────────────────────────────────────────────────────────

async function loadClientes(forceSync = false) {
  const raw = localStorage.getItem(CONFIG.CLIENTES_CACHE_KEY);
  if (raw && !forceSync) {
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < CONFIG.CACHE_TTL_MS) {
      State.clientes = data;
      return;
    }
  }
  try {
    const res = await apiGet({ action: 'getClientes' });
    if (res.ok && Array.isArray(res.data)) {
      State.clientes = res.data;
      localStorage.setItem(CONFIG.CLIENTES_CACHE_KEY, JSON.stringify({ data: res.data, timestamp: Date.now() }));
    }
  } catch {
    if (raw) { State.clientes = JSON.parse(raw).data; showToast('Sin conexión – lista de clientes local.', 'info'); }
    else showToast('No se pudo cargar la lista de clientes.', 'error');
  }
}

// ─────────────────────────────────────────────────────────
//  AUTOCOMPLETE
// ─────────────────────────────────────────────────────────

function initAutocomplete() {
  const input  = document.getElementById('inp-cliente');
  const list   = document.getElementById('autocomplete-list');
  const hidId  = document.getElementById('inp-cliente-id');
  const rifEl  = document.getElementById('inp-rif');
  const zonaEl = document.getElementById('inp-zona');
  let selectedIdx = -1;

  function renderList(q) {
    q = q.toLowerCase().trim();
    list.innerHTML = '';
    selectedIdx = -1;
    if (!q || q.length < 2) { list.classList.remove('open'); return; }

    const matches = State.clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 10);
    if (!matches.length) {
      list.innerHTML = '<div class="autocomplete-empty">Sin resultados</div>';
      list.classList.add('open');
      return;
    }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    matches.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.idx = i;
      item.innerHTML = `${c.nombre.replace(re, '<mark>$1</mark>')} <span style="float:right;font-size:.75rem;color:#8fa8d0;">${c.zona || ''}</span>`;
      item.addEventListener('mousedown', () => select(c));
      list.appendChild(item);
    });
    list.classList.add('open');
    list._matches = matches;
  }

  function select(c) {
    input.value  = c.nombre;
    hidId.value  = c.id;
    rifEl.value  = c.rif  || '';
    zonaEl.value = c.zona || '';
    list.classList.remove('open');
  }

  input.addEventListener('input',   () => { hidId.value = rifEl.value = zonaEl.value = ''; renderList(input.value); });
  document.addEventListener('click', e => { if (!input.contains(e.target) && !list.contains(e.target)) list.classList.remove('open'); });
  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); }
    else if (e.key === 'Enter' && selectedIdx >= 0) { e.preventDefault(); select(list._matches[selectedIdx]); return; }
    else if (e.key === 'Escape') { list.classList.remove('open'); return; }
    items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
    if (selectedIdx >= 0) items[selectedIdx].scrollIntoView({ block: 'nearest' });
  });
}

// ─────────────────────────────────────────────────────────
//  FACTURAS DINÁMICAS
// ─────────────────────────────────────────────────────────

function initFacturas() {
  const container = document.getElementById('facturas-container');
  const btnAdd    = document.getElementById('btn-add-factura');
  let count = 1;

  btnAdd.addEventListener('click', () => {
    count++;
    const wrap = document.createElement('div');
    wrap.className = 'factura-item';
    wrap.innerHTML = `
      <input type="text" class="form-control factura-input" placeholder="N° Factura ${count}" />
      <button class="btn-remove-factura" aria-label="Eliminar">
        <i class="bi bi-dash"></i>
      </button>`;
    wrap.querySelector('.btn-remove-factura').addEventListener('click', () => wrap.remove());
    container.appendChild(wrap);
    wrap.querySelector('input').focus();
  });
}

function getFacturas() {
  return Array.from(document.querySelectorAll('.factura-input'))
    .map(i => i.value.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────
//  GEOLOCALIZACIÓN
// ─────────────────────────────────────────────────────────

function initGeo() {
  const statusEl = document.getElementById('geo-status');
  const textEl   = document.getElementById('geo-text');

  if (!navigator.geolocation) {
    statusEl.className = 'geo-status fail mb-3';
    textEl.textContent = 'Geolocalización no disponible en este dispositivo.';
    return;
  }

  State.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      State.currentGeo = {
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        acc: Math.round(pos.coords.accuracy),
      };
      document.getElementById('inp-lat').value = State.currentGeo.lat;
      document.getElementById('inp-lng').value = State.currentGeo.lng;
      statusEl.className = 'geo-status ok mb-3';
      textEl.textContent  = `GPS OK · ${State.currentGeo.lat}, ${State.currentGeo.lng} (±${State.currentGeo.acc}m)`;
    },
    (err) => {
      State.currentGeo = null;
      statusEl.className = 'geo-status fail mb-3';
      textEl.textContent = { 1: 'Permiso denegado. Activa la ubicación.', 2: 'Posición no disponible.', 3: 'Tiempo de espera agotado.' }[err.code] || 'Error de geolocalización.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// ─────────────────────────────────────────────────────────
//  FORMULARIO DE DESPACHO
// ─────────────────────────────────────────────────────────

function initDespachoForm() {
  document.getElementById('btn-submit').addEventListener('click', handleSubmitDespacho);
}

async function handleSubmitDespacho() {
  const cliente   = document.getElementById('inp-cliente').value.trim();
  const clienteId = document.getElementById('inp-cliente-id').value;
  const obs       = document.getElementById('inp-obs').value.trim();
  const facturas  = getFacturas();

  if (!cliente)               { showToast('Selecciona un cliente de la lista.', 'error'); return; }
  if (!obs)                   { showToast('Agrega una observación del despacho.', 'error'); return; }
  if (!facturas.length)       { showToast('Ingresa al menos un número de factura.', 'error'); return; }

  // Captura automática
  const now   = new Date();
  const fecha = now.toLocaleString('es-VE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  const lat   = State.currentGeo?.lat || '';
  const lng   = State.currentGeo?.lng || '';

  const payload = {
    action: 'saveDespacho',
    data: {
      fecha,
      transportistaCedula: State.session.cedula,
      transportistaNombre: State.session.nombre,
      clienteId,
      clienteNombre:  cliente,
      rif:            document.getElementById('inp-rif').value,
      zona:           document.getElementById('inp-zona').value,
      facturas:       facturas.join(' | '),
      observaciones:  obs,
      lat,
      lng,
    },
  };

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-ring" style="width:20px;height:20px;border-width:3px;margin:0 auto;display:block;"></span>';

  try {
    if (!navigator.onLine) throw new Error('offline');
    const res = await apiPost(payload);
    if (res.ok) {
      showToast('<i class="bi bi-check-circle-fill me-1"></i>Despacho registrado exitosamente.', 'success', 4000);
      resetDespachoForm();
    } else {
      throw new Error(res.mensaje || 'Error del servidor');
    }
  } catch (err) {
    if (err.message === 'offline' || !navigator.onLine) {
      enqueueOffline(payload);
      showToast('Sin conexión – Despacho guardado localmente. Se enviará cuando vuelva la red.', 'info', 5000);
      resetDespachoForm();
    } else {
      showToast(`Error al enviar: ${err.message}`, 'error', 5000);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send-fill me-2"></i>Registrar Despacho';
  }
}

function resetDespachoForm() {
  ['inp-cliente','inp-obs','inp-cliente-id','inp-rif','inp-zona'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('facturas-container').innerHTML = `
    <div class="factura-item">
      <input type="text" class="form-control factura-input" placeholder="N° Factura 1" />
    </div>`;
}

// ─────────────────────────────────────────────────────────
//  COLA OFFLINE
// ─────────────────────────────────────────────────────────

function enqueueOffline(payload) {
  const raw   = localStorage.getItem(CONFIG.QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ payload, enqueuedAt: new Date().toISOString() });
  localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(queue));
}

async function flushOfflineQueue() {
  const raw = localStorage.getItem(CONFIG.QUEUE_KEY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  if (!queue.length) return;

  showToast(`Enviando ${queue.length} despacho(s) pendiente(s)...`, 'info', 3000);
  const failed = [];
  for (const item of queue) {
    try {
      const res = await apiPost(item.payload);
      if (!res.ok) throw new Error(res.mensaje);
    } catch {
      failed.push(item);
    }
  }
  localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(failed));
  if (!failed.length) showToast('Todos los despachos pendientes sincronizados.', 'success');
  else showToast(`${failed.length} despacho(s) no se pudieron enviar.`, 'error');
}

// ─────────────────────────────────────────────────────────
//  REGISTROS  ←  incluye link a Google Maps
// ─────────────────────────────────────────────────────────

async function loadRegistros() {
  const tbody = document.getElementById('registros-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#8fa8d0;">Cargando...</td></tr>';

  try {
    const res = await apiGet({ action: 'getRegistros', cedula: State.session.cedula, rol: State.session.rol });
    if (!res.ok || !Array.isArray(res.data)) throw new Error();

    if (!res.data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#8fa8d0;">Sin registros.</td></tr>';
      return;
    }

    tbody.innerHTML = res.data.map((r, i) => {
      // Genera link a Google Maps si hay coordenadas
      const mapsCell = (r.lat && r.lng)
        ? `<a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener" class="maps-link">
             <i class="bi bi-geo-alt-fill"></i>${r.lat}, ${r.lng}
           </a>`
        : '<span style="color:#c0d0e8;">–</span>';

      return `<tr>
        <td>${i + 1}</td>
        <td>${r.fecha || '–'}</td>
        <td>${r.clienteNombre || '–'}</td>
        <td>${r.facturas || '–'}</td>
        <td style="max-width:180px;white-space:normal;word-break:break-word;">${r.observaciones || '–'}</td>
        <td>${mapsCell}</td>
        <td>${r.transportistaNombre || r.transportistaCedula || '–'}</td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#e84545;">Error al cargar registros.</td></tr>';
  }
}

// ─────────────────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────────────────

async function loadAdminData() {
  // Tabla clientes
  const cBody = document.getElementById('clientes-body');
  cBody.innerHTML = State.clientes.length
    ? State.clientes.map(c => `<tr><td>${c.id}</td><td>${c.nombre}</td><td>${c.rif||'–'}</td><td>${c.zona||'–'}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;padding:2rem;color:#8fa8d0;">–</td></tr>';

  // Stats
  try {
    const res = await apiGet({ action: 'getStats' });
    if (res.ok) {
      document.getElementById('stats-row').innerHTML = `
        <div class="stat-card"><div class="val">${res.totalDespachos ?? '–'}</div><div class="lbl">Despachos</div></div>
        <div class="stat-card"><div class="val">${res.totalClientes  ?? '–'}</div><div class="lbl">Clientes</div></div>
        <div class="stat-card"><div class="val">${res.totalUsuarios  ?? '–'}</div><div class="lbl">Usuarios</div></div>
        <div class="stat-card"><div class="val">${res.hoy            ?? '–'}</div><div class="lbl">Hoy</div></div>`;
    }
  } catch { /* silencioso */ }

  // Usuarios
  try {
    const res = await apiGet({ action: 'getUsuarios' });
    const uBody = document.getElementById('usuarios-body');
    if (res.ok && res.data?.length) {
      uBody.innerHTML = res.data.map(u =>
        `<tr><td>${u.cedula}</td><td>${u.nombre}</td><td><span class="badge-ok">${u.rol}</span></td></tr>`
      ).join('');
    }
  } catch { /* silencioso */ }
}

// ─────────────────────────────────────────────────────────
//  INIT APP
// ─────────────────────────────────────────────────────────

async function initApp() {
  showScreen('screen-app');
  applyRoleUI(State.session);
  showTab('despacho');

  loadClientes().then(() => initAutocomplete());
  initGeo();
  initFacturas();
  initDespachoForm();

  // Tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === 'registros') loadRegistros();
      if (tab === 'admin' && State.session.rol?.toLowerCase() === 'admin') loadAdminData();
    });
  });

  // Sync button
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-ring" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:.4rem;"></span>Sincronizando…';
    await loadClientes(true);
    loadAdminData();
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Sincronizar Clientes';
    showToast(`Clientes actualizados (${State.clientes.length}).`, 'success');
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión?')) return;
    clearSession();
    if (State.geoWatchId) navigator.geolocation.clearWatch(State.geoWatchId);
    State.session = null;
    State.clientes = [];
    showScreen('screen-login');
    document.getElementById('inp-cedula').value = '';
    document.getElementById('inp-clave').value  = '';
  });

  flushOfflineQueue();
}

// ─────────────────────────────────────────────────────────
//  ONLINE / OFFLINE
// ─────────────────────────────────────────────────────────

window.addEventListener('online',  () => { document.getElementById('offline-banner').classList.remove('show'); if (State.session) flushOfflineQueue(); });
window.addEventListener('offline', () => { document.getElementById('offline-banner').classList.add('show'); });
if (!navigator.onLine) document.getElementById('offline-banner').classList.add('show');

// ─────────────────────────────────────────────────────────
//  PWA INSTALL
// ─────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  State.deferredInstall = e;
  document.getElementById('install-banner').classList.add('show');
});
document.getElementById('btn-install').addEventListener('click', async () => {
  if (!State.deferredInstall) return;
  State.deferredInstall.prompt();
  const { outcome } = await State.deferredInstall.userChoice;
  if (outcome === 'accepted') showToast('¡App instalada correctamente!', 'success');
  State.deferredInstall = null;
  document.getElementById('install-banner').classList.remove('show');
});
document.getElementById('btn-dismiss-install').addEventListener('click', () => {
  document.getElementById('install-banner').classList.remove('show');
});
window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner').classList.remove('show');
  showToast('Natulac instalada en tu dispositivo.', 'success');
});

// Service worker: escucha mensajes de sync background
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SYNC_QUEUE' && State.session) flushOfflineQueue();
  });
}

// ─────────────────────────────────────────────────────────
//  SERVICE WORKER
// ─────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(r  => console.log('[SW] Registrado:', r.scope))
      .catch(e => console.error('[SW] Error:', e));
  });
}

// ─────────────────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setTimeout(() => setLoader(false), 800);

  const session = loadSession();
  if (session) {
    State.session = session;
    initApp();
  } else {
    showScreen('screen-login');
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('inp-clave').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  }
});
