const VERSION = 'bandeco-v198-datas-cardapio-schedule';
const SHELL = ['/', '/index.html', '/config.js', '/assets/app.js', '/assets/dish-category.js', '/assets/date-availability.js', '/assets/hours.js', '/assets/styles.css', '/assets/restaurantes/setorial-i.webp', '/assets/restaurantes/setorial-ii.webp', '/assets/restaurantes/direito.webp', '/assets/restaurantes/saude.webp', '/assets/restaurantes/ica.webp', '/assets/icons/icon.svg', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png', '/assets/icons/apple-touch-icon.png', '/manifest.webmanifest', '/data/cardapios.json'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Firestore e FUMP nunca são cacheados por este SW.
  if (url.pathname.startsWith('/data/') || url.pathname === '/config.js' || event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {const clone = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request,clone)).catch(()=>{});}
      return response;
    }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response=>{
    if (response.ok) { const clone = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request,clone)).catch(()=>{}); }
    return response;
  })));
});
