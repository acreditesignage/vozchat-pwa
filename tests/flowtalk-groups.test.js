import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function availablePort(){
  const server=net.createServer();
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
    const port=server.address().port;server.close(()=>resolve(port));
  }));
}
test('FlowTalk e gestão de grupos: administrador, revogação, saída e exclusão',async t=>{
  const port=await availablePort();
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-flowtalk-'));
  const worker=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',NODE_ENV:'test',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',DATA_DIR:dataDir,PORT:String(port)},
    stdio:'pipe'
  });
  t.after(()=>{worker.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+port;
  let healthy=false;
  for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/health');if(r.ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,35));}
  assert.ok(healthy,'Servidor deve iniciar');
  async function req(method,url,body,cookie,headers={}){
    const binary=body instanceof Uint8Array;
    const res=await fetch(base+url,{
      method,headers:{...(body&&!binary?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},
      body:body?(binary?body:JSON.stringify(body)):undefined
    });
    const value=(res.headers.get('content-type')||'').includes('application/json')?await res.json():await res.arrayBuffer();
    return {status:res.status,data:value,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const a=await req('POST','/api/register',{name:'Alice',password:'senha-forte-123'});
  const b=await req('POST','/api/register',{name:'Bruno',password:'senha-forte-456'});
  const c=await req('POST','/api/register',{name:'Carla',password:'senha-forte-789'});
  const d=await req('POST','/api/register',{name:'Daniel',password:'senha-forte-000'});
  for(const r of [a,b,c,d])assert.equal(r.status,201);
  const room=await req('POST','/api/rooms',{name:'Plantão de atendimento'},a.cookie);
  assert.equal(room.status,201);
  const rid=room.data.room.id;
  const groupUrl='/api/rooms/'+rid;
  const unauthorized=await req('GET',groupUrl+'/members',undefined,b.cookie);
  assert.equal(unauthorized.status,404);
  const outsiderAdd=await req('POST',groupUrl+'/members',{publicId:c.data.user.publicId},b.cookie);
  assert.equal(outsiderAdd.status,404);
  const before=await req('GET',groupUrl+'/members',undefined,a.cookie);
  assert.equal(before.status,200);assert.equal(before.data.members.length,1);assert.equal(before.data.members[0].isOwner,true);
  const add=await req('POST',groupUrl+'/members',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(add.status,201);assert.equal(add.data.members.length,2);
  const addAgain=await req('POST',groupUrl+'/members',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(addAgain.status,409);
  const noPrivilege=await req('POST',groupUrl+'/members',{publicId:c.data.user.publicId},b.cookie);
  assert.equal(noPrivilege.status,403);
  const addC=await req('POST',groupUrl+'/members',{publicId:c.data.user.publicId},a.cookie);
  assert.equal(addC.status,201);assert.equal(addC.data.members.length,3);
  const audioBytes=new Uint8Array(240).fill(45);
  const radio=await req('POST',groupUrl+'/flowtalk',audioBytes,a.cookie,{'Content-Type':'audio/webm','X-Audio-Duration':'1'});
  assert.equal(radio.status,201);assert.equal(radio.data.message.type,'flowtalk');
  const radioRead=await req('GET','/api/audio/'+radio.data.message.audioId,undefined,b.cookie);
  assert.equal(radioRead.status,200);assert.equal(radioRead.data.byteLength,240);
  const radioDenied=await req('POST',groupUrl+'/flowtalk',audioBytes,d.cookie,{'Content-Type':'audio/webm'});
  assert.equal(radioDenied.status,403);
  const radioTooLong=await req('POST',groupUrl+'/flowtalk',audioBytes,a.cookie,{'Content-Type':'audio/webm','X-Audio-Duration':'50'});
  assert.equal(radioTooLong.status,413);
  const badRemove=await req('DELETE',groupUrl+'/members/'+a.data.user.publicId,undefined,b.cookie);
  assert.equal(badRemove.status,403);
  const ownerRemoveSelf=await req('DELETE',groupUrl+'/members/'+a.data.user.publicId,undefined,a.cookie);
  assert.equal(ownerRemoveSelf.status,400);
  const oldInvite=room.data.room.inviteUrl.split('join=')[1];
  const kicked=await req('DELETE',groupUrl+'/members/'+c.data.user.publicId,undefined,a.cookie);
  assert.equal(kicked.status,200);assert.equal(kicked.data.members.length,2);
  const removedRead=await req('GET',groupUrl+'/messages',undefined,c.cookie);
  assert.equal(removedRead.status,403);
  const staleInvite=await req('POST','/api/rooms/join',{invite:oldInvite},c.cookie);
  assert.equal(staleInvite.status,404);
  const leaveOwner=await req('POST',groupUrl+'/leave',{},a.cookie);
  assert.equal(leaveOwner.status,409);
  const ownerDeleteDenied=await req('DELETE',groupUrl,undefined,b.cookie);
  assert.equal(ownerDeleteDenied.status,403);
  const left=await req('POST',groupUrl+'/leave',{},b.cookie);
  assert.equal(left.status,200);
  const leftRead=await req('GET',groupUrl+'/members',undefined,b.cookie);
  assert.equal(leftRead.status,404);
  const deleted=await req('DELETE',groupUrl,undefined,a.cookie);
  assert.equal(deleted.status,200);
  const ownerGone=await req('GET',groupUrl+'/members',undefined,a.cookie);
  assert.equal(ownerGone.status,404);
  const goneAudio=await req('GET','/api/audio/'+radio.data.message.audioId,undefined,a.cookie);
  assert.equal(goneAudio.status,404);
  const direct=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(direct.status,201);
  const deniedDirectGroup=await req('DELETE','/api/rooms/'+direct.data.room.id,undefined,a.cookie);
  assert.equal(deniedDirectGroup.status,404);
  const html=(await fetch(base+'/app')).status;assert.equal(html,200);
  const appJs=await (await fetch(base+'/app.js')).text();
  assert.match(appJs,/flowtalkHold|groupManageDialog/);
});