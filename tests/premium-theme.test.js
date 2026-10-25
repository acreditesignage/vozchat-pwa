import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('VozChat tem temas claro/escuro e troca manual ou automática, sem perder preferência',()=>{
  const js=read('public/theme.js'),css=read('public/premium.css');
  const settings=new Map();
  const classList={toggle(){}};
  const buttons=['light','dark','auto'].map(mode=>({dataset:{themeValue:mode},attrs:{},classList,
    setAttribute(k,v){this.attrs[k]=v},addEventListener(name,fn){this.press=fn;}}));
  const quick={attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(name,fn){this.press=fn;}};
  let sysDark=false,mediaHandler=null,ready=null;
  const meta={content:''},status={textContent:''};
  const doc={
    documentElement:{dataset:{},style:{}},
    querySelector(q){return q==='meta[name="theme-color"]'?meta:null;},
    querySelectorAll(q){return q==='[data-theme-value]'?buttons:q==='[data-theme-toggle]'?[quick]:[];},
    getElementById(id){return id==='themeCurrentLabel'?status:null;},
    addEventListener(type,fn){if(type==='DOMContentLoaded')ready=fn;}
  };
  const window={matchMedia:()=>({get matches(){return sysDark;},addEventListener(type,fn){mediaHandler=fn;}})};
  const localStorage={getItem:key=>settings.get(key)||null,setItem:(key,value)=>settings.set(key,value)};
  runInNewContext(js,{document:doc,window,localStorage});
  ready();
  assert.equal(window.VozChatTheme.get(),'auto');
  assert.equal(doc.documentElement.dataset.theme,'light');
  sysDark=true;mediaHandler();
  assert.equal(doc.documentElement.dataset.theme,'dark');
  assert.equal(quick.attrs['aria-label'],'Ativar tema claro');
  quick.press();
  assert.equal(doc.documentElement.dataset.theme,'light');
  assert.equal(settings.get('vozchat_theme_v1'),'light');
  buttons[0].press();
  assert.equal(window.VozChatTheme.get(),'light');
  assert.equal(doc.documentElement.dataset.theme,'light');
  assert.equal(settings.get('vozchat_theme_v1'),'light');
  assert.equal(buttons[0].attrs['aria-pressed'],'true');
  buttons[1].press();assert.equal(doc.documentElement.dataset.theme,'dark');
  assert.equal(meta.content,'#071323');
  buttons[2].press();assert.equal(window.VozChatTheme.get(),'auto');
  assert.equal(status.textContent,'Acompanha o tema do iPhone ou Android');
  assert.match(css,/html\[data-theme="dark"\]/);
  assert.match(css,/\.mobile-tabbar/);
  assert.match(css,/\.call-sheet/);
  assert.match(css,/\.theme-choice\[aria-pressed="true"\]/);
});
test('todas as entradas usam as duas aparências e botões de navegação reais',()=>{
  const html=read('public/index.html'),talk=read('public/talk.html'),app=read('public/app.js'),sw=read('public/sw.js');
  assert.match(html,/href="\/premium\.css"/);
  assert.match(html,/src="\/theme\.js"/);
  assert.match(talk,/src="\/theme\.js"/);
  for(const name of ['light','dark','auto'])assert.ok(html.includes('data-theme-value="'+name+'"'));
  for(const name of ['chats','contacts','calls','settings'])assert.ok(html.includes('data-mobile-tab="'+name+'"'));
  assert.match(app,/function switchMobileTab/);
  assert.match(app,/function setConversationFilter/);
  assert.match(app,/function callContactDirectly/);
  assert.match(app,/function renderRooms/);
  assert.match(sw,/\/premium\.css/);
  assert.match(sw,/\/theme\.js/);
  assert.match(sw,/vozchat-shell-v26/);
  assert.match(html,/data-theme-toggle/);
  assert.match(talk,/data-theme-toggle/);
  assert.match(read('public/talk.css'),/html\[data-theme="dark"\] \.appearance-toggle/);
  assert.doesNotThrow(()=>new Function(app));
});
