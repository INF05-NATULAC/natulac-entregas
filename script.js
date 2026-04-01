/**
 * ╔══════════════════════════════════════════════════════╗
 *  NATULAC PWA · script.js
 *  Frontend logic: Auth · Predictive Search · Geo · Forms
 * ╚══════════════════════════════════════════════════════╝
 *
 * ⚠️  CONFIGURACIÓN REQUERIDA:
 *     Reemplaza GAS_URL con la URL de tu Web App de Google Apps Script.
 *     Formato: https://script.google.com/macros/s/XXXXXX/exec
 */

'use strict';

// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN GLOBAL
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID_AQUI/exec',
  CLIENTES_CACHE_KEY: 'natulac_clientes_v1',
  SESSION_KEY: 'natulac_session_v1',
  QUEUE_KEY: 'natulac_queue_v1',      // Cola offline
  CACHE_TTL_MS: 1000 * 60 * 60 * 6,  // 6 horas
};

// ─────────────────────────────────────────────────────────────
//  ESTADO DE LA APLICACIÓN
// ─────────────────────────────────────────────────────────────
const State = {
  session: null,          // { cedula, nombre, rol }
  clientes: [],           // [{ id, nombre, rif, zona }]
  currentGeo: null,       // { lat, lng }
  geoWatchId: null,
  deferredInstall: null,  // PWA install prompt
};

// ─────────────────────────────────────────────────────────────
//  UTILIDADES UI
// ─────────────────────────────────────────────────────────────

