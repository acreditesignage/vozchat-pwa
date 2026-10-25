import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';

const unused=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
test('transferência fracionada >25MB: progresso, permissão, intervalo e cancelamento',async t=>{
  const PORT=await unused(),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-large-'));
  const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir,DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test'},
    stdio:'pipe'});
  t.after(()=>{server.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+PORT;
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(ready);
  async function req(method,url,body,cookie,headers={}){
    const isRaw=body instanceof Uint8Array;
    const response=await fetch(base+url,{method,headers:{
      ...(!isRaw&&body?{'Content-Type':'application/json'}:{}),
      ...(cookie?{cookie}:{}),...headers
    },body:!body?undefined:isRaw?body:JSON.stringify(body)});
    let payload;
    if((response.headers.get('content-type')||'').includes('application/json'))payload=await response.json();
    else payload=new Uint8Array(await response.arrayBuffer());
    return {status:response.status,data:payload,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  const a=await req('POST','/api/register',{name:'Lia',password:'abcdefgh123'});
  const b=await req('POST','/api/register',{name:'Tom',password:'abcdefgh124'});
  const stranger=await req('POST','/api/register',{name:'Ivo',password:'abcdefgh125'});
  assert.equal(a.status,201);assert.equal(b.status,201);
  const added=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},a.cookie);
  assert.equal(added.status,201);
  const roomId=added.data.room.id;
  const config=await req('GET','/api/transfers/config',undefined,a.cookie);
  assert.equal(config.status,200);
  assert.equal(config.data.maxBytes,100*1024*1024);
  assert.equal(config.data.chunkBytes,1024*1024);
  const size=25*1024*1024+37;
  assert.equal((await req('POST','/api/transfers/start',{roomId,name:'large.zip',mime:'application/zip',size:101*1024*1024},a.cookie)).status,413);
  assert.equal((await req('POST','/api/transfers/start',{roomId,name:'malware.exe',mime:'application/octet-stream',size},a.cookie)).status,415);
  assert.equal((await req('POST','/api/transfers/start',{roomId,name:'large.zip',mime:'application/zip',size},stranger.cookie)).status,403);
  const start=await req('POST','/api/transfers/start',{roomId,name:'large.zip',mime:'application/zip',size},a.cookie);
  assert.equal(start.status,201);
  const uri='/api/transfers/'+start.data.uploadId;
  assert.equal((await req('POST',uri+'/finish',{},a.cookie)).status,409);
  assert.equal((await req('POST',uri+'/chunk',new Uint8Array(1024),stranger.cookie,{'X-Part-Index':'0'})).status,404);
  const chunkSize=config.data.chunkBytes;
  for(let i=0;i<start.data.chunks;i++){
    const length=Math.min(chunkSize,size-i*chunkSize);
    const buffer=new Uint8Array(length).fill(i%255);
    const uploaded=await req('POST',uri+'/chunk',buffer,a.cookie,{'X-Part-Index':String(i)});
    assert.equal(uploaded.status,200,'parte '+i+' '+JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.received,i+1);
  }
  const complete=await req('POST',uri+'/finish',{},a.cookie);
  assert.equal(complete.status,201);
  assert.equal(complete.data.message.fileSize,size);
  const file='/api/files/'+complete.data.message.fileId;
  const range=await req('GET',file,undefined,b.cookie,{Range:'bytes=1048569-1048580'});
  assert.equal(range.status,206);
  assert.equal(range.data.length,12);
  assert.deepEqual([...range.data],[0,0,0,0,0,0,0,1,1,1,1,1]);
  assert.equal((await req('GET',file,undefined,stranger.cookie,{Range:'bytes=0-9'})).status,404);
  const last=await req('GET',file,undefined,b.cookie,{Range:'bytes=-37'});
  assert.equal(last.status,206);
  assert.equal(last.data.length,37);
  assert.ok([...last.data].every(v=>v===25));
  assert.match(complete.data.message.fileName,/large.zip/);
  const started2=await req('POST','/api/transfers/start',{roomId,name:'other.zip',mime:'application/zip',size},a.cookie);
  assert.equal(started2.status,201);
  const uri2='/api/transfers/'+started2.data.uploadId;
  assert.equal((await req('POST',uri2+'/cancel',{},a.cookie)).status,200);
  assert.equal((await req('POST',uri2+'/chunk',new Uint8Array(chunkSize),a.cookie,{'X-Part-Index':'0'})).status,404);
});
test('configurações e progresso têm controles reais',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  for(const id of ['settingsButton','settingsDialog','settingsNotifications','settingsCompact','settingsCopyId',
    'settingsStorageStatus','transferProgress','transferBar','transferText','cancelUpload']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(app,/sendLargeFile\(file,roomId,progress\)/);
  assert.match(app,/transferUpdate\(/);
  assert.match(app,/uploadController\?\.abort\(\)/);
  assert.match(app,/settingsButton'\)\.addEventListener\('click'/);
  assert.match(app,/settingsCompact'\)\.addEventListener\('change'/);
  assert.doesNotThrow(()=>new Function(app));
});
