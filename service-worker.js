self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("app").then(cache =>
      cache.addAll([
        "/",
        "/index.html",
        "/styles.css"
      ])
    )
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
