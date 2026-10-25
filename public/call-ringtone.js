/* Toque de chamada de áudio/vídeo, diferente do aviso curto de mensagem.
   Usa AudioContext já autorizado pelo toque do usuário, sem arquivos externos. */
(()=>{
  'use strict';
  const CYCLE_MS=2250;
  const MAX_RING_MS=60000;
  let callId=null,loop=null,expires=null,settings=null;
  const activeNodes=new Set();
  function play(){
    if(!callId||!settings||document.hidden)return;
    let ctx=null;
    try{if(settings.sound())ctx=settings.audio();}catch{}
    if(ctx?.state==='running'){
      const incoming=settings.incoming;
      // Dois pulsos de campainha com pausa audível; saída usa tom mais discreto.
      const notes=incoming?
        [[0,784,.21],[.28,988,.24],[.64,784,.21],[.92,988,.28]]:
        [[0,440,.16],[.30,554,.19]];
      const volume=incoming?.105:.052;
      for(const [delay,freq,duration] of notes){
        try{
          const oscillator=ctx.createOscillator(),gain=ctx.createGain();
          const start=ctx.currentTime+.01+delay;
          oscillator.type='sine';oscillator.frequency.setValueAtTime(freq,start);
          gain.gain.setValueAtTime(.0001,start);
          gain.gain.exponentialRampToValueAtTime(volume,start+.027);
          gain.gain.setValueAtTime(volume,start+duration-.055);
          gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
          oscillator.connect(gain);gain.connect(ctx.destination);
          const node={oscillator,gain,context:ctx};
          activeNodes.add(node);
          oscillator.onended=()=>{activeNodes.delete(node);try{oscillator.disconnect();gain.disconnect();}catch{}};
          oscillator.start(start);oscillator.stop(start+duration+.015);
        }catch{}
      }
    }
    if(settings.incoming&&settings.vibrate()&&typeof navigator.vibrate==='function'){
      try{navigator.vibrate([260,170,260]);}catch{}
    }
  }
  function stop(){
    callId=null;settings=null;
    // Encerrar imediatamente até as notas previamente agendadas no WebAudio.
    for(const node of activeNodes){
      try{
        node.gain.gain.cancelScheduledValues(node.context.currentTime);
        node.gain.gain.setValueAtTime(.0001,node.context.currentTime);
        node.oscillator.stop(node.context.currentTime+.005);
      }catch{}
    }
    activeNodes.clear();
    if(loop!==null){clearInterval(loop);loop=null;}
    if(expires!==null){clearTimeout(expires);expires=null;}
    if(typeof navigator.vibrate==='function')try{navigator.vibrate(0);}catch{}
  }
  function start({id,incoming=true,expiresAt=null,audio,sound,vibrate}={}){
    if(!id||typeof audio!=='function'||typeof sound!=='function'||typeof vibrate!=='function')return;
    // Evita iniciar dois alarmes para o mesmo evento/SSE.
    if(id===callId&&incoming===settings?.incoming)return;
    stop();
    callId=id;settings={incoming,audio,sound,vibrate};
    let lifetime=MAX_RING_MS;
    if(Number.isFinite(expiresAt)&&expiresAt>Date.now())
      lifetime=Math.min(MAX_RING_MS,expiresAt-Date.now());
    play();
    loop=setInterval(play,CYCLE_MS);
    expires=setTimeout(stop,Math.max(1000,lifetime));
  }
  document.addEventListener('visibilitychange',()=>{
    // No iOS o PWA suspenso não pode gerar som; retomar na volta à tela.
    if(!document.hidden&&callId)play();
  });
  window.VozChatRingtone={start,stop,isActive:()=>Boolean(callId)};
})();
