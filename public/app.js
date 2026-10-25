const $ = q => document.querySelector(q);
let me=null, rooms=[], current=null, messages=[], events=null, isRegister=false, recorder=null, pieces=[], recordingStart=0, recordingTicker=null, recordedCanceled=false, deferredInstall=null, pendingFiles=[],pendingRoom=null,previewUrl=null,uploading=false;
const joinParam = new URLSearchParams(location.search).get('join');
const openParam = new URLSearchParams(location.search).get('open');
const talkParam = new URLSearchParams(location.search).get('talk');
const callParam = new URLSearchParams(location.search).get('call');
let currentCall=null,callEngine=null,joiningCall=false,callAttempt=0;
let pendingContactRequests=[];
let uiListMode='chats',uiListFilter='all',favorites=new Set();
const avatar = name => (name||'?').slice(0,1).toUpperCase();
const time = iso => new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const day = iso => new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
let toastTimer;
function toast(msg) {const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3700);}
async function api(url,{method='GET',data,headers={}}={}) {let opt={method,credentials:'same-origin',headers};if(data!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data);}let response;try{response=await fetch(url,opt);}catch{throw new Error('Falha na conexão com o servidor.');}let json=await response.json().catch(()=>({}));if(!response.ok)throw new Error(json.error||'Não foi possível concluir.');return json;}
function showAuth() {window.VozChatRingtone?.stop();me=null;rooms=[];current=null;$('#auth').hidden=false;$('#app').hidden=true;$('#app').classList.remove('chat-open');if(events){events.close();events=null;}}
function sortRooms() {rooms.sort((a,b)=>new Date(b.last?.createdAt||b.createdAt)-new Date(a.last?.createdAt||a.createdAt));}
function authMode(register) {isRegister=register;$('#nameField').hidden=!register;$('#realName').required=register;$('#usernameField').hidden=register;$('#username').required=!register;$('#authDescription').textContent=register?'Escolha como quer ser chamado. Seu ID exclusivo será criado automaticamente.':'Entre com seu ID numérico (ou usuário antigo) e sua senha.';$('#authTitle').textContent=register?'Crie sua conta':'Entre na sua conta';$('#authSubmit').innerHTML=register?'Criar conta <span>→</span>':'Entrar <span>→</span>';$('#authSwitchLabel').firstChild.textContent=register?'Já possui uma conta? ':'Ainda não tem conta? ';$('#authSwitch').textContent=register?'Entrar':'Criar conta';$('#password').autocomplete=register?'new-password':'current-password';}
$('#authSwitch').addEventListener('click',()=>authMode(!isRegister));
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#authSubmit');btn.disabled=true;try {const creating=isRegister;const result=await api(creating?'/api/register':'/api/login',{method:'POST',data:creating?{name:$('#realName').value,password:$('#password').value}:{username:$('#username').value,password:$('#password').value}});$('#password').value='';await start();if(creating&&result.user?.publicId){$('#welcomePublicId').textContent=result.user.publicId;openDialog('welcomeDialog');}}catch(err){toast(err.message);}finally{btn.disabled=false;}});
async function start() {let data;try {data=await api('/api/bootstrap');}catch{showAuth();return;}me=data.user;rooms=data.rooms;sortRooms();loadFavoriteRooms();$('#auth').hidden=true;$('#app').hidden=false;$('#meName').textContent=me.name;$('#meUsername').textContent='ID '+(me.publicId||me.username);paintAvatar($('#meAvatar'),me.name,me.avatarUrl);renderRooms();await refreshContactRequests();connectEvents();void autoRestoreNotifications();if(openParam && rooms.some(r=>r.id===openParam)){await openRoom(openParam);history.replaceState({},'', '/app');if(talkParam==='1')void openLiveRadio();}void syncPendingCalls();if(joinParam){try{const joined=await api('/api/rooms/join',{method:'POST',data:{invite:joinParam}});upsertRoom(joined.room);history.replaceState({},'', '/app');await openRoom(joined.room.id);toast('Você entrou na conversa!');}catch(err){toast(err.message);}}}
function paintAvatar(element,name,url){
  element.replaceChildren();
  element.textContent=avatar(name);
  if(!url)return;
  const img=document.createElement('img');
  img.alt='';img.loading='eager';img.decoding='async';img.className='avatar-image';
  img.addEventListener('error',()=>{
    img.remove();
    // Nunca deixar o espaço da foto vazio se a rede ou a imagem falhar.
    if(!element.firstChild)element.textContent=avatar(name);
    if(element.id==='profilePreview'){
      const status=$('#profilePhotoStatus');
      if(status)status.textContent='A foto foi salva, mas não pôde ser exibida. Feche e reabra o perfil.';
    }
  },{once:true});
  element.replaceChildren(img);
  img.src=url;
}
function upsertRoom(r) {let idx=rooms.findIndex(x=>x.id===r.id);if(idx<0)rooms.push(r);else rooms[idx]={...rooms[idx],...r};sortRooms();renderRooms();if(current===r.id)renderHeader();}
const PHONE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h4l1 5-2 2a16 16 0 0 0 5 5l2-2 5 1v4a3 3 0 0 1-3-3C10 21 3 14 3 6a3 3 0 0 1 3-3Z"/></svg>';
const VIDEO_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4"/></svg>';
function loadFavoriteRooms(){
  try{const value=JSON.parse(localStorage.getItem('vozchat_favorite_rooms_'+me?.id)||'[]');favorites=new Set(Array.isArray(value)?value:[]);}
  catch{favorites=new Set();}
}
function setRoomFavorite(roomId,enabled){
  if(enabled)favorites.add(roomId);else favorites.delete(roomId);
  try{localStorage.setItem('vozchat_favorite_rooms_'+me?.id,JSON.stringify([...favorites]));}catch{}
  renderRooms();
}
function switchMobileTab(mode){
  if(mode==='settings'){$('#settingsButton').click();return;}
  if(!['chats','contacts','calls'].includes(mode))return;
  uiListMode=mode;
  $('#app').dataset.listMode=mode;
  $('#listViewTitle').textContent=mode==='contacts'?'Contatos':mode==='calls'?'Chamadas':'Conversas';
  $('#search').placeholder=mode==='contacts'?'Buscar contato':mode==='calls'?'Buscar alguém para ligar':'Buscar conversa';
  for(const button of document.querySelectorAll('[data-mobile-tab]')){
    if(button.dataset.mobileTab===mode)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  renderRooms();
}
function setConversationFilter(filter){
  if(!['all','favorites','groups','audio'].includes(filter))return;
  uiListFilter=filter;
  for(const button of document.querySelectorAll('[data-list-filter]')){
    button.setAttribute('aria-pressed',String(button.dataset.listFilter===filter));
  }
  renderRooms();
}
function callContactDirectly(roomId,kind){
  if(currentCall){toast('Encerre a chamada atual antes de ligar novamente.');return;}
  void (async()=>{
    try{await openRoom(roomId);await startCall(kind);}
    catch(err){toast(err?.message||'Não foi possível iniciar a chamada.');}
  })();
}
function renderRooms(){
  const list=$('#roomList');list.replaceChildren();
  const term=$('#search').value.trim().toLowerCase();
  const filtered=rooms.filter(room=>{
    if(!room.name.toLowerCase().includes(term)&&!String(room.peerId||'').includes(term))return false;
    if(uiListMode==='contacts'||uiListMode==='calls')return !!room.isDirect;
    if(uiListFilter==='favorites')return favorites.has(room.id);
    if(uiListFilter==='groups')return !room.isDirect;
    if(uiListFilter==='audio')return ['audio','flowtalk'].includes(room.last?.type);
    return true;
  });
  if(!filtered.length){
    const el=document.createElement('p');el.className='list-empty';
    el.textContent=term?'Nenhum resultado encontrado.':
      uiListMode==='contacts'?'Nenhum contato aprovado ainda. Toque em + ID para convidar.':
      uiListMode==='calls'?'Adicione e aprove um contato para fazer chamadas de áudio ou vídeo.':
      uiListFilter==='favorites'?'Toque na estrela de uma conversa para marcar como favorita.':
      uiListFilter==='groups'?'Nenhum grupo ainda. Toque em + para criar.':
      uiListFilter==='audio'?'Nenhuma mensagem de voz recente.':
      'Nenhuma conversa ainda. Toque em + para criar a primeira.';
    list.append(el);return;
  }
  for(const room of filtered){
    const line=document.createElement('div');line.className='room-line';
    const btn=document.createElement('button');btn.type='button';
    btn.className='room-item'+(room.id===current?' active':'');
    const icon=document.createElement('div');icon.className='room-icon';
    paintAvatar(icon,room.name,room.avatarUrl);
    const info=document.createElement('div');info.className='room-info';
    const titleRow=document.createElement('div');titleRow.className='room-name';
    const title=document.createElement('strong');title.textContent=room.name;
    const last=document.createElement('small');last.textContent=room.last?time(room.last.createdAt):'';
    titleRow.append(title,last);
    const preview=document.createElement('div');preview.className='room-preview';
    preview.textContent=uiListMode==='calls'?'Toque em telefone ou vídeo para ligar':
      room.last?room.last.senderName+': '+(room.last.type==='flowtalk'?'FlowTalk':
      room.last.type==='audio'?'🎤 Mensagem de voz':
      ({image:'📷 Foto',video:'🎬 Vídeo',file:'📎 Arquivo'}[room.last.type]||room.last.text)):
      'Conversa privada · toque para abrir';
    info.append(titleRow,preview);btn.append(icon,info);
    btn.addEventListener('click',()=>void openRoom(room.id));
    line.append(btn);
    if(uiListMode==='chats'){
      const favorite=document.createElement('button');
      favorite.type='button';favorite.className='room-favorite';
      favorite.setAttribute('aria-label',favorites.has(room.id)?'Remover dos favoritos':'Adicionar aos favoritos');
      favorite.setAttribute('aria-pressed',String(favorites.has(room.id)));
      favorite.textContent=favorites.has(room.id)?'★':'☆';
      favorite.addEventListener('click',()=>setRoomFavorite(room.id,!favorites.has(room.id)));
      line.append(favorite);
    }else if(room.isDirect){
      for(const [kind,svg] of [['audio',PHONE_ICON],['video',VIDEO_ICON]]){
        const call=document.createElement('button');call.type='button';
        call.className='room-quick-call';call.innerHTML=svg;
        call.setAttribute('aria-label',(kind==='audio'?'Ligar por áudio para ':'Iniciar vídeo com ')+room.name);
        call.addEventListener('click',()=>callContactDirectly(room.id,kind));
        line.append(call);
      }
    }
    list.append(line);
  }
}
for(const button of document.querySelectorAll('[data-mobile-tab]')){
  button.addEventListener('click',()=>switchMobileTab(button.dataset.mobileTab));
}
for(const button of document.querySelectorAll('[data-list-filter]')){
  button.addEventListener('click',()=>setConversationFilter(button.dataset.listFilter));
}
$('#search').addEventListener('input',renderRooms);
// Preferências locais: alertas durante a conversa e notificações do sistema.
const SETTINGS_KEY='vozchat_notification_settings_v1';
let notifyPrefs={sound:true,vibrate:true};
try{notifyPrefs={...notifyPrefs,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};}catch{}
let alertAudio=null,unreadAlerts=0;
const defaultTitle=document.title;
$('#notificationSound').checked=notifyPrefs.sound!==false;
$('#notificationVibrate').checked=notifyPrefs.vibrate!==false;
function saveNotifyPrefs(){
  notifyPrefs={sound:$('#notificationSound').checked,vibrate:$('#notificationVibrate').checked};
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(notifyPrefs));}catch{}
}
$('#notificationSound').addEventListener('change',saveNotifyPrefs);
$('#notificationVibrate').addEventListener('change',saveNotifyPrefs);
function unlockAlertAudio(){
  if(!alertAudio){const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)return;alertAudio=new AudioCtor();}
  if(alertAudio.state==='suspended')void alertAudio.resume().catch(()=>{});
}
document.addEventListener('pointerdown',unlockAlertAudio,{passive:true});
function soundAlert(){
  if(!notifyPrefs.sound)return;
  try{
    unlockAlertAudio();
    if(!alertAudio||alertAudio.state!=='running')return;
    const now=alertAudio.currentTime;
    for(const [freq,at] of [[780,0],[980,.12]]){
      const oscillator=alertAudio.createOscillator(),gain=alertAudio.createGain();
      oscillator.type='sine';oscillator.frequency.value=freq;
      gain.gain.setValueAtTime(.0001,now+at);
      gain.gain.exponentialRampToValueAtTime(.14,now+at+.018);
      gain.gain.exponentialRampToValueAtTime(.0001,now+at+.12);
      oscillator.connect(gain).connect(alertAudio.destination);
      oscillator.start(now+at);oscillator.stop(now+at+.13);
    }
  }catch{}
}
function vibrateAlert(){if(notifyPrefs.vibrate&&typeof navigator.vibrate==='function')try{navigator.vibrate([110,70,110]);}catch{}}
function incomingAlert(msg){
  if(msg.senderId===me?.id)return;
  if(document.visibilityState==='visible'){soundAlert();vibrateAlert();}
  else{unreadAlerts++;document.title='('+unreadAlerts+') VozChat · nova mensagem';}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){unreadAlerts=0;document.title=defaultTitle;}});
