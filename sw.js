self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {});

/* avisos no celular (Web Push): mostra a notificação e, ao tocar, abre o app em Pendentes */
self.addEventListener('push', (e) => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){}
  e.waitUntil(self.registration.showNotification(d.titulo || 'Controle Financeiro', {
    body: d.corpo || '', icon: '/icon-v3.png', badge: '/icon-v3.png', tag: d.tag || undefined,
    data: { url: d.url || '/#pendentes' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/#pendentes';
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const j of janelas){
      if('focus' in j){ await j.focus(); j.postMessage({ tipo: 'ir', sec: 'pendentes' }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
