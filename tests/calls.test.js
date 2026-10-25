import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';

const port=()=>new Promise(resolve=>{
  const server=net.createServer();server.listen(0,'127.0.0.1',()=>{
    const p=server.address().port;server.close(()=>resolve(p));
  });
});
test('chamadas privadas: criar, atender, autenticar câmera/microfone, recusar e encerrar',async t=>{
  const PORT=await port(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-calls-'));
  const backend=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),stdio:'pipe',
    env:{...process.env,PORT:String(PORT),DATA_DIR:folder,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
      LIVEKIT_URL:'wss://test-env.livekit.cloud',LIVEKIT_API_KEY:'dev-scope-test',
      LIVEKIT_API_SECRET:'not-a-production-secret-long-enough-1234567890',NODE_ENV:'test'}
  });
  t.after(()=>{backend.kill('SIGTERM');fs.rmSync(folder,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+PORT;
  let ready=false;
  for(let i=0;i<100;i++){
    try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,'Backend disponível');
  async function req(method,url,data,cookie){
    const response=await fetch(base+url,{
      method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:data?JSON.stringify(data):undefined
    });
    let body;
    try{body=await response.json();}catch{body={};}
    return{status:response.status,data:body,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const a=await req('POST','/api/register',{name:'Ana',password:'senha-forte-123'});
  const b=await req('POST','/api/register',{name:'Bruna',password:'senha-forte-124'});
  const outsider=await req('POST','/api/register',{name:'Carlos',password:'senha-forte-125'});
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(outsider.status,201);
  const contact=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(contact.status,201);
  const acceptance=await req('POST','/api/contacts/requests/'+contact.data.request.id+'/accept',{},b.cookie);
  assert.equal(acceptance.status,200);
  const roomId=acceptance.data.room.id;
  const unauthorized=await req('POST','/api/calls/start',{roomId,kind:'video'},outsider.cookie);
  assert.equal(unauthorized.status,403);
  const invalid=await req('POST','/api/calls/start',{roomId,kind:'screen'},a.cookie);
  assert.equal(invalid.status,400);
  const unauth=await req('GET','/api/calls/pending');
  assert.equal(unauth.status,401);
  const started=await req('POST','/api/calls/start',{roomId,kind:'video'},a.cookie);
  assert.equal(started.status,201,JSON.stringify(started.data));
  const id=started.data.call.id;
  assert.equal(started.data.call.kind,'video');
  assert.equal(started.data.call.state,'ringing');
  const busy=await req('POST','/api/calls/start',{roomId,kind:'audio'},a.cookie);
  assert.equal(busy.status,409);
  const pendingB=await req('GET','/api/calls/pending',undefined,b.cookie);
  assert.equal(pendingB.data.calls.length,1);
  assert.equal(pendingB.data.calls[0].id,id);
  const otherPending=await req('GET','/api/calls/pending',undefined,outsider.cookie);
  assert.equal(otherPending.data.calls.length,0);
  const uri='/api/calls/'+id;
  const unauthToken=await req('POST',uri+'/token',{},outsider.cookie);
  assert.equal(unauthToken.status,404);
  const unacceptedToken=await req('POST',uri+'/token',{},b.cookie);
  assert.equal(unacceptedToken.status,403);
  const callerToken=await req('POST',uri+'/token',{},a.cookie);
  assert.equal(callerToken.status,200);
  const accepted=await req('POST',uri+'/accept',{},b.cookie);
  assert.equal(accepted.status,200);
  assert.equal(accepted.data.call.state,'active');
  const recipientToken=await req('POST',uri+'/token',{},b.cookie);
  assert.equal(recipientToken.status,200);
  const [,raw]=recipientToken.data.token.split('.');
  const jwt=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  assert.equal(jwt.video.room,'vozchat-call-'+id);
  assert.equal(jwt.video.roomJoin,true);
  assert.equal(jwt.video.canSubscribe,true);
  assert.equal(jwt.video.canPublish,true);
  assert.deepEqual(jwt.video.canPublishSources,['microphone','camera']);
  assert.ok(jwt.exp>jwt.nbf && jwt.exp-jwt.nbf<=601,'token temporário');
  const ended=await req('POST',uri+'/end',{},b.cookie);
  assert.equal(ended.status,200);
  const after=await req('GET','/api/calls/pending',undefined,a.cookie);
  assert.equal(after.data.calls.length,0);
  assert.equal((await req('POST',uri+'/token',{},a.cookie)).status,404);
  const firstHistory=await req('GET','/api/calls/history',undefined,a.cookie);
  assert.equal(firstHistory.status,200);
  assert.equal(firstHistory.data.calls.length,1);
  assert.equal(firstHistory.data.calls[0].status,'completed');
  assert.equal(firstHistory.data.calls[0].direction,'outgoing');
  assert.equal(firstHistory.data.calls[0].kind,'video');
  const recipientHistory=await req('GET','/api/calls/history',undefined,b.cookie);
  assert.equal(recipientHistory.data.calls[0].direction,'incoming');
  const unauthorizedHistory=await req('GET','/api/calls/history',undefined,outsider.cookie);
  assert.equal(unauthorizedHistory.data.calls.length,0);
  const audio=await req('POST','/api/calls/start',{roomId,kind:'audio'},a.cookie);
  assert.equal(audio.status,201);
  assert.equal(audio.data.call.kind,'audio');
  const rejected=await req('POST','/api/calls/'+audio.data.call.id+'/decline',{},b.cookie);
  assert.equal(rejected.status,200);
  assert.equal((await req('GET','/api/calls/pending',undefined,a.cookie)).data.calls.length,0);
  const history=await req('GET','/api/calls/history',undefined,a.cookie);
  assert.equal(history.data.calls.length,2);
  assert.equal(history.data.calls[0].status,'declined');
  assert.equal(history.data.calls[0].kind,'audio');
});

test('interface possui controles separados de áudio/vídeo, alerta e privacidade',()=>{
  const read=file=>fs.readFileSync(path.resolve(import.meta.dirname,'..',file),'utf8');
  const html=read('public/index.html'),app=read('public/app.js'),
        sw=read('public/sw.js'),css=read('public/styles.css'),server=read('server.js');
  for(const id of ['callAudioButton','callVideoButton','callOverlay','callAccept','callDecline',
    'callEnd','callMute','callCamera','callFlip','callSpeaker','callRemoteVideos','callLocalVideo'])
    assert.ok(html.includes('id="'+id+'"'),id+' presente');
  assert.match(app,/startCall\('audio'\)/);
  assert.match(app,/startCall\('video'\)/);
  assert.match(app,/call-incoming/);
  assert.match(app,/call-ended/);
  assert.match(app,/function renderCallHistory/);
  assert.ok(app.includes("'/api/calls/history'"));
  assert.match(html,/id="callHistoryList"/);
  assert.match(html,/data-call-filter="missed"/);
  assert.ok(server.includes("p==='/api/calls/history'"));
  assert.match(app,/VozChatRingtone\?\.start/);
  assert.match(app,/VozChatRingtone\?\.stop/);
  assert.match(html,/src="\/call-ringtone.js"/);
  assert.match(sw,/\/call-ringtone.js/);
  assert.match(sw,/const isCall=payload\.kind==='call'/);
  assert.match(sw,/\/app\?open=/);
  assert.match(sw,/&call=/);
  assert.match(sw,/vozchat-shell-v27/);
  assert.match(server,/camera=\(self\), microphone=\(self\)/);
  assert.match(css,/\.call-overlay/);
  assert.match(read('package.json'),/build:calls/);
  assert.doesNotThrow(()=>new Function(app));
});
