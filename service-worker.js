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


self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/app";
  event.waitUntil(
    clients.matchAll({type:"window", includeUncontrolled:true}).then(windowClients => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
    })
  );
});
