const CACHE_NAME = "cashcontrol-v6";

// Assets da interface que ficam em cache (app shell)
const STATIC_ASSETS = [
"/",
"/index.html",
"/login.html",
"/style.css",
"/app.js",
"/lion.js",
"/auth.js",
"/logo.png",
"/favicon.ico",
"/manifest.json"
];

self.addEventListener("install", (event) => {
event.waitUntil(
caches.open(CACHE_NAME).then((cache) => {
// addAll falha se qualquer asset der 404 — usamos add individual
return Promise.allSettled(
STATIC_ASSETS.map((url) => cache.add(url).catch(() => {}))
);
})
);
self.skipWaiting();
});

self.addEventListener("activate", (event) => {
event.waitUntil(
caches.keys().then((keys) =>
Promise.all(
keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
)
)
);
self.clients.claim();
});

self.addEventListener("fetch", (event) => {
const url = new URL(event.request.url);

// Chamadas de API: sempre vai para a rede, nunca cache
if (url.pathname.startsWith("/api/")) return;

// Assets estáticos: cache primeiro, rede como fallback
event.respondWith(
caches.match(event.request).then((cached) => {
if (cached) return cached;
return fetch(event.request).then((response) => {
// Guarda em cache apenas respostas bem-sucedidas de mesma origem
if (
response.ok &&
response.type === "basic" &&
event.request.method === "GET"
) {
const clone = response.clone();
caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
}
return response;
});
})
);
});
