const VERSION='vozchat-shell-v31';
const ASSETS=['/app','/play-solo.js','/play-history.js','/neon-maze-ui.js','/neon-maze-engine.js','/theme.js','/premium.css','/call-ringtone.js','/talk','/install-guide.css','/install-guide.js','/styles.css','/app.js','/talk.js','/talk.css','/talk.webmanifest','/icons/flowtalk.svg','/talk-worklet.js','/livekit.bundle.js','/call.bundle.js','/icons/icon.svg','/icons/icon-maskable.svg','/icons/icon-192.png','/icons/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).pathname.startsWith('/api/'))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch{}
  const title=String(payload.title||'VozChat').slice(0,70);
  const body=String(payload.body||'Você recebeu uma nova mensagem.').slice(0,140);
  const safeId=/^[0-9a-f-]{36}$/i.test(payload.roomId||'')?payload.roomId:'';
  const isTalk=payload.kind==='talk';
  const isCall=payload.kind==='call';
  const isContactRequest=payload.kind==='contact-request';
  const safeCallId=/^[0-9a-f-]{36}$/i.test(payload.callId||'')?payload.callId:'';
  const url=isContactRequest?'/app?requests=1':
    safeId?(isCall&&safeCallId?'/app?open='+encodeURIComponent(safeId)+'&call='+encodeURIComponent(safeCallId):
    isTalk?'/talk?room='+encodeURIComponent(safeId)+'&join=1':'/app?open='+encodeURIComponent(safeId)):'/app';
  const safeProfile=/^[0-9a-f-]{36}$/i.test(payload.profileId||'')?payload.profileId:'';
  // Ao tocar a notificação, muda apenas para um perfil pertencente à própria conta.
  const notificationUrl=new URL(url,self.location.origin);
  if(safeProfile&&notificationUrl.pathname==='/app')notificationUrl.searchParams.set('identity',safeProfile);
  event.waitUntil((async()=>{
    await self.registration.showNotification(title,{
      body,
      icon:'/icons/icon-192.png',
      badge:'/icons/icon-192.png',
      tag:typeof payload.tag==='string'?payload.tag.slice(0,90):'vozchat-message',
      renotify:true,
      vibrate:isCall?[220,100,220,100,220]:isTalk?[180,100,180,100,180]:isContactRequest?[180,90,180]:[100,60,100],
      requireInteraction:isTalk||isCall||isContactRequest,
      timestamp:Date.now(),
      data:{url:notificationUrl.pathname+notificationUrl.search,roomId:safeId}
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
