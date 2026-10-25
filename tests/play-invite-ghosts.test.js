import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {newNeonGame,beginNeonGame,neonTick,neonMove} from '../public/neon-maze-engine.js';

const port=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>resolve(n));});});

test('Drones se movimentam sem mexer nos personagens e respeitam regras do labirinto',()=>{
 const game=newNeonGame('g','r',['a','b'],'a',447);
 beginNeonGame(game);
 const initial=game.players.map(p=>({x:p.x,y:p.y}));
 const drones=game.ghosts.map(p=>({x:p.x,y:p.y}));
 const tick=neonTick(game);
 assert.equal(tick.changed,true);
 assert.equal(game.moves,1);
 assert.deepEqual(game.players.map(p=>({x:p.x,y:p.y})),initial);
 assert.ok(game.ghosts.some((ghost,index)=>ghost.x!==drones[index].x||ghost.y!==drones[index].y));
 assert.equal(neonMove(game,'a','nope').code,400);
 const stopped={...game,status:'canceled'};
 assert.equal(neonTick(stopped).changed,false);
});

test('Convites para jogar chegam apenas ao contato convidado e os drones seguem com o jogador parado',async t=>{
 const PORT=await port(),DATA_DIR=mkdtempSync(path.join(tmpdir(),'vozchat-call-to-play-'));
 const server=spawn(process.execPath,['server.js'],{
  cwd:path.resolve(import.meta.dirname,'..'),
  env:{...process.env,PORT:String(PORT),DATA_DIR,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
    VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test'},stdio:'pipe'
 });
 t.after(()=>{server.kill('SIGTERM');rmSync(DATA_DIR,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+PORT;
 for(let i=0;i<130;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(done=>setTimeout(done,35));}
 async function req(method,url,data,cookie){
  const res=await fetch(base+url,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const a=await req('POST','/api/register',{name:'Alice',password:'strong-pass-alice'});
 const b=await req('POST','/api/register',{name:'Bob',password:'strong-pass-bobby'});
 const c=await req('POST','/api/register',{name:'Outro',password:'strong-pass-other'});
 assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(c.status,201);
 const ca=a.cookie,cb=b.cookie,cc=c.cookie;
 const contact=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},ca);
 const approved=await req('POST','/api/contacts/requests/'+contact.data.request.id+'/accept',{},cb);
 assert.equal(approved.status,200);
 const rid=approved.data.room.id;
 const invalid=await req('GET','/api/play/invites',null,cc);
 assert.deepEqual(invalid.data.invitations,[]);
 const game=await req('POST','/api/play/neon/invite',{roomId:rid},ca);
 assert.equal(game.status,201);
 assert.equal((await req('GET','/api/play/invites',null,ca)).data.invitations.length,0);
 const list=await req('GET','/api/play/invites',null,cb);
 assert.equal(list.status,200);
 assert.equal(list.data.invitations.length,1);
 assert.equal(list.data.invitations[0].kind,'neon');
 assert.equal(list.data.invitations[0].roomId,rid);
 assert.equal(list.data.invitations[0].inviterName,'Alice');
 assert.equal((await req('GET','/api/play/invites',null,cc)).data.invitations.length,0);
 const ready=await req('POST','/api/play/neon/'+game.data.game.id+'/accept',{},cb);
 assert.equal(ready.status,200);
 assert.deepEqual((await req('GET','/api/play/invites',null,cb)).data.invitations,[]);
 const sse=new AbortController();
 const live=await fetch(base+'/api/events',{headers:{cookie:ca},signal:sse.signal});
 assert.equal(live.status,200);
 const before=(await req('GET','/api/play/neon/room/'+rid,null,ca)).data.game;
 await new Promise(resolve=>setTimeout(resolve,1250));
 const after=(await req('GET','/api/play/neon/room/'+rid,null,cb)).data.game;
 assert.ok(after.moves>before.moves,'Drones devem receber ticks do servidor sem jogadas');
 assert.deepEqual(after.players.map(p=>p.position),before.players.map(p=>p.position),'Jogadores não andam sem comandos');
 sse.abort();
 await live.body.cancel().catch(()=>{});
 const old=(await req('POST','/api/play/neon/'+game.data.game.id+'/quit',{},cb));
 assert.equal(old.status,200);
 const again=await req('POST','/api/play/invite',{roomId:rid},ca);
 assert.equal(again.status,201);
 const tic=(await req('GET','/api/play/invites',null,cb)).data.invitations;
 assert.equal(tic.length,1);assert.equal(tic[0].kind,'tic');
 const declined=await req('POST','/api/play/'+again.data.game.id+'/decline',{},cb);
 assert.equal(declined.status,200);
 assert.deepEqual((await req('GET','/api/play/invites',null,cb)).data.invitations,[]);
});

test('Botão de controle no campo de mensagem, convite simples e notificação especial no PWA',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/premium.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const solo=readFileSync(new URL('../public/play-solo.js',import.meta.url),'utf8');
 for(const id of ['composerPlayButton','composerPlayMenu','composerInviteNeon','composerInviteTic',
  'incomingPlayDialog','incomingPlayAccept','incomingPlayDecline','incomingPlayLater'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(app,/function sendQuickPlayInvite\(/);
 assert.match(app,/function showIncomingPlayInvite\(/);
 assert.match(app,/addEventListener\('play-invite'/);
 assert.match(app,/\/api\/play\/invites/);
 assert.match(server,/function expireNeon/);
 assert.match(server,/neonTick\(game\)/);
 assert.match(server,/kind:\['game','maze'\].includes\(msg.type\)\?'game-invite'/);
 assert.match(sw,/payload.kind==='game-invite'/);
 assert.match(sw,/requireInteraction:isTalk\|\|isCall\|\|isContactRequest\|\|isGameInvite/);
 assert.match(sw,/vozchat-shell-v32/);
 assert.match(css,/\.composer-play-button/);
 assert.match(solo,/function startDrones\(/);
 assert.doesNotThrow(()=>new Function(app));
 assert.doesNotThrow(()=>new Function(sw));
});
