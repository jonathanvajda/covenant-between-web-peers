const CACHE_PREFIX = 'covenant-peer-chat-';
const CACHE = `${CACHE_PREFIX}v1`;
const ASSETS = ['./', './index.html', './manifest.json', './css/styles.css', './js/app.js',
    './js/core/crypto.js', './js/core/rtc-manager.js', './js/core/module-registry.js', './js/core/bridge.js',
    './js/modules/chat.js', './js/vendor/qrcode.min.js', './js/vendor/html5-qrcode.min.js',
    './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const ASSET_URLS = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));
self.addEventListener('install', event => {
    // Deliberately do not skipWaiting: an update must not replace modules during a live chat.
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // Cache only the immutable app shell. Never cache handshakes or arbitrary fetched content.
    if (url.origin !== self.location.origin || url.search || !ASSET_URLS.has(url.href)) return;
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
