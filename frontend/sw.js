self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || "Nueva notificación" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Ready Express Now", {
    body: data.body || "Tienes una actualización en tu cuenta.",
    icon: "/images/favicon.png",
    badge: "/images/favicon-32.png",
    data: { url: data.url || "/cuenta.html#referidos" },
    tag: "referral-purchase"
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/cuenta.html#referidos", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => "focus" in client);
    if (existing) { existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});

