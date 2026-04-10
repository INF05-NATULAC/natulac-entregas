/**
 * NATULAC PWA · script.js  v1.2
 * Cambios:
 *  - Zona eliminada del formulario de despacho
 *  - Panel Admin separado en tabs: Clientes / Usuarios
 *  - CRUD: agregar y eliminar clientes desde la app
 *  - CRUD: agregar y eliminar usuarios desde la app
 */

'use strict';

// ─────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ─────────────────────────────────────────────────────────
const CONFIG = {
  GAS_URL:            'https://script.google.com/macros/s/AKfycbxJCYchEwueAiqfpDkM7YRwQw_ayZt3540cM39UV86s5qylhEzVZCgkXMTcMOOUlwRK5A/exec',
  CLIENTES_CACHE_KEY: 'natulac_clientes_v1',
  USERS_CACHE_KEY:    'natulac_users_v1',
  SESSION_KEY:        'natulac_session_v1',
  QUEUE_KEY:          'natulac_queue_v1',
  CACHE_TTL_MS:       1000 * 60 * 60 * 6,
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
  isOffline:       false,
  lastOfflineToast: 0,
  lastStateChange:  Date.now(),
  consecutiveFailures: 0,
};

// ─────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────

function showToast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast-msg toast-${type}`;
  el.innerHTML = msg;
  document.getElementById('toast-container').appendChild(el);
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

function setBtnLoading(btn, loading, originalHTML) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-ring" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:.3rem;"></span>Guardando…';
  } else {
    btn.innerHTML = originalHTML || btn.dataset.original || btn.innerHTML;
  }
}

// ─────────────────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────────────────

async function apiGet(params = {}, timeout = 30000) {
  if (!navigator.onLine) {
    throw new Error('offline');
  }

  const url = new URL(CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url.toString(), { method: 'GET', mode: 'cors', signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 503 || res.status === 504 || res.status === 408) throw new Error('Servidor saturado (503/504). Reintenta.');
    if (!res.ok) throw new Error(`Error de Servidor (HTTP ${res.status})`);

    const data = await res.json();
    State.consecutiveFailures = 0;
    setOnlineUI(true);
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (isOfflineError(err)) {
      State.consecutiveFailures++;
      if (!navigator.onLine || State.consecutiveFailures >= 2) {
        setOnlineUI(false);
      }
      throw new Error('offline');
    }
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado. Reintenta.');
    if (err.name === 'SyntaxError') throw new Error('El servidor envió una respuesta inválida.');
    throw err;
  }
}

async function apiPost(payload = {}, timeout = 30000) {
  if (!navigator.onLine) {
    throw new Error('offline');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(CONFIG.GAS_URL, {
      method:  'POST',
      mode:    'cors',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(payload),
      signal:  controller.signal
    });
    clearTimeout(timer);

    if (res.status === 503 || res.status === 504 || res.status === 408) throw new Error('Servidor saturado. Reintenta.');
    if (!res.ok) throw new Error(`Error de Servidor (HTTP ${res.status})`);

    const data = await res.json();
    State.consecutiveFailures = 0;
    setOnlineUI(true);
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (isOfflineError(err)) {
      State.consecutiveFailures++;
      if (!navigator.onLine || State.consecutiveFailures >= 2) {
        setOnlineUI(false);
      }
      throw new Error('offline');
    }
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado.');
    if (err.name === 'SyntaxError') throw new Error('Respuesta de servidor inválida.');
    throw err;
  }
}

function isOfflineError(err) {
  const msg = (err.message || '').toLowerCase();
  const name = (err.name || '');
  return !navigator.onLine ||
         name === 'AbortError' ||
         name === 'TypeError' ||
         msg.includes('fetch') ||
         msg.includes('network') ||
         msg === 'offline';
}

// ─────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────

function loadSession()  { try { const r = localStorage.getItem(CONFIG.SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveSession(s) { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(CONFIG.SESSION_KEY); }

// Cache de usuarios para login offline
function getUsersCache() { try { const r = localStorage.getItem(CONFIG.USERS_CACHE_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; } }
function saveUserToCache(cedula, clave, nombre, rol) {
  const users = getUsersCache();
  users[cedula] = { clave, nombre, rol };
  localStorage.setItem(CONFIG.USERS_CACHE_KEY, JSON.stringify(users));
}
function checkUserCache(cedula, clave) {
  const users = getUsersCache();
  const u = users[cedula];
  return (u && u.clave === clave) ? { cedula, nombre: u.nombre, rol: u.rol } : null;
}

function applyRoleUI(session) {
  const isAdmin = session.rol?.toLowerCase() === 'admin';
  const badge   = document.getElementById('role-badge');
  badge.textContent = session.rol || 'User';
  badge.className   = `role-badge${isAdmin ? ' admin' : ''}`;
  document.getElementById('header-user').textContent = session.nombre || session.cedula;

  // Todos ven Registros; solo Admin ve Clientes y Usuarios
  document.getElementById('tab-btn-registros').classList.remove('hidden-tab');
  ['tab-btn-clientes', 'tab-btn-usuarios'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden-tab', !isAdmin);
  });
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
      saveUserToCache(cedula, clave, res.nombre, res.rol); // Guardar para offline
      initApp();
    } else {
      showToast(res.mensaje || 'Credenciales incorrectas.', 'error');
    }
  } catch (err) {
    const isOffline = (err.message === 'offline');
    const offlineUser = checkUserCache(cedula, clave);

    if (isOffline && offlineUser) {
      State.session = offlineUser;
      saveSession(offlineUser);
      showToast('Modo offline: sesión iniciada con credenciales locales.', 'info');
      initApp();
    } else if (isOffline) {
      showToast('Sin conexión y no hay datos locales para este usuario.', 'error');
    } else {
      showToast(err.message || 'Error de conexión con el servidor.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Ingresar';
  }
}

// ─────────────────────────────────────────────────────────
//  CLIENTES — carga y caché
// ─────────────────────────────────────────────────────────

async function loadClientes(forceSync = false) {
  const raw = localStorage.getItem(CONFIG.CLIENTES_CACHE_KEY);

  // 1. Cargar desde cache inmediatamente para que la búsqueda funcione ya
  if (raw) {
    try {
      const { data } = JSON.parse(raw);
      State.clientes = data;
    } catch(e) {}
  }

  // 2. Si estamos offline y tenemos datos, no hacemos nada más
  if (!navigator.onLine && State.clientes.length > 0) return;

  // 3. Intentar actualizar en segundo plano o si se fuerza
  try {
    const res = await apiGet({ action: 'getClientes' });
    if (res.ok && Array.isArray(res.data)) {
      State.clientes = res.data;
      localStorage.setItem(CONFIG.CLIENTES_CACHE_KEY, JSON.stringify({ data: res.data, timestamp: Date.now() }));
      console.log('Clientes sincronizados:', State.clientes.length);
    }
  } catch (err) {
    console.warn('No se pudo actualizar la lista de clientes (offline).');
  }
}

// ─────────────────────────────────────────────────────────
//  AUTOCOMPLETE (despacho)
// ─────────────────────────────────────────────────────────

function initAutocomplete() {
  const input  = document.getElementById('inp-cliente');
  const list   = document.getElementById('autocomplete-list');
  const hidId  = document.getElementById('inp-cliente-id');
  const rifEl  = document.getElementById('inp-rif');

  if (!input || input.dataset.initialized) return;
  input.dataset.initialized = 'true';

  let selectedIdx = -1;

  function renderList(q) {
    q = q.toLowerCase().trim();
    list.innerHTML = ''; selectedIdx = -1;
    if (!q || q.length < 1) { list.classList.remove('open'); return; }

    const matches = State.clientes.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.rif || '').toLowerCase().includes(q)
    ).slice(0, 15);

    if (!matches.length) {
      list.innerHTML = '<div class="autocomplete-empty">Sin resultados</div>';
      list.classList.add('open'); return;
    }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    matches.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.idx = i;
      const subtext = c.rif ? ` <small class="text-muted">(${c.rif})</small>` : '';
      item.innerHTML = c.nombre.replace(re, '<mark>$1</mark>') + subtext;
      item.addEventListener('mousedown', () => select(c));
      list.appendChild(item);
    });
    list.classList.add('open');
    list._matches = matches;
  }

  function select(c) {
    input.value = c.nombre;
    hidId.value = c.id;
    rifEl.value = c.rif || '';
    list.classList.remove('open');
  }

  input.addEventListener('input', () => { hidId.value = rifEl.value = ''; renderList(input.value); });
  document.addEventListener('click', e => { if (!input.contains(e.target) && !list.contains(e.target)) list.classList.remove('open'); });
  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown')      { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); }
    else if (e.key === 'Enter' && selectedIdx >= 0) { e.preventDefault(); select(list._matches[selectedIdx]); return; }
    else if (e.key === 'Escape')    { list.classList.remove('open'); return; }
    items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
    if (selectedIdx >= 0) items[selectedIdx].scrollIntoView({ block: 'nearest' });
  });
}

// ─────────────────────────────────────────────────────────
//  FACTURAS DINÁMICAS
// ─────────────────────────────────────────────────────────

function initFacturas() {
  const container = document.getElementById('facturas-container');
  const btn = document.getElementById('btn-add-factura');
  if (!btn || btn.dataset.listener) return;
  btn.dataset.listener = 'true';

  btn.addEventListener('click', () => {
    const count = container.querySelectorAll('.factura-item').length + 1;
    const wrap = document.createElement('div');
    wrap.className = 'factura-item';
    wrap.innerHTML = `
      <input type="text" class="form-control factura-input" placeholder="N° Factura ${count}" />
      <button class="btn-remove-factura" aria-label="Eliminar"><i class="bi bi-dash"></i></button>`;
    wrap.querySelector('.btn-remove-factura').addEventListener('click', () => wrap.remove());
    container.appendChild(wrap);
    wrap.querySelector('input').focus();
  });
}

function getFacturas() {
  return Array.from(document.querySelectorAll('.factura-input')).map(i => i.value.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────
//  GEOLOCALIZACIÓN
// ─────────────────────────────────────────────────────────

function initGeo() {
  const statusEl = document.getElementById('geo-status');
  const textEl   = document.getElementById('geo-text');
  if (!navigator.geolocation) {
    statusEl.className = 'geo-status fail mb-3';
    textEl.textContent = 'Geolocalización no disponible.'; return;
  }
  State.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      State.currentGeo = { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy) };
      document.getElementById('inp-lat').value = State.currentGeo.lat;
      document.getElementById('inp-lng').value = State.currentGeo.lng;
      statusEl.className = 'geo-status ok mb-3';
      textEl.textContent  = `GPS OK · ${State.currentGeo.lat}, ${State.currentGeo.lng} (±${State.currentGeo.acc}m)`;
    },
    (err) => {
      State.currentGeo = null;
      statusEl.className = 'geo-status fail mb-3';
      textEl.textContent = ({1:'Permiso denegado.',2:'Posición no disponible.',3:'Tiempo de espera agotado.'})[err.code] || 'Error de geolocalización.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// ─────────────────────────────────────────────────────────
//  FORMULARIO DE DESPACHO
// ─────────────────────────────────────────────────────────

function initDespachoForm() {
  const btn = document.getElementById('btn-submit');
  if (!btn || btn.dataset.listener) return;
  btn.dataset.listener = 'true';
  btn.addEventListener('click', handleSubmitDespacho);
}

async function handleSubmitDespacho() {
  const cliente   = document.getElementById('inp-cliente').value.trim();
  const clienteId = document.getElementById('inp-cliente-id').value;
  const obs       = document.getElementById('inp-obs').value.trim();
  const facturas  = getFacturas();

  if (!cliente)         { showToast('Selecciona un cliente de la lista.', 'error'); return; }
  if (!facturas.length) { showToast('Ingresa al menos un número de factura.', 'error'); return; }

  if (!State.session) {
    showToast('Error de sesión. Por favor, reinicia la aplicación.', 'error');
    return;
  }

  const now   = new Date();
  const fecha = now.toLocaleString('es-VE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });

  const payload = {
    action: 'saveDespacho',
    data: {
      fecha,
      transportistaCedula: State.session.cedula,
      transportistaNombre: State.session.nombre,
      clienteId,
      clienteNombre: cliente,
      rif:           document.getElementById('inp-rif').value,
      facturas:      facturas.join(' | '),
      observaciones: obs,
      lat:           State.currentGeo?.lat || '',
      lng:           State.currentGeo?.lng || '',
    },
  };

  const btn = document.getElementById('btn-submit');
  const originalHTML = btn.innerHTML;
  setBtnLoading(btn, true);

  try {
    const res = await apiPost(payload);
    if (res.ok) {
      showToast('<i class="bi bi-check-circle-fill me-1"></i>Despacho registrado exitosamente.', 'success', 4000);
      resetDespachoForm();
    } else throw new Error(res.mensaje || 'Error del servidor');
  } catch (err) {
    if (err.message === 'offline') {
      enqueueOffline(payload);
      showToast('<b>Modo Offline:</b> Despacho guardado localmente. Se enviará automáticamente al recuperar conexión.', 'info', 6000);
      resetDespachoForm();
    } else {
      showToast(`Error: ${err.message}`, 'error', 5000);
    }
  } finally {
    setBtnLoading(btn, false, originalHTML);
  }
}

function resetDespachoForm() {
  ['inp-cliente','inp-obs','inp-cliente-id','inp-rif'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('facturas-container').innerHTML = `
    <div class="factura-item">
      <input type="text" class="form-control factura-input" placeholder="N° Factura 1" />
    </div>`;
}

// ─────────────────────────────────────────────────────────
//  COLA OFFLINE
// ─────────────────────────────────────────────────────────

function enqueueOffline(payload) {
  try {
    const raw   = localStorage.getItem(CONFIG.QUEUE_KEY);
    let queue = [];
    if (raw) {
      try { queue = JSON.parse(raw); } catch(e) { queue = []; }
    }
    if (!Array.isArray(queue)) queue = [];

    queue.push({ payload, enqueuedAt: new Date().toISOString() });
    localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(queue));
    console.log('Despacho encolado offline:', payload);
  } catch (err) {
    console.error('Error al encolar:', err);
    showToast('Error crítico: No se pudo guardar localmente.', 'error');
  }
}

async function flushOfflineQueue(isManual = false) {
  if (State._isSyncing) return;
  const raw = localStorage.getItem(CONFIG.QUEUE_KEY);
  if (!raw) return;

  let queue = [];
  try { queue = JSON.parse(raw); } catch(e) { return; }
  if (!queue || !queue.length) return;

  // Si físicamente no hay red, no lo intentamos.
  if (!navigator.onLine) return;

  State._isSyncing = true;
  if (isManual) showToast(`Sincronizando ${queue.length} despacho(s)...`, 'info', 2000);

  const failed = [];
  let successCount = 0;

  // Copia de la cola para procesar
  const processQueue = [...queue];

  for (const item of processQueue) {
    try {
      // Usamos un timeout más corto para el flush automático
      const res = await apiPost(item.payload, 15000);
      if (res && res.ok) {
        successCount++;
        // Al tener un éxito real, confirmamos que estamos ONLINE de verdad
        setOnlineUI(true);
      } else {
        failed.push(item);
      }
    } catch (err) {
      failed.push(item);
      // Si un envío falla por red/timeout, detenemos el resto para no saturar
      if (err.message === 'offline') break;
    }
  }

  // Actualizar cola con lo que quedó pendiente (fallidos + no procesados)
  const remainingCount = processQueue.length - successCount;
  const remaining = queue.slice(successCount); // Simplificación: asume orden

  // Re-validar contra fallidos específicos por si hubo saltos
  if (failed.length > 0) {
      localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify([...failed, ...queue.slice(processQueue.length)]));
  } else {
      localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(queue.slice(successCount)));
  }

  State._isSyncing = false;

  if (successCount > 0) {
    showToast(`${successCount} despacho(s) sincronizado(s) exitosamente.`, 'success');
  }

  // Si aún hay pendientes y seguimos online, reintentar pronto (backoff ligero)
  const currentQueue = JSON.parse(localStorage.getItem(CONFIG.QUEUE_KEY) || '[]');
  if (currentQueue.length > 0 && navigator.onLine) {
    const delay = failed.length > 0 ? 30000 : 60000;
    setTimeout(() => flushOfflineQueue(), delay);
  }
}

// ─────────────────────────────────────────────────────────
//  REGISTROS
// ─────────────────────────────────────────────────────────

async function loadRegistros() {
  const tbody = document.getElementById('registros-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#8fa8d0;">Cargando...</td></tr>';
  try {
    // Aumentamos timeout a 20s para admin porque la data puede ser pesada
    const res = await apiGet({ action: 'getRegistros', cedula: State.session.cedula, rol: State.session.rol }, 20000);
    if (!res.ok || !Array.isArray(res.data)) throw new Error(res.mensaje || 'Error en formato de datos');
    if (!res.data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#8fa8d0;">Sin registros.</td></tr>'; return;
    }
    tbody.innerHTML = res.data.map((r, i) => {
      const mapsCell = (r.lat && r.lng)
        ? `<a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener" class="maps-link"><i class="bi bi-geo-alt-fill"></i>${r.lat}, ${r.lng}</a>`
        : '<span style="color:#c0d0e8;">–</span>';
      return `<tr>
        <td>${i+1}</td>
        <td>${r.fecha||'–'}</td>
        <td>${r.clienteNombre||'–'}</td>
        <td>${r.facturas||'–'}</td>
        <td style="max-width:180px;white-space:normal;word-break:break-word;">${r.observaciones||'–'}</td>
        <td>${mapsCell}</td>
        <td>${r.transportistaNombre||r.transportistaCedula||'–'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Error registros:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#e84545;">Error: ${err.message || 'No se pudo cargar la data'}.</td></tr>`;
  }
}

