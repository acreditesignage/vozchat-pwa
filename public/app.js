const $ = q => document.querySelector(q);
let me=null, rooms=[], current=null, messages=[], events=null, isRegister=false, recorder=null, pieces=[], recordingStart=0, recordingTicker=null, recordedCanceled=false, deferredInstall=null, pendingFiles=[],pendingRoom=null,previewUrl=null,uploading=false;
const joinParam = new URLSearchParams(location.search).get('join');
const avatar = name => (name||'?').slice(0,1).toUpperCase();
const time = iso => new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const day = iso => new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
let toastTimer;
function toast(msg) {const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3700);}
async function api(url,{method='GET',data,headers={}}={}) {let opt={method,credentials:'same-origin',headers};if(data!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(data);}let response;try{response=await fetch(url,opt);}catch{throw new Error('Falha na conexão com o servidor.');}let json=await response.json().catch(()=>({}));if(!response.ok)throw new Error(json.error||'Não foi possível concluir.');return json;}
function showAuth() {me=null;rooms=[];current=null;$('#auth').hidden=false;$('#app').hidden=true;$('#app').classList.remove('chat-open');if(events){events.close();events=null;}}
function sortRooms() {rooms.sort((a,b)=>new Date(b.last?.createdAt||b.createdAt)-new Date(a.last?.createdAt||a.createdAt));}
function authMode(register) {isRegister=register;$('#nameField').hidden=!register;$('#realName').required=register;$('#authTitle').textContent=register?'Crie sua conta':'Entre na sua conta';$('#authSubmit').innerHTML=register?'Criar conta <span>→</span>':'Entrar <span>→</span>';$('#authSwitchLabel').firstChild.textContent=register?'Já possui uma conta? ':'Ainda não tem conta? ';$('#authSwitch').textContent=register?'Entrar':'Criar conta';$('#password').autocomplete=register?'new-password':'current-password';}
$('#authSwitch').addEventListener('click',()=>authMode(!isRegister));
$('#authForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#authSubmit');btn.disabled=true;try {await api(isRegister?'/api/register':'/api/login',{method:'POST',data:{name:$('#realName').value,username:$('#username').value,password:$('#password').value}});$('#password').value='';await start();}catch(err){toast(err.message);}finally{btn.disabled=false;}});
async function start() {let data;try {data=await api('/api/bootstrap');}catch{showAuth();return;}me=data.user;rooms=data.rooms;sortRooms();$('#auth').hidden=true;$('#app').hidden=false;$('#meName').textContent=me.name;$('#meUsername').textContent='@'+me.username;$('#meAvatar').textContent=avatar(me.name);renderRooms();connectEvents();if(joinParam){try{const joined=await api('/api/rooms/join',{method:'POST',data:{invite:joinParam}});upsertRoom(joined.room);history.replaceState({},'', '/app');await openRoom(joined.room.id);toast('Você entrou na conversa!');}catch(err){toast(err.message);}}}
function upsertRoom(r) {let idx=rooms.findIndex(x=>x.id===r.id);if(idx<0)rooms.push(r);else rooms[idx]={...rooms[idx],...r};sortRooms();renderRooms();if(current===r.id)renderHeader();}
function renderRooms(){const list=$('#roomList');list.replaceChildren();const term=$('#search').value.trim().toLowerCase();const filtered=rooms.filter(x=>x.name.toLowerCase().includes(term));if(!filtered.length){const el=document.createElement('p');el.className='list-empty';el.textContent=term?'Nenhuma conversa encontrada.':'Nenhuma conversa ainda. Toque em + para criar a primeira.';list.append(el);return;}for(const room of filtered){const btn=document.createElement('button');btn.type='button';btn.className='room-item'+(room.id===current?' active':'');const ic=document.createElement('div');ic.className='room-icon';ic.textContent=avatar(room.name);const info=document.createElement('div');info.className='room-info';const top=document.createElement('div');top.className='room-name';const title=document.createElement('strong');title.textContent=room.name;const small=document.createElement('small');small.textContent=room.last?time(room.last.createdAt):'';top.append(title,small);const preview=document.createElement('div');preview.className='room-preview';preview.textContent=room.last?`${room.last.senderName}: ${room.last.type==='audio'?'🎤 Mensagem de voz':({image:'📷 Foto',video:'🎬 Vídeo',file:'📎 Arquivo'}[room.last.type]||room.last.text)}`:'Conversa criada · toque para abrir';info.append(top,preview);btn.append(ic,info);btn.addEventListener('click',()=>openRoom(room.id));list.append(btn);}}
$('#search').addEventListener('input',renderRooms);
function connectEvents(){if(events)events.close();events=new EventSource('/api/events');events.addEventListener('room',event=>{upsertRoom(JSON.parse(event.data));});events.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(current===msg.roomId && !messages.some(m=>m.id===msg.id)){messages.push(msg);renderMessage(msg);scrollDown();}else if(current!==msg.roomId){const room=rooms.find(x=>x.id===msg.roomId);if(room)toast(`Nova mensagem em ${room.name}`);}});events.onerror=()=>{if(!navigator.onLine)$('#offline').hidden=false;};}
async function openRoom(roomId){current=roomId;$('#emptyChat').hidden=true;$('#activeChat').hidden=false;$('#app').classList.add('chat-open');renderHeader();renderRooms();$('#messages').replaceChildren();messages=[];try{const data=await api(`/api/rooms/${roomId}/messages`);if(current!==roomId)return;messages=data.messages;renderMessages();}catch(err){toast(err.message);} }
function renderHeader(){const r=rooms.find(x=>x.id===current);if(!r)return;$('#roomName').textContent=r.name;$('#memberCount').textContent=`${r.members} ${r.members===1?'participante':'participantes'} · conversa privada`;$('#headerAvatar').textContent=avatar(r.name);}
function renderMessages(){const list=$('#messages');list.replaceChildren();if(!messages.length){const msg=document.createElement('div');msg.className='mini-welcome';msg.textContent='Conversa iniciada ✨\nCompartilhe o convite para outras pessoas entrarem e começarem a trocar mensagens.';list.append(msg);}let lastDay='';for(const m of messages){const key=day(m.createdAt);if(key!==lastDay){const divider=document.createElement('div');divider.className='day-divider';divider.textContent=key;list.append(divider);lastDay=key;}renderMessage(m);}scrollDown();}
function formatSize(size){if(size<1024)return size+' B';if(size<1048576)return (size/1024).toFixed(0)+' KB';return (size/1048576).toFixed(1)+' MB';}
function renderMessage(m){
  const row=document.createElement('div');row.className='bubble-row '+(m.senderId===me.id?'mine':'other');row.dataset.id=m.id;
  if(m.senderId!==me.id){const av=document.createElement('div');av.className='sender-avatar';av.textContent=avatar(m.senderName);row.append(av);}
  const bubble=document.createElement('div');bubble.className='bubble';
  if(m.senderId!==me.id){const author=document.createElement('p');author.className='bubble-author';author.textContent=m.senderName;bubble.append(author);}
  if(m.type==='audio'){
    const lab=document.createElement('div');lab.className='audio-label';lab.textContent='🎤 Mensagem de voz'+(m.duration?' · '+Math.round(m.duration)+'s':'');bubble.append(lab);
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
function newConversation(){$('#newRoomName').value='';openDialog('roomDialog');setTimeout(()=>$('#newRoomName').focus(),100);}
$('#newRoom').addEventListener('click',newConversation);$('#emptyCreate').addEventListener('click',newConversation);
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>document.getElementById(b.dataset.close).close());
$('#roomForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=await api('/api/rooms',{method:'POST',data:{name:$('#newRoomName').value}});$('#roomDialog').close();upsertRoom(data.room);await openRoom(data.room.id);showInvite();}catch(err){toast(err.message);}});
function showInvite(){const r=rooms.find(x=>x.id===current);if(!r)return;$('#inviteLink').value=location.origin+r.inviteUrl;openDialog('inviteDialog');}
$('#inviteButton').addEventListener('click',showInvite);
$('#copyInvite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#inviteLink').value);toast('Convite copiado!');$('#inviteDialog').close();}catch{$('#inviteLink').select();toast('Selecione e copie o link.');}});
$('#mobileBack').addEventListener('click',()=>{$('#app').classList.remove('chat-open');});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{}showAuth();});
$('#composer').addEventListener('submit',async e=>{e.preventDefault();const input=$('#msgInput');const content=input.value.trim();if(!content||!current)return;const roomId=current;input.value='';input.style.height='auto';try {await api(`/api/rooms/${roomId}/messages`,{method:'POST',data:{text:content}});}catch(err){input.value=content;toast(err.message);}});
// Envio de mídias e arquivos. A seleção é feita pelo navegador (câmera nativa no celular).
const MEDIA_MAX=25*1024*1024;
const ALLOWED_EXTENSIONS=/\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|webm|m4v|3gp|pdf|txt|csv|docx?|xlsx?|pptx?|zip)$/i;
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
  for(const file of files){if(file.size>MEDIA_MAX){toast('O arquivo '+file.name+' excede 25 MB.');return;}if(!ALLOWED_EXTENSIONS.test(file.name)){toast('Esse tipo de arquivo não é permitido.');return;}}
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
$('#confirmUpload').addEventListener('click',async()=>{
  if(uploading||!pendingFiles.length||!pendingRoom)return;
  uploading=true;const button=$('#confirmUpload');button.disabled=true;const files=[...pendingFiles], roomId=pendingRoom;
  try{
    for(let i=0;i<files.length;i++){
      const file=files[i];button.textContent=`Enviando ${i+1} de ${files.length}...`;
      let mime=file.type.split(';')[0].toLowerCase();if(!mime)mime='application/octet-stream';
      const response=await fetch(`/api/rooms/${roomId}/files`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':mime,'X-File-Name':encodeURIComponent(file.name)},body:file});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Falha ao enviar o arquivo.');
    }
    $('#fileDialog').close();toast(files.length===1?'Arquivo enviado!':'Arquivos enviados!');
  }catch(err){toast(err.message||'Erro ao enviar arquivo.');}
  finally{uploading=false;button.disabled=false;button.textContent='Enviar arquivo →';cleanupPreview();}
});
$('#msgInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#composer').requestSubmit();}});
$('#msgInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(136,e.target.scrollHeight)+'px';});
function supportedMime(){return ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'';}
function updateRecordClock(){const sec=Math.floor((Date.now()-recordingStart)/1000);$('#recordTime').textContent=`Gravando · ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;if(sec>=90&&recorder?.state==='recording')stopRecord();}
async function startRecord(){if(!current) return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Seu navegador não permite gravação de áudio.');return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});const type=supportedMime();recorder=new MediaRecorder(stream,type?{mimeType:type}:{});pieces=[];recordedCanceled=false;recorder.ondataavailable=e=>{if(e.data.size)pieces.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(recordingTicker);$('#recording').hidden=true;$('#micButton').classList.remove('recording-active');$('#micButton').setAttribute('aria-label','Iniciar gravação');if(recordedCanceled)return;const mime=recorder.mimeType.split(';')[0]||'audio/webm';const blob=new Blob(pieces,{type:mime});if(blob.size<100){toast('Áudio vazio. Tente novamente.');return;}const roomId=current;$('#micButton').disabled=true;try {const result=await fetch(`/api/rooms/${roomId}/audio`,{method:'POST',headers:{'Content-Type':mime,'X-Audio-Duration':String((Date.now()-recordingStart)/1000)},body:blob,credentials:'same-origin'});const data=await result.json();if(!result.ok)throw new Error(data.error||'Erro ao enviar áudio.');toast('Mensagem de voz enviada!');}catch(err){toast(err.message);}finally{$('#micButton').disabled=false;}};recorder.start(250);recordingStart=Date.now();$('#recording').hidden=false;$('#micButton').classList.add('recording-active');$('#micButton').setAttribute('aria-label','Parar e enviar gravação');updateRecordClock();recordingTicker=setInterval(updateRecordClock,500);}catch(err){toast(err.name==='NotAllowedError'?'Permita o acesso ao microfone nas configurações do navegador.':'Não foi possível iniciar o microfone.');}}
function stopRecord(cancel=false){if(!recorder||recorder.state!=='recording')return;recordedCanceled=cancel;recorder.stop();}
$('#micButton').addEventListener('click',()=>recorder?.state==='recording'?stopRecord():startRecord());$('#cancelAudio').addEventListener('click',()=>stopRecord(true));
window.addEventListener('online',()=>{$('#offline').hidden=true;toast('Conectado novamente.');});window.addEventListener('offline',()=>{$('#offline').hidden=false;});$('#offline').hidden=navigator.onLine;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
$('#installButton').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null, pendingFiles=[],pendingRoom=null,previewUrl=null,uploading=false;}else{toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)?'No Safari, toque em Compartilhar → Adicionar à Tela de Início.':'No menu do navegador, selecione Instalar app ou Adicionar à tela inicial.');}});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
start();