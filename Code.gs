/**
 * ╔════════════════════════════════════════════════════════════╗
 *  NATULAC · Code.gs  v1.1
 *  Google Apps Script — Web App Backend
 *
 *  Cambios v1.1:
 *  - Lat/Lng se guardan como HYPERLINK de Google Maps en el Sheet.
 *    Al hacer clic sobre la celda se abre Google Maps directamente.
 *  - Formulario simplificado: sin Producto/Cantidad/Unidad.
 * ╚════════════════════════════════════════════════════════════╝
 */

const SHEET_USUARIOS  = 'Usuarios';
const SHEET_CLIENTES  = 'Clientes';
const SHEET_DESPACHOS = 'Despachos';
const SHEET_CONFIG    = 'Config';

// ─────────────────────────────────────────────────────────────
//  RESPUESTA JSON
// ─────────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  doGet
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    switch (action) {
      case 'login':        return handleLogin(e.parameter.cedula, e.parameter.clave);
      case 'getClientes':  return handleGetClientes();
      case 'getRegistros': return handleGetRegistros(e.parameter.cedula, e.parameter.rol);
      case 'getStats':     return handleGetStats();
      case 'getUsuarios':  return handleGetUsuarios();
      default:             return jsonResponse({ ok: false, mensaje: 'Acción no reconocida: ' + action });
    }
  } catch (err) {
    Logger.log('doGet ERROR: ' + err.message);
    return jsonResponse({ ok: false, mensaje: 'Error interno: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  doPost
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || '';
    switch (action) {
      case 'saveDespacho': return handleSaveDespacho(body.data);
      default:             return jsonResponse({ ok: false, mensaje: 'Acción POST no reconocida: ' + action });
    }
  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResponse({ ok: false, mensaje: 'Error interno: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────
function handleLogin(cedula, clave) {
  if (!cedula || !clave)
    return jsonResponse({ ok: false, mensaje: 'Cédula y clave requeridas.' });

  const data = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).trim() === cedula && String(row[1]).trim() === clave) {
      if (String(row[4] ?? 'true').toLowerCase() === 'false')
        return jsonResponse({ ok: false, mensaje: 'Usuario inactivo.' });
      return jsonResponse({ ok: true, nombre: String(row[3]).trim(), rol: String(row[2]).trim() });
    }
  }
  return jsonResponse({ ok: false, mensaje: 'Cédula o clave incorrecta.' });
}

// ─────────────────────────────────────────────────────────────
//  GET CLIENTES
// ─────────────────────────────────────────────────────────────
function handleGetClientes() {
  const data = getSheet(SHEET_CLIENTES).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] && !row[1]) continue;
    if (String(row[5] ?? 'true').toLowerCase() === 'false') continue;
    out.push({ id: String(row[0]).trim(), nombre: String(row[1]).trim(), rif: String(row[2]||'').trim(), zona: String(row[3]||'').trim() });
  }
  return jsonResponse({ ok: true, data: out, total: out.length });
}

// ─────────────────────────────────────────────────────────────
//  GET REGISTROS
// ─────────────────────────────────────────────────────────────
function handleGetRegistros(cedula, rol) {
  const data    = getSheet(SHEET_DESPACHOS).getDataRange().getValues();
  const isAdmin = (rol || '').toLowerCase() === 'admin';
  const out     = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (!isAdmin && String(row[2]||'').trim() !== cedula) continue;

    // Para la columna de ubicación devolvemos las coordenadas en texto plano.
    // El frontend construye el link de Maps. El Sheet ya tiene la fórmula HYPERLINK.
    out.push({
      id:                  String(row[0]||'').trim(),
      fecha:               String(row[1]||'').trim(),
      transportistaCedula: String(row[2]||'').trim(),
      transportistaNombre: String(row[3]||'').trim(),
      clienteId:           String(row[4]||'').trim(),
      clienteNombre:       String(row[5]||'').trim(),
      rif:                 String(row[6]||'').trim(),
      zona:                String(row[7]||'').trim(),
      facturas:            String(row[8]||'').trim(),
      observaciones:       String(row[9]||'').trim(),
      // Coordenadas en texto (el HYPERLINK en el Sheet no afecta getValues)
      lat:                 String(row[10]||'').trim(),
      lng:                 String(row[11]||'').trim(),
    });
  }

  out.reverse(); // Más recientes primero
  return jsonResponse({ ok: true, data: out, total: out.length });
}

