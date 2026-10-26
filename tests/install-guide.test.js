import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/install-guide.js',import.meta.url),'utf8');
const mainHtml=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const talkHtml=readFileSync(new URL('../public/talk.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/install-guide.css',import.meta.url),'utf8');
const worker=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function scenario({ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',installed=false,manifest='/manifest.webmanifest',query='',storage=new Map()}={}){
  const listeners=new Map();let scheduled=null;
  const node=id=>({
    id,hidden:id==='installGuide',textContent:'',src:'',isConnected:true,disabled:false,
    children:[],listeners:{},focus(){document.activeElement=this;},
    addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);},
    dispatch(name,data={}){return Promise.all((this.listeners[name]||[]).map(fn=>fn({target:this,...data})));},
    replaceChildren(...children){this.children=children;},
    append(...children){this.children.push(...children);},
    querySelector(selector){return selector==='.install-guide-card'?elements.card:null;},
    querySelectorAll(){return [elements.installGuideClose,elements.installGuideAction,elements.installGuideLater];}
  });
  const ids=['installGuide','installGuideTitle','installGuideDescription','installGuideIcon','installGuideSteps',
    'installGuideAction','installGuideClose','installGuideLater','installButton','installGuideTalk'];
  const elements=Object.fromEntries(ids.map(id=>[id,node(id)]));
  elements.card=node('card');
  const document={
    activeElement:node('oldfocus'),visibilityState:'visible',
    getElementById:id=>elements[id],
    querySelector:selector=>selector==='link[rel="manifest"]'?{getAttribute:()=>manifest}:null,
    createElement:tag=>node(tag),
    addEventListener(name,handler){(listeners.get(name)||listeners.set(name,[]).get(name)).push(handler);},
    removeEventListener(name,handler){listeners.set(name,(listeners.get(name)||[]).filter(fn=>fn!==handler));}
  };
  const window={
    matchMedia:()=>({matches:installed}),addEventListener(name,handler){
      (listeners.get('window:'+name)||listeners.set('window:'+name,[]).get('window:'+name)).push(handler);
    },
    location:{search:query},navigator:{standalone:installed}
  };
  const navigator={userAgent:ua,platform:'iPhone',maxTouchPoints:1,standalone:installed};
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  runInNewContext(source,{window,document,navigator,localStorage,location:{search:query},
    URLSearchParams,setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout(){}});
  return {
    elements,storage,window,runTimer:()=>scheduled?.(),listeners,
    dispatchWindow:(name,data)=>Promise.all((listeners.get('window:'+name)||[]).map(fn=>fn(data))),
    document
  };
}
test('guia mobile abre apenas na primeira visita e respeita dispensa',async()=>{
  const store=new Map(),first=scenario({storage:store});
  first.runTimer();
  assert.equal(first.elements.installGuide.hidden,false);
  assert.match(first.elements.installGuideTitle.textContent,/VozChat/);
  assert.match(first.elements.installGuideSteps.children[0].children[1].textContent,/Safari/);
  assert.match(first.elements.installGuideSteps.children[2].children[1].textContent,/Tela de Início/);
  await first.elements.installGuideLater.dispatch('click');
  assert.equal(first.elements.installGuide.hidden,true);
  assert.equal(store.get('vozchat_install_guide_seen_v1'),'1');
  const another=scenario({storage:store});
  another.runTimer();
  assert.equal(another.elements.installGuide.hidden,true,'não reapresentar após dispensar');
  await another.elements.installButton.dispatch('click');
  assert.equal(another.elements.installGuide.hidden,false,'tutorial disponível manualmente');
});
test('não interrompe aplicativo instalado ou convite, e FlowTalk usa nome correto',()=>{
  const installed=scenario({installed:true});installed.runTimer();
  assert.equal(installed.elements.installGuide.hidden,true);
  const join=scenario({query:'?join=chave'});join.runTimer();
  assert.equal(join.elements.installGuide.hidden,true);
  const radio=scenario({manifest:'/talk.webmanifest'});
  radio.runTimer();
  assert.match(radio.elements.installGuideTitle.textContent,/FlowTalk/);
  assert.match(radio.elements.installGuideIcon.src,/flowtalk/);
});
test('Android permite instalação nativa com prompt e oferece instruções',async()=>{
  const android=scenario({ua:'Mozilla/5.0 (Linux; Android 15; Pixel 8)'});
  let prompted=false;
  const promptEvent={preventDefault(){},async prompt(){prompted=true;},userChoice:Promise.resolve({outcome:'accepted'})};
  await android.dispatchWindow('beforeinstallprompt',promptEvent);
  android.runTimer();
  assert.equal(android.elements.installGuideAction.textContent,'Instalar agora');
  assert.match(android.elements.installGuideSteps.children[1].children[1].textContent,/três pontos/);
  await android.elements.installGuideAction.dispatch('click');
  assert.equal(prompted,true);
  assert.equal(android.elements.installGuide.hidden,true);
  assert.equal(android.storage.get('vozchat_install_guide_seen_v1'),'1');
});
test('UI mantém zoom acessível, etapas e cache de instalação',()=>{
  for(const html of [mainHtml,talkHtml]){
    assert.match(html,/id="installGuide"/);
    assert.match(html,/aria-modal="true"/);
    assert.match(html,/src="\/install-guide.js"/);
    assert.match(html,/href="\/install-guide.css"/);
    assert.match(html,/id="installGuideLater"/);
  }
  assert.match(talkHtml,/id="installGuideTalk"/);
  assert.match(css,/min-height:48px/);
  assert.doesNotMatch(css,/user-scalable=no|touch-action:none/);
  assert.match(worker,/vozchat-shell-v37/);
  assert.match(worker,/\/install-guide.js/);
  assert.match(worker,/\/install-guide.css/);
});
