import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

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
  // FlowTalk AO VIVO: sem upload nem histórico. Canal WebSocket serve somente para sinalização WebRTC.
  const audioBytes=new Uint8Array(240).fill(45);
  const oldRadio=await req('POST',groupUrl+'/flowtalk',audioBytes,a.cookie,{'Content-Type':'audio/webm','X-Audio-Duration':'1'});
  assert.equal(oldRadio.status,410);
  const iceConfig=await req('GET','/api/talk/ice-config',undefined,a.cookie);
  assert.equal(iceConfig.status,200);
  assert.ok(iceConfig.data.iceServers.length>0);
  function openRadio(cookie){
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket('ws://127.0.0.1:'+port+'/api/talk/ws?room='+rid,{
        headers:{cookie,Origin:base}
      });
      const buffer=[],waiters=[],binaryBuffer=[],binaryWaiters=[];
      const conn={
        ws,buffer,binaryBuffer,
        wait(type){
          const index=buffer.findIndex(m=>m.type===type);
          if(index>=0)return Promise.resolve(buffer.splice(index,1)[0]);
          return new Promise((yes,no)=>{
            const timer=setTimeout(()=>{
              const at=waiters.findIndex(w=>w.resolve===deliver);
              if(at>=0)waiters.splice(at,1);
              no(new Error('WebSocket sem mensagem '+type));
            },2500);
            const deliver=msg=>{clearTimeout(timer);yes(msg);};
            waiters.push({type,resolve:deliver});
          });
        },
        waitAudio(){
          if(binaryBuffer.length)return Promise.resolve(binaryBuffer.shift());
          return new Promise((yes,no)=>{
            const timer=setTimeout(()=>no(new Error('WebSocket sem áudio PCM ao vivo')),2500);
            binaryWaiters.push(v=>{clearTimeout(timer);yes(v);});
          });
        },
        send(x){ws.send(JSON.stringify(x));}
      };
      ws.on('message',(v,isBinary)=>{
        if(isBinary){
          if(binaryWaiters.length)binaryWaiters.shift()(Buffer.from(v));
          else binaryBuffer.push(Buffer.from(v));
          return;
        }
        try{
          const msg=JSON.parse(String(v));
          const at=waiters.findIndex(w=>w.type===msg.type);
          if(at>=0)waiters.splice(at,1)[0].resolve(msg);
          else buffer.push(msg);
        }catch{}
      });
      ws.once('open',()=>resolve(conn));ws.once('error',reject);
    });
  }
  const radioA=await openRadio(a.cookie);
  const radioAReady=await radioA.wait('ready');
  const radioB=await openRadio(b.cookie);
  const radioBReady=await radioB.wait('ready');
  assert.equal(radioBReady.peers.length,1);
  assert.equal((await radioA.wait('peer-joined')).clientId,radioBReady.clientId);
  // Streaming apenas enquanto o locutor segura o botão e recebe autorização.
  const pcm=Buffer.alloc(640,42);
  radioA.ws.send(pcm);
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(radioB.buffer.length,0);

  radioA.send({type:'floor-request'});
  assert.equal((await radioA.wait('floor-granted')).type,'floor-granted');
  assert.equal((await radioB.wait('floor')).name,'Alice');
  radioA.ws.send(pcm);
  const delivered=await radioB.waitAudio();
  assert.equal(delivered.byteLength,640);
  assert.deepEqual(delivered,pcm);
  // Participante que não possui o canal não pode injetar voz.
  radioB.ws.send(Buffer.alloc(640,99));
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(radioA.binaryBuffer?.length||0,0);

  radioB.send({type:'floor-request'});
  assert.equal((await radioB.wait('floor-denied')).type,'floor-denied');
  radioA.send({type:'floor-release'});
  assert.equal((await radioB.wait('floor')).clientId,null);
  radioB.send({type:'floor-request'});
  assert.equal((await radioB.wait('floor-granted')).type,'floor-granted');
  radioB.send({type:'floor-release'});
  const cRadio=await openRadio(c.cookie);
  assert.equal((await cRadio.wait('ready')).peers.length,2);
  const noSaved=await req('GET',groupUrl+'/messages',undefined,b.cookie);
  assert.deepEqual(noSaved.data.messages,[]);
  const badRemove=await req('DELETE',groupUrl+'/members/'+a.data.user.publicId,undefined,b.cookie);
  assert.equal(badRemove.status,403);
  const ownerRemoveSelf=await req('DELETE',groupUrl+'/members/'+a.data.user.publicId,undefined,a.cookie);
  assert.equal(ownerRemoveSelf.status,400);
  const oldInvite=room.data.room.inviteUrl.split('join=')[1];
  const kicked=await req('DELETE',groupUrl+'/members/'+c.data.user.publicId,undefined,a.cookie);
  assert.equal(kicked.status,200);assert.equal(kicked.data.members.length,2);
  await new Promise((resolve,reject)=>{if(cRadio.ws.readyState===WebSocket.CLOSED)return resolve();cRadio.ws.once('close',resolve);setTimeout(()=>reject(new Error('Removido continua no rádio')),2500);});
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
  await new Promise((resolve,reject)=>{if(radioA.ws.readyState===WebSocket.CLOSED)return resolve();radioA.ws.once('close',resolve);setTimeout(()=>reject(new Error('Rádio continua conectado após excluir grupo')),2500);});
  try{radioB.ws.close();}catch{}
  const direct=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(direct.status,201);
  const deniedDirectGroup=await req('DELETE','/api/rooms/'+direct.data.room.id,undefined,a.cookie);
  assert.equal(deniedDirectGroup.status,404);
  const html=(await fetch(base+'/app')).status;assert.equal(html,200);
  const appJs=await (await fetch(base+'/app.js')).text();
  assert.match(appJs,/AudioWorkletNode|groupManageDialog/);
  assert.match(appJs,/async function acquireRadioMic/);
  assert.match(appJs,/talk-incoming/);
  assert.doesNotMatch(appJs,/talkButton.disabled=!session.ready\|\|count<1/);
  const workerSource=await (await fetch(base+'/sw.js')).text();
  assert.match(workerSource,/&talk=1/);

  assert.doesNotMatch(appJs,/radioPieces|new Blob\(radioPieces/);
  const worklet=await (await fetch(base+'/talk-worklet.js')).text();
  assert.match(worklet,/vozchat-mic-stream/);
  assert.match(worklet,/vozchat-speaker-stream/);

});