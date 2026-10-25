import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

async function freePort(){return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}

test('VozChat Play: convite, aceite, turnos, vitória, revanche e privacidade real',async t=>{
  const PORT=await freePort(),DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-play-'));
  const processServer=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,DATA_DIR,PORT:String(PORT),DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test'},
    stdio:'pipe'
  });
  t.after(()=>{processServer.kill('SIGTERM');fs.rmSync(DATA_DIR,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+PORT;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  async function req(method,uri,data,cookie){
    const response=await fetch(base+uri,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:data?JSON.stringify(data):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const a=await req('POST','/api/register',{name:'Pessoa A',password:'senha-comprida-A'});
  const b=await req('POST','/api/register',{name:'Pessoa B',password:'senha-comprida-B'});
  const outsider=await req('POST','/api/register',{name:'Outro usuário',password:'senha-comprida-C'});
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(outsider.status,201);
  const ca=a.cookie,cb=b.cookie,cc=outsider.cookie;
  const add=await req('POST','/api/contacts/add',{publicId:b.body.user.publicId},ca);
  assert.equal(add.status,201);
  const acc=await req('POST','/api/contacts/requests/'+add.body.request.id+'/accept',{},cb);
  assert.equal(acc.status,200);
  const rid=acc.body.room.id;
  assert.equal((await req('GET','/api/play/room/'+rid,null,ca)).body.game,null);
  assert.equal((await req('GET','/api/play/room/'+rid)).status,401);
  assert.equal((await req('GET','/api/play/room/'+rid,null,cc)).status,403);
  assert.equal((await req('POST','/api/play/invite',{roomId:rid},cc)).status,403);
  const invite=await req('POST','/api/play/invite',{roomId:rid},ca);
  assert.equal(invite.status,201);assert.equal(invite.body.game.status,'pending');
  assert.equal(invite.body.game.players[0].symbol,'X');
  const gameId=invite.body.game.id;
  assert.equal((await req('POST','/api/play/invite',{roomId:rid},ca)).status,409);
  assert.equal((await req('POST','/api/play/'+gameId+'/accept',{},ca)).status,403);
  assert.equal((await req('POST','/api/play/'+gameId+'/accept',{},cc)).status,403);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:0},ca)).status,409);
  assert.equal((await req('POST','/api/play/'+gameId+'/accept',{},cb)).status,200);
  assert.equal((await req('POST','/api/play/'+gameId+'/accept',{},cb)).status,409);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:0},cb)).status,409);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:9},ca)).status,400);
  const race=await Promise.all([
    req('POST','/api/play/'+gameId+'/move',{position:0},ca),
    req('POST','/api/play/'+gameId+'/move',{position:1},ca)
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:0},cb)).status,409);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:3},cb)).status,200);
  const firstX=race.findIndex(x=>x.status===200)===0?0:1;
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:firstX===0?1:0},ca)).status,200);
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:4},cb)).status,200);
  const finish=await req('POST','/api/play/'+gameId+'/move',{position:2},ca);
  if(firstX===0){
    assert.equal(finish.status,200);assert.equal(finish.body.game.status,'won');
    assert.equal(finish.body.game.winner,a.body.user.id);
  }else{
    assert.equal(finish.status,200);
    assert.equal(finish.body.game.status,'active');
    assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:5},cb)).status,200);
    const winning=await req('POST','/api/play/'+gameId+'/move',{position:2},ca);
    assert.equal(winning.body.game.status,'won');
  }
  assert.equal((await req('POST','/api/play/'+gameId+'/move',{position:8},cb)).status,409);
  const old=await req('GET','/api/play/room/'+rid,null,cb);
  assert.equal(old.body.game.status,'won');
  assert.equal(JSON.parse(fs.readFileSync(path.join(DATA_DIR,'database.json'),'utf8')).games[0].status,'won');
  const repeat=await req('POST','/api/play/invite',{roomId:rid},cb);
  assert.equal(repeat.status,201);
  assert.equal((await req('POST','/api/play/'+repeat.body.game.id+'/decline',{},ca)).status,200);
  assert.equal((await req('POST','/api/play/'+repeat.body.game.id+'/accept',{},ca)).status,409);
  const again=await req('POST','/api/play/invite',{roomId:rid},ca);
  assert.equal(again.status,201);
  assert.equal((await req('POST','/api/play/'+again.body.game.id+'/cancel',{},cb)).status,403);
  assert.equal((await req('POST','/api/play/'+again.body.game.id+'/cancel',{},ca)).status,200);

  const prof=await req('POST','/api/identities',{label:'Profissional',name:'Trabalho A'},ca);
  assert.equal(prof.status,201);
  assert.equal((await req('POST','/api/identities/'+prof.body.profile.id+'/activate',{},ca)).status,200);
  assert.equal((await req('GET','/api/play/room/'+rid,null,ca)).status,403);
  const professionalInvite=await req('POST','/api/contacts/add',{publicId:b.body.user.publicId},ca);
  assert.equal(professionalInvite.status,201);
  const professionalApproved=await req('POST','/api/contacts/requests/'+professionalInvite.body.request.id+'/accept',{},cb);
  assert.equal(professionalApproved.status,200);
  const proRid=professionalApproved.body.room.id;
  assert.equal((await req('POST','/api/play/invite',{roomId:proRid},cb)).status,403);
  assert.equal((await req('GET','/api/play/room/'+proRid,null,cb)).status,403);
});

test('VozChat Play integrado ao chat mantém identidade Pessoal/Família e eventos em tempo real',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  for(const id of ['playButton','playPanel','playBoard','playStatus','playActions','playPlayers','playClose'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/addEventListener\('play-update'/);
  assert.match(app,/function renderPlayPanel\(/);
  assert.match(app,/function performPlayAction\(/);
  assert.match(app,/game-invite-card/);
  assert.match(server,/function withPlayLock\(/);
  assert.match(server,/identityType!=='Profissional'/);
  assert.doesNotThrow(()=>new Function(app));
});
