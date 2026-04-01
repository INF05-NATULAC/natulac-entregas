/**
 * ╔════════════════════════════════════════════════════════════╗
 *  NATULAC · Code.gs
 *  Google Apps Script — Web App Backend
 *
 *  INSTRUCCIONES DE INSTALACIÓN:
 *  1. Abre tu Google Sheet en https://sheets.google.com
 *  2. Ve a Extensiones → Apps Script
 *  3. Borra todo el contenido y pega este código completo
 *  4. Crea las 4 hojas: "Usuarios", "Clientes", "Despachos", "Config"
 *     (el script las crea automáticamente con setupSheets())
 *  5. Ejecuta la función "setupSheets()" una vez manualmente
 *  6. Ejecuta "insertarDatosDePrueba()" para tener datos de ejemplo
 *  7. Despliega: Implementar → Nueva implementación
 *     - Tipo: Aplicación web
 *     - Ejecutar como: Yo (tu cuenta)
 *     - Quién tiene acceso: Cualquier persona
 *  8. Copia la URL de implementación y pégala en CONFIG.GAS_URL de script.js
 * ╚════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────────────────────
//  NOMBRES DE HOJAS
// ─────────────────────────────────────────────────────────────
const SHEET_USUARIOS   = 'Usuarios';
const SHEET_CLIENTES   = 'Clientes';
const SHEET_DESPACHOS  = 'Despachos';
const SHEET_CONFIG     = 'Config';

// ─────────────────────────────────────────────────────────────
//  CABECERAS CORS — Requeridas para fetch desde GitHub Pages
// ─────────────────────────────────────────────────────────────
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  doGet — Maneja peticiones GET
//  Acciones: login | getClientes | getRegistros | getStats | getUsuarios
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || '';

    switch (action) {
      case 'login':
        return handleLogin(e.parameter.cedula, e.parameter.clave);
      case 'getClientes':
        return handleGetClientes();
      case 'getRegistros':
        return handleGetRegistros(e.parameter.cedula, e.parameter.rol);
      case 'getStats':
        return handleGetStats();
      case 'getUsuarios':
        return handleGetUsuarios();
      default:
        return jsonResponse({ ok: false, mensaje: 'Acción no reconocida: ' + action });
    }
  } catch (err) {
    Logger.log('doGet ERROR: ' + err.message);
    return jsonResponse({ ok: false, mensaje: 'Error interno: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  doPost — Maneja peticiones POST
//  Acciones: saveDespacho
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    switch (action) {
      case 'saveDespacho':
        return handleSaveDespacho(body.data);
      default:
        return jsonResponse({ ok: false, mensaje: 'Acción POST no reconocida: ' + action });
    }
  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResponse({ ok: false, mensaje: 'Error interno: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: LOGIN
// ─────────────────────────────────────────────────────────────
function handleLogin(cedula, clave) {
  if (!cedula || !clave) {
    return jsonResponse({ ok: false, mensaje: 'Cédula y clave son requeridas.' });
  }

  const sheet = getSheet(SHEET_USUARIOS);
  const data  = sheet.getDataRange().getValues();

  // Fila 1 = encabezados: [Cedula, Clave, Rol, Nombre, Activo]
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowCedula = String(row[0]).trim();
    const rowClave  = String(row[1]).trim();
    const rowRol    = String(row[2]).trim();
    const rowNombre = String(row[3]).trim();
    const rowActivo = String(row[4]).trim().toLowerCase();

    if (rowCedula === cedula && rowClave === clave) {
      if (rowActivo === 'false' || rowActivo === 'no') {
        return jsonResponse({ ok: false, mensaje: 'Usuario inactivo. Contacta al administrador.' });
      }
      return jsonResponse({ ok: true, nombre: rowNombre, rol: rowRol });
    }
  }

  return jsonResponse({ ok: false, mensaje: 'Cédula o clave incorrecta.' });
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: GET CLIENTES
// ─────────────────────────────────────────────────────────────
function handleGetClientes() {
  const sheet = getSheet(SHEET_CLIENTES);
  const data  = sheet.getDataRange().getValues();

  // Encabezados: [ID, Nombre, RIF, Zona, Telefono, Activo]
  const clientes = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] && !row[1]) continue; // Fila vacía
    const activo = String(row[5] ?? 'true').toLowerCase();
    if (activo === 'false' || activo === 'no') continue;

    clientes.push({
      id:     String(row[0]).trim(),
      nombre: String(row[1]).trim(),
      rif:    String(row[2] || '').trim(),
      zona:   String(row[3] || '').trim(),
      tel:    String(row[4] || '').trim(),
    });
  }

  return jsonResponse({ ok: true, data: clientes, total: clientes.length });
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: GET REGISTROS (Admin ve todos, User solo los suyos)
// ─────────────────────────────────────────────────────────────
function handleGetRegistros(cedula, rol) {
  const sheet = getSheet(SHEET_DESPACHOS);
  const data  = sheet.getDataRange().getValues();

  // Encabezados: ver columnas en setupSheets()
  const isAdmin = (rol || '').toLowerCase() === 'admin';
  const registros = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const rowCedula = String(row[2] || '').trim();

    // Si no es admin, solo sus propios despachos
    if (!isAdmin && rowCedula !== cedula) continue;

    registros.push({
      id:                   String(row[0]).trim(),
      fecha:                String(row[1] || '').trim(),
      transportistaCedula:  String(row[2] || '').trim(),
      transportistaNombre:  String(row[3] || '').trim(),
      clienteId:            String(row[4] || '').trim(),
      clienteNombre:        String(row[5] || '').trim(),
      rif:                  String(row[6] || '').trim(),
      zona:                 String(row[7] || '').trim(),
      producto:             String(row[8] || '').trim(),
      cantidad:             String(row[9] || '').trim(),
      unidad:               String(row[10] || '').trim(),
      facturas:             String(row[11] || '').trim(),
      observaciones:        String(row[12] || '').trim(),
      lat:                  String(row[13] || '').trim(),
      lng:                  String(row[14] || '').trim(),
    });
  }

  // Ordenar por fecha desc
  registros.reverse();

  return jsonResponse({ ok: true, data: registros, total: registros.length });
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: SAVE DESPACHO
// ─────────────────────────────────────────────────────────────
function handleSaveDespacho(data) {
  if (!data) {
    return jsonResponse({ ok: false, mensaje: 'No se recibieron datos.' });
  }

  // Validaciones mínimas del servidor
  if (!data.clienteNombre) return jsonResponse({ ok: false, mensaje: 'Nombre del cliente requerido.' });
  if (!data.producto)      return jsonResponse({ ok: false, mensaje: 'Producto requerido.' });
  if (!data.facturas)      return jsonResponse({ ok: false, mensaje: 'Al menos un número de factura requerido.' });

  const sheet = getSheet(SHEET_DESPACHOS);

  // Generar ID único
  const lastRow = sheet.getLastRow();
  const id = 'DSP-' + Utilities.formatDate(new Date(), 'America/Caracas', 'yyyyMMdd') + '-' + (lastRow);

  const row = [
    id,
    data.fecha              || Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy HH:mm:ss'),
    data.transportistaCedula || '',
    data.transportistaNombre || '',
    data.clienteId           || '',
    data.clienteNombre       || '',
    data.rif                 || '',
    data.zona                || '',
    data.producto            || '',
    data.cantidad            || '',
    data.unidad              || '',
    data.facturas            || '',
    data.observaciones       || '',
    data.lat                 || '',
    data.lng                 || '',
  ];

  sheet.appendRow(row);

  // Auto-formato de la fila recién insertada
  const newRow = sheet.getLastRow();
  sheet.getRange(newRow, 1, 1, row.length).setFontFamily('Arial').setFontSize(10);

  Logger.log('Despacho guardado: ' + id);
  return jsonResponse({ ok: true, id, mensaje: 'Despacho registrado correctamente.' });
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: GET STATS (Admin)
// ─────────────────────────────────────────────────────────────
function handleGetStats() {
  const hoyStr = Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy');

  const despachos = getSheet(SHEET_DESPACHOS).getDataRange().getValues();
  const clientes  = getSheet(SHEET_CLIENTES).getDataRange().getValues();
  const usuarios  = getSheet(SHEET_USUARIOS).getDataRange().getValues();

  const totalDespachos = Math.max(0, despachos.length - 1);
  const totalClientes  = Math.max(0, clientes.length - 1);
  const totalUsuarios  = Math.max(0, usuarios.length - 1);

  // Contar despachos de hoy
  let hoy = 0;
  for (let i = 1; i < despachos.length; i++) {
    const fecha = String(despachos[i][1] || '');
    if (fecha.startsWith(hoyStr)) hoy++;
  }

  return jsonResponse({ ok: true, totalDespachos, totalClientes, totalUsuarios, hoy });
}

// ─────────────────────────────────────────────────────────────
//  HANDLER: GET USUARIOS (Admin)
// ─────────────────────────────────────────────────────────────
function handleGetUsuarios() {
  const sheet = getSheet(SHEET_USUARIOS);
  const data  = sheet.getDataRange().getValues();
  const usuarios = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    usuarios.push({
      cedula: String(row[0]).trim(),
      // NO devolver la clave por seguridad
      rol:    String(row[2]).trim(),
      nombre: String(row[3]).trim(),
      activo: String(row[4] ?? 'true').trim(),
    });
  }

  return jsonResponse({ ok: true, data: usuarios });
}

// ─────────────────────────────────────────────────────────────
//  UTILIDADES DE HOJAS
// ─────────────────────────────────────────────────────────────

/** Obtiene una hoja por nombre, creándola si no existe */
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ─────────────────────────────────────────────────────────────
//  SETUP — Ejecutar UNA VEZ manualmente para inicializar hojas
// ─────────────────────────────────────────────────────────────

