/**
 * NATULAC · Code.gs  v1.2
 * Nuevas acciones:
 *   saveCliente   → agrega fila en hoja Clientes
 *   deleteCliente → marca Activo=false (no borra la fila)
 *   saveUsuario   → agrega fila en hoja Usuarios
 *   deleteUsuario → marca Activo=false
 */

const SHEET_USUARIOS  = 'Usuarios';
const SHEET_CLIENTES  = 'Clientes';
const SHEET_DESPACHOS = 'Despachos';
const SHEET_CONFIG    = 'Config';

// Cache global del Spreadsheet para evitar múltiples llamadas
const SS = SpreadsheetApp.getActiveSpreadsheet();

function getSheet(name) {
  return SS.getSheetByName(name) || SS.insertSheet(name);
}

// ─────────────────────────────────────────────────────────
//  RESPUESTA JSON
// ─────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────
//  doGet
// ─────────────────────────────────────────────────────────
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
    return jsonResponse({ ok: false, mensaje: 'Error: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────
//  doPost
// ─────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || '';
    switch (action) {
      case 'saveDespacho':  return handleSaveDespacho(body.data);
      case 'saveCliente':   return handleSaveCliente(body.data);
      case 'deleteCliente': return handleDeleteCliente(body.data);
      case 'saveUsuario':   return handleSaveUsuario(body.data);
      case 'deleteUsuario': return handleDeleteUsuario(body.data);
      default:              return jsonResponse({ ok: false, mensaje: 'Acción POST no reconocida: ' + action });
    }
  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResponse({ ok: false, mensaje: 'Error: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────
function handleLogin(cedula, clave) {
  if (!cedula || !clave) return jsonResponse({ ok: false, mensaje: 'Cédula y clave requeridas.' });

  const data = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  const cedulaStr = String(cedula).trim();
  const claveStr  = String(clave).trim();

  // Búsqueda rápida en memoria
  const user = data.find(row => String(row[0]).trim() === cedulaStr && String(row[1]).trim() === claveStr);

  if (user) {
    if (String(user[4] ?? 'true').toLowerCase() === 'false') {
      return jsonResponse({ ok: false, mensaje: 'Usuario inactivo.' });
    }
    return jsonResponse({ ok: true, nombre: String(user[3]).trim(), rol: String(user[2]).trim() });
  }

  return jsonResponse({ ok: false, mensaje: 'Cédula o clave incorrecta.' });
}

// ─────────────────────────────────────────────────────────
//  GET CLIENTES
// ─────────────────────────────────────────────────────────
function handleGetClientes() {
  const data = getSheet(SHEET_CLIENTES).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] && !row[1]) continue;
    if (String(row[5] ?? 'true').toLowerCase() === 'false') continue;
    out.push({
      id:     String(row[0]).trim(),
      nombre: String(row[1]).trim(),
      rif:    String(row[2] || '').trim(),
    });
  }
  return jsonResponse({ ok: true, data: out, total: out.length });
}

// ─────────────────────────────────────────────────────────
//  SAVE CLIENTE (nuevo)
// ─────────────────────────────────────────────────────────
function handleSaveCliente(data) {
  if (!data?.nombre) return jsonResponse({ ok: false, mensaje: 'Nombre del cliente requerido.' });

  const sheet   = getSheet(SHEET_CLIENTES);
  const lastRow = sheet.getLastRow();

  // Generar ID autoincremental
  const id = 'C' + String(lastRow).padStart(3, '0');

  // Validar que la cédula/RIF no exista ya
  if (data.rif) {
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (String(existing[i][2]).trim() === data.rif.trim() &&
          String(existing[i][5] ?? 'true').toLowerCase() !== 'false') {
        return jsonResponse({ ok: false, mensaje: `El RIF "${data.rif}" ya existe en el sistema.` });
      }
    }
  }

  sheet.appendRow([
    id,
    data.nombre  || '',
    data.rif     || '',
    'true',
  ]);

  Logger.log('Cliente agregado: ' + id + ' - ' + data.nombre);
  return jsonResponse({ ok: true, id, mensaje: 'Cliente guardado correctamente.' });
}

// ─────────────────────────────────────────────────────────
//  DELETE CLIENTE (desactivar)
// ─────────────────────────────────────────────────────────
function handleDeleteCliente(data) {
  if (!data?.id) return jsonResponse({ ok: false, mensaje: 'ID de cliente requerido.' });

  const sheet = getSheet(SHEET_CLIENTES);
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === data.id) {
      sheet.getRange(i + 1, 4).setValue('false'); // columna Activo
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, mensaje: 'Cliente desactivado.' });
    }
  }
  return jsonResponse({ ok: false, mensaje: 'Cliente no encontrado.' });
}