function pushSupported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;}
function pushInstallHint(){return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);}
async function refreshNotificationStatus(){
  const status=$('#notificationStatus'),enable=$('#enableNotifications'),disable=$('#disableNotifications');
  if(!pushSupported()){
    status.textContent='Notificações push não suportadas neste navegador. Som no chat e vibração compatível continuam disponíveis.';
    enable.disabled=true;disable.hidden=true;return;
  }
  if(pushInstallHint()){
    status.textContent='No iPhone, instale o VozChat na Tela de Início pelo Safari e abra o aplicativo instalado.';
    enable.disabled=true;disable.hidden=true;return;
  }
  if(Notification.permission==='denied'){
    status.textContent='Notificações bloqueadas. Libere o VozChat nas configurações de notificações do aparelho.';
    enable.disabled=true;disable.hidden=true;return;
  }
  try{
    const config=await api('/api/push/config');
    if(!config.enabled){status.textContent='O servidor ainda não configurou as notificações push.';enable.disabled=true;return;}
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    const active=Notification.permission==='granted'&&subscription&&
      (localStorage.getItem('vozchat_push_uid')===me?.id);
    status.textContent=active?'Ativadas neste aparelho. Você receberá avisos de novas mensagens.':'Toque em Ativar para permitir notificações deste aparelho.';
    enable.disabled=false;enable.hidden=!!active;disable.hidden=!active;
  }catch{status.textContent='Não foi possível consultar as notificações. Tente novamente.';}
}
$('#notificationsButton').addEventListener('click',()=>{
  openDialog('notificationsDialog');
  void refreshNotificationStatus();
});
$('#enableNotifications').addEventListener('click',async()=>{
  if(!me||!pushSupported()||pushInstallHint())return;
  // O pedido ocorre diretamente após o toque, exigência de navegadores móveis.
  const requested=Notification.requestPermission();
  const enable=$('#enableNotifications');enable.disabled=true;
  try{
    const permission=await requested;
    if(permission!=='granted'){toast('Permissão de notificações não concedida.');return;}
    const config=await api('/api/push/config');
    if(!config.enabled||!config.publicKey)throw new Error('Notificações indisponíveis no servidor.');
    const registration=await navigator.serviceWorker.ready;
    const bytes=(b64=>{
      const pad='='.repeat((4-b64.length%4)%4);
      const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
      return Uint8Array.from(raw,c=>c.charCodeAt(0));
    })(config.publicKey);
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    await api('/api/push/subscribe',{method:'POST',data:{subscription:subscription.toJSON()}});
    localStorage.setItem('vozchat_push_uid',me.id);
    unlockAlertAudio();toast('Notificações ativadas!');
  }catch(err){toast(err.message||'Não foi possível ativar notificações.');}
  finally{enable.disabled=false;void refreshNotificationStatus();}
});
$('#disableNotifications').addEventListener('click',async()=>{
  try{
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    if(subscription){
      await api('/api/push/unsubscribe',{method:'POST',data:{endpoint:subscription.endpoint}});
      await subscription.unsubscribe();
    }
    localStorage.removeItem('vozchat_push_uid');toast('Notificações desativadas neste aparelho.');
  }catch(err){toast(err.message||'Falha ao desativar notificações.');}
  void refreshNotificationStatus();
});
$('#testNotifications').addEventListener('click',async()=>{
  unlockAlertAudio();soundAlert();vibrateAlert();
  toast('Teste realizado. Vibração depende do aparelho.');
  if(pushSupported()&&Notification.permission==='granted')try{
    const registration=await navigator.serviceWorker.ready;
    await registration.showNotification('VozChat 🔔',{body:'Este é um teste de notificação.',icon:'/icons/icon-192.png',tag:'vozchat-test',vibrate:[100,50,100],data:{url:'/app'}});
  }catch{}
});
async function autoRestoreNotifications(){
  if(!pushSupported()||Notification.permission!=='granted')return;
  try{
    if(localStorage.getItem('vozchat_push_uid')!==me?.id)return;
    const config=await api('/api/push/config');if(!config.enabled)return;
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    if(subscription)await api('/api/push/subscribe',{method:'POST',data:{subscription:subscription.toJSON()}});
  }catch{}
}
function connectEvents(){
  if(events)events.close();events=new EventSource('/api/events');
  events.addEventListener('contact-requests-changed',()=>{void refreshContactRequests();});
  events.addEventListener('profile-updated',event=>{
    const user=JSON.parse(event.data);
    if(user.userId===me?.id){me.avatarUrl=user.avatarUrl;paintAvatar($('#meAvatar'),me.name,me.avatarUrl);}
    if(current)renderHeader();
    renderRooms();
    void refreshContactRequests();
  });
  events.addEventListener('room',event=>{
    const next=JSON.parse(event.data);upsertRoom(next);
    if($('#groupManageDialog').open&&managedGroup===next.id)void refreshGroupMembers();
  });
  events.addEventListener('talk-incoming',event=>{
    const call=JSON.parse(event.data);
    if(!me||!rooms.some(r=>r.id===call.roomId))return;
    const contact=call.senderName||'Alguém';
    if(document.visibilityState==='visible'){
      soundAlert();vibrateAlert();
      toast('📻 '+contact+' chamou no FlowTalk. Abra o rádio para ouvir.');
      const button=$('#flowtalkToggle');
      if(current===call.roomId&&!liveRadio){
        button.classList.add('talk-incoming');
        setTimeout(()=>button.classList.remove('talk-incoming'),12000);
      }
    }
  });
  events.addEventListener('call-incoming',event=>{
    const incoming=JSON.parse(event.data);
    if(!me||!rooms.some(r=>r.id===incoming.roomId))return;
    if(currentCall&&currentCall.id!==incoming.id)return;
    if(currentCall?.id===incoming.id)return;
    currentCall=incoming;
    presentCall(incoming,true);
  });
  events.addEventListener('call-update',event=>{
    const status=JSON.parse(event.data);
    if(currentCall?.id!==status.id)return;
    currentCall=status;
    if(status.state==='active'&&status.callerId===me?.id)window.VozChatRingtone?.stop();
    if(!$('#callOverlay').hidden&&!$('#callIncomingActions').hidden)return;
    if(!$('#callOverlay').hidden&&!callEngine)$('#callStatus').textContent=status.state==='active'?'Chamada atendida · conectando…':'Chamando…';
  });
  events.addEventListener('call-ended',event=>{
    const stopped=JSON.parse(event.data);
    if(currentCall?.id===stopped.id){
      void closeCallUI(false);
      toast('Chamada encerrada.');
    }
  });
  events.addEventListener('room-removed',event=>{
    const {roomId}=JSON.parse(event.data);rooms=rooms.filter(r=>r.id!==roomId);
    if(managedGroup===roomId){$('#groupManageDialog').close();managedGroup=null;}
    if(current===roomId){stopLiveRadio();resetActiveChat();toast('Você não participa mais deste grupo.');}
    renderRooms();
  });
  events.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.senderId!==me?.id)incomingAlert(msg);
    if(current===msg.roomId&&!messages.some(m=>m.id===msg.id)){
      messages.push(msg);renderMessage(msg);scrollDown();
      
    }else if(current!==msg.roomId){
      const room=rooms.find(x=>x.id===msg.roomId);if(room)toast(`Nova mensagem em ${room.name}`);
    }
  });
  events.onerror=()=>{if(!navigator.onLine)$('#offline').hidden=false;};
}
async function openRoom(roomId){if(current!==roomId){stopLiveRadio();}current=roomId;$('#emptyChat').hidden=true;$('#activeChat').hidden=false;$('#app').classList.add('chat-open');renderHeader();renderRooms();$('#messages').replaceChildren();messages=[];try{const data=await api(`/api/rooms/${roomId}/messages`);if(current!==roomId)return;messages=data.messages;renderMessages();}catch(err){toast(err.message);} }
function renderHeader(){const r=rooms.find(x=>x.id===current);if(!r)return;$('#roomName').textContent=r.name;$('#memberCount').textContent=r.isDirect?'ID '+r.peerId+' · conversa privada':`${r.members} ${r.members===1?'participante':'participantes'} · grupo privado`;$('#inviteButton').hidden=!!r.isDirect;$('#groupManageButton').hidden=!!r.isDirect;paintAvatar($('#headerAvatar'),r.name,r.avatarUrl);$('#removeContactButton').hidden=!r.isDirect;}
function renderMessages(){const list=$('#messages');list.replaceChildren();if(!messages.length){const msg=document.createElement('div');msg.className='mini-welcome';msg.textContent=current&&rooms.find(r=>r.id===current)?.isDirect?'Conversa iniciada ✨\nDiga oi para começar.':'Conversa iniciada ✨\nCompartilhe o convite para outras pessoas entrarem e começarem a trocar mensagens.';list.append(msg);}let lastDay='';for(const m of messages){const key=day(m.createdAt);if(key!==lastDay){const divider=document.createElement('div');divider.className='day-divider';divider.textContent=key;list.append(divider);lastDay=key;}renderMessage(m);}scrollDown();}
function formatSize(size){if(size<1024)return size+' B';if(size<1048576)return (size/1024).toFixed(0)+' KB';if(size<1073741824)return (size/1048576).toFixed(1)+' MB';return (size/1073741824).toFixed(2)+' GB';}
function renderMessage(m){
  const row=document.createElement('div');row.className='bubble-row '+(m.senderId===me.id?'mine':'other');row.dataset.id=m.id;
  if(m.senderId!==me.id){const av=document.createElement('div');av.className='sender-avatar';av.textContent=avatar(m.senderName);row.append(av);}
  const bubble=document.createElement('div');bubble.className='bubble';
  if(m.senderId!==me.id){const author=document.createElement('p');author.className='bubble-author';author.textContent=m.senderName;bubble.append(author);}
  if(m.type==='audio'||m.type==='flowtalk'){
    const lab=document.createElement('div');lab.className='audio-label';lab.textContent=(m.type==='flowtalk'?'📻 FlowTalk · ':'🎤 Mensagem de voz')+(m.duration?' · '+Math.round(m.duration)+'s':'');bubble.append(lab);
    const player=document.createElement('audio');player.controls=true;player.preload='none';player.src='/api/audio/'+encodeURIComponent(m.audioId);player.setAttribute('aria-label','Ouvir áudio enviado');bubble.append(player);
  }else if(['image','video','file'].includes(m.type)&&m.fileId){
    const url='/api/files/'+encodeURIComponent(m.fileId);
    const wrap=document.createElement('div');wrap.className='attachment-message';
    if(m.type==='image' && !/\.hei[cf]$/i.test(m.fileName||'')){
      const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Abrir foto');
      const img=document.createElement('img');img.loading='lazy';img.alt=m.fileName||'Foto enviada';img.className='message-image';img.src=url;link.append(img);wrap.append(link);
    }else if(m.type==='video'){
      const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=url;video.className='message-video';video.setAttribute('aria-label',m.fileName||'Vídeo enviado');wrap.append(video);
    }
    const fileLink=document.createElement('a');fileLink.href=url;fileLink.className='file-link';
    if(m.type==='file'||/\.hei[cf]$/i.test(m.fileName||''))fileLink.setAttribute('download',m.fileName||'anexo');
    fileLink.innerHTML='<span class="file-link-icon" aria-hidden="true">'+({image:'🖼️',video:'🎬',file:'📎'}[m.type]||'📎')+'</span>';
    const details=document.createElement('span');details.className='file-link-info';const name=document.createElement('strong');name.textContent=m.fileName||'Anexo';
    const size=document.createElement('small');size.textContent=formatSize(m.fileSize||0);details.append(name,size);fileLink.append(details);wrap.append(fileLink);bubble.append(wrap);
  }else{
    const content=document.createElement('div');content.className='bubble-text';content.textContent=m.text||'';bubble.append(content);
  }
  const meta=document.createElement('div');meta.className='bubble-meta';meta.textContent=time(m.createdAt)+(m.senderId===me.id?'  ✓':'');bubble.append(meta);row.append(bubble);$('#messages').append(row);
}