// ─────────────────────────────────────────────────────────────
//  SAVE DESPACHO  ← guarda lat/lng como HYPERLINK de Maps
// ─────────────────────────────────────────────────────────────
function handleSaveDespacho(data) {
  if (!data)               return jsonResponse({ ok: false, mensaje: 'Sin datos.' });
  if (!data.clienteNombre) return jsonResponse({ ok: false, mensaje: 'Cliente requerido.' });
  if (!data.facturas)      return jsonResponse({ ok: false, mensaje: 'Factura requerida.' });

  const sheet   = getSheet(SHEET_DESPACHOS);
  const lastRow = sheet.getLastRow();
  const id      = 'DSP-' + Utilities.formatDate(new Date(), 'America/Caracas', 'yyyyMMdd') + '-' + lastRow;
  const fecha   = data.fecha || Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy HH:mm:ss');

  // Fila sin las columnas de lat/lng (las ponemos aparte con setFormula)
  const row = [
    id,
    fecha,
    data.transportistaCedula || '',
    data.transportistaNombre || '',
    data.clienteId           || '',
    data.clienteNombre       || '',
    data.rif                 || '',
    data.zona                || '',
    data.facturas            || '',
    data.observaciones       || '',
    data.lat                 || '',   // col 11 (K) — texto plano primero
    data.lng                 || '',   // col 12 (L)
  ];

  sheet.appendRow(row);
  const newRow = sheet.getLastRow();

  // ── Reemplazar col K y L con HYPERLINK de Google Maps ─────
  if (data.lat && data.lng) {
    const mapsUrl   = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
    const coordText = `${data.lat}, ${data.lng}`;

    // Columna K (11) → fórmula HYPERLINK
    sheet.getRange(newRow, 11).setFormula(
      `=HYPERLINK("${mapsUrl}","${coordText}")`
    );
    // Columna L (12) → misma fórmula con etiqueta "Ver mapa"
    sheet.getRange(newRow, 12).setFormula(
      `=HYPERLINK("${mapsUrl}","📍 Ver en Maps")`
    );

    // Estilo visual para que se vea como link
    sheet.getRange(newRow, 11, 1, 2)
      .setFontColor('#003087')
      .setFontLine('underline');
  }

  // Auto-formato general de la fila
  sheet.getRange(newRow, 1, 1, 10)
    .setFontFamily('Arial')
    .setFontSize(10);

  Logger.log('Despacho guardado: ' + id);
  return jsonResponse({ ok: true, id, mensaje: 'Despacho registrado correctamente.' });
}

// ─────────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────────
function handleGetStats() {
  const hoyStr = Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy');
  const d = getSheet(SHEET_DESPACHOS).getDataRange().getValues();
  const c = getSheet(SHEET_CLIENTES).getDataRange().getValues();
  const u = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  let hoy = 0;
  for (let i = 1; i < d.length; i++) if (String(d[i][1]||'').startsWith(hoyStr)) hoy++;
  return jsonResponse({ ok: true, totalDespachos: Math.max(0, d.length-1), totalClientes: Math.max(0, c.length-1), totalUsuarios: Math.max(0, u.length-1), hoy });
}

// ─────────────────────────────────────────────────────────────
//  USUARIOS
// ─────────────────────────────────────────────────────────────
function handleGetUsuarios() {
  const data = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({ cedula: String(data[i][0]).trim(), rol: String(data[i][2]).trim(), nombre: String(data[i][3]).trim() });
  }
  return jsonResponse({ ok: true, data: out });
}

