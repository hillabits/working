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

// --- keeping the server's copy of the push subscription from going stale ---
// Browsers periodically rotate a push subscription's endpoint/keys on their own (Chrome does
// this every so often as part of normal push-service key rotation) — with no warning to the
// page. Nothing in this file used to listen for that, so the row Supabase had on file for this
// device quietly kept pointing at a dead endpoint; the server's push would then just fail
// silently (a 404/410 from the push service) forever after, with no error the user would ever
// see, since it happens whether or not the tab is ever open again. This is very likely why
// screen-off alarms "worked at first, then stopped" rather than never working at all — it can
// take days or weeks for a rotation to happen. Must match the same key used in index.html's
// enablePushAlarms().
const VAPID_PUBLIC_KEY = 'BFqUJ0VAFZ9eCYPT5oGJPz5qpvkB1RNsiHhKVkjL23Y9RiDh5aZpbl-dzFI3NJrU2MeUYQwzkdxrTt6mtJBPkbU';
const SUPABASE_URL = 'https://filciqqqqwpplhnpdeko.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_O9BWULqG4SPvF-d6Y2npcg_XQGJjaLg';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
    const key = (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey)
      || urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let newSub;
    try{
      newSub = event.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: key
      });
    }catch(e){ return; /* resubscription failed/denied — nothing more we can do here */ }

    const json = newSub.toJSON();
    // Write the fresh endpoint/keys straight to Supabase's REST API — the service worker has no
    // access to the page's signed-in client, only the anon key, so this update only reaches the
    // table if its RLS policy allows an anon write keyed by endpoint (the same shape as the
    // matching-by-endpoint DELETE already used in disablePushAlarms). If pushed rows are scoped
    // to auth.uid() instead, this call will be silently rejected by RLS — in that case index.html's
    // refreshPushButtonState() (which runs with a real signed-in session) re-upserts the current
    // subscription every time the app is opened, as a backstop for exactly this case.
    try{
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(oldEndpoint || '')}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
      });
    }catch(e){ /* offline, or RLS rejected it — the page-side backstop above will catch it later */ }
  })());
});