function scrollDown() {const list=$('#messages');requestAnimationFrame(()=>{list.scrollTop=list.scrollHeight;});}
function openDialog(id){document.getElementById(id).showModal();}

function resetActiveChat(){
  current=null;messages=[];
  $('#app').classList.remove('chat-open');
  $('#emptyChat').hidden=false;$('#activeChat').hidden=true;
  $('#messages').replaceChildren();
  $('#flowtalkPanel').hidden=true;
  $('#flowtalkToggle').setAttribute('aria-pressed','false');
  renderRooms();
}
let managedGroup=null;
async function refreshGroupMembers(){
  const id=managedGroup;if(!id)return;
  const result=await api('/api/rooms/'+id+'/members');
  if(managedGroup!==id)return;
  const isOwner=!!result.room.isOwner;
  $('#groupManageDescription').textContent=result.room.name+' · '+result.members.length+' participantes';
  $('#groupAddForm').hidden=!isOwner;
  $('#groupDeleteButton').hidden=!isOwner;
  $('#groupLeaveButton').hidden=isOwner;
  const list=$('#groupMembersList');list.replaceChildren();
  for(const member of result.members){
    const item=document.createElement('div');item.className='group-member';
    const info=document.createElement('div');info.className='group-member-info';
    const name=document.createElement('strong');name.textContent=member.name+(member.isOwner?' 👑':'');
    const idText=document.createElement('small');idText.textContent='ID '+member.publicId;
    info.append(name,idText);item.append(info);
    if(isOwner&&!member.isOwner){
      const kick=document.createElement('button');
      kick.type='button';kick.className='group-remove';
      kick.textContent='Remover';kick.setAttribute('aria-label','Remover '+member.name);
      kick.addEventListener('click',async()=>{
        if(!confirm('Remover '+member.name+' do grupo? O convite antigo será invalidado.'))return;
        kick.disabled=true;
        try{
          await api('/api/rooms/'+id+'/members/'+encodeURIComponent(member.publicId),{method:'DELETE'});
          toast(member.name+' removido(a).');await refreshGroupMembers();
        }catch(err){toast(err.message);kick.disabled=false;}
      });
      item.append(kick);
    }
    list.append(item);
  }
}
$('#groupManageButton').addEventListener('click',async()=>{
  const room=rooms.find(r=>r.id===current);if(!room||room.isDirect)return;
  managedGroup=room.id;openDialog('groupManageDialog');
  try{await refreshGroupMembers();}catch(err){toast(err.message);$('#groupManageDialog').close();}
});
$('#groupManageDialog').addEventListener('close',()=>{managedGroup=null;});
$('#groupAddForm').addEventListener('submit',async e=>{
  e.preventDefault();const id=managedGroup;if(!id)return;
  const button=$('#groupAddSubmit');button.disabled=true;
  try{
    await api('/api/rooms/'+id+'/members',{method:'POST',data:{publicId:$('#groupAddId').value.trim()}});
    $('#groupAddId').value='';await refreshGroupMembers();toast('Participante adicionado.');
  }catch(err){toast(err.message);}finally{button.disabled=false;}
});
$('#groupLeaveButton').addEventListener('click',async()=>{
  const id=managedGroup;if(!id||!confirm('Deseja sair deste grupo?'))return;
  try{
    await api('/api/rooms/'+id+'/leave',{method:'POST'});$('#groupManageDialog').close();
    rooms=rooms.filter(r=>r.id!==id);if(current===id){stopLiveRadio();resetActiveChat();}
    toast('Você saiu do grupo.');
  }catch(err){toast(err.message);}
});
$('#groupDeleteButton').addEventListener('click',async()=>{
  const id=managedGroup;if(!id||!confirm('Excluir este grupo DEFINITIVAMENTE? Todas as mensagens e arquivos serão apagados para todos os participantes.'))return;
  const button=$('#groupDeleteButton');button.disabled=true;
  try{
    await api('/api/rooms/'+id,{method:'DELETE'});$('#groupManageDialog').close();
    rooms=rooms.filter(r=>r.id!==id);if(current===id){stopLiveRadio();resetActiveChat();}
    toast('Grupo excluído definitivamente.');
  }catch(err){toast(err.message);}finally{button.disabled=false;}
});
// FlowTalk ao vivo: captura e toca pacotes PCM de 20 ms em Web Audio.
// O servidor só encaminha a voz durante o pressionamento; não grava nem cria mensagens.
let liveRadio=null;
let livekitController=null;
let livekitOpening=false;
const talkButton=$('#flowtalkHold'),listenButton=$('#flowtalkListen'),talkStop=$('#flowtalkStop');
function liveStatus(text){$('#flowtalkStatus').textContent=text;}
function radioSend(session,payload){
  if(session.ws?.readyState===WebSocket.OPEN)session.ws.send(JSON.stringify(payload));
}
function radioUI(session){
  if(liveRadio!==session)return;
  const count=session.peerCount||0;
  const occupied=!!session.speakerId&&session.speakerId!==session.clientId;
  talkButton.disabled=!session.ready||occupied||session.ctx?.state==='closed';
  $('#flowtalkParticipants').textContent=count+' participante(s) conectado(s) · rádio ao vivo';
  if(occupied)liveStatus('📻 '+(session.speakerName||'Outra pessoa')+' está falando agora');
  else if(!session.holding)liveStatus(count?'Canal livre · segure para falar AO VIVO':'Canal livre · segure para chamar seus contatos');
}
function resetRadioSpeaker(session){
  session.speakerNode?.port.postMessage({type:'reset'});
}
function stopLiveRadio(){
  endTalkHold();releasePushToTalk();
  talkStop.hidden=true;
  if(livekitController){livekitController.release();livekitController.close();livekitController=null;}
  const session=liveRadio;
  if(!session)return;
  liveRadio=null;session.holding=false;session.granted=false;
  if(session.track)session.track.enabled=false;
  session.micNode?.port.postMessage({type:'enabled',value:false});
  radioSend(session,{type:'floor-release'});
  try{session.ws?.close(1000,'Rádio encerrado');}catch{}
  try{session.stream?.getTracks().forEach(t=>t.stop());}catch{}
  try{session.micNode?.disconnect();session.speakerNode?.disconnect();session.micSource?.disconnect();}catch{}
  try{void session.ctx?.close();}catch{}
  talkButton.classList.remove('talking');
  talkButton.textContent='Segure para falar';
  talkButton.disabled=true;
  $('#flowtalkPanel').hidden=true;
  $('#flowtalkToggle').classList.remove('flowtalk-active');
  $('#flowtalkToggle').setAttribute('aria-pressed','false');
  liveStatus('Rádio desligado.');
}
async function acquireRadioMic(session){
  if(session.track?.readyState==='live')return;
  // A primeira tentativa acontece no gesto de tocar em "falar"; autorização futura é decisão do navegador.
  const stream=await navigator.mediaDevices.getUserMedia({audio:{
    echoCancellation:true,noiseSuppression:true,autoGainControl:true
  }});
  if(liveRadio!==session){stream.getTracks().forEach(t=>t.stop());return;}
  session.stream=stream;session.track=stream.getAudioTracks()[0];
  if(!session.track)throw Error('Microfone não encontrado.');
  session.track.enabled=false;
  session.track.onended=()=>{if(liveRadio===session){toast('Microfone desconectado.');stopLiveRadio();}};
  const micSource=session.ctx.createMediaStreamSource(stream);
  const micNode=new AudioWorkletNode(session.ctx,'vozchat-mic-stream',{
    numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]
  });
  const silent=session.ctx.createGain();silent.gain.value=0;
  micSource.connect(micNode).connect(silent).connect(session.ctx.destination);
  session.micNode=micNode;session.micSource=micSource;
  micNode.port.onmessage=e=>{
    if(liveRadio!==session||!session.granted||!session.holding||session.ws?.readyState!==WebSocket.OPEN)return;
    const pcm=e.data?.pcm;
    if(!(pcm instanceof ArrayBuffer)||pcm.byteLength!==640)return;
    session.framesSent=(session.framesSent||0)+1;
    if(session.ws.bufferedAmount<16384)session.ws.send(pcm);
  };
}
async function startRadioTalk(){
  if(livekitController){livekitController.press();return;}
  const session=liveRadio;
  if(!session?.ready||session.holding||talkButton.disabled)return;
  session.holding=true;session.granted=false;
  liveStatus('Preparando microfone...');
  // Resume antes de esperar o microfone, preservando o gesto do usuário no Safari.
  if(session.ctx.state==='suspended')void session.ctx.resume().catch(()=>{});
  try{
    await acquireRadioMic(session);
    if(liveRadio!==session||!session.holding)return;
    liveStatus('Chamando no rádio...');
    radioSend(session,{type:'floor-request'});
  }catch(err){
    if(liveRadio===session){
      session.holding=false;
      liveStatus(err.name==='NotAllowedError'?'Microfone bloqueado. Autorize nas configurações.':'Não foi possível ligar o microfone.');
      toast(err.message||'Microfone indisponível.');
    }
  }
}
function stopRadioTalk(){
  if(livekitController){livekitController.release();return;}
  const session=liveRadio;if(!session)return;
  session.holding=false;session.granted=false;
  if(session.track)session.track.enabled=false;
  session.micNode?.port.postMessage({type:'enabled',value:false});
  talkButton.classList.remove('talking');
  talkButton.textContent='Segure para falar';
  talkStop.hidden=true;
  radioSend(session,{type:'floor-release'});
  radioUI(session);
}
async function openLiveRadio(){
  if(liveRadio||livekitController){stopLiveRadio();return;}
  if(livekitOpening)return;
  livekitOpening=true;
  let provider;
  try{provider=await api('/api/talk/provider');}
  catch(err){livekitOpening=false;toast(err.message);return;}
  if(provider.provider==='livekit'){
    $('#flowtalkPanel').hidden=false;
    $('#flowtalkStatus').textContent='Abrindo LiveKit...';
    try{
      const {startLiveKitRadio}=await import('/livekit.bundle.js');
      livekitController=await startLiveKitRadio({roomId:current,api,notify:toast});
    }catch(err){
      toast('Falha no LiveKit: '+(err?.message||'verifique configuração'));
      $('#flowtalkPanel').hidden=true;
    }finally{livekitOpening=false;}
    return;
  }
  livekitOpening=false;
  if(!current||!navigator.mediaDevices?.getUserMedia||!window.WebSocket||
    !window.AudioContext&&!window.webkitAudioContext||!window.AudioWorkletNode){
    toast('Seu navegador não permite rádio ao vivo. Atualize o Safari ou Chrome.');return;
  }
  const Context=window.AudioContext||window.webkitAudioContext;
  // O receptor pode entrar e ouvir sem liberar o microfone.
  const ctx=new Context({latencyHint:'interactive'});
  // Não aguardar resume(): em alguns iPhones a Promise fica pendente indefinidamente.
  void ctx.resume().catch(()=>{});
  const session={roomId:current,ctx,ws:null,stream:null,track:null,micNode:null,speakerNode:null,
    micSource:null,clientId:null,ready:false,holding:false,granted:false,
    speakerId:null,speakerName:null,peerCount:0,framesReceived:0,framesSent:0};
  liveRadio=session;
  $('#flowtalkPanel').hidden=false;
  $('#flowtalkToggle').classList.add('flowtalk-active');
  $('#flowtalkToggle').setAttribute('aria-pressed','true');
  listenButton.hidden=false;talkButton.disabled=true;
  liveStatus('Preparando alto-falante...');
  try{
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
    await ctx.audioWorklet.addModule('/talk-worklet.js');
    if(liveRadio!==session){void ctx.close();return;}
    const speakerNode=new AudioWorkletNode(ctx,'vozchat-speaker-stream',{
      numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]
    });
    const speakerGain=ctx.createGain();speakerGain.gain.value=$('#flowtalkAutoPlay').checked?1:0;
    speakerNode.connect(speakerGain).connect(ctx.destination);
    session.speakerNode=speakerNode;session.speakerGain=speakerGain;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(proto+'//'+location.host+'/api/talk/ws?room='+encodeURIComponent(session.roomId));
    ws.binaryType='arraybuffer';session.ws=ws;
    ws.onmessage=e=>{
      if(liveRadio!==session)return;
      if(e.data instanceof ArrayBuffer){
        session.framesReceived++;
        if($('#flowtalkAutoPlay').checked){
          session.speakerNode?.port.postMessage({type:'pcm',pcm:e.data},[e.data]);
          if(session.ctx.state!=='running')liveStatus('Áudio recebido. Toque em 🔊 Ativar alto-falante.');
          else if(session.framesReceived===1)liveStatus('🔊 Áudio chegando ao aparelho');
        }
        return;
      }
      let msg;try{msg=JSON.parse(e.data);}catch{return;}
      if(msg.type==='ready'){
        session.clientId=msg.clientId;session.ready=true;
        session.peerCount=msg.peers?.length||0;
        session.speakerId=msg.speakerId||null;session.speakerName=msg.speaker||null;
        radioUI(session);
      }else if(msg.type==='peer-joined'){
        session.peerCount++;radioUI(session);
      }else if(msg.type==='peer-left'){
        session.peerCount=Math.max(0,session.peerCount-1);
        if(session.speakerId===msg.clientId){session.speakerId=null;session.speakerName=null;resetRadioSpeaker(session);}
        radioUI(session);
      }else if(msg.type==='floor'){
        session.speakerId=msg.clientId||null;
        session.speakerName=msg.name||null;
        if(!msg.clientId)resetRadioSpeaker(session);
        radioUI(session);
      }else if(msg.type==='floor-granted'){
        if(!session.holding){radioSend(session,{type:'floor-release'});return;}
        session.granted=true;
        session.track.enabled=true;
        session.micNode.port.postMessage({type:'enabled',value:true});
        talkButton.classList.add('talking');
        talkButton.textContent='Falando…';
        talkStop.hidden=false;
        liveStatus('🔴 SUA VOZ ESTÁ SAINDO AGORA');
        if(typeof navigator.vibrate==='function')try{navigator.vibrate(45);}catch{}
      }else if(msg.type==='floor-denied'){
        session.holding=false;session.granted=false;
        liveStatus('Canal ocupado. Aguarde quem está falando terminar.');
      }else if(msg.type==='error')liveStatus(msg.message||'Falha no canal.');
    };
    ws.onerror=()=>{if(liveRadio===session)liveStatus('Erro na conexão com o rádio.');};
    ws.onclose=()=>{if(liveRadio===session){toast('Rádio desconectado. Abra novamente.');stopLiveRadio();}};
  }catch(err){
    if(liveRadio===session){
      toast(err.name==='NotAllowedError'?'Permita acesso ao microfone para usar o rádio.':(err.message||'Falha ao iniciar áudio ao vivo.'));
      stopLiveRadio();
    }
  }
}
$('#flowtalkToggle').addEventListener('click',()=>{void openLiveRadio();});
// PTT físico: o fim do toque SEMPRE encerra o LiveKit e o rádio antigo.
let talkPointerId=null;
let talkTouchId=null;
let talkKeyboardHeld=false;
let talkSafetyTimer=null;
// Última proteção: o rádio nunca pode ficar transmitindo indefinidamente.
const MAX_TALK_MS=60000;
function releasePushToTalk(){
  if(livekitController)livekitController.release();
  if(liveRadio?.holding)stopRadioTalk();
  talkStop.hidden=true;
}
function endTalkHold(){
  const wasHolding=talkPointerId!==null||talkTouchId!==null||talkKeyboardHeld;
  talkPointerId=null;talkTouchId=null;talkKeyboardHeld=false;
  clearTimeout(talkSafetyTimer);talkSafetyTimer=null;
  if(wasHolding)releasePushToTalk();
}
function startTalkSafetyTimer(){
  clearTimeout(talkSafetyTimer);
  talkSafetyTimer=setTimeout(()=>{
    if(talkPointerId!==null||talkTouchId!==null||talkKeyboardHeld){
      endTalkHold();
      releasePushToTalk();
      toast('Transmissão encerrada por segurança após 60 segundos.');
    }
  },MAX_TALK_MS);
}
// Botão de emergência independente dos gestos. Fecha o rádio e para a captura física.
talkStop.addEventListener('click',()=>{
  endTalkHold();releasePushToTalk();stopLiveRadio();
  toast('Microfone desligado. Toque no FlowTalk para abrir novamente.');
});
talkButton.addEventListener('pointerdown',e=>{
  if(e.button!==0||talkButton.disabled)return;
  e.preventDefault();
  if(talkPointerId!==null){
    // Ponteiro anterior não foi liberado: desligar o transmissor.
    endTalkHold();releasePushToTalk();return;
  }
  if(talkTouchId!==null){
    // Safari pode enviar touchstart ANTES de pointerdown para o mesmo dedo.
    // Capturar o ponteiro sem começar nem interromper a fala novamente.
    talkPointerId=e.pointerId;
    try{talkButton.setPointerCapture(e.pointerId);}catch{}
    return;
  }
  if(livekitController?.isHolding?.()){
    endTalkHold();releasePushToTalk();return;
  }
  talkPointerId=e.pointerId;
  try{talkButton.setPointerCapture(e.pointerId);}catch{}
  startRadioTalk();startTalkSafetyTimer();
});
for(const name of ['pointerup','pointercancel','lostpointercapture']){
  talkButton.addEventListener(name,e=>{
    if(talkPointerId===e.pointerId)endTalkHold();
  });
}
// A soltura fora do botão também deve interromper o rádio.
for(const name of ['pointerup','pointercancel']){
  document.addEventListener(name,e=>{
    if(talkPointerId!==null&&e.pointerId===talkPointerId)endTalkHold();
  },{capture:true});
}
// Backup de toque nativo para Safari/WebKit quando pointerup/lostpointercapture falha.
talkButton.addEventListener('touchstart',e=>{
  if(talkButton.disabled||!e.changedTouches.length)return;
  const touchId=e.changedTouches[0].identifier;
  if(talkTouchId!==null){
    // Um segundo toque com o primeiro ainda marcado pode indicar release perdido.
    if(talkTouchId!==touchId){endTalkHold();releasePushToTalk();}
    return;
  }
  talkTouchId=touchId;
  if(talkPointerId===null&&!talkKeyboardHeld){
    // O fluxo touch-first deve iniciar uma única vez.
    if(livekitController?.isHolding?.()){endTalkHold();releasePushToTalk();return;}
    startRadioTalk();startTalkSafetyTimer();
  }
},{passive:true});
for(const name of ['touchend','touchcancel']){
  document.addEventListener(name,e=>{
    if(talkTouchId!==null&&Array.from(e.changedTouches).some(t=>t.identifier===talkTouchId)){
      endTalkHold();
    }else if(talkPointerId!==null&&e.touches.length===0){
      endTalkHold();
    }
  },{capture:true,passive:true});
}
document.addEventListener('touchmove',e=>{
  if(talkTouchId===null)return;
  const touch=Array.from(e.touches).find(t=>t.identifier===talkTouchId);
  if(!touch){endTalkHold();return;}
  const rect=talkButton.getBoundingClientRect();
  if(touch.clientX<rect.left||touch.clientX>rect.right||
     touch.clientY<rect.top||touch.clientY>rect.bottom)endTalkHold();
},{capture:true,passive:true});
talkButton.addEventListener('keydown',e=>{
  if(e.repeat||talkKeyboardHeld)return;
  if(e.code==='Space'||e.code==='Enter'){
    e.preventDefault();talkKeyboardHeld=true;startRadioTalk();startTalkSafetyTimer();
  }
});
document.addEventListener('keyup',e=>{
  if(talkKeyboardHeld&&(e.code==='Space'||e.code==='Enter')){
    e.preventDefault();endTalkHold();
  }
});
window.addEventListener('blur',()=>{endTalkHold();releasePushToTalk();});
$('#flowtalkAutoPlay').addEventListener('change',()=>{
  if(livekitController){livekitController.listening($('#flowtalkAutoPlay').checked);return;}
  const session=liveRadio;
  if(session?.speakerGain)session.speakerGain.gain.value=$('#flowtalkAutoPlay').checked?1:0;
  if(!$('#flowtalkAutoPlay').checked&&session)resetRadioSpeaker(session);
});
listenButton.addEventListener('click',async()=>{
  if(livekitController){void livekitController.enableAudio();return;}
  const session=liveRadio;if(!session)return;
  try{
    void session.ctx.resume().catch(()=>{});
    // Toque de confirmação do próprio alto-falante (não é mensagem de rádio).
    const oscillator=session.ctx.createOscillator(),gain=session.ctx.createGain();
    gain.gain.setValueAtTime(.0001,session.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.12,session.ctx.currentTime+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,session.ctx.currentTime+.18);
    oscillator.frequency.value=880;
    oscillator.connect(gain).connect(session.ctx.destination);
    oscillator.start();oscillator.stop(session.ctx.currentTime+.19);
    $('#flowtalkAutoPlay').checked=true;
    if(session.speakerGain)session.speakerGain.gain.value=1;
    toast('Teste do alto-falante executado. Se não ouvir, verifique volume e modo silencioso.');
  }catch{toast('Falha ao ativar alto-falante. Confira o volume do aparelho.');}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){endTalkHold();releasePushToTalk();}
  else if(liveRadio?.ctx?.state==='suspended')void liveRadio.ctx.resume().catch(()=>{});
});
window.addEventListener('pagehide',()=>{
  endTalkHold();releasePushToTalk();stopLiveRadio();
});