// ─────────────────────────────────────────────────────────
//  CLIENTES ADMIN — listar, agregar, eliminar
// ─────────────────────────────────────────────────────────

function renderClientesTable(data) {
  const tbody  = document.getElementById('clientes-body');
  const filter = (document.getElementById('filter-clientes')?.value || '').toLowerCase().trim();
  const list   = filter ? data.filter(c => c.nombre.toLowerCase().includes(filter) || (c.rif||'').toLowerCase().includes(filter)) : data;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:#8fa8d0;">${filter ? 'Sin coincidencias.' : 'Sin clientes registrados.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((c, i) => `
    <tr>
      <td>${i+1}</td>
      <td><strong>${c.nombre}</strong></td>
      <td>${c.rif||'–'}</td>
      <td>
        <button class="btn-danger-sm" onclick="handleDeleteCliente('${c.id}', this)">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`).join('');

  // Stat rápida
  document.getElementById('clientes-stats').innerHTML = `
    <div class="stat-card"><div class="val">${data.length}</div><div class="lbl">Clientes</div></div>`;
}

async function loadClientesAdmin(forceSync = false) {
  await loadClientes(forceSync);
  renderClientesTable(State.clientes);
}

async function handleSaveCliente() {
  const nombre = document.getElementById('new-cli-nombre').value.trim();
  const rif    = document.getElementById('new-cli-rif').value.trim();

  if (!nombre) { showToast('El nombre del cliente es requerido.', 'error'); return; }

  const btn = document.getElementById('btn-save-cliente');
  setBtnLoading(btn, true);

  try {
    const res = await apiPost({ action: 'saveCliente', data: { nombre, rif } });
    if (res.ok) {
      showToast(`<i class="bi bi-check-circle-fill me-1"></i>Cliente "${nombre}" agregado.`, 'success');
      // Limpiar campos
      ['new-cli-nombre','new-cli-rif'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      // Recargar lista y caché
      await loadClientesAdmin(true);
    } else {
      showToast(res.mensaje || 'No se pudo guardar el cliente.', 'error');
    }
  } catch (err) {
    showToast('Error de conexión al guardar cliente.', 'error');
  } finally {
    setBtnLoading(btn, false, '<i class="bi bi-plus-circle-fill me-1"></i>Guardar Cliente');
  }
}

async function handleDeleteCliente(id, btnEl) {
  if (!confirm(`¿Eliminar cliente ID ${id}? Esta acción no se puede deshacer.`)) return;
  btnEl.disabled = true;
  btnEl.innerHTML = '...';
  try {
    const res = await apiPost({ action: 'deleteCliente', data: { id } });
    if (res.ok) {
      showToast('Cliente eliminado.', 'success');
      await loadClientesAdmin(true);
    } else {
      showToast(res.mensaje || 'No se pudo eliminar.', 'error');
      btnEl.disabled = false; btnEl.innerHTML = '<i class="bi bi-trash"></i>';
    }
  } catch {
    showToast('Error de conexión.', 'error');
    btnEl.disabled = false; btnEl.innerHTML = '<i class="bi bi-trash"></i>';
  }
}

// ─────────────────────────────────────────────────────────
//  USUARIOS ADMIN — listar, agregar, eliminar
// ─────────────────────────────────────────────────────────

async function loadUsuariosAdmin() {
  const tbody = document.getElementById('usuarios-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#8fa8d0;">Cargando...</td></tr>';
  try {
    const res = await apiGet({ action: 'getUsuarios' });
    if (!res.ok || !res.data?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#8fa8d0;">Sin usuarios.</td></tr>'; return;
    }
    tbody.innerHTML = res.data.map((u, i) => `
      <tr>
        <td>${i+1}</td>
        <td><strong>${u.nombre}</strong></td>
        <td>${u.cedula}</td>
        <td><span class="badge-ok ${u.rol==='Admin'?'badge-admin':''}">${u.rol}</span></td>
        <td>
          ${u.cedula !== State.session.cedula
            ? `<button class="btn-danger-sm" onclick="handleDeleteUsuario('${u.cedula}', this)"><i class="bi bi-trash"></i></button>`
            : '<span style="font-size:.75rem;color:#aaa;">Tu cuenta</span>'
          }
        </td>
      </tr>`).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#e84545;">Error al cargar.</td></tr>';
  }
}

async function handleSaveUsuario() {
  const nombre = document.getElementById('new-usr-nombre').value.trim();
  const cedula = document.getElementById('new-usr-cedula').value.trim();
  const clave  = document.getElementById('new-usr-clave').value.trim();
  const rol    = document.getElementById('new-usr-rol').value;

  if (!nombre || !cedula || !clave) { showToast('Nombre, cédula y clave son requeridos.', 'error'); return; }

  const btn = document.getElementById('btn-save-usuario');
  setBtnLoading(btn, true);

  try {
    const res = await apiPost({ action: 'saveUsuario', data: { nombre, cedula, clave, rol } });
    if (res.ok) {
      showToast(`<i class="bi bi-check-circle-fill me-1"></i>Usuario "${nombre}" agregado.`, 'success');
      ['new-usr-nombre','new-usr-cedula','new-usr-clave'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('new-usr-rol').selectedIndex = 0;
      await loadUsuariosAdmin();
    } else {
      showToast(res.mensaje || 'No se pudo guardar el usuario.', 'error');
    }
  } catch {
    showToast('Error de conexión al guardar usuario.', 'error');
  } finally {
    setBtnLoading(btn, false, '<i class="bi bi-person-check-fill me-1"></i>Guardar Usuario');
  }
}

async function handleDeleteUsuario(cedula, btnEl) {
  if (!confirm(`¿Eliminar usuario con cédula ${cedula}?`)) return;
  btnEl.disabled = true; btnEl.innerHTML = '...';
  try {
    const res = await apiPost({ action: 'deleteUsuario', data: { cedula } });
    if (res.ok) {
      showToast('Usuario eliminado.', 'success');
      await loadUsuariosAdmin();
    } else {
      showToast(res.mensaje || 'No se pudo eliminar.', 'error');
      btnEl.disabled = false; btnEl.innerHTML = '<i class="bi bi-trash"></i>';
    }
  } catch {
    showToast('Error de conexión.', 'error');
    btnEl.disabled = false; btnEl.innerHTML = '<i class="bi bi-trash"></i>';
  }
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
    if (btn.dataset.listener) return;
    btn.dataset.listener = 'true';
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === 'registros') loadRegistros();
      if (tab === 'clientes')  loadClientesAdmin();
      if (tab === 'usuarios')  loadUsuariosAdmin();
    });
  });

  // Sync clientes
  const btnSync = document.getElementById('btn-sync');
  if (btnSync && !btnSync.dataset.listener) {
    btnSync.dataset.listener = 'true';
    btnSync.addEventListener('click', async () => {
      btnSync.disabled = true;
      btnSync.innerHTML = '<span class="spinner-ring" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:.3rem;"></span>Sincronizando…';
      await loadClientesAdmin(true);
      btnSync.disabled = false;
      btnSync.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Sincronizar';
      showToast(`Lista actualizada (${State.clientes.length} clientes).`, 'success');
    });
  }

  // Filtro de clientes
  const filterCli = document.getElementById('filter-clientes');
  if (filterCli && !filterCli.dataset.listener) {
    filterCli.dataset.listener = 'true';
    filterCli.addEventListener('input', () => {
      renderClientesTable(State.clientes);
    });
  }

  // Guardar cliente
  const btnSaveCli = document.getElementById('btn-save-cliente');
  if (btnSaveCli && !btnSaveCli.dataset.listener) {
    btnSaveCli.dataset.listener = 'true';
    btnSaveCli.addEventListener('click', handleSaveCliente);
  }

  // Guardar usuario
  const btnSaveUsr = document.getElementById('btn-save-usuario');
  if (btnSaveUsr && !btnSaveUsr.dataset.listener) {
    btnSaveUsr.dataset.listener = 'true';
    btnSaveUsr.addEventListener('click', handleSaveUsuario);
  }

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout && !btnLogout.dataset.listener) {
    btnLogout.addEventListener('click', () => {
      if (!confirm('¿Cerrar sesión?')) return;
      clearSession();
      if (State.geoWatchId) navigator.geolocation.clearWatch(State.geoWatchId);
      State.session = null; State.clientes = [];
      showScreen('screen-login');
      document.getElementById('inp-cedula').value = '';
      document.getElementById('inp-clave').value  = '';
    });
    btnLogout.dataset.listener = 'true';
  }

  flushOfflineQueue();
}

// ─────────────────────────────────────────────────────────
//  ONLINE / OFFLINE
// ─────────────────────────────────────────────────────────

function updateOnlineStatus() {
  // Si el navegador dice que NO hay red física, estamos offline.
  if (!navigator.onLine) {
    setOnlineUI(false);
  }
  // Si hay red física pero la app está en modo offline (por fallo de servidor),
  // NO forzamos el estado a online. Esperamos a que una API tenga éxito.
  else if (!State.isOffline) {
    setOnlineUI(true);
  }
}

function setOnlineUI(isOnline) {
  const banner = document.getElementById('offline-banner');
  const dot    = document.getElementById('header-conn-status');
  if (!banner || !dot) return;

  const targetOffline = !(isOnline && navigator.onLine);

  // Si el estado no ha cambiado, no hacemos nada
  if (State.isOffline === targetOffline) return;

  const now = Date.now();
  const timeSinceLastChange = now - State.lastStateChange;

  State.isOffline = targetOffline;
  State.lastStateChange = now;
  console.log(`[Status Change] Offline: ${State.isOffline} (after ${timeSinceLastChange}ms)`);

  if (State.isOffline) {
    // --- MODO OFFLINE ---
    dot.innerHTML = '<span style="color:#ff4444; font-size:1.3rem; cursor:pointer; animation: pulse 2s infinite;" title="Sin conexión"><i class="bi bi-wifi-off"></i></span>';
    dot.onclick = () => showToast('Sin conexión al servidor.', 'info');

    banner.classList.add('was-offline', 'show');
    banner.style.background = '#dc3545';
    banner.innerHTML = '<i class="bi bi-wifi-off me-2"></i>Modo Offline – Los datos se guardarán localmente';

    // EVITAR REPETICIÓN: Solo mostrar el toast si llevábamos un tiempo estable y han pasado 60s
    if (timeSinceLastChange > 15000 && (now - State.lastOfflineToast > 60000)) {
      showToast('Se ha perdido la conexión. Entrando en modo offline.', 'error', 4000);
      State.lastOfflineToast = now;
    }
  } else {
    // --- MODO ONLINE ---
    State.consecutiveFailures = 0; // Reset por si acaso
    dot.innerHTML = '<span style="color:#42ff9b; font-size:1.3rem; cursor:pointer;" title="En línea"><i class="bi bi-wifi"></i></span>';
    dot.onclick = () => {
      showToast('Conexión estable.', 'info', 1000);
      flushOfflineQueue(true);
    };

    if (banner.classList.contains('was-offline')) {
      banner.style.background = '#1a6b42';
      banner.innerHTML = '<i class="bi bi-wifi me-2"></i>Conexión restablecida – Sincronizando datos...';
      banner.classList.add('show');

      if (State.session) setTimeout(() => flushOfflineQueue(), 500);

      setTimeout(() => {
        if (!State.isOffline) {
          banner.classList.remove('show');
          setTimeout(() => {
             if (!State.isOffline) banner.classList.remove('was-offline');
          }, 15000);
        }
      }, 4000);
    } else {
      banner.classList.remove('show');
    }
  }
}

// Chequeo de seguridad cada 3 segundos para asegurar que el estado sea correcto
setInterval(updateOnlineStatus, 3000);

// Sync automático cada 30 segundos si hay conexión
setInterval(() => {
  if (navigator.onLine && State.session) flushOfflineQueue();
}, 30000);

window.addEventListener('online',  () => {
  console.log('Hardware Online');
  if (State.isOffline && State.session) {
    // Intentamos sincronizar inmediatamente para validar la conexión real
    flushOfflineQueue();
  }
  updateOnlineStatus();
});
window.addEventListener('offline', () => {
  console.log('Internet OFF');
  setOnlineUI(false);
});
// Ejecutar al inicio para establecer estado inicial
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineStatus();
});

// ─────────────────────────────────────────────────────────
//  PWA INSTALL
// ─────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); State.deferredInstall = e;
  document.getElementById('install-banner').classList.add('show');
});
document.getElementById('btn-install').addEventListener('click', async () => {
  if (!State.deferredInstall) return;
  State.deferredInstall.prompt();
  const { outcome } = await State.deferredInstall.userChoice;
  if (outcome === 'accepted') showToast('¡App instalada!', 'success');
  State.deferredInstall = null;
  document.getElementById('install-banner').classList.remove('show');
});
document.getElementById('btn-dismiss-install').addEventListener('click', () => {
  document.getElementById('install-banner').classList.remove('show');
});

// ─────────────────────────────────────────────────────────
//  SERVICE WORKER
// ─────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(r  => console.log('[SW] Registrado:', r.scope))
      .catch(e => console.error('[SW] Error:', e));
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SYNC_QUEUE' && State.session) flushOfflineQueue();
  });
}

// ─────────────────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────────────────

function setupLoginListeners() {
  const btn = document.getElementById('btn-login');
  const inp = document.getElementById('inp-clave');
  if (btn) {
    // Eliminamos listeners previos para no duplicar
    btn.replaceWith(btn.cloneNode(true));
    document.getElementById('btn-login').addEventListener('click', handleLogin);
  }
  if (inp) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => setLoader(false), 800);

  // Siempre configuramos los listeners de login al arrancar
  setupLoginListeners();

  const session = loadSession();
  if (session) { State.session = session; initApp(); }
  else { showScreen('screen-login'); }
});
