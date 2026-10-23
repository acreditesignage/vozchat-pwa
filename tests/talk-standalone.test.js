import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('FlowTalk independente tem entrada própria, controles LiveKit e ícone instalável',()=>{
  const radio=file('talk.html');
  const app=file('index.html');
  const css=file('talk.css');
  const js=file('talk.js');
  const manifest=JSON.parse(file('talk.webmanifest'));
  const mainManifest=JSON.parse(file('manifest.webmanifest'));
  const worker=file('sw.js');
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/url\.pathname==='\/talk'\?'\/talk\.html'/);
  assert.match(app,/href="\/talk" class="quick-talk-link"/);
  assert.equal(manifest.id,'/talk');
  assert.equal(manifest.start_url,'/talk');
  assert.equal(manifest.display,'standalone');
  assert.notEqual(mainManifest.id,manifest.id);
  assert.ok(mainManifest.shortcuts?.some(x=>x.url==='/talk'));
  assert.match(radio,/rel="manifest" href="\/talk\.webmanifest"/);
  for(const id of ['flowtalkPanel','flowtalkToggle','flowtalkHold','flowtalkStop','flowtalkListen',
                   'flowtalkAutoPlay','flowtalkAudioOutputs','flowtalkStatus','flowtalkParticipants',
                   'talkRoom','notifyButton','loginPanel']){
    assert.match(radio,new RegExp('id="'+id+'"'),id+' na tela dedicada');
  }
  assert.match(css,/\.flowtalk-hold\.talking/);
  new Function(js);
  assert.match(js,/await import\('\/livekit\.bundle\.js'\)/);
  assert.match(js,/startLiveKitRadio\(\{roomId:selectedRoom\(\),api,notify:toast\}\)/);
  assert.match(js,/localStorage\.setItem\(STORAGE_KEY,selectedRoom\(\)\)/);
  assert.match(js,/roomId:selectedRoom\(\)/);
  assert.match(js,/const requested=normalizeRoom\(rooms,linkRoom\)/);
  assert.match(js,/void connectRadio\(\)/);
  assert.match(js,/document\.addEventListener\(evt,e=>/);
  assert.match(js,/if\(document\.hidden\)releaseTalk\(\)/);
  assert.match(js,/emergency\.addEventListener\('click'/);
  assert.match(js,/timer=setTimeout\(\(\)=>\{/);
  assert.match(js,/Notification\.requestPermission\(\)/);
  assert.match(js,/registration\.pushManager\.subscribe/);
  assert.match(worker,/\/talk\?room=/);
  assert.match(worker,/const VERSION='vozchat-shell-v13'/);
  assert.match(worker,/\/talk\.webmanifest/);
});