// ─────────────────────────────────────────────────────────
//  GET USUARIOS
// ─────────────────────────────────────────────────────────
function handleGetUsuarios() {
  const data = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][4] ?? 'true').toLowerCase() === 'false') continue; // omitir inactivos
    out.push({
      cedula: String(data[i][0]).trim(),
      rol:    String(data[i][2]).trim(),
      nombre: String(data[i][3]).trim(),
    });
  }
  return jsonResponse({ ok: true, data: out });
}

// ─────────────────────────────────────────────────────────
//  SAVE USUARIO (nuevo)
// ─────────────────────────────────────────────────────────
function handleSaveUsuario(data) {
  if (!data?.cedula || !data?.clave || !data?.nombre)
    return jsonResponse({ ok: false, mensaje: 'Nombre, cédula y clave son requeridos.' });

  const sheet = getSheet(SHEET_USUARIOS);
  const rows  = sheet.getDataRange().getValues();

  // Verificar que la cédula no exista ya como activa
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === data.cedula.trim() &&
        String(rows[i][4] ?? 'true').toLowerCase() !== 'false') {
      return jsonResponse({ ok: false, mensaje: `La cédula "${data.cedula}" ya está registrada.` });
    }
  }

  sheet.appendRow([
    data.cedula,
    data.clave,
    data.rol    || 'User',
    data.nombre,
    'true',
  ]);

  Logger.log('Usuario agregado: ' + data.cedula + ' - ' + data.nombre);
  return jsonResponse({ ok: true, mensaje: 'Usuario guardado correctamente.' });
}

// ─────────────────────────────────────────────────────────
//  DELETE USUARIO (desactivar)
// ─────────────────────────────────────────────────────────
function handleDeleteUsuario(data) {
  if (!data?.cedula) return jsonResponse({ ok: false, mensaje: 'Cédula requerida.' });

  const sheet = getSheet(SHEET_USUARIOS);
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === data.cedula) {
      sheet.getRange(i + 1, 5).setValue('false'); // columna Activo
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, mensaje: 'Usuario desactivado.' });
    }
  }
  return jsonResponse({ ok: false, mensaje: 'Usuario no encontrado.' });
}

// ─────────────────────────────────────────────────────────
//  GET REGISTROS
// ─────────────────────────────────────────────────────────
function handleGetRegistros(cedula, rol) {
  const data    = getSheet(SHEET_DESPACHOS).getDataRange().getValues();
  const isAdmin = (rol || '').toLowerCase() === 'admin';
  const out     = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (!isAdmin && String(row[2] || '').trim() !== cedula) continue;
    out.push({
      id:                  String(row[0]  || '').trim(),
      fecha:               String(row[1]  || '').trim(),
      transportistaCedula: String(row[2]  || '').trim(),
      transportistaNombre: String(row[3]  || '').trim(),
      clienteId:           String(row[4]  || '').trim(),
      clienteNombre:       String(row[5]  || '').trim(),
      rif:                 String(row[6]  || '').trim(),
      facturas:            String(row[7]  || '').trim(),
      observaciones:       String(row[8]  || '').trim(),
      lat:                 (String(row[9] || '').split(',')[0] || '').trim(),
      lng:                 (String(row[9] || '').split(',')[1] || '').trim(),
    });
  }
  out.reverse();
  return jsonResponse({ ok: true, data: out, total: out.length });
}

// ─────────────────────────────────────────────────────────
//  SAVE DESPACHO
// ─────────────────────────────────────────────────────────
function handleSaveDespacho(data) {
  if (!data) return jsonResponse({ ok: false, mensaje: 'Sin datos.' });

  const sheet = getSheet(SHEET_DESPACHOS);
  const nextRow = sheet.getLastRow() + 1;
  const id = 'DSP-' + Utilities.formatDate(new Date(), 'America/Caracas', 'yyyyMMdd') + '-' + nextRow;
  const fecha = data.fecha || Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy HH:mm:ss');

  const rowData = [
    id, fecha,
    data.transportistaCedula || '',
    data.transportistaNombre || '',
    data.clienteId           || '',
    data.clienteNombre       || '',
    data.rif                 || '',
    data.facturas            || '',
    data.observaciones       || '',
    (data.lat && data.lng) ? `${data.lat}, ${data.lng}` : '',
  ];

  sheet.appendRow(rowData);

  // Solo procesar RichText si hay coordenadas (evita llamadas lentas si no es necesario)
  if (data.lat && data.lng) {
    const mapsUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
    const richText = SpreadsheetApp.newRichTextValue()
      .setText(`${data.lat}, ${data.lng}`)
      .setLinkUrl(mapsUrl)
      .build();
    sheet.getRange(nextRow, 10).setRichTextValue(richText);
  }

  return jsonResponse({ ok: true, id });
}

