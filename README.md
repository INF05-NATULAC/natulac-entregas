# Natulac PWA — Guía de Configuración Completa

## 📁 Estructura de archivos

```
natulac-pwa/
├── index.html          ← App principal (UI)
├── script.js           ← Lógica frontend
├── sw.js               ← Service Worker (PWA offline)
├── manifest.json       ← Configuración PWA instalable
├── Code.gs             ← Pegar en Google Apps Script
└── icons/              ← Carpeta de íconos (crear manualmente)
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png
    ├── icon-192.png    ← Requerido
    ├── icon-384.png
    └── icon-512.png    ← Requerido
```

---

## 🔧 PASO 1 — Configurar Google Sheets + Apps Script

### 1.1 Crear el Google Sheet
1. Ve a [sheets.google.com](https://sheets.google.com) y crea una nueva hoja.
2. Nómbrala **"Natulac Despachos"** (o cualquier nombre).

### 1.2 Abrir Apps Script
1. En Google Sheets: `Extensiones → Apps Script`.
2. Borra el contenido del editor (`function myFunction() {}`).
3. **Pega todo el contenido de `Code.gs`** en el editor.
4. Guarda con `Ctrl+S` o `Cmd+S`.

### 1.3 Inicializar las hojas
1. En el menú desplegable de funciones (arriba, a la derecha del botón ▶), selecciona **`setupSheets`**.
2. Haz clic en **▶ Ejecutar**.
3. Autoriza los permisos cuando se solicite (Revisar permisos → cuenta de Google → Avanzado → Ir a Natulac... → Permitir).
4. Verás un alert: *"✅ Hojas creadas correctamente."*

### 1.4 Insertar datos de prueba
1. Selecciona la función **`insertarDatosDePrueba`**.
2. Haz clic en **▶ Ejecutar**.
3. Verás el alert con las credenciales de prueba.

### 1.5 Desplegar como Web App
1. Haz clic en el botón azul **"Implementar"** → **"Nueva implementación"**.
2. Haz clic en el ícono ⚙️ → **"Aplicación web"**.
3. Configura:
   - **Descripción**: `Natulac API v1`
   - **Ejecutar como**: `Yo (tu-email@gmail.com)`
   - **Quién tiene acceso**: `Cualquier persona`
4. Haz clic en **"Implementar"**.
5. **Copia la URL** que aparece. Tiene este formato:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> ⚠️ **Cada vez que modifiques el código**, debes hacer una **nueva implementación** (no "gestionar implementaciones actuales"). De lo contrario los cambios no se reflejan.

---

## 🔧 PASO 2 — Configurar el Frontend

### 2.1 Insertar la URL del script
Abre `script.js` y busca la línea:
```javascript
GAS_URL: 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID_AQUI/exec',
```
Reemplaza `TU_DEPLOYMENT_ID_AQUI` con la URL completa copiada en el Paso 1.5.

---

## 🔧 PASO 3 — Crear los íconos PWA

La app requiere íconos para ser instalable. Tienes 3 opciones:

### Opción A: Usar una herramienta online (recomendado)
1. Ve a [https://realfavicongenerator.net](https://realfavicongenerator.net) o [https://maskable.app/editor](https://maskable.app/editor).
2. Sube un logo de Natulac (o cualquier imagen 512×512px).
3. Descarga el paquete de íconos.
4. Copia los archivos a la carpeta `icons/`.

### Opción B: Usar favicon.io
1. Ve a [https://favicon.io/favicon-generator/](https://favicon.io/favicon-generator/).
2. Genera íconos con el texto "N" y fondo verde `#0a4f3c`.
3. Descarga y renombra según los tamaños requeridos.

### Opción C: Placeholder SVG (solo para pruebas)
Crea un archivo `icons/icon-192.png` de 192×192px con cualquier imagen. La app funcionará aunque el ícono no sea perfecto.

---

## 🔧 PASO 4 — Publicar en GitHub Pages

### 4.1 Crear el repositorio
```bash
git init natulac-pwa
cd natulac-pwa
# Copia todos los archivos aquí
git add .
git commit -m "feat: Natulac PWA v1.0"
git remote add origin https://github.com/TU_USUARIO/natulac-pwa.git
git push -u origin main
```

### 4.2 Activar GitHub Pages
1. Ve a tu repositorio en GitHub.
2. `Settings → Pages`.
3. **Source**: `Deploy from a branch`.
4. **Branch**: `main`, carpeta `/` (root).
5. Haz clic en **"Save"**.
6. En 1-2 minutos la app estará disponible en:
   ```
   https://TU_USUARIO.github.io/natulac-pwa/
   ```

> ⚠️ **IMPORTANTE**: GitHub Pages requiere HTTPS, que ya está habilitado por defecto. El Service Worker **solo funciona en HTTPS** (o localhost), por lo que esta configuración es correcta.

---

## 📱 PASO 5 — Instalar en celulares de los transportistas

### Android (Chrome)
1. Abrir la URL en Chrome.
2. Aparecerá el banner automático **"Instalar Natulac"** en la parte superior.
3. Tocar **"Instalar"** → La app queda en el home screen como app nativa.

### iOS (Safari)
1. Abrir la URL en **Safari** (no Chrome en iOS).
2. Tocar el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Seleccionar **"Añadir a pantalla de inicio"**.
4. Confirmar.

---

## 🗄️ Estructura de datos en Google Sheets

### Hoja: Usuarios
| Cedula | Clave | Rol | Nombre | Activo |
|--------|-------|-----|--------|--------|
| 12345678 | admin123 | Admin | Carlos Rodríguez | true |
| 87654321 | user123 | User | Pedro Gómez | true |

### Hoja: Clientes
| ID | Nombre | RIF | Zona | Telefono | Activo |
|----|--------|-----|------|----------|--------|
| C001 | Distribuidora El Sol | J-12345678-9 | Zona Norte | 0412-xxx | true |

### Hoja: Despachos (generada automáticamente)
| ID | Fecha | TransportistaCedula | TransportistaNombre | ClienteID | ClienteNombre | RIF | Zona | Producto | Cantidad | Unidad | Facturas | Observaciones | Latitud | Longitud |
|----|-------|---------------------|---------------------|-----------|---------------|-----|------|----------|----------|--------|----------|---------------|---------|----------|

---

## 🔐 Seguridad — Recomendaciones

1. **Contraseñas**: En producción, hashea las claves en Apps Script con `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clave)`.
2. **Validación**: El `Code.gs` incluye validación servidor-lado para todos los campos críticos.
3. **HTTPS**: GitHub Pages lo provee por defecto. No despliegues en HTTP.
4. **Roles**: El frontend y backend validan el rol. Un User no puede ver la pestaña Admin aunque inspeccione el código.

---

## 🚀 Funcionalidades incluidas

| Función | Estado |
|---------|--------|
| Login por Cédula/Clave | ✅ |
| Roles Admin / User | ✅ |
| Búsqueda predictiva local (sin latencia) | ✅ |
| Caché local de clientes (6h) | ✅ |
| Facturas dinámicas (N por despacho) | ✅ |
| GPS automático al enviar | ✅ |
| Fecha/hora automática | ✅ |
| Panel Admin con tabla de registros | ✅ |
| Sincronización de BD de clientes | ✅ |
| Modo offline con cola local | ✅ |
| Flush automático al recuperar red | ✅ |
| Instalable en Android / iOS | ✅ |
| Service Worker (Cache First + Network First) | ✅ |
| Banner de instalación PWA | ✅ |

---

## 🐛 Solución de problemas frecuentes

**La búsqueda de clientes no muestra resultados**
→ Verifica que la URL del GAS esté correctamente configurada en `script.js`. Revisa la consola del navegador (F12).

**Error CORS al hacer fetch**
→ Asegúrate de que la Web App esté desplegada con acceso: *"Cualquier persona"*. Haz una nueva implementación si cambiaste el código.

**La PWA no se instala**
→ Verifica que la app esté en HTTPS, que el `manifest.json` sea válido (usar [https://web.dev/measure/](https://web.dev/measure/)) y que el Service Worker esté registrado (DevTools → Application → Service Workers).

**Los despachos no se guardan**
→ Verifica los logs en Apps Script: `Ver → Registros de ejecución`.
