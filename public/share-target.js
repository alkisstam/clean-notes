// Imported by the generated service worker. A share arrives as a POST, which only a worker can receive.
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