// ─────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────
function handleGetStats() {
  const hoyStr = Utilities.formatDate(new Date(), 'America/Caracas', 'dd/MM/yyyy');
  const d = getSheet(SHEET_DESPACHOS).getDataRange().getValues();
  const c = getSheet(SHEET_CLIENTES).getDataRange().getValues();
  const u = getSheet(SHEET_USUARIOS).getDataRange().getValues();
  let hoy = 0;
  for (let i = 1; i < d.length; i++) if (String(d[i][1]||'').startsWith(hoyStr)) hoy++;
  return jsonResponse({ ok: true, totalDespachos: Math.max(0, d.length-1), totalClientes: Math.max(0, c.length-1), totalUsuarios: Math.max(0, u.length-1), hoy });
}

// ─────────────────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────────────────

function _styleRow(sheet, rowNum, cols) {
  sheet.getRange(rowNum, 1, 1, cols).setFontFamily('Arial').setFontSize(10);
}

// ─────────────────────────────────────────────────────────
//  SETUP — ejecutar UNA VEZ para inicializar hojas
// ─────────────────────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Usuarios: Cedula | Clave | Rol | Nombre | Activo
  const shU = ss.getSheetByName(SHEET_USUARIOS) || ss.insertSheet(SHEET_USUARIOS);
  shU.clearContents();
  shU.appendRow(['Cedula','Clave','Rol','Nombre','Activo']);
  _styleHeader(shU, 5);

  // Clientes: ID | Nombre | RIF | Activo
  const shC = ss.getSheetByName(SHEET_CLIENTES) || ss.insertSheet(SHEET_CLIENTES);
  shC.clearContents();
  shC.appendRow(['ID','Nombre','RIF','Activo']);
  _styleHeader(shC, 4);

  // Despachos: ID | Fecha | TranspCedula | TranspNombre | ClienteID | ClienteNombre | RIF | Facturas | Observaciones | Ubicación
  const shD = ss.getSheetByName(SHEET_DESPACHOS) || ss.insertSheet(SHEET_DESPACHOS);
  shD.clearContents();
  shD.appendRow(['ID','Fecha','TransportistaCedula','TransportistaNombre','ClienteID','ClienteNombre','RIF','Facturas','Observaciones','Ubicación (Maps)']);
  _styleHeader(shD, 10);
  shD.setColumnWidth(10, 250);

  // Config
  const shCfg = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG);
  shCfg.clearContents();
  shCfg.appendRow(['Clave','Valor']);
  shCfg.appendRow(['version','1.2']);
  shCfg.appendRow(['empresa','Natulac']);
  _styleHeader(shCfg, 2);

  SpreadsheetApp.flush();
  try {
    SpreadsheetApp.getUi().alert('✅ Hojas creadas (v1.2).\n\nEjecuta "insertarDatosDePrueba()" para agregar datos de ejemplo.');
  } catch (e) {
    Logger.log('✅ Hojas creadas (v1.2).');
  }
}

function _styleHeader(sheet, cols) {
  sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#003087').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

// ─────────────────────────────────────────────────────────
//  DATOS DE PRUEBA
// ─────────────────────────────────────────────────────────
function insertarDatosDePrueba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.getSheetByName(SHEET_USUARIOS).appendRow(['12345678','admin123','Admin','Carlos Rodríguez','true']);
  ss.getSheetByName(SHEET_USUARIOS).appendRow(['87654321','user123', 'User', 'Pedro Gómez',     'true']);
  ss.getSheetByName(SHEET_USUARIOS).appendRow(['11223344','user456', 'User', 'Luis Martínez',   'true']);

  const clientes = [
    ['C001','Distribuidora El Sol',   'J-12345678-9','true'],
    ['C002','Supermercado La Colina', 'J-98765432-1','true'],
    ['C003','Bodega Central Caracas', 'J-11223344-5','true'],
    ['C004','Mini Market Los Andes',  'V-44556677',  'true'],
    ['C005','Abastos El Progreso',    'J-55667788-2','true'],
  ];
  clientes.forEach(c => ss.getSheetByName(SHEET_CLIENTES).appendRow(c));

  SpreadsheetApp.flush();
  try {
    SpreadsheetApp.getUi().alert('✅ Datos insertados.\n\nAdmin: 12345678 / admin123\nUser:  87654321 / user123');
  } catch (e) {
    Logger.log('✅ Datos de prueba insertados.');
  }
}
