import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const port=()=>new Promise(resolve=>{
  const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
test('foto de perfil privada, solicitação de contato, recusa e exclusão segura',async t=>{
  const PORT=await port(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-friends-'));
  const backend=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),stdio:'pipe',
    env:{...process.env,PORT:String(PORT),DATA_DIR:folder,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test'}
  });
  t.after(()=>{backend.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+PORT;
  let ready=false;
  for(let i=0;i<120;i++){
    try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,'Servidor iniciado');
  // iOS usa blob: para pré-visualizar fotos ao converter HEIC/JPEG para o avatar.
  const shell=await fetch(base+'/app');
  assert.equal(shell.status,200);
  assert.match(shell.headers.get('content-security-policy')||'',/img-src 'self' data: blob:/);
  assert.equal(shell.headers.get('cache-control'),'no-cache');
  const jsResponse=await fetch(base+'/app.js');
  assert.equal(jsResponse.status,200);
  assert.equal(jsResponse.headers.get('cache-control'),'no-cache');
  async function req(method,url,data,cookie,headers={}){
    const binary=data instanceof Uint8Array||Buffer.isBuffer(data);
    const res=await fetch(base+url,{method,
      headers:{...(data&&!binary?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},
      body:data===undefined?undefined:binary?data:JSON.stringify(data)});
    let payload;
    if((res.headers.get('content-type')||'').includes('application/json'))payload=await res.json();
    else payload=Buffer.from(await res.arrayBuffer());
    return {status:res.status,data:payload,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const alice=await req('POST','/api/register',{name:'Alice',password:'senha-segura-123'});
  const bob=await req('POST','/api/register',{name:'Bruno',password:'senha-segura-124'});
  const eve=await req('POST','/api/register',{name:'Carla',password:'senha-segura-125'});
  for(const result of [alice,bob,eve])assert.equal(result.status,201);
  const a=alice.cookie,b=bob.cookie,c=eve.cookie;
  const pushConfig=await req('GET','/api/push/config',undefined,b);
  assert.equal(pushConfig.status,200);
  assert.equal(pushConfig.data.enabled,false);
  assert.equal(pushConfig.data.registered,0);
  assert.equal((await req('POST','/api/push/test',{},b)).status,503);
  const health=(await req('GET','/api/health')).data;
  assert.equal(health.push,'not_configured');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9rZi4BUAAAAASUVORK5CYII=','base64');
  const avatar=await req('POST','/api/profile/avatar',png,a,{'Content-Type':'image/png'});
  assert.equal(avatar.status,200);
  assert.match(avatar.data.user.avatarUrl,/\/api\/avatars\//);
  assert.equal((await req('POST','/api/profile/avatar',Buffer.from('fake-png'),a,{'Content-Type':'image/png'})).status,415);
  assert.equal((await req('GET',avatar.data.user.avatarUrl,undefined,c)).status,403);
  const first=await req('POST','/api/contacts/add',{publicId:bob.data.user.publicId},a);
  assert.equal(first.status,201);
  assert.equal(first.data.status,'pending');
  assert.equal((await req('GET','/api/bootstrap',undefined,b)).data.rooms.length,0);
  assert.equal((await req('GET',avatar.data.user.avatarUrl,undefined,b)).status,200,'Destinatário pode ver foto de solicitante');
  const outgoing=await req('GET','/api/contacts/requests',undefined,a);
  const incoming=await req('GET','/api/contacts/requests',undefined,b);
  assert.equal(outgoing.data.requests[0].kind,'outgoing');
  assert.equal(incoming.data.requests[0].kind,'incoming');
  assert.equal((await req('POST','/api/contacts/requests/'+first.data.request.id+'/accept',{},a)).status,403);
  assert.equal((await req('POST','/api/contacts/add',{publicId:alice.data.user.publicId},b)).status,409);
  const declined=await req('POST','/api/contacts/requests/'+first.data.request.id+'/decline',{},b);
  assert.equal(declined.status,200);
  assert.equal((await req('GET','/api/contacts/requests',undefined,a)).data.requests.length,0);
  const second=await req('POST','/api/contacts/add',{publicId:bob.data.user.publicId},a);
  assert.equal(second.status,201);
  const accepted=await req('POST','/api/contacts/requests/'+second.data.request.id+'/accept',{},b);
  assert.equal(accepted.status,200);
  const roomId=accepted.data.room.id;
  assert.equal((await req('GET','/api/bootstrap',undefined,a)).data.rooms[0].id,roomId);
  assert.equal((await req('GET','/api/bootstrap',undefined,b)).data.rooms[0].avatarUrl,avatar.data.user.avatarUrl);
  assert.equal((await req('GET','/api/rooms/'+roomId+'/messages',undefined,c)).status,403);
  const msg=await req('POST','/api/rooms/'+roomId+'/messages',{text:'mensagem preservada'},a);
  assert.equal(msg.status,201);
  assert.equal((await req('DELETE','/api/contacts/'+roomId,undefined,c)).status,404);
  const removal=await req('DELETE','/api/contacts/'+roomId,undefined,a);
  assert.equal(removal.status,200);
  assert.equal((await req('GET','/api/bootstrap',undefined,a)).data.rooms.length,0);
  assert.equal((await req('GET','/api/bootstrap',undefined,b)).data.rooms.length,0);
  assert.equal((await req('GET','/api/rooms/'+roomId+'/messages',undefined,b)).status,403);
  assert.equal((await req('POST','/api/rooms/'+roomId+'/messages',{text:'não permitido'},b)).status,403);
  assert.equal((await req('GET',avatar.data.user.avatarUrl,undefined,b)).status,403);
  const reconnect=await req('POST','/api/contacts/add',{publicId:alice.data.user.publicId},b);
  assert.equal(reconnect.status,201);
  const restored=await req('POST','/api/contacts/requests/'+reconnect.data.request.id+'/accept',{},a);
  assert.equal(restored.status,200);
  assert.equal(restored.data.room.id,roomId,'Histórico preservado');
  const history=await req('GET','/api/rooms/'+roomId+'/messages',undefined,b);
  assert.equal(history.status,200);
  assert.match(JSON.stringify(history.data),/mensagem preservada/);
  const delphoto=await req('DELETE','/api/profile/avatar',undefined,a);
  assert.equal(delphoto.status,200);
  assert.equal(delphoto.data.user.avatarUrl,null);
  assert.equal((await req('GET',avatar.data.user.avatarUrl,undefined,b)).status,404);
});
test('interface: pendentes, perfil e exclusão de contato disponíveis',()=>{
  const read=file=>fs.readFileSync(path.resolve(import.meta.dirname,'..',file),'utf8');
  const html=read('public/index.html'),client=read('public/app.js'),server=read('server.js');
  for(const id of ['pendingContactsButton','pendingContactsCount','pendingContactsDialog',
    'incomingRequestsList','outgoingRequestsList','removeContactButton','profilePhotoDialog',
    'profilePhotoInput','profilePreview','settingsProfilePhoto']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(client,/contact-requests-changed/);
  assert.match(client,/knownIncomingRequestIds/);
  assert.match(client,/testPushNotification/);
  assert.match(client,/testCallRingtone/);
  assert.match(client,/requestsParam==='1'/);
  assert.match(server,/deliverPersonalPush\(target\.id/);
  assert.match(server,/kind:'contact-request'/);
  assert.match(server,/kind:'contact-accepted'/);
  assert.match(read('public/sw.js'),/isContactRequest\?'\/app\?requests=1'/);
  assert.match(html,/id="testPushNotification"/);
  assert.match(html,/id="testCallRingtone"/);
  assert.match(client,/\/api\/contacts\/requests/);
  assert.match(client,/canvas\.toBlob/);
  assert.match(client,/stopLiveRadio\(\);resetActiveChat\(\)/);
  assert.match(server,/r\.inactive/);
  assert.match(server,/photo JPEG|foto JPEG|foto JPEG|Envie uma foto JPEG/);
});

test('iPhone instalado: seletor nativo de fotos recebe toque direto e mostra erros',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
  const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  const input=html.match(/<input[^>]+id="profilePhotoInput"[^>]*>/)?.[0]||'';
  assert.ok(input,'seletor de fotos existe');
  assert.match(input,/type="file"/);
  assert.match(input,/accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif"/);
  assert.doesNotMatch(input,/\shidden(?:[ >])/);
  assert.match(html,/id="profilePhotoStatus"[^>]*role="status"/);
  assert.match(html,/class="profile-picker-control"/);
  assert.match(css,/#profilePhotoInput\s*\{[^}]*position:absolute;inset:0;z-index:2;[^}]*width:100%;height:100%;/);
  assert.match(css,/\.sidebar-foot \.profile-avatar-button\{[^}]*min-width:50px/);
  assert.doesNotMatch(app,/selectProfilePhoto'\)\.addEventListener\('click'/,'não depender de click indireto em input oculto');
  assert.match(app,/const input=event\.currentTarget;/);
  assert.match(app,/await createImageBitmap\(file\)/);
  assert.match(app,/picture\.onload=\(\)=>resolve\(picture\)/);
  assert.match(app,/canvas\.toBlob\(resolve,'image\/jpeg',0\.8\)/);
  assert.match(app,/status\.textContent='Salvando foto no seu perfil/);
  assert.match(app,/\?v='\+Date\.now\(\)/);
  assert.match(app,/input\.disabled=false/);
  assert.match(app,/await fetch\(me\.avatarUrl,\{method:'GET',credentials:'same-origin',cache:'no-store'\}\)/);
  assert.match(app,/if\(!readback\.ok\)throw new Error/);
  assert.match(app,/if\(!saved\.size\)throw new Error/);
  assert.match(app,/Foto salva e confirmada no servidor/);
  assert.match(app,/if\(!element\.firstChild\)element\.textContent=avatar\(name\)/);
  assert.doesNotThrow(()=>new Function(app));
});
