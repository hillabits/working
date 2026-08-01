// Weekly Rhythm — minimal service worker.
//
// The ONLY job of this file is to make ServiceWorkerRegistration.showNotification()
// available. On Android, the page itself is not allowed to call `new Notification()` —
// Chrome (and every other Android browser) throws "Illegal constructor" and requires a
// notification to be shown *through* a registered service worker instead. Desktop browsers
// allow both, but registering this makes behavior consistent everywhere.
//
// It deliberately does NOT do any caching / offline / fetch interception — this app doesn't
// need that, and adding it would risk serving stale content.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fired when a real Web Push message arrives from the server (see
// supabase/functions/send-due-alarms). Unlike everything else in this app, this can wake the
// device even with the screen fully off and the tab fully frozen — the OS's push service is
// what delivers it, not the page.
self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ /* not JSON — use defaults below */ }
  const title = data.title || 'Weekly Rhythm';
  const options = {
    body: data.body || "Time's up.",
    tag: data.tag || 'wr-push',
    vibrate: [200, 100, 200],
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses (or opens) the app instead of leaving a dead notification
// sitting in the tray.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
