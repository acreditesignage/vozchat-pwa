const VERSION='vozchat-shell-v4';
const ASSETS=['/app','/styles.css','/app.js','/icons/icon.svg','/icons/icon-maskable.svg','/icons/icon-192.png','/icons/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).pathname.startsWith('/api/'))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch{}
  const title=String(payload.title||'VozChat').slice(0,70);
  const body=String(payload.body||'Você recebeu uma nova mensagem.').slice(0,140);
  const safeId=/^[0-9a-f-]{36}$/i.test(payload.roomId||'')?payload.roomId:'';
  const url=safeId?'/app?open='+encodeURIComponent(safeId):'/app';
  event.waitUntil((async()=>{
    await self.registration.showNotification(title,{
      body,
      icon:'/icons/icon-192.png',
      badge:'/icons/icon-192.png',
      tag:typeof payload.tag==='string'?payload.tag.slice(0,90):'vozchat-message',
      renotify:true,
      vibrate:[100,60,100],
      data:{url,roomId:safeId}
    });
    if('setAppBadge' in self.navigator)try{await self.navigator.setAppBadge();}catch{}
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/app',self.location.origin);
  if(target.origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const same=all.find(c=>new URL(c.url).origin===target.origin);
    if(same){
      try{await same.navigate(target.href);}catch{}
      await same.focus();
    }else await self.clients.openWindow(target.href);
  })());
});
