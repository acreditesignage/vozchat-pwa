import {Room,RoomEvent,Track,VideoPresets} from 'livekit-client';

// Cliente compartilhado para chamadas de voz e vídeo; separado do PTT FlowTalk.
// O SDK interrompe tracks locais ao encerrar, e nenhuma mídia é gravada.
export async function joinLiveCall({call,api,mount,onState,onFailure}){
  const room=new Room({adaptiveStream:true,dynacast:true,videoCaptureDefaults:{resolution:VideoPresets.h540.resolution}});
  let closed=false,muted=false,cameraEnabled=call.kind==='video',front=true;
  const participants=new Map();
  const audioMount=mount.audio;
  const videoMount=mount.remote;
  const selfMount=mount.local;
  const notify=message=>{if(!closed)onState?.(message);};
  function attachRemote(track,participant){
    if(closed)return;
    if(track.kind===Track.Kind.Video){
      const cell=document.createElement('div');
      cell.className='call-person';
      cell.dataset.identity=participant.identity;
      const video=track.attach();
      video.autoplay=true;video.playsInline=true;
      video.setAttribute('playsinline','');
      video.muted=true;
      cell.append(video);
      const badge=document.createElement('span');badge.textContent='Participante';
      cell.append(badge);
      videoMount.append(cell);
      participants.set(track.sid,{cell,track});
    }else if(track.kind===Track.Kind.Audio){
      const audio=track.attach();
      audio.autoplay=true;audio.playsInline=true;
      audio.setAttribute('playsinline','');
      audioMount.append(audio);
      audio.play().catch(()=>notify('Toque em Ativar som para ouvir.'));
    }
  }
  function unmount(track){
    if(track.kind===Track.Kind.Video){
      const cell=participants.get(track.sid)?.cell;
      cell?.remove();
      participants.delete(track.sid);
    }
    for(const el of track.detach()){el.pause?.();el.remove();}
  }
  function paintLocalCamera(){
    selfMount.replaceChildren();
    const pub=room.localParticipant.getTrackPublication(Track.Source.Camera);
    if(!pub?.track||pub.isMuted)return;
    const local=pub.track.attach();
    local.muted=true;local.autoplay=true;local.playsInline=true;
    local.setAttribute('playsinline','');
    selfMount.append(local);
    void local.play().catch(()=>{});
  }
  async function shutdown(){
    if(closed)return;
    closed=true;
    for(const pub of room.localParticipant.trackPublications.values()){
      try{pub.track?.mediaStreamTrack && (pub.track.mediaStreamTrack.enabled=false);}catch{}
      try{pub.track?.stop();}catch{}
    }
    try{await room.disconnect();}catch{}
    for(const node of participants.values())node.cell.remove();
    participants.clear();
    audioMount.replaceChildren();
    videoMount.replaceChildren();
    selfMount.replaceChildren();
  }
  room.on(RoomEvent.TrackSubscribed,(track,_pub,participant)=>attachRemote(track,participant));
  room.on(RoomEvent.TrackUnsubscribed,track=>unmount(track));
  room.on(RoomEvent.LocalTrackPublished,paintLocalCamera);
  room.on(RoomEvent.LocalTrackUnpublished,paintLocalCamera);
  room.on(RoomEvent.TrackMuted,(_pub,participant)=>{if(participant?.isLocal)paintLocalCamera();});
  room.on(RoomEvent.Disconnected,()=>{if(!closed)onFailure?.('A chamada foi desconectada.');});
  room.on(RoomEvent.AudioPlaybackStatusChanged,()=>{
    if(!room.canPlaybackAudio)notify('Toque em Ativar som para ouvir.');
  });
  try{
    // O servidor autoriza apenas participantes aceitos na chamada.
    const result=await api('/api/calls/'+call.id+'/token',{method:'POST',data:{}});
    if(closed)throw Error('Chamada encerrada.');
    await room.connect(result.url,result.token,{autoSubscribe:true});
    if(closed){void room.disconnect();throw Error('Chamada encerrada.');}
    // Permissão solicitada na entrada, sem ativação silenciosa de câmera ou microfone.
    await room.localParticipant.setMicrophoneEnabled(true);
    if(closed){void room.disconnect();throw Error('Chamada encerrada.');}
    if(call.kind==='video'){
      try{await room.localParticipant.setCameraEnabled(true);}catch(err){
        cameraEnabled=false;
        notify('Câmera indisponível. A chamada continuará somente com áudio.');
      }
    }
    paintLocalCamera();
    notify('Conectado · chamada ao vivo');
  }catch(err){
    await shutdown();
    throw err;
  }
  return {
    close:shutdown,
    isMuted:()=>muted,
    isCameraEnabled:()=>cameraEnabled,
    mute:async()=>{
      muted=!muted;
      await room.localParticipant.setMicrophoneEnabled(!muted);
      return !muted;
    },
    camera:async()=>{
      cameraEnabled=!cameraEnabled;
      try{
        await room.localParticipant.setCameraEnabled(cameraEnabled);
        paintLocalCamera();
        return cameraEnabled;
      }catch(err){cameraEnabled=!cameraEnabled;throw err;}
    },
    flip:async()=>{
      const pub=room.localParticipant.getTrackPublication(Track.Source.Camera);
      if(!pub?.track?.restartTrack)return false;
      front=!front;
      await pub.track.restartTrack({facingMode:front?'user':'environment'});
      return true;
    },
    startAudio:async()=>{await room.startAudio();return room.canPlaybackAudio;}
  };
}
