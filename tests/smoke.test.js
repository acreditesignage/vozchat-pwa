import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function unusedPort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
test('cadastro, chat, privacidade, convite, texto, áudio, fotos, vídeos, arquivos e PWA',async t=>{
  const PORT=await unusedPort(), dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-'));
  const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test',DATA_DIR:dataDir,PORT:String(PORT)},stdio:'pipe'});
  t.after(()=>{server.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${PORT}`;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let c1='',c2='';
  async function req(method,url,body,cookie,headers={}){const res=await fetch(base+url,{method,headers:{...(body && !(body instanceof Uint8Array)?{'content-type':'application/json'}:{}),...headers,...(cookie?{cookie}:{})},body:body?(body instanceof Uint8Array?body:JSON.stringify(body)):undefined});const data=(res.headers.get('content-type')||'').startsWith('application/json')?await res.json():await res.arrayBuffer();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  const home=await req('GET','/app');assert.equal(home.status,200);
  const talk=await req('GET','/talk');assert.equal(talk.status,200);
  assert.match(new TextDecoder().decode(talk.data),/FlowTalk/);
  for(const resource of ['/talk.js','/talk.css','/talk.webmanifest']){
    const result=await req('GET',resource);assert.equal(result.status,200,resource);
  }
  const manifest=await req('GET','/manifest.webmanifest');assert.equal(manifest.status,200);
  const register1=await req('POST','/api/register',{name:'Ana',username:'ana',password:'senha-forte-123'});assert.equal(register1.status,201);c1=register1.cookie;
  const register2=await req('POST','/api/register',{name:'Bruno',username:'bruno',password:'senha-forte-456'});assert.equal(register2.status,201);c2=register2.cookie;

  // Novo onboarding: IDs numéricos sequenciais a partir de 10, com senha.
  assert.equal(register1.data.user.publicId,'10');
  assert.equal(register2.data.user.publicId,'11');
  // LiveKit só liga com credenciais, e tokens de voz exigem autenticação e grupo válido.
  const providerAnon=await req('GET','/api/talk/provider');
  assert.equal(providerAnon.status,401);
  const provider=await req('GET','/api/talk/provider',undefined,c1);
  assert.equal(provider.status,200);
  assert.equal(provider.data.provider,'legacy');
  const tokenUnconfigured=await req('POST','/api/talk/livekit-token',{roomId:'00000000-0000-4000-8000-000000000000'},c1);
  assert.equal(tokenUnconfigured.status,503);
  const addById=await req('POST','/api/contacts/add',{publicId:'11'},c1);
  assert.equal(addById.status,201);
  assert.equal(addById.data.room.isDirect,true);
  assert.equal(addById.data.room.peerId,'11');
  assert.equal(addById.data.room.name,'Bruno');
  const sameChat=await req('POST','/api/contacts/add',{publicId:'10'},c2);
  assert.equal(sameChat.status,200);
  assert.equal(sameChat.data.room.id,addById.data.room.id);
  assert.equal(sameChat.data.room.peerId,'10');
  const self=await req('POST','/api/contacts/add',{publicId:'10'},c1);
  assert.equal(self.status,400);
  const missingId=await req('POST','/api/contacts/add',{publicId:'99'},c1);
  assert.equal(missingId.status,404);
  const loginById=await req('POST','/api/login',{username:'10',password:'senha-forte-123'});
  assert.equal(loginById.status,200);
  assert.equal(loginById.data.user.publicId,'10');
  const unnamedAccount=await req('POST','/api/register',{name:'Clara',password:'senha-nova-789'});
  assert.equal(unnamedAccount.status,201);
  assert.equal(unnamedAccount.data.user.publicId,'12');
  const loginNew=await req('POST','/api/login',{username:'12',password:'senha-nova-789'});
  assert.equal(loginNew.status,200);
  assert.equal(loginNew.data.user.name,'Clara');
  // Notificações devem exigir sessão. Sem credenciais VAPID, ficam indisponíveis sem quebrar o chat.
  const anonymousConfig=await req('GET','/api/push/config');
  assert.equal(anonymousConfig.status,401);
  const config=await req('GET','/api/push/config',undefined,c1);
  assert.equal(config.status,200);
  assert.equal(typeof config.data.enabled,'boolean');
  const invalidSubscription=await req('POST','/api/push/subscribe',{subscription:{endpoint:'http://localhost/private',keys:{p256dh:'x',auth:'y'}}},c1);
  assert.ok([400,503].includes(invalidSubscription.status));
  const unsubscribe=await req('POST','/api/push/unsubscribe',{endpoint:'https://fcm.googleapis.com/nonexistent'},c1);
  assert.equal(unsubscribe.status,200);
  const workerSource=await (await fetch(base+'/sw.js')).text();
  assert.match(workerSource,/notificationclick/);
  assert.match(workerSource,/addEventListener\('push'/);
  const appHtml=await (await fetch(base+'/app')).text();
  assert.match(appHtml,/notificationsDialog|enableNotifications/);
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
  const photoBytes=new Uint8Array(1024).fill(32);
  const photo=await req('POST',`/api/rooms/${room.id}/files`,photoBytes,c1,{'Content-Type':'image/jpeg','X-File-Name':encodeURIComponent('foto da equipe.jpg')});
  assert.equal(photo.status,201);assert.equal(photo.data.message.type,'image');assert.equal(photo.data.message.fileName,'foto da equipe.jpg');
  const openPhoto=await req('GET',`/api/files/${photo.data.message.fileId}`,undefined,c2);assert.equal(openPhoto.status,200);assert.equal(openPhoto.data.byteLength,1024);
  const privatePhoto=await req('GET',`/api/files/${photo.data.message.fileId}`);assert.equal(privatePhoto.status,401);
  const clip=await req('POST',`/api/rooms/${room.id}/files`,new Uint8Array(1500).fill(3),c2,{'Content-Type':'video/mp4','X-File-Name':'clip.mp4'});
  assert.equal(clip.status,201);assert.equal(clip.data.message.type,'video');
  const document=await req('POST',`/api/rooms/${room.id}/files`,new Uint8Array(350).fill(4),c1,{'Content-Type':'application/pdf','X-File-Name':'documento.pdf'});
  assert.equal(document.status,201);assert.equal(document.data.message.type,'file');
  const download=await fetch(base+`/api/files/${document.data.message.fileId}`,{headers:{cookie:c2}});
  assert.match(download.headers.get('content-disposition'),/^attachment/);
  const partial=await fetch(base+`/api/files/${clip.data.message.fileId}`,{headers:{cookie:c1,range:'bytes=0-99'}});
  assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,100);
  const bad=await req('POST',`/api/rooms/${room.id}/files`,new Uint8Array(250).fill(6),c1,{'Content-Type':'text/html','X-File-Name':'script.html'});assert.equal(bad.status,415);
  const mimeMismatch=await req('POST',`/api/rooms/${room.id}/files`,new Uint8Array(250).fill(6),c1,{'Content-Type':'text/html','X-File-Name':'file.jpg'});assert.equal(mimeMismatch.status,415);
  const noLoginUpload=await req('POST',`/api/rooms/${room.id}/files`,photoBytes,undefined,{'Content-Type':'image/jpeg','X-File-Name':'photo.jpg'});assert.equal(noLoginUpload.status,401);
  const third=await req('POST','/api/register',{name:'Cleo',username:'cleo',password:'senha-forte-789'});assert.equal(third.status,201);
  const deniedPhoto=await req('GET',`/api/files/${photo.data.message.fileId}`,undefined,third.cookie);assert.equal(deniedPhoto.status,404);
  const deniedUpload=await req('POST',`/api/rooms/${room.id}/files`,photoBytes,third.cookie,{'Content-Type':'image/jpeg','X-File-Name':'photo.jpg'});assert.equal(deniedUpload.status,403);
  const roomMessages=await req('GET',`/api/rooms/${room.id}/messages`,undefined,c1);assert.equal(roomMessages.status,200);
  assert.deepEqual(roomMessages.data.messages.map(x=>x.type),['text','audio','image','video','file']);
  assert.match(await (await fetch(base+'/app.js')).text(),/emojiList|emojiPicker/);
  assert.match(await (await fetch(base+'/app')).text(),/cameraInput|fileInput/);
  const logout=await req('POST','/api/logout',undefined,c1);assert.equal(logout.status,200);
  const dead=await req('GET','/api/bootstrap',undefined,c1);assert.equal(dead.status,401);
  const login=await req('POST','/api/login',{username:'ana',password:'senha-forte-123'});assert.equal(login.status,200);
});