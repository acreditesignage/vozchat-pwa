import { Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client';

// SDK de áudio gerenciado. Sinalização de "quem pode falar" permanece no VozChat.
// Sem gravação, sem anexos e sem áudio no histórico.
export async function startLiveKitRadio({roomId,api,notify}) {
  const $ = selector => document.querySelector(selector);
  const status = text => { $('#flowtalkStatus').textContent=text; };
  const toggle = $('#flowtalkToggle'), panel = $('#flowtalkPanel');
  const button = $('#flowtalkHold'), speakers = $('#flowtalkAudioOutputs');
  const listen = $('#flowtalkListen'), audioToggle = $('#flowtalkAutoPlay');
  const stopButton = $('#flowtalkStop');
  let alive=true,holding=false,granted=false,ready=false,clientId=null,pressEpoch=0;
  let speakerId=null,peerCount=0,speakerName=null,ws=null,microphone=null,published=false,micPromise=null;
  let room=null;
  const receiveAudio=new Map();
  const roomCookie='/api/talk/ws?room='+encodeURIComponent(roomId);
  const send = data => {if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
  function ui(){
    if(!alive)return;
    const occupied=speakerId && speakerId!==clientId;
    button.disabled=!ready||!!occupied||!room;
    $('#flowtalkParticipants').textContent=peerCount+' pessoa(s) no rádio · LiveKit';
    if(occupied)status('📻 '+(speakerName||'Outra pessoa')+' está falando');
    else if(!holding)status('Canal livre · segure para falar');
  }
  // Silenciar imediatamente o track físico, sem aguardar a Promise do SDK.
  function silenceMicrophone(){
    try{
      if(microphone?.mediaStreamTrack)microphone.mediaStreamTrack.enabled=false;
      if(microphone)void microphone.mute().catch(()=>{});
    }catch{}
  }
  function close(){
    if(!alive)return;alive=false;holding=false;granted=false;pressEpoch++;
    stopButton.hidden=true;
    silenceMicrophone();
    try{microphone?.stop();}catch{}
    try{ws?.close();}catch{}
    try{room?.disconnect();}catch{}
    for(const audio of receiveAudio.values()){audio.pause();audio.remove();}
    receiveAudio.clear();speakers.replaceChildren();button.disabled=true;
    button.textContent='🎙 Segure para falar';button.classList.remove('talking');
    toggle.classList.remove('flowtalk-active');toggle.setAttribute('aria-pressed','false');panel.hidden=true;
  }
  function enableAudio(){
    if(!room||!alive)return;
    // Chamar no próprio gesto do usuário para o Safari liberar o alto-falante.
    return room.startAudio().then(()=>{
      listen.hidden=room.canPlaybackAudio;
      notify('🔊 Alto-falante ativado.');
    }).catch(()=>notify('Toque novamente para permitir o áudio no iPhone.'));
  }
  function listening(enabled) {
    for(const audio of receiveAudio.values())audio.muted=!enabled;
  }
  function audioSubscribed(track){
    if(!alive||track.kind!==Track.Kind.Audio)return;
    const audio=track.attach();
    audio.autoplay=true;audio.playsInline=true;
    audio.setAttribute('playsinline','');
    audio.muted=!audioToggle.checked;
    speakers.append(audio);receiveAudio.set(track.sid||track.mediaStreamTrack?.id||String(receiveAudio.size),audio);
    audio.play().catch(()=>{listen.hidden=false;status('Toque em 🔊 Ativar alto-falante para ouvir.');});
  }
  async function ensureMicrophone(){
    if(microphone)return microphone;
    if(!micPromise) {
      // Primeiro pedido inicia diretamente quando o botão é pressionado.
      micPromise=createLocalAudioTrack({echoCancellation:true,noiseSuppression:true,autoGainControl:true})
        .then(async track=>{
          if(!alive){track.stop();return null;}
          await track.mute();
          microphone=track;
          return track;
        }).catch(err=>{micPromise=null;throw err;});
    }
    return micPromise;
  }
  async function startSpeaking(epoch){
    const active=()=>alive&&holding&&granted&&pressEpoch===epoch;
    try{
      const track=await ensureMicrophone();
      if(!track||!active()){if(!holding||!granted)silenceMicrophone();return;}
      if(!published){
        await room.localParticipant.publishTrack(track,{source:Track.Source.Microphone});
        published=true;
      }
      if(!active()){if(!holding||!granted)silenceMicrophone();return;}
      await track.unmute();
      // Publicar e desmutar são assíncronos: se o usuário soltou no meio,
      // não reativar o microfone depois do pointerup.
      if(!active()){if(!holding||!granted)silenceMicrophone();return;}
      button.classList.add('talking');button.textContent='🔴 NO AR · solte para parar';
      stopButton.hidden=false;
      status('🔴 TRANSMITINDO VOZ AO VIVO');
    }catch(err){
      if(!alive)return;
      status('Microfone não ativou: '+(err?.message||'verifique a permissão'));
      notify('Não foi possível ativar o microfone.');
      release();
    }
  }
  function press(){
    if(!alive||!ready||holding||button.disabled)return;
    pressEpoch++;
    holding=true;granted=false;
    // O pedido do microfone começa no gesto do usuário.
    void ensureMicrophone().catch(err=>{
      if(!alive)return;
      notify(err?.name==='NotAllowedError'?'Autorize o microfone no aparelho.':'Falha ao abrir microfone.');
      release();
    });
    status('Solicitando canal...');
    send({type:'floor-request'});
  }
  function release(){
    if(!alive)return;
    pressEpoch++;
    holding=false;granted=false;
    silenceMicrophone();
    send({type:'floor-release'});
    button.classList.remove('talking');
    button.textContent='🎙 Segure para falar';
    stopButton.hidden=true;
    ui();
  }
  panel.hidden=false;button.disabled=true;stopButton.hidden=true;
  toggle.classList.add('flowtalk-active');toggle.setAttribute('aria-pressed','true');
  listen.hidden=false;status('Conectando áudio profissional...');
  try{
    const tokenResponse=await api('/api/talk/livekit-token',{method:'POST',data:{roomId}});
    if(!alive)return {close,press,release,enableAudio,listening};
    room=new Room({adaptiveStream:false,dynacast:false});
    room.on(RoomEvent.TrackSubscribed,track=>audioSubscribed(track));
    room.on(RoomEvent.TrackUnsubscribed,track=>{
      for(const element of track.detach()){element.pause();element.remove();}
      for(const [key,element] of receiveAudio)if(!element.isConnected)receiveAudio.delete(key);
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged,()=>{
      listen.hidden=room.canPlaybackAudio; if(!room.canPlaybackAudio)status('Toque em 🔊 para liberar o áudio.');
    });
    room.on(RoomEvent.ParticipantConnected,()=>{});
    room.on(RoomEvent.Disconnected,()=>{if(alive){release();status('Rádio desconectado da rede.');button.disabled=true;}});
    await room.connect(tokenResponse.url,tokenResponse.token,{autoSubscribe:true});
    if(!alive){room.disconnect();return {close,press,release,enableAudio,listening};}
    // Usar a mesma autenticação de sessão do VozChat para controlar uma única pessoa no ar.
    ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+roomCookie);
    ws.onmessage=event=>{
      if(!alive)return;
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(msg.type==='ready'){
        ready=true;clientId=msg.clientId;peerCount=msg.peers?.length||0;
        speakerId=msg.speakerId||null;speakerName=msg.speaker||null;ui();
      }else if(msg.type==='peer-joined'){peerCount++;ui();}
      else if(msg.type==='peer-left'){
        peerCount=Math.max(0,peerCount-1);
        if(speakerId===msg.clientId){speakerId=null;speakerName=null;}
        ui();
      }else if(msg.type==='floor'){
        speakerId=msg.clientId||null;speakerName=msg.name||null;ui();
      }else if(msg.type==='floor-granted'){
        if(!holding){send({type:'floor-release'});return;}
        granted=true;void startSpeaking(pressEpoch);
      }else if(msg.type==='floor-denied'){
        release();status('O canal está ocupado. Aguarde sua vez.');
      }
    };
    ws.onclose=()=>{if(alive){release();status('Conexão do rádio perdida. Feche e reabra o FlowTalk.');button.disabled=true;}};
    ws.onerror=()=>{if(alive)status('Não foi possível manter o canal de rádio.');};
    status('Conectado ao LiveKit. Aguardando o canal...');
  }catch(err){
    close();
    throw err;
  }
  return {close,press,release,enableAudio,listening,isHolding:()=>holding};
}
