// Weekly Rhythm service worker
// Required for: (1) showNotification() on Android/Chrome (pages can't call `new Notification()`
// there), and (2) receiving Web Push messages sent by the server while the app is closed or the
// screen is locked. Without this file present at the site root, navigator.serviceWorker.ready
// never resolves, so push subscriptions silently never get created — which is why alarms only
// ever worked on the device with the tab open, and other devices never rang at all.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fired when the server's push (supabase/functions/send-due-alarms) delivers an alarm.
self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ /* non-JSON payload — ignore */ }

  const title = data.title || 'Weekly Rhythm';
  const body = data.body || "Time's up.";
  const tag = data.tag || 'wr-alarm';

  // Note on the alarm "sound": a locked/closed phone can't run this page's WebAudio beep, so
  // the loud custom ring only plays while the tab itself is open and foregrounded. What a push
  // notification CAN do reliably is trigger the device's normal notification sound + vibration
  // pattern below — that's the real, guaranteed cross-device/background signal.
  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: true, // stays on screen until the user dismisses/taps it
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses (or opens) the app instead of just dismissing.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for(const client of clientList){
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