// ─────────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ─────────────────────────────────────────────────────────────
//  SETUP — Ejecutar UNA VEZ para crear las hojas
// ─────────────────────────────────────────────────────────────
function setupSheets() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const HDR = { fontWeight: 'bold', background: '#003087', fontColor: '#ffffff' };

  // Usuarios: Cedula | Clave | Rol | Nombre | Activo
  const shU = ss.getSheetByName(SHEET_USUARIOS) || ss.insertSheet(SHEET_USUARIOS);
  shU.clearContents();
  shU.appendRow(['Cedula','Clave','Rol','Nombre','Activo']);
  _styleHeader(shU, 5);

  // Clientes: ID | Nombre | RIF | Zona | Telefono | Activo
  const shC = ss.getSheetByName(SHEET_CLIENTES) || ss.insertSheet(SHEET_CLIENTES);
  shC.clearContents();
  shC.appendRow(['ID','Nombre','RIF','Zona','Telefono','Activo']);
  _styleHeader(shC, 6);

  // Despachos (sin Producto/Cantidad/Unidad)
  // ID | Fecha | TranspCedula | TranspNombre | ClienteID | ClienteNombre | RIF | Zona | Facturas | Observaciones | Latitud | Longitud
  const shD = ss.getSheetByName(SHEET_DESPACHOS) || ss.insertSheet(SHEET_DESPACHOS);
  shD.clearContents();
  shD.appendRow(['ID','Fecha','TransportistaCedula','TransportistaNombre','ClienteID','ClienteNombre','RIF','Zona','Facturas','Observaciones','Latitud (Maps)','Longitud (Maps)']);
  _styleHeader(shD, 12);
  // Ancho generoso para la columna de Maps
  shD.setColumnWidth(11, 200);
  shD.setColumnWidth(12, 160);

  // Config
  const shCfg = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  shCfg.clearContents();
  shCfg.appendRow(['Clave','Valor']);
  shCfg.appendRow(['version','1.1']);
  shCfg.appendRow(['empresa','Natulac']);
  _styleHeader(shCfg, 2);

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ Hojas creadas.\n\nEjecuta "insertarDatosDePrueba()" para agregar datos de ejemplo.');
}

function _styleHeader(sheet, cols) {
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setBackground('#003087')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

// ─────────────────────────────────────────────────────────────
//  DATOS DE PRUEBA
// ─────────────────────────────────────────────────────────────
function insertarDatosDePrueba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.getSheetByName(SHEET_USUARIOS).appendRow(['12345678','admin123','Admin','Carlos Rodríguez','true']);
  ss.getSheetByName(SHEET_USUARIOS).appendRow(['87654321','user123', 'User', 'Pedro Gómez',      'true']);
  ss.getSheetByName(SHEET_USUARIOS).appendRow(['11223344','user456', 'User', 'Luis Martínez',    'true']);

  const clientes = [
    ['C001','Distribuidora El Sol',   'J-12345678-9','Zona Norte',  '0412-1234567','true'],
    ['C002','Supermercado La Colina', 'J-98765432-1','Zona Sur',    '0416-9876543','true'],
    ['C003','Bodega Central Caracas', 'J-11223344-5','Zona Centro', '0424-1112233','true'],
    ['C004','Mini Market Los Andes',  'V-44556677',  'Zona Oeste',  '0414-4455667','true'],
    ['C005','Abastos El Progreso',    'J-55667788-2','Zona Este',   '0426-5566778','true'],
    ['C006','Distribuidora Natalia',  'J-66778899-3','Zona Norte',  '0412-6677889','true'],
    ['C007','Supermercado Familiar',  'J-77889900-4','Zona Sur',    '0416-7788990','true'],
    ['C008','Bodeguita Los Samanes',  'V-88990011',  'Zona Centro', '0424-8899001','true'],
    ['C009','Tienda El Venezolano',   'J-99001122-5','Zona Oeste',  '0414-9900112','true'],
    ['C010','Abastos Maracay Centro', 'J-00112233-6','Zona Maracay','0426-0011223','true'],
  ];
  clientes.forEach(c => ss.getSheetByName(SHEET_CLIENTES).appendRow(c));

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ Datos de prueba insertados.\n\nUsuarios:\n• Admin: 12345678 / admin123\n• User:  87654321 / user123');
}
