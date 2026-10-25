import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

const reservePort=()=>new Promise(resolve=>{
 const server=net.createServer();
 server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
});

test('histórico de partidas sobrevive ao fechamento de chat, separa perfis e protege terceiros',async t=>{
 const PORT=await reservePort(),DATA_DIR=mkdtempSync(path.join(tmpdir(),'vozchat-history-'));
 const child=spawn(process.execPath,['server.js'],{
   cwd:path.resolve(import.meta.dirname,'..'),
   env:{...process.env,PORT:String(PORT),DATA_DIR,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
     LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',
     VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',NODE_ENV:'test'},
   stdio:'pipe'
 });
 t.after(()=>{child.kill('SIGTERM');rmSync(DATA_DIR,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+PORT;
 for(let i=0;i<110;i++){
   try{if((await fetch(base+'/api/health')).ok)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,40));
 }
 async function request(method,url,body,cookie){
   const res=await fetch(base+url,{
     method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
     body:body?JSON.stringify(body):undefined
   });
   return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const alice=await request('POST','/api/register',{name:'Ana Pessoal',password:'ana-strong-pass'});
 const bob=await request('POST','/api/register',{name:'Bruno',password:'bruno-strong-pass'});
 const third=await request('POST','/api/register',{name:'Pessoa externa',password:'third-strong-pass'});
 assert.equal(alice.status,201);assert.equal(bob.status,201);assert.equal(third.status,201);
 const ca=alice.cookie,cb=bob.cookie,cc=third.cookie;
 assert.equal((await request('GET','/api/play/history')).status,401);
 assert.deepEqual((await request('GET','/api/play/history',null,ca)).data.games,[]);
 assert.deepEqual((await request('GET','/api/play/history',null,cc)).data.games,[]);
 const added=await request('POST','/api/contacts/add',{publicId:bob.data.user.publicId},ca);
 const accepted=await request('POST','/api/contacts/requests/'+added.data.request.id+'/accept',{},cb);
 assert.equal(accepted.status,200);
 const roomId=accepted.data.room.id;
 const game=await request('POST','/api/play/invite',{roomId},ca);
 assert.equal(game.status,201);
 const acceptGame=await request('POST','/api/play/'+game.data.game.id+'/accept',{},cb);
 assert.equal(acceptGame.status,200);
 const abandoned=await request('POST','/api/play/'+game.data.game.id+'/resign',{},cb);
 assert.equal(abandoned.status,200);
 const maze=await request('POST','/api/play/neon/invite',{roomId},cb);
 assert.equal(maze.status,201);
 const started=await request('POST','/api/play/neon/'+maze.data.game.id+'/accept',{},ca);
 assert.equal(started.status,200);
 const ended=await request('POST','/api/play/neon/'+maze.data.game.id+'/quit',{},ca);
 assert.equal(ended.status,200);
 const initial=await request('GET','/api/play/history',null,ca);
 assert.equal(initial.status,200);
 assert.equal(initial.data.games.length,2);
 assert.deepEqual(initial.data.games.map(item=>item.kind).sort(),['neon-maze','tic-tac-toe']);
 assert.ok(initial.data.games.every(item=>item.roomId===roomId&&item.otherName==='Bruno'&&item.canReopen));
 assert.ok(initial.data.games.every(item=>!('board' in item)&&!('users' in item)));
 const other=await request('GET','/api/play/history',null,cb);
 assert.equal(other.data.games.length,2);
 assert.ok(other.data.games.every(item=>item.otherName==='Ana Pessoal'));
 assert.deepEqual((await request('GET','/api/play/history',null,cc)).data.games,[]);
 // Fechar o app não apaga a conversa: novo login e nova leitura de mensagens.
 const login=await request('POST','/api/login',{username:alice.data.user.publicId,password:'ana-strong-pass'});
 assert.equal(login.status,200);
 const reopened=await request('GET','/api/rooms/'+roomId+'/messages',null,login.cookie);
 assert.equal(reopened.status,200);
 assert.ok(reopened.data.messages.some(msg=>msg.type==='game'));
 assert.ok(reopened.data.messages.some(msg=>msg.type==='maze'));
 assert.equal((await request('GET','/api/play/history',null,login.cookie)).data.games.length,2);
 // Trocar de identidade não revela jogos do perfil Pessoal.
 const professional=await request('POST','/api/identities',{label:'Profissional',name:'Ana Empresa'},ca);
 assert.equal(professional.status,201);
 const switched=await request('POST','/api/identities/'+professional.data.profile.id+'/activate',{},ca);
 assert.equal(switched.status,200);
 assert.deepEqual((await request('GET','/api/play/history',null,ca)).data.games,[]);
 // Mesmo quando um contato é removido, o resumo do jogo permanece privado.
 const removed=await request('DELETE','/api/contacts/'+roomId,null,cb);
 assert.equal(removed.status,200);
 const archived=await request('GET','/api/play/history',null,login.cookie);
 assert.equal(archived.status,200);
 assert.equal(archived.data.games.length,2);
 assert.ok(archived.data.games.every(item=>item.canReopen===false));
 assert.equal((await request('GET','/api/rooms/'+roomId+'/messages',null,login.cookie)).status,403);
 assert.deepEqual((await request('GET','/api/play/history',null,cc)).data.games,[]);
 assert.ok(archived.data.games.every(item=>item.otherPublicId===bob.data.user.publicId));
 // O contato pode ser convidado novamente sem revelar outro perfil nem apagar as mensagens antigas.
 const reconnect=await request('POST','/api/contacts/add',{publicId:bob.data.user.publicId},login.cookie);
 assert.equal(reconnect.status,201);
 const acceptedAgain=await request('POST','/api/contacts/requests/'+reconnect.data.request.id+'/accept',{},cb);
 assert.equal(acceptedAgain.status,200);
 assert.equal(acceptedAgain.data.room.id,roomId);
 const recovered=await request('GET','/api/play/history',null,login.cookie);
 assert.ok(recovered.data.games.every(item=>item.canReopen));
 assert.equal((await request('GET','/api/rooms/'+roomId+'/messages',null,login.cookie)).status,200);
});

test('botão Jogar fixo no mobile, histórico privado e retomar conversa estão conectados',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/play-history.js',import.meta.url),'utf8');
 const styles=readFileSync(new URL('../public/premium.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
 const solo=readFileSync(new URL('../public/play-solo.js',import.meta.url),'utf8');
 for(const id of ['playHubButton','chatPlayBar','chatPlayStart','chatPlayHistory',
   'playHistoryDialog','playHistoryList','playHistoryContacts','resumeLastChat',
   'playHubSoloNeon','playHubSoloTic','playHubDuoNeon','playHubDuoTic',
   'playHubContactsSection','playSoloDialog','playSoloCanvas','playSoloTicBoard',
   'playSoloRestart','playSoloBack','playHistoryDetails','playHubAddContact'])
   assert.match(html,new RegExp('id="'+id+'"'),'falta elemento '+id);
 assert.match(html,/src="\/play-history\.js"/);
 assert.match(html,/src="\/play-solo\.js"/);
 assert.ok(html.indexOf('id="playHubSoloNeon"')<html.indexOf('id="playHistoryDetails"'));
 assert.ok(html.indexOf('src="/play-history.js"')<html.indexOf('src="/app.js"'));
 assert.match(js,/createPlayHistory/);
 assert.match(js,/playHistory\.syncChat\(r\)/);
 assert.match(js,/playHistory\.roomOpened\(roomId\)/);
 assert.match(styles,/#playButton\{display:none!important\}/);
 assert.match(styles,/\.chat-play-bar/);
 assert.match(script,/\/api\/play\/history/);
 assert.match(script,/vozchat_last_room_/);
 assert.match(script,/createPlaySolo/);
 assert.match(script,/openContact\(entry\.otherPublicId\)/);
 assert.match(solo,/import\('\/neon-maze-engine\.js'\)/);
 assert.match(solo,/function findBotMove\(/);
 assert.match(solo,/localStorage\.setItem\(storageKey\(\)/);
 assert.match(sw,/vozchat-shell-v34/);
 assert.match(sw,/\/play-history\.js/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(script));
 assert.doesNotThrow(()=>new Function(solo));
});
