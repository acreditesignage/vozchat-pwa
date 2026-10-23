const $=selector=>document.querySelector(selector);
const STORAGE_KEY='vozchat_talk_room_v1';
const notice=$('#notice'),panel=$('#flowtalkPanel'),hold=$('#flowtalkHold'),select=$('#talkRoom');
const toggle=$('#flowtalkToggle'),emergency=$('#flowtalkStop');
let user=null,rooms=[],radio=null,opening=false,pointerId=null,touchId=null,timer=null;
let keyboardHeld=false,autoJoin=false;
const params=new URLSearchParams(location.search);
const linkRoom=params.get('room')||'';
function toast(message){
  notice.textContent=message;notice.hidden=false;
  clearTimeout(toast.timeout);
  toast.timeout=setTimeout(()=>notice.hidden=true,4300);
}
async function api(url,{method='GET',data}={}){
  const res=await fetch(url,{method,credentials:'same-origin',
    headers:data===undefined?{}:{'Content-Type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data)});
  const content=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(content.error||'Erro de conexão');
  return content;
}
function normalizeRoom(rooms,value){return rooms.find(r=>r.id===value)?.id||'';}
function selectedRoom(){return normalizeRoom(rooms,select.value);}
async function init(){
  let info;
  try{info=await api('/api/bootstrap');}
  catch{
    $('#loginPanel').hidden=false;$('#radioHome').hidden=true;
    return;
  }
  user=info.user;rooms=info.rooms||[];
  $('#loginPanel').hidden=true;$('#radioHome').hidden=false;
  const requested=normalizeRoom(rooms,linkRoom);
  const saved=normalizeRoom(rooms,localStorage.getItem(STORAGE_KEY));
  const remembered=requested||saved||rooms[0]?.id||'';
  select.replaceChildren();
  for(const r of rooms){
    const option=document.createElement('option');
    option.value=r.id;
    option.textContent=r.name+(r.isDirect?' · conversa privada':' · grupo');
    select.append(option);
  }
  if(remembered)select.value=remembered;
  const enabled=rooms.length>0;
  toggle.disabled=!enabled;
  if(!enabled)toast('Crie uma conversa no VozChat para usar o rádio.');
  if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
  if(!autoJoin && remembered && (requested&&params.get('join')==='1'||saved)){
    autoJoin=true;
    // Somente escuta. O microfone exige pressionar o botão.
    void connectRadio();
  }
}
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=$('#loginForm button[type=submit]');
  submit.disabled=true;
  try{
    await api('/api/login',{method:'POST',data:{
      username:$('#userId').value.trim(),password:$('#userPassword').value
    }});
    $('#userPassword').value='';
    await init();
  }catch(err){toast(err.message);}
  finally{submit.disabled=false;}
});
async function connectRadio(){
  if(radio||opening||!selectedRoom())return;
  opening=true;toggle.disabled=true;select.disabled=true;
  toggle.textContent='Conectando...';
  try{
    const provider=await api('/api/talk/provider');
    if(provider.provider!=='livekit')throw new Error('LiveKit não está disponível.');
    const {startLiveKitRadio}=await import('/livekit.bundle.js');
    radio=await startLiveKitRadio({roomId:selectedRoom(),api,notify:toast});
    localStorage.setItem(STORAGE_KEY,selectedRoom());
    toggle.textContent='Desconectar';
    // O iOS pode exigir toque explícito no alto-falante antes de reproduzir áudio.
  }catch(err){
    radio=null;panel.hidden=true;
    toast('Não foi possível abrir o rádio: '+err.message);
    toggle.textContent='Conectar';select.disabled=false;
  }finally{opening=false;toggle.disabled=false;}
}
function releaseTalk(){
  clearTimeout(timer);timer=null;
  const active=pointerId!==null||touchId!==null||keyboardHeld||radio?.isHolding?.();
  pointerId=null;touchId=null;keyboardHeld=false;
  if(active)radio?.release();
}
function disconnectRadio(){
  releaseTalk();
  radio?.close();radio=null;opening=false;
  panel.hidden=true;emergency.hidden=true;
  toggle.textContent='Conectar';toggle.disabled=false;
  select.disabled=false;
}
toggle.addEventListener('click',()=>radio?disconnectRadio():void connectRadio());
select.addEventListener('change',()=>{
  localStorage.setItem(STORAGE_KEY,selectedRoom());
  if(radio)disconnectRadio();
});
function beginTalk(){
  if(!radio||hold.disabled||radio.isHolding?.())return;
  radio.press();
  clearTimeout(timer);
  timer=setTimeout(()=>{
    releaseTalk();
    radio?.release();
    toast('Transmissão encerrada após 60 segundos por segurança.');
  },60000);
}
hold.addEventListener('pointerdown',e=>{
  if(e.button!==0||hold.disabled)return;
  e.preventDefault();
  if(pointerId!==null){releaseTalk();return;}
  if(touchId!==null){
    pointerId=e.pointerId;
    try{hold.setPointerCapture(e.pointerId);}catch{}
    return;
  }
  if(radio?.isHolding?.()){releaseTalk();return;}
  pointerId=e.pointerId;
  try{hold.setPointerCapture(e.pointerId);}catch{}
  beginTalk();
});
hold.addEventListener('touchstart',e=>{
  if(hold.disabled||!e.changedTouches.length)return;
  if(touchId!==null)return;
  touchId=e.changedTouches[0].identifier;
  if(pointerId===null)beginTalk();
},{passive:true});
for(const evt of ['pointerup','pointercancel']){
  document.addEventListener(evt,e=>{
    if(pointerId!==null&&e.pointerId===pointerId)releaseTalk();
  },{capture:true});
}
hold.addEventListener('lostpointercapture',e=>{
  if(pointerId!==null&&e.pointerId===pointerId)releaseTalk();
});
for(const evt of ['touchend','touchcancel']){
  document.addEventListener(evt,e=>{
    if(touchId!==null&&Array.from(e.changedTouches).some(t=>t.identifier===touchId))releaseTalk();
    else if(pointerId!==null&&!e.touches.length)releaseTalk();
  },{passive:true,capture:true});
}
document.addEventListener('touchmove',e=>{
  if(touchId===null)return;
  const touch=Array.from(e.touches).find(t=>t.identifier===touchId);
  if(!touch){releaseTalk();return;}
  const rect=hold.getBoundingClientRect();
  if(touch.clientX<rect.left||touch.clientX>rect.right||
     touch.clientY<rect.top||touch.clientY>rect.bottom)releaseTalk();
},{passive:true,capture:true});
hold.addEventListener('keydown',e=>{
  if(keyboardHeld||e.repeat)return;
  if(e.code==='Space'||e.code==='Enter'){e.preventDefault();keyboardHeld=true;beginTalk();}
});
document.addEventListener('keyup',e=>{
  if(keyboardHeld&&(e.code==='Space'||e.code==='Enter')){
    e.preventDefault();releaseTalk();
  }
});
emergency.addEventListener('click',()=>{
  disconnectRadio();
  toast('Microfone desligado. Rádio encerrado.');
});
$('#flowtalkListen').addEventListener('click',()=>{void radio?.enableAudio();});
$('#flowtalkAutoPlay').addEventListener('change',()=>{
  radio?.listening($('#flowtalkAutoPlay').checked);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)releaseTalk();
});
window.addEventListener('blur',releaseTalk);
window.addEventListener('pagehide',disconnectRadio);
$('#notifyButton').addEventListener('click',async()=>{
  if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator)){
    toast('Este aparelho não oferece notificações web.');return;
  }
  if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&
     !(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)){
    toast('No iPhone, instale o FlowTalk na Tela de Início antes de ativar os alertas.');
    return;
  }
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Autorize as notificações do FlowTalk.');
    const config=await api('/api/push/config');
    if(!config.enabled||!config.publicKey)throw new Error('Alertas indisponíveis neste servidor.');
    const b64=config.publicKey;const raw=atob((b64+'='.repeat((4-b64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));
    const key=Uint8Array.from(raw,ch=>ch.charCodeAt(0));
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await api('/api/push/subscribe',{method:'POST',data:{subscription:subscription.toJSON()}});
    localStorage.setItem('vozchat_push_uid',user.id);
    toast('Alertas ativados. Toque na notificação para entrar no rádio.');
  }catch(err){toast(err.message);}
});
void init();
