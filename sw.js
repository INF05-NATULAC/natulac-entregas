/**
 * ╔══════════════════════════════════════════════════════╗
 *  NATULAC PWA · sw.js (Service Worker)
 *  Estrategia: Cache First para assets, Network First para API
 * ╚══════════════════════════════════════════════════════╝
 */

'use strict';

const SW_VERSION   = 'natulac-v1.0.2';
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_DYNAMIC= `${SW_VERSION}-dynamic`;

// Archivos que se cachean en la instalación (app shell)
const STATIC_ASSETS = [
  './',
  './index.html',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Bootstrap CSS & JS (CDN — se cachea en primera visita)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ─────────────────────────────────────────────────────────────
//  INSTALL — Pre-cache del app shell
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando:', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-cacheando assets estáticos...');
        // addAll falla si algún asset falla; usamos add individual para robustez
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] No se pudo cachear:', url, e)))
        );
      })
      .then(() => self.skipWaiting()) // Activa inmediatamente sin esperar cierre de tabs
  );
});

// ─────────────────────────────────────────────────────────────
//  ACTIVATE — Limpia caches antiguas
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activando:', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log('[SW] Eliminando caché antigua:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim()) // Toma control de todos los tabs abiertos
  );
});

// ─────────────────────────────────────────────────────────────
//  FETCH — Estrategia híbrida
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Peticiones al GAS (API) → Network Only (sin cachear respuestas de API)
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // 2. Google Fonts → Stale-While-Revalidate
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_DYNAMIC));
    return;
  }

  // 3. CDN assets (Bootstrap, Icons) → Cache First
  if (url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // 4. App shell (HTML, JS, manifest, icons) → Cache First con fallback de red
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // 5. Todo lo demás → Network First
  event.respondWith(networkFirst(event.request, CACHE_DYNAMIC));
});

// ─────────────────────────────────────────────────────────────
//  ESTRATEGIAS DE CACHÉ
// ─────────────────────────────────────────────────────────────

/** Cache First: sirve desde caché si existe, sino red y guarda */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/** Network First: intenta red, si falla usa caché */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/** Network Only: solo red, sin caché */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, mensaje: 'Sin conexión a internet.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Stale-While-Revalidate: sirve caché inmediatamente y actualiza en background */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || networkPromise;
}

/** Fallback para cuando todo falla y la app está offline */
function offlineFallback(request) {
  const acceptHeader = request.headers.get('Accept') || '';
  if (acceptHeader.includes('text/html')) {
    return caches.match('./index.html');
  }
  return new Response('Contenido no disponible sin conexión.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ─────────────────────────────────────────────────────────────
//  BACKGROUND SYNC (Opcional — API experimental)
//  Si el navegador lo soporta, registra sync para la cola offline.
//  El script.js ya maneja la cola manualmente como fallback.
// ─────────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'natulac-sync-despachos') {
    console.log('[SW] Background sync: natulac-sync-despachos');
    event.waitUntil(syncPendingDespachos());
  }
});

async function syncPendingDespachos() {
  // Notifica al cliente para que ejecute flushOfflineQueue()
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_QUEUE' }));
}

// ─────────────────────────────────────────────────────────────
//  PUSH NOTIFICATIONS (base — expandible)
// ─────────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'Nueva notificación de Natulac.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || './' },
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Natulac', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || './')
  );
});
