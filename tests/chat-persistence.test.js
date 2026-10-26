import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){return new Promise(resolve=>{
 const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});}
async function boot(port,dir){
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,
   NODE_ENV:'test',DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
   LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:''},stdio:'pipe'});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<130;i++){
  if(child.exitCode!==null)throw Error('Servidor encerrou antes de iniciar');
  try{if((await fetch(base+'/api/health')).ok)return child;}catch{}
  await sleep(35);
 }
 child.kill();throw Error('Servidor não iniciou');
}
async function stop(child){
 if(!child||child.exitCode!==null)return;
 const done=new Promise(resolve=>child.once('exit',resolve));
 child.kill('SIGTERM');
 await Promise.race([done,sleep(1000)]);
}

test('Conversas e mensagens são restauradas do armazenamento após reiniciar e novo login',async t=>{
 const port=await availablePort(),dir=mkdtempSync(path.join(tmpdir(),'vozchat-chat-restore-'));
 let child=await boot(port,dir);
 t.after(async()=>{await stop(child);rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 async function req(method,url,data,cookie){
  const res=await fetch(base+url,{method,headers:{
   ...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})
  },body:data?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const alice=await req('POST','/api/register',{name:'Alice',password:'AlicePassword123'});
 const bob=await req('POST','/api/register',{name:'Bob',password:'BobPassword123'});
 assert.equal(alice.status,201);assert.equal(bob.status,201);
 const add=await req('POST','/api/contacts/add',{publicId:bob.data.user.publicId},alice.cookie);
 assert.equal(add.status,201);
 const accept=await req('POST','/api/contacts/requests/'+add.data.request.id+'/accept',{},bob.cookie);
 assert.equal(accept.status,200);
 const id=accept.data.room.id;
 for(let i=0;i<7;i++){
  const msg=await req('POST','/api/rooms/'+id+'/messages',{text:'Mensagem importante #'+i},i%2?alice.cookie:bob.cookie);
  assert.equal(msg.status,201);
 }
 let bootstrap=await req('GET','/api/bootstrap',null,alice.cookie);
 assert.ok(bootstrap.data.rooms.some(r=>r.id===id));
 assert.equal(bootstrap.data.rooms.find(r=>r.id===id).last.text,'Mensagem importante #6');
 let page=await req('GET','/api/rooms/'+id+'/messages?limit=2',null,alice.cookie);
 assert.equal(page.status,200);assert.equal(page.data.messages.length,2);assert.equal(page.data.hasMore,true);
 assert.equal(page.data.messages[0].text,'Mensagem importante #5');
 let before=await req('GET','/api/rooms/'+id+'/messages?limit=2&before='+page.data.messages[0].id,null,alice.cookie);
 assert.deepEqual(before.data.messages.map(m=>m.text),['Mensagem importante #3','Mensagem importante #4']);
 assert.equal(before.data.hasMore,true);
 const invalid=await req('GET','/api/rooms/'+id+'/messages?before=nao-existe',null,alice.cookie);
 assert.equal(invalid.status,400);
 await stop(child);child=await boot(port,dir);
 const login=await req('POST','/api/login',{username:alice.data.user.publicId,password:'AlicePassword123'});
 assert.equal(login.status,200);
 bootstrap=await req('GET','/api/bootstrap',null,login.cookie);
 assert.ok(bootstrap.data.rooms.some(r=>r.id===id),'Conversa deve reaparecer ao entrar de novo');
 const all=await req('GET','/api/rooms/'+id+'/messages',null,login.cookie);
 assert.equal(all.status,200);
 assert.deepEqual(all.data.messages.map(m=>m.text),Array.from({length:7},(_,i)=>'Mensagem importante #'+i));
 assert.equal(all.data.hasMore,false);
 assert.equal((await req('GET','/api/bootstrap',null,bob.cookie)).status,200);
});

test('UI restaura rooms antes de ordenação, protege fechamento e carrega histórico completo',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/premium.css',import.meta.url),'utf8');
 const init=js.slice(js.indexOf('async function start()'),js.indexOf('function paintAvatar('));
 assert.match(init,/rooms=Array\.isArray\(data\.rooms\)\?data\.rooms:\[\]/);
 assert.ok(init.indexOf('rooms=Array.isArray(data.rooms)')<init.indexOf('sortRooms()'));
 assert.match(js,/hasEarlierMessages=!!data\.hasMore/);
 assert.match(js,/async function loadEarlierMessages\(/);
 assert.match(js,/function renderMessages\(keepScroll=false\)/);
 assert.match(js,/Carregar mensagens anteriores/);
 assert.match(server,/hasMore:start>0/);
 assert.match(html,/id="contactOptionsButton"/);
 assert.match(html,/id="contactOptionsDialog"/);
 assert.match(html,/id="closeChatMenuButton"/);
 assert.match(html,/id="removeContactButton"/);
 assert.match(js,/\$\('#closeChatMenuButton'\)\.addEventListener/);
 assert.match(js,/\$\('#contactOptionsButton'\)\.addEventListener/);
 assert.doesNotMatch(html,/id="removeContactButton"[^>]*>\s*<span[^>]*>×/);
 assert.match(css,/\.load-earlier-messages/);
 assert.doesNotThrow(()=>new Function(js));
});
