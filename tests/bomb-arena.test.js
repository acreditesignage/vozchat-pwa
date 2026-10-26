import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createArena,createBombGame,startBombGame,placeBomb,moveBombGame,tickBombGame,bombView,BW,BH} from '../public/bomb-arena-engine.js';

const freePort=()=>new Promise(resolve=>{const sock=net.createServer();sock.listen(0,'127.0.0.1',()=>{const port=sock.address().port;sock.close(()=>resolve(port));});});

test('Arena Bomba: mapa original, spawns livres, bomba, tempo, destruição e vitória',()=>{
 const board=createArena(2026);
 assert.equal(board.length,BW*BH);
 assert.equal(board[1*BW+1],' ');
 assert.equal(board[(BH-2)*BW+BW-2],' ');
 assert.ok(board.includes('#')&&board.includes('+'));
 const game=createBombGame('id','room',['alice','bob'],'alice',2026,1000);
 assert.equal(game.status,'pending');
 assert.equal(startBombGame(game,1000),true);
 assert.equal(placeBomb(game,'intruder',1100).code,403);
 assert.equal(moveBombGame(game,'alice','diagonal',1100).code,400);
 assert.equal(moveBombGame(game,'alice','left',1100).changed,false);
 assert.equal(placeBomb(game,'alice',1100).changed,true);
 assert.equal(placeBomb(game,'alice',1110).code,409,'Uma bomba simultânea por jogador');
 assert.equal(game.bombs.length,1);
 assert.equal(game.status,'active');
 assert.equal(moveBombGame(game,'alice','right',1300).changed,true);
 assert.equal(tickBombGame(game,3300),false,'Não detonar antes do tempo');
 assert.equal(tickBombGame(game,3400),true);
 assert.equal(game.bombs.length,0);
 assert.ok(game.flames.length>=2);
 assert.equal(game.status,'won');
 assert.equal(game.winner,'bob');
 const view=bombView(game,()=>({name:'Jogador'}));
 assert.equal(view.fighters.length,2);
 assert.equal(view.fighters[0].alive,false);
 assert.ok(!('lastMoveAt' in view)===false||view.fighters[0].lastMoveAt>=0);
 assert.equal(moveBombGame(game,'bob','left',3600).code,409);
});

test('Arena Bomba: convite é privado, jogador controla movimento e bomba e histórico continua',async t=>{
 const PORT=await freePort(),DATA_DIR=mkdtempSync(path.join(os.tmpdir(),'vozchat-bomb-'));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),
  env:{...process.env,PORT:String(PORT),DATA_DIR,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
    LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',NODE_ENV:'test'},stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');rmSync(DATA_DIR,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+PORT;
 for(let i=0;i<140;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,35));}
 async function req(method,p,data,cookie){
  const res=await fetch(base+p,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const a=await req('POST','/api/register',{name:'Ana',password:'senha-1234567'});
 const b=await req('POST','/api/register',{name:'Bia',password:'senha-1234568'});
 const outsider=await req('POST','/api/register',{name:'Carol',password:'senha-1234569'});
 assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(outsider.status,201);
 const ca=a.cookie,cb=b.cookie,cc=outsider.cookie;
 const add=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},ca);
 const accept=await req('POST','/api/contacts/requests/'+add.data.request.id+'/accept',{},cb);
 assert.equal(accept.status,200);
 const roomId=accept.data.room.id;
 assert.equal((await req('GET','/api/play/bomb/room/'+roomId,null,cc)).status,403);
 assert.equal((await req('POST','/api/play/bomb/invite',{roomId},cc)).status,403);
 const invited=await req('POST','/api/play/bomb/invite',{roomId},ca);
 assert.equal(invited.status,201);
 const id=invited.data.game.id;
 assert.equal((await req('POST','/api/play/bomb/invite',{roomId},ca)).status,409);
 const inbox=(await req('GET','/api/play/invites',null,cb)).data.invitations;
 assert.equal(inbox.length,1);assert.equal(inbox[0].kind,'bomb');assert.equal(inbox[0].id,id);
 assert.deepEqual((await req('GET','/api/play/invites',null,cc)).data.invitations,[]);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/accept',{},ca)).status,403);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/move',{direction:'right'},ca)).status,409);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/accept',{},cb)).status,200);
 const before=(await req('GET','/api/play/bomb/room/'+roomId,null,ca)).data.game;
 assert.equal(before.fighters[0].x,1);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/move',{direction:'wrong'},ca)).status,400);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/move',{direction:'right'},cc)).status,403);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/place',{},ca)).status,200);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/place',{},ca)).status,409);
 assert.equal((await req('POST','/api/play/bomb/'+id+'/move',{direction:'right'},ca)).status,200);
 const current=(await req('GET','/api/play/bomb/room/'+roomId,null,cb)).data.game;
 assert.ok(current.bombs.length>=1);
 assert.equal(current.fighters[0].x,2);
 assert.equal(current.fighters[1].x,BW-2);
 const messages=await req('GET','/api/rooms/'+roomId+'/messages',null,cb);
 assert.ok(messages.data.messages.some(m=>m.type==='bomb'&&m.bombId===id));
 const history=(await req('GET','/api/play/history',null,ca)).data.games;
 assert.ok(history.some(g=>g.kind==='bomb'&&g.name==='Arena Bomba'));
 const prof=await req('POST','/api/identities',{label:'Profissional',name:'Ana Trabalho'},ca);
 assert.equal(prof.status,201);
 assert.equal((await req('POST','/api/identities/'+prof.data.profile.id+'/activate',{},ca)).status,200);
 assert.equal((await req('GET','/api/play/bomb/room/'+roomId,null,ca)).status,403);
 assert.deepEqual((await req('GET','/api/play/history',null,ca)).data.games,[]);
});

test('Arena Bomba no menu, no chat, push, D-pad em cruz e novos personagens',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/bomb-arena-ui.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/premium.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
 const art=readFileSync(new URL('../public/arcade-art.js',import.meta.url),'utf8');
 const neon=readFileSync(new URL('../public/neon-maze-ui.js',import.meta.url),'utf8');
 for(const id of ['bombPanel','bombCanvas','bombDpad','bombPlace','composerInviteBomb','playHubDuoBomb','chooseBombArena'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/src="\/bomb-arena-ui\.js"/);
 assert.match(app,/createBombArena/);assert.match(app,/addEventListener\('bomb-update'/);
 assert.match(app,/sendQuickPlayInvite\('bomb'\)/);
 assert.match(css,/\.bomb-dpad/);assert.match(css,/\.bomb-drop/);
 assert.match(ui,/setPointerCapture/);assert.match(ui,/data-bomb-dir/);
 assert.match(art,/drawArcadeHero/);
 assert.match(neon,/VozChatArcadeArt\?\.drawHero/);
 assert.match(sw,/vozchat-shell-v37/);
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(art));
 assert.doesNotThrow(()=>new Function(app));
});
