// Imported by the generated service worker: shares, and reminder notification clicks.
// A share arrives as a POST, which only a worker can receive.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'POST' || new URL(e.request.url).searchParams.get('open') !== 'share') return;
  e.respondWith(
    (async () => {
      const form = await e.request.formData();
      const cache = await caches.open('cn-share');
      await cache.put(new URL('share-pending', self.registration.scope).href, new Response(form));
      return Response.redirect(new URL('./?open=shared', self.registration.scope).href, 303);
    })(),
  );
});

// Done and a click on the body are handed to the open app, which has the notes; Dismiss only closes.
self.addEventListener('notificationclick', (e) => {
  const due = e.notification.data;
  e.notification.close();
  if (!due || e.action === 'dismiss') return;
  e.waitUntil(
    (async () => {
      const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // shortcut: Done with the app closed does nothing; it would need the notes in the worker.
      if (!client) return e.action === 'done' ? undefined : self.clients.openWindow(self.registration.scope);
      if (e.action !== 'done') await client.focus();
      client.postMessage({ type: 'reminder', action: e.action || 'open', due });
    })(),
  );
});
