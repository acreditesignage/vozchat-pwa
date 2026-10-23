import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';

function getPort(){return new Promise(resolve=>{
  const server=net.createServer();server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;server.close(()=>resolve(port));
  });
});}
test('LiveKit: tokens assinados só para membros de cada grupo',async t=>{
  const port=await getPort();
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-livekit-'));
  const backend=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(port),DATA_DIR:dataDir,NODE_ENV:'test',
      DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
      LIVEKIT_URL:'wss://unit-test.livekit.cloud',LIVEKIT_API_KEY:'dev-test-abc',
      LIVEKIT_API_SECRET:'dev-test-this-key-must-never-be-used-in-production-12345'},
    stdio:'pipe'
  });
  let serverError='';
  backend.stderr.on('data',chunk=>{serverError+=String(chunk).slice(0,1000);});
  t.after(()=>{backend.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,40));}
  assert.ok(ready,'servidor iniciou');
  async function req(method,url,data,cookie){
    const res=await fetch(base+url,{
      method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:data?JSON.stringify(data):undefined
    });
    return{status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const unauth=await req('GET','/api/talk/provider');assert.equal(unauth.status,401);
  const alice=await req('POST','/api/register',{name:'Alice',password:'senha-forte-123'});
  const bob=await req('POST','/api/register',{name:'Bruno',password:'senha-forte-456'});
  assert.equal(alice.status,201);assert.equal(bob.status,201);
  const provider=await req('GET','/api/talk/provider',null,alice.cookie);
  assert.equal(provider.data.provider,'livekit');
  const group=await req('POST','/api/rooms',{name:'Equipe Alfa'},alice.cookie);
  assert.equal(group.status,201);
  const roomId=group.data.room.id;
  const denied=await req('POST','/api/talk/livekit-token',{roomId},bob.cookie);
  assert.equal(denied.status,403);
  const permitted=await req('POST','/api/talk/livekit-token',{roomId},alice.cookie);
  assert.equal(permitted.status,200,'Token endpoint error: '+JSON.stringify(permitted.data)+'; server: '+serverError.slice(-600));
  assert.equal(permitted.data.url,'wss://unit-test.livekit.cloud');
  const [,payload]=permitted.data.token.split('.');
  const jwt=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  assert.equal(jwt.video.room,'vozchat-'+roomId);
  assert.equal(jwt.video.roomJoin,true);
  assert.equal(jwt.video.canSubscribe,true);
  assert.equal(jwt.video.canPublish,true);
  assert.deepEqual(jwt.video.canPublishSources,['microphone']);
  assert.ok(jwt.exp-jwt.iat<=601,'TTL curto');
  const join=await req('POST','/api/rooms/join',{invite:group.data.room.inviteUrl.split('join=')[1]},bob.cookie);
  assert.equal(join.status,200);
  const permittedBob=await req('POST','/api/talk/livekit-token',{roomId},bob.cookie);
  assert.equal(permittedBob.status,200);
  const invalid=await req('POST','/api/talk/livekit-token',{roomId:'bad'},alice.cookie);
  assert.equal(invalid.status,403);
});
