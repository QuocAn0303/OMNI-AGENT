/**
 * Frontend: src/sw.js — Service Worker (vite-plugin-pwa injectManifest)
 *
 * - Precache toàn bộ app shell (workbox) + Navigation fallback cho SPA
 * - Nhận Web Push (PWA) → showNotification
 * - Click notification → focus/open trang đích (link trong payload)
 */
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback — không chặn API/socket
const handler = createHandlerBoundToURL("index.html");
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//, /^\/socket\.io\//],
});
registerRoute(navigationRoute);

// ============ WEB PUSH ============

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // payload không phải JSON — bỏ qua
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Aduu ERP", {
      body: data.message || "",
      icon: "/aduu.jpeg",
      badge: "/aduu.jpeg",
      data: { url: data.link || "/" },
      tag: `aduu-${data.severity || "info"}`,
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
