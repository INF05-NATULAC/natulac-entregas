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

async function apiGet(params = {}) {
  const url = new URL(CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(payload = {}) {
  const res = await fetch(CONFIG.GAS_URL, {
    method:  'POST',
    mode:    'cors',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────

function loadSession()  { try { const r = localStorage.getItem(CONFIG.SESSION_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveSession(s) { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(CONFIG.SESSION_KEY); }

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
//  CLIENTES — carga y caché
// ─────────────────────────────────────────────────────────

async function loadClientes(forceSync = false) {
  const raw = localStorage.getItem(CONFIG.CLIENTES_CACHE_KEY);
  if (raw && !forceSync) {
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < CONFIG.CACHE_TTL_MS) { State.clientes = data; return; }
  }
  try {
    const res = await apiGet({ action: 'getClientes' });
    if (res.ok && Array.isArray(res.data)) {
      State.clientes = res.data;
      localStorage.setItem(CONFIG.CLIENTES_CACHE_KEY, JSON.stringify({ data: res.data, timestamp: Date.now() }));
    }
  } catch {
    if (raw) { State.clientes = JSON.parse(raw).data; showToast('Sin conexión – lista local de clientes.', 'info'); }
    else showToast('No se pudo cargar la lista de clientes.', 'error');
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
  let selectedIdx = -1;

  function renderList(q) {
    q = q.toLowerCase().trim();
    list.innerHTML = ''; selectedIdx = -1;
    if (!q || q.length < 2) { list.classList.remove('open'); return; }

    const matches = State.clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 10);
    if (!matches.length) {
      list.innerHTML = '<div class="autocomplete-empty">Sin resultados</div>';
      list.classList.add('open'); return;
    }
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    matches.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.idx = i;
      item.innerHTML = c.nombre.replace(re, '<mark>$1</mark>');
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
  let count = 1;

  document.getElementById('btn-add-factura').addEventListener('click', () => {
    count++;
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
  document.getElementById('btn-submit').addEventListener('click', handleSubmitDespacho);
}

async function handleSubmitDespacho() {
  const cliente   = document.getElementById('inp-cliente').value.trim();
  const clienteId = document.getElementById('inp-cliente-id').value;
  const obs       = document.getElementById('inp-obs').value.trim();
  const facturas  = getFacturas();

  if (!cliente)         { showToast('Selecciona un cliente de la lista.', 'error'); return; }
  if (!obs)             { showToast('Agrega una observación del despacho.', 'error'); return; }
  if (!facturas.length) { showToast('Ingresa al menos un número de factura.', 'error'); return; }

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
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-ring" style="width:20px;height:20px;border-width:3px;margin:0 auto;display:block;"></span>';

  try {
    if (!navigator.onLine) throw new Error('offline');
    const res = await apiPost(payload);
    if (res.ok) {
      showToast('<i class="bi bi-check-circle-fill me-1"></i>Despacho registrado exitosamente.', 'success', 4000);
      resetDespachoForm();
    } else throw new Error(res.mensaje || 'Error del servidor');
  } catch (err) {
    if (err.message === 'offline' || !navigator.onLine) {
      enqueueOffline(payload);
      showToast('Sin conexión – guardado localmente. Se enviará cuando vuelva la red.', 'info', 5000);
      resetDespachoForm();
    } else {
      showToast(`Error: ${err.message}`, 'error', 5000);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send-fill me-2"></i>Registrar Despacho';
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
    try { const res = await apiPost(item.payload); if (!res.ok) throw new Error(); }
    catch { failed.push(item); }
  }
  localStorage.setItem(CONFIG.QUEUE_KEY, JSON.stringify(failed));
  if (!failed.length) showToast('Despachos pendientes sincronizados.', 'success');
  else showToast(`${failed.length} despacho(s) no se pudieron enviar.`, 'error');
}

// ─────────────────────────────────────────────────────────
//  REGISTROS
// ─────────────────────────────────────────────────────────

async function loadRegistros() {
  const tbody = document.getElementById('registros-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#8fa8d0;">Cargando...</td></tr>';
  try {
    const res = await apiGet({ action: 'getRegistros', cedula: State.session.cedula, rol: State.session.rol });
    if (!res.ok || !Array.isArray(res.data)) throw new Error();
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
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#e84545;">Error al cargar registros.</td></tr>';
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
      // Refrescar autocomplete del despacho
      initAutocomplete();
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
      initAutocomplete();
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
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      showTab(tab);
      if (tab === 'registros') loadRegistros();
      if (tab === 'clientes')  loadClientesAdmin();
      if (tab === 'usuarios')  loadUsuariosAdmin();
    });
  });

  // Sync clientes
  document.getElementById('btn-sync')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-ring" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:.3rem;"></span>Sincronizando…';
    await loadClientesAdmin(true);
    initAutocomplete();
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Sincronizar';
    showToast(`Lista actualizada (${State.clientes.length} clientes).`, 'success');
  });

  // Filtro de clientes
  document.getElementById('filter-clientes')?.addEventListener('input', () => {
    renderClientesTable(State.clientes);
  });

  // Guardar cliente
  document.getElementById('btn-save-cliente')?.addEventListener('click', handleSaveCliente);

  // Guardar usuario
  document.getElementById('btn-save-usuario')?.addEventListener('click', handleSaveUsuario);

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión?')) return;
    clearSession();
    if (State.geoWatchId) navigator.geolocation.clearWatch(State.geoWatchId);
    State.session = null; State.clientes = [];
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

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => setLoader(false), 800);
  const session = loadSession();
  if (session) { State.session = session; initApp(); }
  else {
    showScreen('screen-login');
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('inp-clave').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  }
});
