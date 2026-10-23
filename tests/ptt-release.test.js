import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const radio=readFileSync(new URL('../public/livekit-radio.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('soltar o botão sempre encerra LiveKit e rádio antigo',()=>{
  const start=source.indexOf('let talkPointerId=null;');
  const end=source.indexOf("talkStop.addEventListener('click'",start);
  assert.ok(start>=0&&end>start);
  const block=source.slice(start,end);
  let livekitReleases=0,legacyReleases=0;
  const context={livekitController:{release:()=>{livekitReleases++;}},liveRadio:{holding:true},stopRadioTalk:()=>{legacyReleases++;},talkStop:{hidden:false},clearTimeout:()=>{}};
  createContext(context);
  runInContext(block+';globalThis.endTalkHold=endTalkHold;globalThis.releasePushToTalk=releasePushToTalk;',context);
  // Simula um toque que começou com o ponteiro capturado.
  runInContext('talkPointerId=42;',context);
  context.endTalkHold();
  assert.equal(livekitReleases,1);
  assert.equal(legacyReleases,1);
  assert.equal(context.talkStop.hidden,true);
  // Eventos repetidos do Safari não devem duplicar a liberação.
  context.endTalkHold();
  assert.equal(livekitReleases,1);
  assert.equal(legacyReleases,1);
  assert.match(source,/document.addEventListener\(name,e=>[\s\S]*?endTalkHold\(\)/);
  assert.match(source,/for\(const name of \['touchend','touchcancel'\]\)/);
  assert.match(source,/document.addEventListener\('touchmove',/);
  assert.match(source,/talkButton.addEventListener\('touchstart',/);
  assert.match(source,/if\(talkTouchId!==null&&talkPointerId===null\)\{[\s\S]*?talkPointerId=e.pointerId;[\s\S]*?return;\s*\}/);
  assert.match(source,/if\(talkPointerId!==null\|\|livekitController\?\.isHolding\?\.\(\)\)/);
  assert.match(source,/window.addEventListener\('blur',[\s\S]*?releasePushToTalk\(\)/);
  assert.match(source,/if\(document.hidden\)\{endTalkHold\(\);releasePushToTalk\(\);\}/);
});

test('LiveKit desliga o microfone imediatamente e não reabre depois do soltar',()=>{
  assert.match(radio,/function silenceMicrophone\(\)[\s\S]*?microphone\.mediaStreamTrack\.enabled=false/);
  const release=radio.slice(radio.indexOf('function release(){'),radio.indexOf('panel.hidden=false;button.disabled=true;'));
  assert.ok(release.includes('pressEpoch++;'));
  assert.ok(release.indexOf('silenceMicrophone();')<release.indexOf("send({type:'floor-release'})"));
  assert.match(radio,/const active=\(\)=>alive&&holding&&granted&&pressEpoch===epoch/);
  assert.match(radio,/if\(!active\(\)\)\{if\(!holding\|\|!granted\)silenceMicrophone\(\);return;\}/);
  assert.match(radio,/granted=true;void startSpeaking\(pressEpoch\)/);
  assert.match(radio,/isHolding:\(\)=>holding/);
  assert.match(radio,/stopButton.hidden=false/);
  assert.match(radio,/stopButton.hidden=true/);
});

test('botão de parada de emergência e limite de transmissão',()=>{
  assert.match(html,/id="flowtalkStop"[^>]*hidden/);
  assert.match(source,/talkStop.addEventListener\('click',/);
  assert.match(source,/stopLiveRadio\(\);[\s\S]*?Microfone desligado/);
  assert.match(source,/const MAX_TALK_MS=60000;/);
  assert.match(source,/Transmissão encerrada por segurança após 60 segundos/);
});
