import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const f=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function boot({stored=null,dark=false}={}){
  const storage=new Map();
  if(stored!==null)storage.set('vozchat_theme_v1',stored);
  const listeners=new Map();
  const buttons=['light','dark','auto'].map(value=>({
    dataset:{themeValue:value},attributes:{},classList:{toggle(key,state){this[key]=state;}},
    setAttribute(key,value){this.attributes[key]=value;},
    addEventListener(event,fn){this[event]=fn;}
  }));
  const scheme={matches:dark,addEventListener(event,fn){listeners.set(event,fn);}};
  const html={dataset:{},style:{}};
  const meta={content:''},status={textContent:''};
  const doc={
    documentElement:html,
    querySelector:x=>x==='meta[name="theme-color"]'?meta:null,
    querySelectorAll:x=>x==='[data-theme-value]'?buttons:[],
    getElementById:id=>id==='themeCurrentLabel'?status:null,
    addEventListener:(name,fn)=>listeners.set('document:'+name,fn)
  };
  const window={matchMedia:()=>scheme};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  runInNewContext(f('theme.js'),{document:doc,window,localStorage});
  listeners.get('document:DOMContentLoaded')?.();
  return{html,buttons,meta,status,storage,scheme,api:window.VozChatTheme,change:()=>listeners.get('change')?.()};
}
test('aparência automática segue o sistema e reage à troca de modo noturno',()=>{
  const t=boot();
  assert.equal(t.api.get(),'auto');
  assert.equal(t.html.dataset.theme,'light');
  assert.equal(t.buttons[2].attributes['aria-pressed'],'true');
  t.scheme.matches=true;t.change();
  assert.equal(t.html.dataset.theme,'dark');
  assert.equal(t.meta.content,'#071323');
  t.scheme.matches=false;t.change();
  assert.equal(t.html.dataset.theme,'light');
});
test('escolha manual é persistida e supera preferência do sistema',()=>{
  const t=boot({dark:true});
  t.api.set('light');
  assert.equal(t.html.dataset.theme,'light');
  assert.equal(t.storage.get('vozchat_theme_v1'),'light');
  t.scheme.matches=false;t.change();
  assert.equal(t.html.dataset.theme,'light');
  t.api.set('dark');
  assert.equal(t.html.dataset.theme,'dark');
  t.api.set('auto');
  assert.equal(t.html.dataset.theme,'light');
  assert.equal(t.api.set('invalid'),false);
  const another=boot({stored:'dark'});
  assert.equal(another.html.dataset.theme,'dark');
  assert.equal(another.status.textContent,'Sempre escuro');
});
test('layout premium oferece navegação funcional e nenhuma imagem inventada',()=>{
  const html=f('index.html'),app=f('app.js'),css=f('premium.css'),worker=f('sw.js');
  for(const id of ['listViewTitle','listSegments','roomList','callHeroAvatar','themeCurrentLabel']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const page of ['chats','contacts','calls','settings']){
    assert.match(html,new RegExp('data-mobile-tab="'+page+'"'));
  }
  for(const name of ['light','dark','auto']){
    assert.match(html,new RegExp('data-theme-value="'+name+'"'));
  }
  for(const name of ['all','favorites','groups','audio']){
    assert.match(html,new RegExp('data-list-filter="'+name+'"'));
  }
  assert.match(html,/href="\/premium.css"/);
  assert.match(html,/src="\/theme.js"/);
  assert.match(app,/function switchMobileTab\(mode\)/);
  assert.match(app,/function setRoomFavorite\(roomId,enabled\)/);
  assert.match(app,/function callContactDirectly\(roomId,kind\)/);
  assert.match(app,/function renderRooms\(\)/);
  assert.match(app,/paintAvatar\(\$\('#callHeroAvatar'\)/);
  assert.match(css,/html\[data-theme="dark"\]/);
  assert.match(css,/\.mobile-tabbar/);
  assert.match(css,/\.call-overlay/);
  assert.match(worker,/vozchat-shell-v23/);
  assert.match(worker,/\/theme.js/);
  assert.match(worker,/\/premium.css/);
  assert.doesNotThrow(()=>new Function(app));
});
test('FlowTalk acompanha o tema da aplicação e preserva PTT',()=>{
  const html=f('talk.html'),css=f('talk.css');
  assert.match(html,/src="\/theme.js"/);
  assert.match(css,/html\[data-theme="dark"\]/);
  assert.match(html,/id="flowtalkHold"/);
  assert.match(html,/id="flowtalkStop"/);
  assert.match(html,/href="\/app"/);
});