function newConversation(){$('#newRoomName').value='';openDialog('roomDialog');setTimeout(()=>$('#newRoomName').focus(),100);}
$('#newRoom').addEventListener('click',newConversation);$('#emptyCreate').addEventListener('click',newConversation);
function openContactDialog(){$('#contactId').value='';openDialog('contactDialog');setTimeout(()=>$('#contactId').focus(),80);}
$('#newDirect').addEventListener('click',openContactDialog);
$('#emptyContact').addEventListener('click',openContactDialog);
$('#contactForm').addEventListener('submit',async e=>{
  e.preventDefault();const button=$('#contactSubmit');button.disabled=true;
  try{
    const result=await api('/api/contacts/add',{method:'POST',data:{publicId:$('#contactId').value.trim()}});
    $('#contactDialog').close();
    if(result.status==='connected'){
      upsertRoom(result.room);await openRoom(result.room.id);
      toast('Contato já está conectado.');
    }else{
      toast('Solicitação enviada! Aguarde a pessoa aceitar.');
      await refreshContactRequests();
    }
  }catch(err){toast(err.message);}finally{button.disabled=false;}
});
async function copyId(){
  if(!me?.publicId)return toast('Seu ID ainda não está disponível.');
  try{await navigator.clipboard.writeText(me.publicId);toast('ID '+me.publicId+' copiado!');}
  catch {toast('Seu ID é '+me.publicId);}
}
$('#copyMyId').addEventListener('click',copyId);
$('#copyWelcomeId').addEventListener('click',()=>{copyId();$('#welcomeDialog').close();});
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>document.getElementById(b.dataset.close).close());
$('#roomForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=await api('/api/rooms',{method:'POST',data:{name:$('#newRoomName').value}});$('#roomDialog').close();upsertRoom(data.room);await openRoom(data.room.id);showInvite();}catch(err){toast(err.message);}});
function showInvite(){const r=rooms.find(x=>x.id===current);if(!r||r.isDirect)return;$('#inviteLink').value=location.origin+r.inviteUrl;openDialog('inviteDialog');}
$('#inviteButton').addEventListener('click',showInvite);
$('#copyInvite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#inviteLink').value);toast('Convite copiado!');$('#inviteDialog').close();}catch{$('#inviteLink').select();toast('Selecione e copie o link.');}});
$('#mobileBack').addEventListener('click',()=>{$('#app').classList.remove('chat-open');});
$('#logout').addEventListener('click',async()=>{
  try{
    if(pushSupported()){
      const registration=await navigator.serviceWorker.ready,sub=await registration.pushManager.getSubscription();
      if(sub){await api('/api/push/unsubscribe',{method:'POST',data:{endpoint:sub.endpoint}});await sub.unsubscribe();}
    }
  }catch{}
  stopLiveRadio();
  try{localStorage.removeItem('vozchat_push_uid');}catch{}
  try{await api('/api/logout',{method:'POST'});}catch{}
  showAuth();authMode(false);
});
$('#composer').addEventListener('submit',async e=>{e.preventDefault();const input=$('#msgInput');const content=input.value.trim();if(!content||!current)return;const roomId=current;input.value='';input.style.height='auto';try {await api(`/api/rooms/${roomId}/messages`,{method:'POST',data:{text:content}});}catch(err){input.value=content;toast(err.message);}});
// Envio de mídias e arquivos. A seleção é feita pelo navegador (câmera nativa no celular).
const MEDIA_MAX=25*1024*1024;
const LARGE_MEDIA_MAX=1024*1024*1024;
let uploadController=null,activeTransferId=null,uploadCanceled=false;
const ALLOWED_EXTENSIONS=/\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|webm|m4v|3gp|pdf|txt|csv|docx?|xlsx?|pptx?|zip|7z|rar|odt|ods|odp|dcm|dwg|dxf)$/i;
const emojiList=['😀','😃','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😢','😭','🥹','😡','😮','👍','👎','👏','🙌','🙏','🤝','💪','❤️','💜','💙','🔥','✨','🎉','💯','👀','🤗','😉','😅','🤔','👌','✅','📷','🎬','🌹','🥂','😴','🙈','😁','😇','🤍','💚','💛'];
function closeTools(){ $('#attachmentPicker').hidden=true;$('#emojiPicker').hidden=true;$('#attachButton').setAttribute('aria-expanded','false');$('#emojiButton').setAttribute('aria-expanded','false'); }
$('#attachButton').addEventListener('click',()=>{const show=$('#attachmentPicker').hidden;closeTools();$('#attachmentPicker').hidden=!show;$('#attachButton').setAttribute('aria-expanded',String(show));});
$('#emojiButton').addEventListener('click',()=>{const show=$('#emojiPicker').hidden;closeTools();$('#emojiPicker').hidden=!show;$('#emojiButton').setAttribute('aria-expanded',String(show));});
const emojiGrid=$('#emojiPicker');
for(const char of emojiList){const button=document.createElement('button');button.type='button';button.textContent=char;button.setAttribute('aria-label','Inserir '+char);button.addEventListener('click',()=>{const input=$('#msgInput');const cursor=input.selectionStart;input.setRangeText(char,cursor,input.selectionEnd,'end');input.focus();input.dispatchEvent(new Event('input'));closeTools();});emojiGrid.append(button);}
const inputs={camera:'#cameraInput',photo:'#photoInput',video:'#videoInput',file:'#fileInput'};
for(const pick of document.querySelectorAll('[data-pick]')){pick.addEventListener('click',()=>{const key=pick.dataset.pick;closeTools();$(inputs[key]).click();});}
function cleanupPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}pendingFiles=[];pendingRoom=null;$('#uploadPreview').replaceChildren();}
function selectFiles(selected){
  if(!selected.length)return;
  const files=Array.from(selected);if(files.length>5){toast('Selecione até 5 arquivos por vez.');return;}
  for(const file of files){if(file.size>LARGE_MEDIA_MAX){toast('O arquivo '+file.name+' excede 1 GB.');return;}if(!ALLOWED_EXTENSIONS.test(file.name)){toast('Esse tipo de arquivo não é permitido.');return;}}
  cleanupPreview();pendingFiles=files;pendingRoom=current;
  const preview=$('#uploadPreview');
  if(files.length===1&&files[0].type.startsWith('image/')&&!/\.hei[cf]$/i.test(files[0].name)){
    previewUrl=URL.createObjectURL(files[0]);const img=document.createElement('img');img.src=previewUrl;img.alt='Foto selecionada';preview.append(img);
  }else if(files.length===1&&files[0].type.startsWith('video/')){
    previewUrl=URL.createObjectURL(files[0]);const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=previewUrl;preview.append(video);
  }else{const image=document.createElement('span');image.className='large-file-icon';image.textContent='📎';preview.append(image);}
  $('#uploadInfo').textContent=files.map(f=>f.name+' · '+formatSize(f.size)).join(' | ');
  $('#confirmUpload').textContent=files.length>1?`Enviar ${files.length} arquivos →`:'Enviar arquivo →';
  openDialog('fileDialog');
}
for(const el of Object.values(inputs)){ $(el).addEventListener('change',e=>{selectFiles(e.target.files);e.target.value='';}); }
$('#fileDialog').addEventListener('cancel',e=>{if(uploading)e.preventDefault();});
$('#fileDialog').addEventListener('close',()=>{if(!uploading)cleanupPreview();});
function transferUpdate(done,total,message){
  $('#transferProgress').hidden=false;
  $('#transferBar').style.width=Math.max(0,Math.min(100,Math.round(done/Math.max(1,total)*100)))+'%';
  $('#transferText').textContent=message+' · '+formatSize(done)+' de '+formatSize(total);
}
async function transferApi(url,{method='POST',data,raw,part,signal}={}){
  const response=await fetch(url,{
    method,credentials:'same-origin',
    signal,
    headers:raw===undefined?{'Content-Type':'application/json'}:{'Content-Type':'application/octet-stream','X-Part-Index':String(part)},
    body:raw===undefined?JSON.stringify(data||{}):raw
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Falha na transferência.');
  return result;
}
async function sendLargeFile(file,roomId,report){
  let mime=file.type.split(';')[0].toLowerCase();
  if(!mime)mime='application/octet-stream';
  const start=await transferApi('/api/transfers/start',{data:{roomId,name:file.name,mime,size:file.size}});
  activeTransferId=start.uploadId;
  let received=start.received||0;
  const chunkSize=start.chunkBytes;
  try{
    while(received<start.chunks){
      if(uploadCanceled)throw Error('Envio cancelado.');
      const offset=received*chunkSize,part=file.slice(offset,Math.min(file.size,offset+chunkSize));
      let attempt=0,posted=false;
      while(!posted){
        attempt++;
        uploadController=new AbortController();
        try{
          const updated=await transferApi('/api/transfers/'+start.uploadId+'/chunk',{
            raw:part,part:received,signal:uploadController.signal
          });
          received=updated.received;posted=true;
        }catch(err){
          if(uploadCanceled)throw Error('Envio cancelado.');
          if(attempt>=3)throw err;
          // Rede interrompida após salvar: consultar posição antes de repetir.
          const state=await api('/api/transfers/'+start.uploadId+'/status');
          if(state.received>received){received=state.received;posted=true;}
          else await new Promise(resolve=>setTimeout(resolve,attempt*400));
        }
      }
      report(Math.min(file.size,received*chunkSize));
    }
    await transferApi('/api/transfers/'+start.uploadId+'/finish',{data:{}});
    activeTransferId=null;
  }catch(err){
    // Não deixar partes órfãs em uma transferência cancelada/falho.
    try{await transferApi('/api/transfers/'+start.uploadId+'/cancel',{data:{}});}catch{}
    activeTransferId=null;
    throw err;
  }finally{uploadController=null;}
}
$('#cancelUpload').addEventListener('click',()=>{
  if(!uploading)return;
  uploadCanceled=true;
  uploadController?.abort();
  $('#transferText').textContent='Cancelando envio...';
});
$('#confirmUpload').addEventListener('click',async()=>{
  if(uploading||!pendingFiles.length||!pendingRoom)return;
  uploading=true;uploadCanceled=false;
  const button=$('#confirmUpload');button.disabled=true;
  $('#cancelUpload').hidden=false;$('#transferProgress').hidden=false;
  const files=[...pendingFiles],roomId=pendingRoom;
  const total=files.reduce((sum,f)=>sum+f.size,0);
  let completed=0,sentAll=false;
  try{
    for(let i=0;i<files.length;i++){
      if(uploadCanceled)throw Error('Envio cancelado.');
      const file=files[i];
      button.textContent='Enviando '+(i+1)+' de '+files.length+'...';
      const progress=bytes=>transferUpdate(completed+bytes,total,'Enviando '+file.name);
      progress(0);
      if(file.size>MEDIA_MAX){
        await sendLargeFile(file,roomId,progress);
      }else{
        let mime=file.type.split(';')[0].toLowerCase();
        if(!mime)mime='application/octet-stream';
        uploadController=new AbortController();
        const response=await fetch('/api/rooms/'+roomId+'/files',{
          method:'POST',credentials:'same-origin',signal:uploadController.signal,
          headers:{'Content-Type':mime,'X-File-Name':encodeURIComponent(file.name)},body:file
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(data.error||'Falha ao enviar o arquivo.');
      }
      completed+=file.size;
      transferUpdate(completed,total,'Concluído');
    }
    sentAll=true;
    $('#fileDialog').close();
    toast(files.length===1?'Arquivo enviado!':'Arquivos enviados!');
  }catch(err){
    toast(uploadCanceled?'Transferência cancelada.':err.message||'Falha ao enviar arquivo.');
  }finally{
    uploading=false;uploadCanceled=false;uploadController=null;activeTransferId=null;
    button.disabled=false;button.textContent='Enviar arquivo →';
    $('#cancelUpload').hidden=true;
    $('#transferProgress').hidden=true;
    $('#transferBar').style.width='0%';
    if(!sentAll&&completed)toast('Os arquivos concluídos permanecem na conversa.');
    cleanupPreview();
  }
});
$('#msgInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#composer').requestSubmit();}});
$('#msgInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(136,e.target.scrollHeight)+'px';});
function supportedMime(){return ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'';}
function updateRecordClock(){const sec=Math.floor((Date.now()-recordingStart)/1000);$('#recordTime').textContent=`Gravando · ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;if(sec>=90&&recorder?.state==='recording')stopRecord();}
async function startRecord(){if(!current) return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Seu navegador não permite gravação de áudio.');return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});const type=supportedMime();recorder=new MediaRecorder(stream,type?{mimeType:type}:{});pieces=[];recordedCanceled=false;recorder.ondataavailable=e=>{if(e.data.size)pieces.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(recordingTicker);$('#recording').hidden=true;$('#micButton').classList.remove('recording-active');$('#micButton').setAttribute('aria-label','Iniciar gravação');if(recordedCanceled)return;const mime=recorder.mimeType.split(';')[0]||'audio/webm';const blob=new Blob(pieces,{type:mime});if(blob.size<100){toast('Áudio vazio. Tente novamente.');return;}const roomId=current;$('#micButton').disabled=true;try {const result=await fetch(`/api/rooms/${roomId}/audio`,{method:'POST',headers:{'Content-Type':mime,'X-Audio-Duration':String((Date.now()-recordingStart)/1000)},body:blob,credentials:'same-origin'});const data=await result.json();if(!result.ok)throw new Error(data.error||'Erro ao enviar áudio.');toast('Mensagem de voz enviada!');}catch(err){toast(err.message);}finally{$('#micButton').disabled=false;}};recorder.start(250);recordingStart=Date.now();$('#recording').hidden=false;$('#micButton').classList.add('recording-active');$('#micButton').setAttribute('aria-label','Parar e enviar gravação');updateRecordClock();recordingTicker=setInterval(updateRecordClock,500);}catch(err){toast(err.name==='NotAllowedError'?'Permita o acesso ao microfone nas configurações do navegador.':'Não foi possível iniciar o microfone.');}}
function stopRecord(cancel=false){if(!recorder||recorder.state!=='recording')return;recordedCanceled=cancel;recorder.stop();}
$('#micButton').addEventListener('click',()=>recorder?.state==='recording'?stopRecord():startRecord());$('#cancelAudio').addEventListener('click',()=>stopRecord(true));

// Chamadas ao vivo de áudio e vídeo: o FlowTalk PTT permanece separado.
function presentCall(call,incoming){
  if(call.state==='ringing'){
    window.VozChatRingtone?.start({
      id:call.id,incoming:incoming&&call.callerId!==me?.id,
      expiresAt:call.expiresAt,
      audio:()=>{unlockAlertAudio();return alertAudio;},
      sound:()=>notifyPrefs.sound!==false,
      vibrate:()=>notifyPrefs.vibrate!==false
    });
  }else window.VozChatRingtone?.stop();
  const room=rooms.find(r=>r.id===call.roomId);
  const name=room?.name||call.callerName||'Contato';
  $('#callOverlay').hidden=false;
  $('#callTitle').textContent=(call.kind==='video'?'Vídeo · ':'Áudio · ')+name;
  paintAvatar($('#callHeroAvatar'),name,room?.avatarUrl);
  $('#callStatus').textContent=incoming?'Chamada recebida de '+call.callerName:'Chamando…';
  $('#callIncomingActions').hidden=!incoming;
  $('#callActiveActions').hidden=incoming;
  $('#callCamera').hidden=call.kind!=='video';
  $('#callFlip').hidden=call.kind!=='video';
  $('#callEnd').hidden=incoming;
  $('#callRemoteVideos').hidden=call.kind!=='video';
  $('#callLocalVideo').hidden=call.kind!=='video';
  $('#callRemoteVideos').replaceChildren();
  $('#callLocalVideo').replaceChildren();
  $('#callAudios').replaceChildren();
  $('#callMute').textContent='🎙 Microfone';
  $('#callMute').setAttribute('aria-pressed','false');
  $('#callCamera').textContent='📷 Câmera';
  $('#callCamera').setAttribute('aria-pressed','true');
}
async function closeCallUI(notifyServer=true){
  window.VozChatRingtone?.stop();
  callAttempt++;
  const call=currentCall;
  currentCall=null;
  const engine=callEngine;callEngine=null;
  joiningCall=false;
  $('#callOverlay').hidden=true;
  $('#callIncomingActions').hidden=true;
  $('#callActiveActions').hidden=true;
  $('#callLocalVideo').replaceChildren();
  $('#callRemoteVideos').replaceChildren();
  $('#callAudios').replaceChildren();
  if(engine)await engine.close().catch(()=>{});
  if(call&&notifyServer){
    try{await api('/api/calls/'+call.id+'/end',{method:'POST',data:{}});}
    catch(err){/* A sessão pode ter encerrado em outro aparelho. */}
  }
}
async function connectCurrentCall(){
  const call=currentCall;
  if(call?.callerId!==me?.id)window.VozChatRingtone?.stop();
  if(!call||joiningCall)return;
  joiningCall=true;
  const generation=++callAttempt;
  $('#callIncomingActions').hidden=true;
  $('#callActiveActions').hidden=false;
  $('#callEnd').hidden=false;
  $('#callStatus').textContent='Conectando áudio seguro…';
  stopLiveRadio();
  try{
    const {joinLiveCall}=await import('/call.bundle.js');
    if(generation!==callAttempt||currentCall?.id!==call.id)return;
    const engine=await joinLiveCall({
      call,api,
      mount:{remote:$('#callRemoteVideos'),local:$('#callLocalVideo'),audio:$('#callAudios')},
      onState:status=>{if(currentCall?.id===call.id)$('#callStatus').textContent=status;},
      onFailure:status=>{if(currentCall?.id===call.id){toast(status);void closeCallUI();}}
    });
    if(generation!==callAttempt||currentCall?.id!==call.id){
      await engine.close();return;
    }
    callEngine=engine;
    $('#callStatus').textContent='Conectado · chamada ao vivo';
  }catch(err){
    if(generation===callAttempt&&currentCall?.id===call.id){
      toast(err?.message||'Não foi possível conectar a chamada.');
      void closeCallUI();
    }
  }finally{if(generation===callAttempt)joiningCall=false;}
}
async function startCall(kind){
  if(!current||!me)return;
  if(currentCall){toast('Encerre a chamada atual antes de iniciar outra.');return;}
  const a=$('#callAudioButton'),v=$('#callVideoButton');
  a.disabled=true;v.disabled=true;
  try{
    const result=await api('/api/calls/start',{method:'POST',data:{roomId:current,kind}});
    currentCall=result.call;
    presentCall(result.call,false);
    await connectCurrentCall();
  }catch(err){toast(err.message||'Não foi possível iniciar a chamada.');}
  finally{a.disabled=false;v.disabled=false;}
}
async function syncPendingCalls(){
  if(!me||currentCall)return;
  try{
    const result=await api('/api/calls/pending');
    if(currentCall||!result.calls?.length)return;
    const prioritized=result.calls.find(c=>c.id===callParam)||result.calls.find(c=>c.callerId!==me.id)||result.calls[0];
    if(!prioritized)return;
    currentCall=prioritized;
    // Depois de recarregar, exigir um toque explícito para acessar câmera e microfone.
    presentCall(prioritized,true);
    if(prioritized.callerId===me.id){
      $('#callStatus').textContent='Retomar sua chamada';
      $('#callAccept').textContent='Retomar';
    }else $('#callAccept').textContent='Atender';
  }catch{}
}
$('#callAudioButton').addEventListener('click',()=>void startCall('audio'));
$('#callVideoButton').addEventListener('click',()=>void startCall('video'));
$('#callAccept').addEventListener('click',async()=>{
  const call=currentCall;if(!call)return;
  window.VozChatRingtone?.stop();
  const btn=$('#callAccept');btn.disabled=true;
  try{
    await api('/api/calls/'+call.id+'/accept',{method:'POST',data:{}});
    if(currentCall?.id===call.id)await connectCurrentCall();
  }catch(err){toast(err.message);void closeCallUI(false);}
  finally{btn.disabled=false;btn.textContent='Atender';}
});
$('#callDecline').addEventListener('click',async()=>{
  const call=currentCall;if(!call)return;
  await closeCallUI(false);
  const action=call.callerId===me?.id?'end':'decline';
  try{await api('/api/calls/'+call.id+'/'+action,{method:'POST',data:{}});}
  catch(err){toast(err.message);}
});
$('#callEnd').addEventListener('click',()=>void closeCallUI());
$('#callMute').addEventListener('click',async()=>{
  if(!callEngine)return;
  const button=$('#callMute');button.disabled=true;
  try{
    const enabled=await callEngine.mute();
    button.textContent=enabled?'🎙 Microfone':'🔇 Silenciado';
    button.setAttribute('aria-pressed',String(!enabled));
  }catch(err){toast('Não foi possível alterar o microfone.');}
  finally{button.disabled=false;}
});
$('#callCamera').addEventListener('click',async()=>{
  if(!callEngine)return;
  const button=$('#callCamera');button.disabled=true;
  try{
    const enabled=await callEngine.camera();
    button.textContent=enabled?'📷 Câmera':'📷 Câmera desligada';
    button.setAttribute('aria-pressed',String(enabled));
  }catch(err){toast('Não foi possível alterar a câmera.');}
  finally{button.disabled=false;}
});
$('#callFlip').addEventListener('click',async()=>{
  if(!callEngine)return;
  try{await callEngine.flip();}catch(err){toast('Não foi possível virar a câmera.');}
});
$('#callSpeaker').addEventListener('click',async()=>{
  if(!callEngine)return;
  try{await callEngine.startAudio();toast('Alto-falante ativado.');}
  catch{toast('Toque novamente para ativar o áudio.');}
});
window.addEventListener('pagehide',()=>{
  window.VozChatRingtone?.stop();
  if(!currentCall)return;
  const id=currentCall.id;
  void closeCallUI(false);
  void fetch('/api/calls/'+id+'/end',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:'{}',keepalive:true}).catch(()=>{});
});



// Consentimento para contatos privados e fotografia de perfil.
async function refreshContactRequests(){
  if(!me)return;
  try{
    const result=await api('/api/contacts/requests');
    pendingContactRequests=result.requests||[];
    const incoming=pendingContactRequests.filter(r=>r.kind==='incoming');
    const badge=$('#pendingContactsCount');
    badge.hidden=incoming.length===0;
    badge.textContent=String(incoming.length);
    const render=(target,items,isIncoming)=>{
      target.replaceChildren();
      if(!items.length){
        const empty=document.createElement('p');
        empty.className='pending-empty';
        empty.textContent=isIncoming?'Nenhuma solicitação pendente.':'Nenhuma solicitação enviada.';
        target.append(empty);return;
      }
      for(const request of items){
        const item=document.createElement('div');item.className='pending-item';
        const image=document.createElement('div');image.className='pending-avatar';
        paintAvatar(image,request.name,request.avatarUrl);
        const info=document.createElement('div');info.className='pending-info';
        const title=document.createElement('strong');title.textContent=request.name;
        const id=document.createElement('small');id.textContent='ID '+request.publicId;
        info.append(title,id);
        const controls=document.createElement('div');controls.className='pending-actions';
        const button=(text,action,className)=>{
          const b=document.createElement('button');b.type='button';b.className=className;
          b.textContent=text;b.addEventListener('click',async()=>{
            const all=[...controls.querySelectorAll('button')];all.forEach(x=>x.disabled=true);
            try{
              const result=await api('/api/contacts/requests/'+request.id+'/'+action,
                {method:'POST',data:{}});
              await refreshContactRequests();
              if(result.status==='accepted'){
                upsertRoom(result.room);await openRoom(result.room.id);
                $('#pendingContactsDialog').close();
                toast('Contato aceito. Conversa liberada.');
              }else toast(action==='decline'?'Solicitação recusada.':'Solicitação cancelada.');
            }catch(err){toast(err.message);all.forEach(x=>x.disabled=false);}
          });return b;
        };
        if(isIncoming){
          controls.append(button('Aceitar','accept','accept-request'),button('Recusar','decline','decline-request'));
        }else controls.append(button('Cancelar','cancel','decline-request'));
        item.append(image,info,controls);target.append(item);
      }
    };
    if($('#pendingContactsDialog').open){
      render($('#incomingRequestsList'),incoming,true);
      render($('#outgoingRequestsList'),pendingContactRequests.filter(r=>r.kind==='outgoing'),false);
    }
  }catch(err){console.warn('Solicitações indisponíveis',err.message);}
}
$('#pendingContactsButton').addEventListener('click',async()=>{
  await refreshContactRequests();
  const renderInside=async()=>{
    // Reutilizar os controles após abrir o modal.
    const requests=pendingContactRequests;
    for(const [id,kind] of [['incomingRequestsList','incoming'],['outgoingRequestsList','outgoing']]){
      const list=$('#'+id);list.replaceChildren();
      for(const request of requests.filter(r=>r.kind===kind)){
        const row=document.createElement('div');row.className='pending-item';
        const image=document.createElement('div');image.className='pending-avatar';
        paintAvatar(image,request.name,request.avatarUrl);
        const info=document.createElement('div');info.className='pending-info';
        const title=document.createElement('strong');title.textContent=request.name;
        const uid=document.createElement('small');uid.textContent='ID '+request.publicId;
        info.append(title,uid);
        const actions=document.createElement('div');actions.className='pending-actions';
        for(const [action,label] of kind==='incoming'?[['accept','Aceitar'],['decline','Recusar']]:[['cancel','Cancelar']]){
          const btn=document.createElement('button');btn.type='button';
          btn.className=action==='accept'?'accept-request':'decline-request';
          btn.textContent=label;
          btn.addEventListener('click',async()=>{
            btn.disabled=true;
            try{
              const result=await api('/api/contacts/requests/'+request.id+'/'+action,{method:'POST',data:{}});
              if(result.status==='accepted'){
                upsertRoom(result.room);
                $('#pendingContactsDialog').close();
                await openRoom(result.room.id);
                toast('Contato aceito!');
              }else toast(action==='decline'?'Solicitação recusada.':'Solicitação cancelada.');
              await refreshContactRequests();if($('#pendingContactsDialog').open)await renderInside();
            }catch(err){toast(err.message);btn.disabled=false;}
          });
          actions.append(btn);
        }
        row.append(image,info,actions);list.append(row);
      }
      if(!list.children.length){
        const empty=document.createElement('p');empty.className='pending-empty';
        empty.textContent=kind==='incoming'?'Nenhuma solicitação pendente.':'Nenhuma solicitação enviada.';
        list.append(empty);
      }
    }
  };
  openDialog('pendingContactsDialog');await renderInside();
});
$('#removeContactButton').addEventListener('click',async()=>{
  const r=rooms.find(x=>x.id===current);
  if(!r?.isDirect)return;
  if(!confirm('Excluir '+r.name+' dos contatos? A conversa será removida para ambos e ficará indisponível até uma nova solicitação ser aceita. O histórico permanecerá armazenado.'))return;
  const button=$('#removeContactButton');button.disabled=true;
  try{
    await api('/api/contacts/'+r.id,{method:'DELETE'});
    rooms=rooms.filter(x=>x.id!==r.id);
    stopLiveRadio();resetActiveChat();renderRooms();
    toast('Contato removido.');
  }catch(err){toast(err.message);}
  finally{button.disabled=false;}
});
function showProfilePhoto(){
  if(!me)return;
  paintAvatar($('#profilePreview'),me.name,me.avatarUrl);
  $('#removeProfilePhoto').hidden=!me.avatarUrl;
  $('#profilePhotoStatus').textContent='Toque em Escolher foto para abrir sua galeria.';
  const dialog=$('#profilePhotoDialog');
  if(!dialog.open)openDialog('profilePhotoDialog');
}
$('#meAvatar').addEventListener('click',showProfilePhoto);
$('#settingsProfilePhoto').addEventListener('click',()=>{
  $('#settingsDialog').close();
  showProfilePhoto();
});
// Seletor de arquivo Nativo: iOS PWA precisa receber o toque DIRETAMENTE no input.
// Não chamar input.click() num elemento oculto: Safari pode bloquear esse gesto.
$('#profilePhotoInput').addEventListener('change',async event=>{
  const input=event.currentTarget;
  const file=input.files?.[0];
  input.value='';
  if(!file)return;
  const status=$('#profilePhotoStatus');
  const control=input.closest('.profile-picker-control');
  const allowed=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  if(file.type&&!allowed.includes(file.type.toLowerCase())){
    status.textContent='Arquivo inválido. Escolha uma foto da galeria.';
    toast('Escolha uma imagem JPEG, PNG, WEBP ou HEIC.');return;
  }
  input.disabled=true;
  control?.classList.add('is-busy');
  status.textContent='Preparando foto…';
  let url=null,bitmap=null;
  try{
    url=URL.createObjectURL(file);
    let image=null;
    // Primeiro caminho: decoder nativo do navegador (inclui alguns formatos HEIC).
    if(typeof createImageBitmap==='function'){
      try{bitmap=await createImageBitmap(file);image=bitmap;}catch{}
    }
    // Fallback para o decoder HTML do Safari/WebKit.
    if(!image){
      image=await new Promise((resolve,reject)=>{
        const picture=new Image();
        picture.onload=()=>resolve(picture);
        picture.onerror=()=>reject(new Error('O iPhone não conseguiu abrir esta imagem. Escolha uma foto JPG/PNG ou uma captura de tela.'));
        picture.src=url;
      });
    }
    const width=image.naturalWidth||image.width;
    const height=image.naturalHeight||image.height;
    if(!width||!height)throw new Error('Não foi possível ler as dimensões da foto.');
    const canvas=document.createElement('canvas');
    canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Seu navegador não conseguiu preparar a foto.');
    const size=Math.min(width,height);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,(width-size)/2,(height-size)/2,size,size,0,0,256,256);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
    if(!blob||blob.size>512*1024)throw new Error('Não foi possível compactar a foto. Tente outra imagem.');
    status.textContent='Salvando foto no seu perfil…';
    const response=await fetch('/api/profile/avatar',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'image/jpeg'},
      body:blob
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Erro ao salvar a foto no servidor.');
    me=result.user;
    if(!me.avatarUrl)throw new Error('O servidor não retornou o endereço da foto.');
    // Confirma que a foto existe no armazenamento privado e pode ser lida pela sessão.
    // Assim não informamos sucesso quando o PostgreSQL salvou apenas os metadados.
    const readback=await fetch(me.avatarUrl,{method:'GET',credentials:'same-origin',cache:'no-store'});
    if(!readback.ok)throw new Error('Foto recebida pelo servidor, mas leitura falhou (HTTP '+readback.status+').');
    if(!(readback.headers.get('content-type')||'').startsWith('image/'))
      throw new Error('O servidor não retornou uma imagem válida.');
    const saved=await readback.blob();
    if(!saved.size)throw new Error('A imagem salva chegou vazia.');
    // URL atualizada força renderização com a foto mais recente no app instalado.
    me.avatarUrl += '?v='+Date.now();
    paintAvatar($('#meAvatar'),me.name,me.avatarUrl);
    paintAvatar($('#profilePreview'),me.name,me.avatarUrl);
    $('#removeProfilePhoto').hidden=false;
    status.textContent='Foto salva e confirmada no servidor!';
    toast('Foto salva e confirmada!');
  }catch(err){
    const message=err?.message||'Erro ao carregar foto. Tente novamente.';
    status.textContent=message;
    toast(message);
  }finally{
    try{bitmap?.close?.();}catch{}
    if(url)URL.revokeObjectURL(url);
    input.disabled=false;
    control?.classList.remove('is-busy');
  }
});
$('#removeProfilePhoto').addEventListener('click',async()=>{
  const button=$('#removeProfilePhoto');button.disabled=true;
  try{
    const result=await api('/api/profile/avatar',{method:'DELETE'});
    me=result.user;
    paintAvatar($('#meAvatar'),me.name,null);
    paintAvatar($('#profilePreview'),me.name,null);
    button.hidden=true;
    $('#profilePhotoStatus').textContent='Foto removida. Você pode escolher outra.';
    toast('Foto removida.');
  }catch(err){
    $('#profilePhotoStatus').textContent=err.message;
    toast(err.message);
  }finally{button.disabled=false;}
});

const compactSettingKey='vozchat_compact_rooms';
function applyCompact(){
  const enabled=localStorage.getItem(compactSettingKey)==='yes';
  $('#settingsCompact').checked=enabled;
  $('#app').classList.toggle('compact-rooms',enabled);
}
$('#settingsButton').addEventListener('click',async()=>{
  $('#settingsUserId').textContent='Seu ID: '+(me?.publicId||me?.username||'--');
  applyCompact();openDialog('settingsDialog');
  try{
    const result=await api('/api/transfers/config');
    $('#settingsStorageStatus').textContent='Até '+formatSize(result.maxBytes)+
      ' por arquivo · espaço disponível para envios grandes: '+formatSize(result.availableBytes);
  }catch{
    $('#settingsStorageStatus').textContent='Capacidade indisponível no momento.';
  }
});
$('#settingsNotifications').addEventListener('click',()=>{
  $('#settingsDialog').close();
  $('#notificationsButton').click();
});
$('#settingsCopyId').addEventListener('click',()=>$('#copyMyId').click());
$('#settingsCompact').addEventListener('change',event=>{
  localStorage.setItem(compactSettingKey,event.target.checked?'yes':'no');
  applyCompact();
});
applyCompact();

window.addEventListener('online',()=>{$('#offline').hidden=true;toast('Conectado novamente.');});window.addEventListener('offline',()=>{$('#offline').hidden=false;});$('#offline').hidden=navigator.onLine;
// O guia de instalação compartilhado gerencia o botão Instalar e o evento nativo beforeinstallprompt.
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
authMode(true);start();