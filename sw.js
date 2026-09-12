const CACHE = 'meetflow-shell-v3';
const CORE = ['./','./index.html','./styles.css','./meetflow.js','./supabase-config.js','./manifest.webmanifest','./assets/icons/icon-192.png','./assets/icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('meetflow-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!CORE.some(path => new URL(path,self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(async response => {
    if(response.ok) { const cache=await caches.open(CACHE); await cache.put(event.request,response.clone()); }
    return response;
  }).catch(async()=> (await caches.match(event.request)) || (event.request.mode==='navigate' ? await caches.match('./index.html') : Response.error())));
});