/** Muestra un toast en pantalla */
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-msg toast-${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(110%)';
    toast.style.transition = 'all .3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** Muestra/oculta el loader global */
function setLoader(visible) {
  const el = document.getElementById('global-loader');
  if (visible) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

/** Activa una pantalla (screen-login / screen-app) */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

/** Activa una pestaña del app */
function showTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
  document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
}

// ─────────────────────────────────────────────────────────────
//  SERVICIO API
// ─────────────────────────────────────────────────────────────

/**
 * Realiza un GET al GAS endpoint con parámetros de query.
 * Manejo automático de errores de red.
 */
async function apiGet(params = {}) {
  const url = new URL(CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Realiza un POST al GAS endpoint con payload JSON.
 */
async function apiPost(payload = {}) {
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain' }, // Evita preflight CORS con text/plain
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────
//  AUTENTICACIÓN
// ─────────────────────────────────────────────────────────────

/** Carga sesión guardada en localStorage */
function loadSession() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Guarda sesión en localStorage */
function saveSession(session) {
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
}

/** Elimina sesión */
function clearSession() {
  localStorage.removeItem(CONFIG.SESSION_KEY);
}

/** Configura la UI según el rol del usuario */
function applyRoleUI(session) {
  const isAdmin = session.rol?.toLowerCase() === 'admin';

  // Badge de rol
  const badge = document.getElementById('role-badge');
  badge.textContent = session.rol || 'User';
  badge.className = `role-badge${isAdmin ? ' admin' : ''}`;

  // Nombre en header
  document.getElementById('header-user').textContent = session.nombre || session.cedula;

  // Mostrar tabs de admin
  if (isAdmin) {
    document.getElementById('tab-btn-registros').classList.remove('hidden-tab');
    document.getElementById('tab-btn-admin').classList.remove('hidden-tab');
  } else {
    document.getElementById('tab-btn-registros').classList.remove('hidden-tab'); // Users can see their own records too
    document.getElementById('tab-btn-admin').classList.add('hidden-tab');
  }
}

/** Lógica del botón Login */
async function handleLogin() {
  const cedula = document.getElementById('inp-cedula').value.trim();
  const clave  = document.getElementById('inp-clave').value;

  if (!cedula || !clave) {
    showToast('Ingresa cédula y clave.', 'error');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-ring" style="width:20px;height:20px;border-width:3px;margin:0 auto;"></span>';

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
  } catch (err) {
    // Modo offline: intentar con sesión anterior si existe
    const cached = loadSession();
    if (cached && cached.cedula === cedula) {
      State.session = cached;
      showToast('Sin conexión – sesión reanudada.', 'info');
      initApp();
    } else {
      showToast('Error de conexión. Verifica internet.', 'error');
      console.error(err);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Ingresar';
  }
}

// ─────────────────────────────────────────────────────────────
//  CARGA DE CLIENTES (Predictive Search Data)
// ─────────────────────────────────────────────────────────────

/** Obtiene la lista de clientes. Usa caché si es reciente. */
async function loadClientes(forceSync = false) {
  const raw = localStorage.getItem(CONFIG.CLIENTES_CACHE_KEY);
  if (raw && !forceSync) {
    const { data, timestamp } = JSON.parse(raw);
    const age = Date.now() - timestamp;
    if (age < CONFIG.CACHE_TTL_MS) {
      State.clientes = data;
      console.log(`[Clientes] Cargados desde caché (${data.length})`);
      return;
    }
  }

  try {
    const res = await apiGet({ action: 'getClientes' });
    if (res.ok && Array.isArray(res.data)) {
      State.clientes = res.data;
      localStorage.setItem(CONFIG.CLIENTES_CACHE_KEY, JSON.stringify({
        data: res.data,
        timestamp: Date.now(),
      }));
      console.log(`[Clientes] Sincronizados desde servidor (${res.data.length})`);
    }
  } catch (err) {
    // Usar caché aunque esté expirada
    if (raw) {
      State.clientes = JSON.parse(raw).data;
      showToast('Sin conexión – usando lista local de clientes.', 'info');
    } else {
      showToast('No se pudo cargar la lista de clientes.', 'error');
    }
    console.warn('[Clientes] Error de red:', err);
  }
}

// ─────────────────────────────────────────────────────────────
//  BÚSQUEDA PREDICTIVA DE CLIENTES
// ─────────────────────────────────────────────────────────────

(function setupAutocomplete() {
  // Se configura en initApp() cuando el DOM esté listo
})();

function initAutocomplete() {
  const input  = document.getElementById('inp-cliente');
  const list   = document.getElementById('autocomplete-list');
  const hidId  = document.getElementById('inp-cliente-id');
  const rifEl  = document.getElementById('inp-rif');
  const zonaEl = document.getElementById('inp-zona');

  let selectedIdx = -1;

  function renderList(query) {
    const q = query.toLowerCase().trim();
    list.innerHTML = '';
    selectedIdx = -1;

    if (!q || q.length < 2) {
      list.classList.remove('open');
      return;
    }

    // Filtrado local — O(n) instantáneo
    const matches = State.clientes
      .filter(c => c.nombre.toLowerCase().includes(q))
      .slice(0, 10);

    if (matches.length === 0) {
      list.innerHTML = '<div class="autocomplete-empty">Sin resultados</div>';
      list.classList.add('open');
      return;
    }

    matches.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.idx = i;
      // Resalta coincidencia
      const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const highlighted = c.nombre.replace(regex, '<mark>$1</mark>');
      item.innerHTML = `${highlighted} <span style="float:right;font-size:.75rem;color:#9ab8ae;">${c.zona || ''}</span>`;
      item.addEventListener('mousedown', () => selectCliente(c));
      list.appendChild(item);
    });

    list.classList.add('open');
    list._matches = matches;
  }

  function selectCliente(c) {
    input.value    = c.nombre;
    hidId.value    = c.id;
    rifEl.value    = c.rif  || '';
    zonaEl.value   = c.zona || '';
    list.classList.remove('open');
  }

  function clearCliente() {
    hidId.value  = '';
    rifEl.value  = '';
    zonaEl.value = '';
  }

  input.addEventListener('input', () => {
    clearCliente();
    renderList(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      const m = list._matches?.[selectedIdx];
      if (m) selectCliente(m);
      return;
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      return;
    }

    items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
    if (selectedIdx >= 0) items[selectedIdx].scrollIntoView({ block: 'nearest' });
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.classList.remove('open');
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  FACTURAS DINÁMICAS
// ─────────────────────────────────────────────────────────────

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
      <button class="btn-remove-factura" aria-label="Eliminar factura">
        <i class="bi bi-dash"></i>
      </button>`;
    wrap.querySelector('.btn-remove-factura').addEventListener('click', () => {
      wrap.remove();
    });
    container.appendChild(wrap);
    // Focus en el nuevo input
    wrap.querySelector('input').focus();
  });
}

/** Devuelve array de números de factura ingresados (no vacíos) */
function getFacturas() {
  return Array.from(document.querySelectorAll('.factura-input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
//  GEOLOCALIZACIÓN
// ─────────────────────────────────────────────────────────────

function initGeo() {
  const statusEl = document.getElementById('geo-status');
  const textEl   = document.getElementById('geo-text');

  if (!navigator.geolocation) {
    statusEl.className = 'geo-status fail mb-3';
    textEl.textContent = 'Geolocalización no disponible en este dispositivo.';
    return;
  }

  function onSuccess(pos) {
    State.currentGeo = {
      lat: pos.coords.latitude.toFixed(6),
      lng: pos.coords.longitude.toFixed(6),
      acc: Math.round(pos.coords.accuracy),
    };
    document.getElementById('inp-lat').value = State.currentGeo.lat;
    document.getElementById('inp-lng').value = State.currentGeo.lng;
    statusEl.className = 'geo-status ok mb-3';
    textEl.textContent = `GPS OK · ${State.currentGeo.lat}, ${State.currentGeo.lng} (±${State.currentGeo.acc}m)`;
  }

  function onError(err) {
    State.currentGeo = null;
    statusEl.className = 'geo-status fail mb-3';
    const msgs = {
      1: 'Permiso denegado. Activa la ubicación.',
      2: 'Ubicación no disponible.',
      3: 'Tiempo de espera agotado.',
    };
    textEl.textContent = msgs[err.code] || 'Error de geolocalización.';
  }

  // Actualización continua mientras la app está abierta
  State.geoWatchId = navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000,
  });
}

// ─────────────────────────────────────────────────────────────
//  FORMULARIO DE DESPACHO
// ─────────────────────────────────────────────────────────────

function initDespachoForm() {
  document.getElementById('btn-submit').addEventListener('click', handleSubmitDespacho);
}

async function handleSubmitDespacho() {
  // 1. Validaciones
  const cliente  = document.getElementById('inp-cliente').value.trim();
  const clienteId= document.getElementById('inp-cliente-id').value;
  const producto = document.getElementById('inp-producto').value.trim();
  const cantidad = document.getElementById('inp-cantidad').value.trim();
  const unidad   = document.getElementById('inp-unidad').value;
  const obs      = document.getElementById('inp-obs').value.trim();
  const facturas = getFacturas();

  if (!cliente)   { showToast('Selecciona un cliente de la lista.', 'error'); return; }
  if (!producto)  { showToast('Ingresa el producto o descripción.', 'error'); return; }
  if (!cantidad || Number(cantidad) < 1) { showToast('Cantidad inválida.', 'error'); return; }
  if (facturas.length === 0) { showToast('Agrega al menos un número de factura.', 'error'); return; }

  // 2. Captura automática de fecha y geo
  const now = new Date();
  const fecha = now.toLocaleString('es-VE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const lat = State.currentGeo?.lat || '';
  const lng = State.currentGeo?.lng || '';

  const payload = {
    action: 'saveDespacho',
    data: {
      fecha,
      transportistaCedula: State.session.cedula,
      transportistaNombre: State.session.nombre,
      clienteId,
      clienteNombre: cliente,
      rif: document.getElementById('inp-rif').value,
      zona: document.getElementById('inp-zona').value,
      producto,
      cantidad: Number(cantidad),
      unidad,
      facturas: facturas.join(' | '),
      observaciones: obs,
      lat,
      lng,
    },
  };

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-ring" style="width:20px;height:20px;border-width:3px;margin:0 auto;"></span>';

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
      // Guardar en cola offline
      enqueueOffline(payload);
      showToast('Sin conexión – Despacho guardado localmente. Se enviará cuando haya red.', 'info', 5000);
      resetDespachoForm();
    } else {
      showToast(`Error al enviar: ${err.message}`, 'error', 5000);
      console.error(err);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send-fill me-2"></i>Registrar Despacho';
  }
}

function resetDespachoForm() {
  ['inp-cliente','inp-producto','inp-cantidad','inp-obs','inp-cliente-id','inp-rif','inp-zona'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('inp-unidad').selectedIndex = 0;
  // Resetear facturas
  const container = document.getElementById('facturas-container');
  container.innerHTML = `
    <div class="factura-item">
      <input type="text" class="form-control factura-input" placeholder="N° Factura 1" />
    </div>`;
}

// ─────────────────────────────────────────────────────────────
//  COLA OFFLINE
// ─────────────────────────────────────────────────────────────

function enqueueOffline(payload) {
  const raw = localStorage.getItem(CONFIG.QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ payload, enqueuedAt: new Date().toISOString() });
  localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(queue));
}

async function flushOfflineQueue() {
  const raw = localStorage.getItem(CONFIG.QUEUE_KEY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  if (queue.length === 0) return;

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

  if (failed.length === 0) {
    showToast('Todos los despachos pendientes sincronizados.', 'success');
  } else {
    showToast(`${failed.length} despacho(s) no se pudieron enviar.`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
//  PANEL ADMIN
// ─────────────────────────────────────────────────────────────

async function loadRegistros() {
  const tbody = document.getElementById('registros-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#9ab8ae;">Cargando...</td></tr>';

  try {
    const res = await apiGet({ action: 'getRegistros', cedula: State.session.cedula, rol: State.session.rol });
    if (!res.ok || !Array.isArray(res.data)) throw new Error('Sin datos');

    if (res.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#9ab8ae;">Sin registros.</td></tr>';
      return;
    }

    tbody.innerHTML = res.data.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.fecha || '–'}</td>
        <td>${r.clienteNombre || '–'}</td>
        <td>${r.producto || '–'}</td>
        <td>${r.cantidad || '–'} ${r.unidad || ''}</td>
        <td>${r.facturas || '–'}</td>
        <td>${r.transportistaNombre || r.transportistaCedula || '–'}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#e84545;">Error al cargar registros.</td></tr>';
    console.error(err);
  }
}

async function loadAdminData() {
  // Sync clientes table
  const cBody = document.getElementById('clientes-body');
  cBody.innerHTML = State.clientes.length
    ? State.clientes.map(c => `<tr><td>${c.id}</td><td>${c.nombre}</td><td>${c.rif||'–'}</td><td>${c.zona||'–'}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;padding:2rem;color:#9ab8ae;">–</td></tr>';

  // Stats
  try {
    const res = await apiGet({ action: 'getStats' });
    if (res.ok) {
      document.getElementById('stats-row').innerHTML = `
        <div class="stat-card"><div class="val">${res.totalDespachos ?? '–'}</div><div class="lbl">Despachos</div></div>
        <div class="stat-card"><div class="val">${res.totalClientes ?? '–'}</div><div class="lbl">Clientes</div></div>
        <div class="stat-card"><div class="val">${res.totalUsuarios ?? '–'}</div><div class="lbl">Usuarios</div></div>
        <div class="stat-card"><div class="val">${res.hoy ?? '–'}</div><div class="lbl">Hoy</div></div>`;
    }
  } catch { /* silently skip stats */ }

  // Usuarios
  try {
    const res = await apiGet({ action: 'getUsuarios' });
    const uBody = document.getElementById('usuarios-body');
    if (res.ok && res.data?.length) {
      uBody.innerHTML = res.data.map(u =>
        `<tr><td>${u.cedula}</td><td>${u.nombre}</td><td><span class="badge-ok">${u.rol}</span></td></tr>`
      ).join('');
    }
  } catch { /* skip */ }
}

// ─────────────────────────────────────────────────────────────
//  INIT APP (post-login)
// ─────────────────────────────────────────────────────────────

async function initApp() {
  showScreen('screen-app');
  applyRoleUI(State.session);
  showTab('despacho');

  // Cargar clientes en background
  loadClientes().then(() => {
    initAutocomplete();
  });

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

  // Sync button (admin)
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
    document.getElementById('inp-clave').value = '';
  });

  // Flush pending queue
  flushOfflineQueue();
}

// ─────────────────────────────────────────────────────────────
//  ONLINE / OFFLINE EVENTS
// ─────────────────────────────────────────────────────────────

window.addEventListener('online', () => {
  document.getElementById('offline-banner').classList.remove('show');
  if (State.session) flushOfflineQueue();
});

window.addEventListener('offline', () => {
  document.getElementById('offline-banner').classList.add('show');
});

if (!navigator.onLine) {
  document.getElementById('offline-banner').classList.add('show');
}

// ─────────────────────────────────────────────────────────────
//  PWA INSTALL PROMPT
// ─────────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  State.deferredInstall = e;
  const banner = document.getElementById('install-banner');
  banner.classList.add('show');
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

// ─────────────────────────────────────────────────────────────
//  SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] Registrado:', reg.scope))
      .catch(err => console.error('[SW] Error:', err));
  });
}

// ─────────────────────────────────────────────────────────────
//  BOOTSTRAP — Punto de entrada
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Ocultar loader
  setTimeout(() => setLoader(false), 800);

  // Restaurar sesión si existe
  const session = loadSession();
  if (session) {
    State.session = session;
    initApp();
  } else {
    showScreen('screen-login');
    // Bind login
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('inp-clave').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }
});
