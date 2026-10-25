import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Port is captured BEFORE closing socket to remain portable.
async function freePort(){return await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
test('perfis Pessoal Profissional Família isolam IDs contatos grupos e acesso',async t=>{
  const PORT=await freePort(),dir=mkdtempSync(path.join(tmpdir(),'vozchat-profiles-'));
  const server=spawn(process.execPath,['server.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(PORT),DATA_DIR:dir,NODE_ENV:'test',
      DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
      LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:''},stdio:'pipe'
  });
  t.after(()=>{server.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+PORT;
  for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/health');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
  async function request(method,p,data,cookie){
    const res=await fetch(base+p,{
      method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:data?JSON.stringify(data):undefined
    });
    const json=await res.json();
    return {status:res.status,data:json,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const alice=await request('POST','/api/register',{name:'Alice',password:'AlicePassword234'});
  const bob=await request('POST','/api/register',{name:'Bob',password:'BobPassword234'});
  assert.equal(alice.status,201);assert.equal(bob.status,201);
  const ca=alice.cookie,cb=bob.cookie;
  let state=await request('GET','/api/bootstrap',null,ca);
  assert.equal(state.data.identities.length,1);
  assert.equal(state.data.identities[0].label,'Pessoal');
  assert.equal(state.data.identities[0].publicId,'10');
  const createPro=await request('POST','/api/identities',{label:'Profissional',name:'Alice Trabalho'},ca);
  assert.equal(createPro.status,201);
  const pro=createPro.data.profile;assert.equal(pro.label,'Profissional');assert.match(pro.publicId,/^[1-9][0-9]{8}$/);
  assert.notEqual(pro.publicId,'12');
  assert.notEqual(pro.id,alice.data.user.id);
  const duplicate=await request('POST','/api/identities',{label:'Profissional',name:'Outra'},ca);
  assert.equal(duplicate.status,409);
  const createFam=await request('POST','/api/identities',{label:'Família',name:'Al Fam'},ca);
  assert.equal(createFam.status,201);
  const family=createFam.data.profile;assert.match(family.publicId,/^[1-9][0-9]{8}$/);
  assert.notEqual(pro.publicId,family.publicId);
  const invalid=await request('POST','/api/identities',{label:'Publico',name:'Outra'},ca);
  assert.equal(invalid.status,400);
  const foreignList=await request('GET','/api/identities',null,cb);
  assert.equal(foreignList.data.identities.length,1);
  assert.equal(foreignList.data.identities[0].id,bob.data.user.id);
  const foreignSwitch=await request('POST','/api/identities/'+pro.id+'/activate',{},cb);
  assert.equal(foreignSwitch.status,404);
  const foreignEdit=await request('PATCH','/api/identities/'+pro.id,{name:'Invadido'},cb);
  assert.equal(foreignEdit.status,404);
  const fakeLogin=await request('POST','/api/login',{username:pro.publicId,password:'AlicePassword234'});
  assert.equal(fakeLogin.status,401);
  const personalRoom=await request('POST','/api/rooms',{name:'Grupo Pessoal'},ca);
  assert.equal(personalRoom.status,201);
  const proActivation=await request('POST','/api/identities/'+pro.id+'/activate',{},ca);
  assert.equal(proActivation.status,200);
  state=await request('GET','/api/bootstrap',null,ca);
  assert.equal(state.data.user.publicId,pro.publicId);
  assert.equal(state.data.rooms.length,0);
  assert.equal(state.data.identities.length,3);
  assert.equal(state.data.identities.find(p=>p.active).label,'Profissional');
  const cannotOpenPersonal=await request('GET','/api/rooms/'+personalRoom.data.room.id+'/messages',null,ca);
  assert.notEqual(cannotOpenPersonal.status,200);
  const ownRequest=await request('POST','/api/contacts/add',{publicId:'10'},ca);
  assert.equal(ownRequest.status,400);
  const proToBob=await request('POST','/api/contacts/add',{publicId:'11'},ca);
  assert.equal(proToBob.status,201);
  const forBob=await request('GET','/api/contacts/requests',null,cb);
  assert.equal(forBob.data.requests[0].name,'Alice Trabalho');
  assert.equal(forBob.data.requests[0].publicId,pro.publicId);
  const approved=await request('POST','/api/contacts/requests/'+proToBob.data.request.id+'/accept',{},cb);
  assert.equal(approved.status,200);
  const proChatId=approved.data.room.id;
  const oldPersonalMessage=await request('GET','/api/rooms/'+proChatId+'/messages',null,ca);
  assert.equal(oldPersonalMessage.status,200);
  const back=await request('POST','/api/identities/'+alice.data.user.id+'/activate',{},ca);
  assert.equal(back.status,200);
  state=await request('GET','/api/bootstrap',null,ca);
  assert.equal(state.data.user.publicId,'10');
  assert.equal(state.data.rooms.length,1);
  assert.equal(state.data.rooms[0].id,personalRoom.data.room.id);
  const inaccessible=await request('GET','/api/rooms/'+proChatId+'/messages',null,ca);
  assert.notEqual(inaccessible.status,200);
  const badGroup=await request('POST','/api/rooms/'+personalRoom.data.room.id+'/members',{publicId:pro.publicId},ca);
  assert.equal(badGroup.status,409);
  const renamed=await request('PATCH','/api/identities/'+family.id,{name:'Minha Família'},ca);
  assert.equal(renamed.status,200);
  assert.equal(renamed.data.profile.name,'Minha Família');
  const nextRoot=await request('POST','/api/register',{name:'Carla',password:'CarlaPassword234'});
  assert.equal(nextRoot.status,201);
  assert.equal(nextRoot.data.user.publicId,'12','IDs alternativos não devem consumir ID simples');
  const loginRoot=await request('POST','/api/login',{username:'10',password:'AlicePassword234'});
  assert.equal(loginRoot.status,200);
  assert.equal(loginRoot.data.user.publicId,'10');
  const checkNoLeak=await request('GET','/api/identities',null,cb);
  assert.equal(JSON.stringify(checkNoLeak.data).includes('Minha Família'),false);
});
test('interface para trocar perfis sem exibir proprietário em links públicos',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  for(const id of ['identitiesDialog','identityMenuButton','identityCreateForm','identityName','identityType','settingsOpenIdentities','identityList'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/identityParam/);
  assert.match(app,/renderIdentities\(\)/);
  assert.match(app,/identity_changed/);
  assert.match(sw,/profileId/);
  assert.match(sw,/vozchat-shell-v31/);
  assert.doesNotThrow(()=>new Function(app));
});
