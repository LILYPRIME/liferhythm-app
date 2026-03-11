const APP_ICON = new URL('./app-icon-192.png', self.registration.scope).toString();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function resolveUrl(rawUrl) {
  return new URL(rawUrl || './', self.registration.scope).toString();
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'LifeRhythm';
  const options = {
    body: payload.body || '',
    icon: APP_ICON,
    badge: APP_ICON,
    tag: payload.tag || (payload.sessionId ? `lr-${payload.sessionId}` : 'lr-push'),
    renotify: !!payload.renotify,
    data: Object.assign({}, payload, {
      url: resolveUrl(payload.url || './'),
    }),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || resolveUrl('./');

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      try {
        if ('focus' in client) {
          await client.focus();
        }
        if ('navigate' in client) {
          await client.navigate(targetUrl);
        }
        return;
      } catch (error) {
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
