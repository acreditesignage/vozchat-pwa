import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=fs.readFileSync(new URL('../public/call-ringtone.js',import.meta.url),'utf8');
function harness(){
  const ticks=new Map(),timeouts=new Map(),listeners=new Map();
  let next=0,hidden=false,vibrateCalls=0,notes=0;
  const audio={
    state:'running',currentTime:0,destination:{},
    createOscillator(){return{
      type:'sine',frequency:{setValueAtTime(){}},connect(){return this;},start(){notes++;},
      stop(){},disconnect(){},onended:null
    }},
    createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return this;},disconnect(){}}}
  };
  const document={
    get hidden(){return hidden;},
    addEventListener(name,fn){listeners.set(name,fn);}
  };
  const navigator={vibrate(pattern){vibrateCalls++;return true;}};
  const window={};
  runInNewContext(source,{window,document,navigator,
    setInterval(fn,ms){const id=++next;ticks.set(id,{fn,ms});return id;},
    clearInterval(id){ticks.delete(id);},
    setTimeout(fn,ms){const id=++next;timeouts.set(id,{fn,ms});return id;},
    clearTimeout(id){timeouts.delete(id);},
    Date});
  return{
    api:window.VozChatRingtone,
    audio:()=>audio,
    sound:()=>true,vibrate:()=>true,
    tick(){for(const {fn} of [...ticks.values()])fn();},
    expire(){for(const {fn} of [...timeouts.values()])fn();},
    hidden(value){hidden=value;listeners.get('visibilitychange')?.();},
    stats:()=>({notes,vibrateCalls,intervals:ticks.size,expiration:timeouts.size,periods:[...ticks.values()].map(x=>x.ms)})
  };
}
test('chamada de vídeo ou áudio repete campainha até atender, sem afetar aviso curto',()=>{
  const h=harness();
  assert.equal(h.api.isActive(),false);
  h.api.start({id:'incoming-audio',incoming:true,audio:h.audio,sound:h.sound,vibrate:h.vibrate,expiresAt:Date.now()+60000});
  assert.equal(h.api.isActive(),true);
  assert.equal(h.stats().notes,4);
  assert.deepEqual(h.stats().periods,[2250]);
  h.tick();
  assert.equal(h.stats().notes,8,'Campainha repetida');
  assert.ok(h.stats().vibrateCalls>=2);
  h.api.stop();
  const state=h.stats();
  assert.equal(h.api.isActive(),false);
  assert.equal(state.intervals,0);
  assert.equal(state.expiration,0);
  h.tick();
  assert.equal(h.stats().notes,8,'Parou de tocar imediatamente');
});
test('ringback de quem liga é diferente e parada por timeout funciona',()=>{
  const h=harness();
  h.api.start({id:'outbound',incoming:false,audio:h.audio,sound:h.sound,vibrate:h.vibrate});
  assert.equal(h.stats().notes,2);
  h.tick();assert.equal(h.stats().notes,4);
  h.expire();
  assert.equal(h.api.isActive(),false);
  assert.equal(h.stats().intervals,0);
});
test('ao voltar do background PWA, repete se chamada ainda estiver pendente',()=>{
  const h=harness();
  h.hidden(true);
  h.api.start({id:'ringing',incoming:true,audio:h.audio,sound:h.sound,vibrate:h.vibrate});
  assert.equal(h.stats().notes,0);
  h.hidden(false);
  assert.equal(h.stats().notes,4);
  h.api.stop();
});
test('desativar som nas preferências interrompe a melodia mas conserva aviso visual',()=>{
  const h=harness();
  h.api.start({id:'no-sound',incoming:true,audio:h.audio,sound:()=>false,vibrate:()=>false});
  assert.equal(h.stats().notes,0);
  h.tick();
  assert.equal(h.stats().notes,0);
  assert.equal(h.api.isActive(),true);
  h.api.stop();
});
test('SSE call-ended, recusa, aceite e pagehide têm parada do toque; mensagens ficam curtas',()=>{
  const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const app=read('public/app.js'),html=read('public/index.html'),sw=read('public/sw.js');
  const callEnd=app.indexOf("events.addEventListener('call-ended'");
  assert.match(app.slice(callEnd,callEnd+270),/closeCallUI\(false\)/);
  assert.match(app,/async function closeCallUI\(notifyServer=true\)\{\s*window\.VozChatRingtone\?\.stop\(\)/);
  assert.match(app,/\$\('#callAccept'\)\.addEventListener\('click',async\(\)=>\{[\s\S]{0,160}VozChatRingtone\?\.stop/);
  assert.match(app,/window\.addEventListener\('pagehide',\(\)=>\{\s*window\.VozChatRingtone\?\.stop\(\)/);
  assert.match(app,/function soundAlert\(\)/);
  assert.match(app,/function incomingAlert\(msg\)/);
  assert.match(app,/events\.addEventListener\('call-incoming'[\s\S]{0,380}presentCall\(incoming,true\)/);
  assert.match(html,/src="\/call-ringtone.js"/);
  assert.match(sw,/vozchat-shell-v28/);
  assert.match(sw,/\/call-ringtone.js/);
  assert.doesNotThrow(()=>new Function(app));
});