/**
 * Ejecuta esta función desde Apps Script para crear las hojas
 * con sus encabezados. Solo necesitas hacerlo una vez.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Hoja USUARIOS ─────────────────────────────────────────
  let sheetU = ss.getSheetByName(SHEET_USUARIOS) || ss.insertSheet(SHEET_USUARIOS);
  sheetU.clearContents();
  sheetU.appendRow(['Cedula', 'Clave', 'Rol', 'Nombre', 'Activo']);
  sheetU.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0a4f3c').setFontColor('#ffffff');
  sheetU.setFrozenRows(1);

  // ── Hoja CLIENTES ──────────────────────────────────────────
  let sheetC = ss.getSheetByName(SHEET_CLIENTES) || ss.insertSheet(SHEET_CLIENTES);
  sheetC.clearContents();
  sheetC.appendRow(['ID', 'Nombre', 'RIF', 'Zona', 'Telefono', 'Activo']);
  sheetC.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0a4f3c').setFontColor('#ffffff');
  sheetC.setFrozenRows(1);

  // ── Hoja DESPACHOS ─────────────────────────────────────────
  let sheetD = ss.getSheetByName(SHEET_DESPACHOS) || ss.insertSheet(SHEET_DESPACHOS);
  sheetD.clearContents();
  sheetD.appendRow([
    'ID', 'Fecha', 'TransportistaCedula', 'TransportistaNombre',
    'ClienteID', 'ClienteNombre', 'RIF', 'Zona',
    'Producto', 'Cantidad', 'Unidad', 'Facturas',
    'Observaciones', 'Latitud', 'Longitud'
  ]);
  sheetD.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#0a4f3c').setFontColor('#ffffff');
  sheetD.setFrozenRows(1);

  // ── Hoja CONFIG ────────────────────────────────────────────
  let sheetCfg = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  sheetCfg.clearContents();
  sheetCfg.appendRow(['Clave', 'Valor']);
  sheetCfg.appendRow(['version', '1.0']);
  sheetCfg.appendRow(['empresa', 'Natulac']);
  sheetCfg.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#0a4f3c').setFontColor('#ffffff');

  SpreadsheetApp.flush();
  Logger.log('✅ Hojas creadas correctamente.');
  SpreadsheetApp.getUi().alert('✅ Hojas creadas correctamente.\n\nYa puedes insertar datos de prueba con "insertarDatosDePrueba()".');
}

// ─────────────────────────────────────────────────────────────
//  DATOS DE PRUEBA — Ejecutar manualmente una vez
// ─────────────────────────────────────────────────────────────

function insertarDatosDePrueba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Usuarios de prueba
  const shU = ss.getSheetByName(SHEET_USUARIOS);
  shU.appendRow(['12345678', 'admin123',  'Admin', 'Carlos Rodríguez', 'true']);
  shU.appendRow(['87654321', 'user123',   'User',  'Pedro Gómez',      'true']);
  shU.appendRow(['11223344', 'user456',   'User',  'Luis Martínez',    'true']);

  // Clientes de prueba
  const shC = ss.getSheetByName(SHEET_CLIENTES);
  const clientesPrueba = [
    ['C001', 'Distribuidora El Sol',    'J-12345678-9', 'Zona Norte',   '0412-1234567', 'true'],
    ['C002', 'Supermercado La Colina',  'J-98765432-1', 'Zona Sur',     '0416-9876543', 'true'],
    ['C003', 'Bodega Central Caracas',  'J-11223344-5', 'Zona Centro',  '0424-1112233', 'true'],
    ['C004', 'Mini Market Los Andes',   'V-44556677',   'Zona Oeste',   '0414-4455667', 'true'],
    ['C005', 'Abastos El Progreso',     'J-55667788-2', 'Zona Este',    '0426-5566778', 'true'],
    ['C006', 'Distribuidora Natalia',   'J-66778899-3', 'Zona Norte',   '0412-6677889', 'true'],
    ['C007', 'Supermercado Familiar',   'J-77889900-4', 'Zona Sur',     '0416-7788990', 'true'],
    ['C008', 'Bodeguita Los Samanes',   'V-88990011',   'Zona Centro',  '0424-8899001', 'true'],
    ['C009', 'Tienda El Venezolano',    'J-99001122-5', 'Zona Oeste',   '0414-9900112', 'true'],
    ['C010', 'Abastos Maracay Centro',  'J-00112233-6', 'Zona Maracay', '0426-0011223', 'true'],
  ];
  clientesPrueba.forEach(c => shC.appendRow(c));

  SpreadsheetApp.flush();
  Logger.log('✅ Datos de prueba insertados.');
  SpreadsheetApp.getUi().alert('✅ Datos de prueba insertados.\n\nUsuarios:\n• Admin: 12345678 / admin123\n• User: 87654321 / user123');
}
