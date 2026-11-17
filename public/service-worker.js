/**
 * Hub UFMG PWA: recursos executáveis sempre usam rede primeiro.
 * Cache permanece disponível offline, mas nunca congela uma versão antiga
 * de app.js, config.js ou seus imports após um deploy.
 */
const VERSION = 'hub-v277-20261117-batch3-5-r1';
const SHELL = [
  '/', '/index.html', '/interno', '/favicon.ico', '/config.js',
  '/assets/app.js', '/assets/vendor/leaflet-1.9.4.js',
  '/assets/vendor/leaflet-1.9.4.css', '/assets/fump-live.js', '/assets/fump-prefetch.js',
  '/assets/fump-parse.js', '/assets/dish-category.js',
  '/assets/date-availability.js', '/assets/festas.js',
  '/assets/festas-core.js', '/assets/festas-backend.js',
  '/assets/festas-public-key.json', '/assets/hours.js', '/assets/styles.css',
  '/assets/restaurantes/setorial-i.webp',
  '/assets/restaurantes/setorial-ii.webp',
  '/assets/restaurantes/direito.webp',
  '/assets/restaurantes/saude.webp',
  '/assets/restaurantes/ica.webp', '/assets/icons/icon.svg',
  '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/apple-touch-icon.png', '/manifest.webmanifest',
  '/data/pratos-ingredientes.json'
];
const CORE = [
  '/', '/index.html', '/interno', '/config.js', '/assets/app.js',
  '/assets/fump-live.js', '/assets/fump-parse.js',
  '/assets/fump-prefetch.js', '/assets/dish-category.js',
  '/assets/date-availability.js', '/assets/hours.js', '/assets/styles.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache=await caches.open(VERSION);
    // Falha de um ícone, restaurante ou página auxiliar não bloqueia a
    // atualização do aplicativo inteiro. Os arquivos principais são atômicos.
    await cache.addAll(CORE);
    const extra=SHELL.filter(path=>!CORE.includes(path));
    await Promise.allSettled(extra.map(path=>cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys=await caches.keys();
    await Promise.all(keys
      .filter(key=>key.startsWith('hub-v') && key!==VERSION)
      .map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

function requiresFreshNetwork(request,url) {
  const path=url.pathname;
  return request.mode==='navigate' ||
    path==='/' || path==='/index.html' || path==='/config.js' ||
    path==='/manifest.webmanifest' ||
    path.startsWith('/data/') ||
    path==='/assets/festas-public-key.json' ||
    path.endsWith('.js') || path.endsWith('.mjs') ||
    path.endsWith('.css');
}

self.addEventListener('fetch', event => {
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return; // Nunca armazenar respostas da FUMP/Firestore.

  // Firebase Hosting cleanUrls redireciona /interno/index.html para /interno.
  // A navegacao interceptada pelo SW antigo recebia um redirect opaco e
  // terminava em chrome-error://chromewebdata (mapa completamente branco).
  // Links legados passam pela rota canonica sem exigir limpeza de cache.
  if(url.pathname==='/interno/index.html' && event.request.mode==='navigate') {
    event.respondWith(Response.redirect(new URL('/interno',self.location.origin).href,302));
    return;
  }

  event.respondWith((async()=>{
    const request=event.request;
    const networkFirst=requiresFreshNetwork(request,url);
    const cached=async()=>
      (await caches.match(request,{ignoreSearch:true})) ||
      (request.mode==='navigate' && url.pathname!=='/interno/index.html'
        ? await caches.match('/index.html') : undefined);

    if(!networkFirst){
      const hit=await cached();
      if(hit) return hit;
    }
    try {
      // 'no-store' passa por cima inclusive do cache HTTP do navegador.
      // A resposta ainda é mantida no CacheStorage para funcionar offline.
      const response=networkFirst ? await fetch(request,{cache:'no-store'}) : await fetch(request);
      if(response.ok){
        const clone=response.clone();
        event.waitUntil(caches.open(VERSION)
          .then(cache=>cache.put(request,clone))
          .catch(()=>{}));
        return response;
      }
      const fallback=await cached();
      return fallback || response;
    }catch{
      return (await cached()) || Response.error();
    }
  })());
});
