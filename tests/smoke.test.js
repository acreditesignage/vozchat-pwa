import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function unusedPort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
test('cadastro, chat, privacidade, convite, texto, áudio e PWA',async t=>{
  const PORT=await unusedPort(), dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-'));
  const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATA_DIR:dataDir,PORT:String(PORT)},stdio:'pipe'});
  t.after(()=>{server.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${PORT}`;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let c1='',c2='';
  async function req(method,url,body,cookie,headers={}){const res=await fetch(base+url,{method,headers:{...(body && !(body instanceof Uint8Array)?{'content-type':'application/json'}:{}),...headers,...(cookie?{cookie}:{})},body:body?(body instanceof Uint8Array?body:JSON.stringify(body)):undefined});const data=(res.headers.get('content-type')||'').startsWith('application/json')?await res.json():await res.arrayBuffer();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  const home=await req('GET','/app');assert.equal(home.status,200);
  const manifest=await req('GET','/manifest.webmanifest');assert.equal(manifest.status,200);
  const register1=await req('POST','/api/register',{name:'Ana',username:'ana',password:'senha-forte-123'});assert.equal(register1.status,201);c1=register1.cookie;
  const register2=await req('POST','/api/register',{name:'Bruno',username:'bruno',password:'senha-forte-456'});assert.equal(register2.status,201);c2=register2.cookie;
  const create=await req('POST','/api/rooms',{name:'Equipe Alfa'},c1);assert.equal(create.status,201);const room=create.data.room;
  const denied=await req('GET',`/api/rooms/${room.id}/messages`,undefined,c2);assert.equal(denied.status,403);
  const join=await req('POST','/api/rooms/join',{invite:room.inviteUrl.split('join=')[1]},c2);assert.equal(join.status,200);
  const streamAbort = new AbortController();
  const stream = await fetch(base+'/api/events',{headers:{cookie:c2},signal:streamAbort.signal});
  assert.equal(stream.status,200);
  assert.ok(stream.headers.get('content-type').includes('text/event-stream'));
  const reader=stream.body.getReader();
  const msg=await req('POST',`/api/rooms/${room.id}/messages`,{text:'Tudo bem?'},c1);assert.equal(msg.status,201);
  let streamText='';
  for(let i=0;i<5;i++){const read=await Promise.race([reader.read(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('SSE sem evento')),1500))]);streamText+=new TextDecoder().decode(read.value);if(streamText.includes('event: message'))break;}
  assert.match(streamText,/event: message/);
  assert.match(streamText,/Tudo bem\?/);
  streamAbort.abort();

  const msgs=await req('GET',`/api/rooms/${room.id}/messages`,undefined,c2);assert.equal(msgs.status,200);assert.equal(msgs.data.messages[0].text,'Tudo bem?');
  const audioBytes=new Uint8Array(240).fill(55);
  const audio=await req('POST',`/api/rooms/${room.id}/audio`,audioBytes,c2,{'Content-Type':'audio/webm','X-Audio-Duration':'4.2'});assert.equal(audio.status,201);
  const play=await req('GET',`/api/audio/${audio.data.message.audioId}`,undefined,c1);assert.equal(play.status,200);assert.equal(play.data.byteLength,240);
  const unauthorized=await req('GET',`/api/audio/${audio.data.message.audioId}`);assert.equal(unauthorized.status,401);
  const logout=await req('POST','/api/logout',undefined,c1);assert.equal(logout.status,200);
  const dead=await req('GET','/api/bootstrap',undefined,c1);assert.equal(dead.status,401);
  const login=await req('POST','/api/login',{username:'ana',password:'senha-forte-123'});assert.equal(login.status,200);
});
