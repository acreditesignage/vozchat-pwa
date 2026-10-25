import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';
import { fileURLToPath } from 'node:url';
import {newNeonGame,beginNeonGame,neonMove,neonTick,viewNeonGame} from './public/neon-maze-engine.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const AUDIO = path.join(DATA, 'audio');
const FILES = path.join(DATA, 'files');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Arquivos maiores usam upload fracionado e acesso privado. Não ampliar o buffer legado.
// O PostgreSQL é provisório; armazenamento de objetos deve ser usado antes de escalar.
const TRANSFER_CHUNK_BYTES=1024*1024;
const MAX_LARGE_FILE_BYTES=1024*1024*1024;
const TRANSFER_QUOTA_BYTES=2*1024*1024*1024;
const TRANSFER_TTL_MS=24*60*60*1000;
const ALLOWED_FILES = {
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.gif': ['image/gif'],
  '.heic': ['image/heic', 'image/heif', 'application/octet-stream'], '.heif': ['image/heif', 'image/heic', 'application/octet-stream'],
  '.mp4': ['video/mp4'], '.mov': ['video/quicktime', 'video/mp4', 'application/octet-stream'], '.webm': ['video/webm'], '.m4v': ['video/x-m4v', 'video/mp4'], '.3gp': ['video/3gpp'],
  '.pdf': ['application/pdf'], '.txt': ['text/plain'], '.csv': ['text/csv','application/vnd.ms-excel','text/plain'],
  '.doc': ['application/msword','application/octet-stream'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'],
  '.xls': ['application/vnd.ms-excel','application/octet-stream'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],
  '.ppt': ['application/vnd.ms-powerpoint','application/octet-stream'], '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'],
  '.zip': ['application/zip','application/x-zip-compressed','application/octet-stream'],
  '.7z': ['application/x-7z-compressed','application/octet-stream'],
  '.rar': ['application/vnd.rar','application/x-rar-compressed','application/octet-stream'],
  '.odt': ['application/vnd.oasis.opendocument.text','application/octet-stream'],
  '.ods': ['application/vnd.oasis.opendocument.spreadsheet','application/octet-stream'],
  '.odp': ['application/vnd.oasis.opendocument.presentation','application/octet-stream'],
  '.dcm': ['application/dicom','application/octet-stream'],
  '.dwg': ['image/vnd.dwg','application/acad','application/octet-stream'],
  '.dxf': ['image/vnd.dxf','application/dxf','application/octet-stream'],
};

const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(AUDIO, { recursive: true });
fs.mkdirSync(FILES, { recursive: true });
const DATA_FILE = path.join(DATA, 'database.json');
const POSTGRES_URL = process.env.DATABASE_URL || process.env.VOZCHAT_DATABASE_URL;
function normalizeLivekitUrl(value){
  // LiveKit Cloud can present a host, HTTPS URL, or WSS URL. Canonicalise harmless variants.
  const raw=String(value||'').trim().replace(/^['"]|['"]$/g,'').trim();
  if(!raw)return '';
  let candidate=raw;
  if(!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate))candidate='wss://'+candidate;
  candidate=candidate.replace(/^https?:\/\//i,'wss://').replace(/^ws:\/\//i,'wss://');
  try{
    const uri=new URL(candidate);
    if(uri.protocol!=='wss:'||!uri.hostname||uri.username||uri.password||uri.search||uri.hash||uri.pathname!=='/')return '';
    if(!/^[a-z0-9.-]+$/i.test(uri.hostname))return '';
    // A dashboard link isn't the LiveKit media endpoint.
    if(uri.hostname==='cloud.livekit.io')return '';
    return 'wss://'+uri.host;
  }catch{return '';}
}
const LIVEKIT_URL = normalizeLivekitUrl(process.env.LIVEKIT_URL);
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const livekitConfigured = /^wss:\/\/[^\s/]+$/i.test(LIVEKIT_URL) && !!LIVEKIT_API_KEY && !!LIVEKIT_API_SECRET;
const livekitRoomService = livekitConfigured
  ? new RoomServiceClient(LIVEKIT_URL.replace(/^wss:/,'https:'),LIVEKIT_API_KEY,LIVEKIT_API_SECRET)
  : null;
async function revokeLivekitMember(roomId,userId){
  if(!livekitRoomService)return;
  try{
    const roomName='vozchat-'+roomId;
    const attendees=await livekitRoomService.listParticipants(roomName);
    await Promise.allSettled(attendees.filter(p=>p.identity.startsWith(userId+'-'))
      .map(p=>livekitRoomService.removeParticipant(roomName,p.identity)));
  }catch(e){console.warn('LiveKit: falha ao desconectar participante',e?.message);}
}
async function closeLivekitRoom(roomId){
  if(!livekitRoomService)return;
  try{await livekitRoomService.deleteRoom('vozchat-'+roomId);}
  catch(e){console.warn('LiveKit: falha ao encerrar sala',e?.message);}
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
console.log('VozChat Web Push:',pushEnabled?'configured':'not_configured');
const webPush = pushEnabled ? (await import('web-push')).default : null;
if(webPush) webPush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://vozchat-pwa.onrender.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const pool = POSTGRES_URL ? new (await import('pg')).default.Pool({connectionString:POSTGRES_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000}) : null;
let db = { users: [], sessions: [], rooms: [], messages: [], audios: [], files: [], largeUploads: [], contactRequests: [], callHistory: [], games: [], neonGames: [], nextPublicId: '10', pushSubscriptions: [] };
if(!pool) {
  try {db={...db,...JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))};}
  catch(err){if(err.code!=='ENOENT')throw err;}
}
let pendingWrite=Promise.resolve();
async function save(){
  if(!pool){const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,DATA_FILE);return;}
  const snapshot=JSON.stringify(db);
  pendingWrite=pendingWrite.catch(()=>{}).then(()=>pool.query('INSERT INTO vozchat_state(id,state) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()',[snapshot]));
  await pendingWrite;
}
async function startStorage(){
  if(!pool)return;
  await pool.query('CREATE TABLE IF NOT EXISTS vozchat_state(id INTEGER PRIMARY KEY CHECK(id=1),state JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS vozchat_blobs(id UUID PRIMARY KEY,content BYTEA NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS vozchat_transfer_chunks(file_id UUID NOT NULL, part INTEGER NOT NULL, content BYTEA NOT NULL, PRIMARY KEY(file_id,part))');
  const result=await pool.query('SELECT state FROM vozchat_state WHERE id=1');
  if(result.rows.length)db={...db,...result.rows[0].state};
  else await save();
  console.log('PostgreSQL conectado: VozChat persistente');
}
async function writeBlob(id,localPath,bytes){
  if(pool)await pool.query('INSERT INTO vozchat_blobs(id,content) VALUES($1,$2)',[id,bytes]);
  else await fsp.writeFile(localPath,bytes,{flag:'wx'});
}
async function readBlob(id,localPath){
  if(pool){const result=await pool.query('SELECT content FROM vozchat_blobs WHERE id=$1',[id]);return result.rows[0]?.content||null;}
  try{return await fsp.readFile(localPath);}catch(err){if(err.code==='ENOENT')return null;throw err;}
}
function normalizeTransferFile(name,mime){
  const originalName=path.basename(String(name||'').trim()).replace(/[\x00-\x1f\x7f]/g,'').slice(0,150);
  const ext=path.extname(originalName).toLowerCase();
  const safeMime=String(mime||'application/octet-stream').split(';')[0].trim().toLowerCase();
  if(!originalName||!ALLOWED_FILES[ext]||!ALLOWED_FILES[ext].includes(safeMime))return null;
  const kind=['.jpg','.jpeg','.png','.webp','.gif','.heic','.heif'].includes(ext)?'image':
    ['.mp4','.mov','.webm','.m4v','.3gp'].includes(ext)?'video':'file';
  return {originalName,ext,mime:safeMime,kind};
}
function userTransferBytes(){
  return db.files.reduce((sum,f)=>sum+(f.storage==='chunks'?Number(f.bytes)||0:0),0)+
    (db.largeUploads||[]).reduce((sum,f)=>sum+(Number(f.size)||0),0);
}
function transferPartPath(fileId,part){return path.join(FILES,fileId+'.part-'+part);}
async function storeTransferChunk(fileId,part,content){
  if(pool){
    await pool.query('INSERT INTO vozchat_transfer_chunks(file_id,part,content) VALUES($1,$2,$3) ON CONFLICT(file_id,part) DO UPDATE SET content=EXCLUDED.content',[fileId,part,content]);
  }else await fsp.writeFile(transferPartPath(fileId,part),content);
}
async function readTransferChunk(fileId,part){
  if(pool){
    const result=await pool.query('SELECT content FROM vozchat_transfer_chunks WHERE file_id=$1 AND part=$2',[fileId,part]);
    return result.rows[0]?.content||null;
  }
  try{return await fsp.readFile(transferPartPath(fileId,part));}catch{return null;}
}
async function deleteTransferChunks(fileId,parts){
  if(pool)await pool.query('DELETE FROM vozchat_transfer_chunks WHERE file_id=$1',[fileId]);
  else for(let i=0;i<parts;i++)await fsp.rm(transferPartPath(fileId,i),{force:true}).catch(()=>{});
}
async function expireUploads(){
  const now=Date.now();
  const expired=(db.largeUploads||[]).filter(x=>now-Number(x.createdAt)>TRANSFER_TTL_MS);
  if(!expired.length)return;
  for(const item of expired)await deleteTransferChunks(item.id,item.chunks);
  db.largeUploads=db.largeUploads.filter(x=>!expired.includes(x));
  await save();
}
async function streamTransfer(req,res,file,headers){
  const total=file.bytes;
  let start=0,end=total-1,status=200;
  if(req.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range));
    if(!match)return error(res,416,'Intervalo inválido.');
    if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}
    else if(match[2]){const suffix=Number(match[2]);start=Math.max(0,total-suffix);}
    else return error(res,416,'Intervalo inválido.');
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||end<start||start<0)return error(res,416,'Intervalo inválido.');
    end=Math.min(total-1,end);status=206;
  }
  const resultHeaders={...headers,'Content-Length':end-start+1};
  if(status===206)resultHeaders['Content-Range']='bytes '+start+'-'+end+'/'+total;
  // Primeira parte verificada antes de enviar cabeçalhos.
  const first=Math.floor(start/TRANSFER_CHUNK_BYTES),last=Math.floor(end/TRANSFER_CHUNK_BYTES);
  let chunk=await readTransferChunk(file.id,first);
  if(!chunk)return error(res,404,'Arquivo indisponível.');
  res.writeHead(status,resultHeaders);
  for(let part=first;part<=last;part++){
    if(part!==first)chunk=await readTransferChunk(file.id,part);
    if(!chunk){res.destroy();return;}
    const base=part*TRANSFER_CHUNK_BYTES;
    const buffer=chunk.subarray(Math.max(0,start-base),Math.min(chunk.length,end-base+1));
    if(!res.write(buffer))await new Promise(resolve=>{
      const done=()=>{res.off('drain',done);res.off('close',done);resolve();};
      res.once('drain',done);res.once('close',done);
    });
    if(res.destroyed)return;
  }
  res.end();
}

function serveBlob(req,res,bytes,headers){
  const range=req.headers.range;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match)return error(res,416,'Intervalo inválido.');
    let start=match[1]?Number(match[1]):0,end=match[2]?Number(match[2]):bytes.length-1;
    if(!match[1]&&match[2]){start=Math.max(0,bytes.length-Number(match[2]));end=bytes.length-1;}
    if(start>=bytes.length||start>end)return error(res,416,'Intervalo inválido.');
    end=Math.min(end,bytes.length-1);
    res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length});
    return res.end(bytes.subarray(start,end+1));
  }
  res.writeHead(200,{...headers,'Content-Length':bytes.length});
  return res.end(bytes);
}
const id = () => crypto.randomUUID();
const rand = (n=24) => crypto.randomBytes(n).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function passwordHash(p, salt=rand(16)) { return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); }
function matchesPassword(p, stored) { try { const [salt, expected] = stored.split(':'); const actual = passwordHash(p, salt).split(':')[1]; return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; } }
function body(req, max=32768) { return new Promise((resolve,reject) => { let chunks=[],len=0; req.on('data', c=> { len += c.length; if (len > max) { reject(Object.assign(new Error('Arquivo ou mensagem grande demais.'),{status:413})); req.destroy(); } else chunks.push(c); }); req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject); }); }
const clients = new Map();
const lastPushTestAt=new Map();
async function notifyMembers(room, sender, msg) {
  if(!webPush)return;
  const recipients = new Set(room.members.filter(uid=>uid!==sender.id));
  if(!recipients.size)return;
  const payload=JSON.stringify({
    title:['game','maze'].includes(msg.type)?'🎮 '+sender.name+' chamou você para jogar':room.directKey?sender.name:room.name,
    kind:['game','maze'].includes(msg.type)?'game-invite':'message',
    gameType:msg.type==='maze'?'neon':msg.type==='game'?'tic':null,
    gameId:msg.mazeId||msg.gameId||null,
    body: msg.type==='flowtalk'?'📻 Chamado no FlowTalk':msg.type==='audio'?'Nova mensagem de voz':msg.type==='image'?'Enviou uma foto':msg.type==='video'?'Enviou um vídeo':msg.type==='file'?'Enviou um arquivo':msg.type==='game'?'Convite para Jogo da Velha. Toque para aceitar.':msg.type==='maze'?'Convite para Labirinto Neon. Toque para aceitar.':'Nova mensagem',
    roomId:room.id,
    url:'/app?open='+encodeURIComponent(room.id),
    tag:['game','maze'].includes(msg.type)?'vozchat-game-'+(msg.mazeId||msg.gameId):'vozchat-'+room.id,
    messageId:msg.id
  });
  const subscriptions=(db.pushSubscriptions||[]).map(record=>({record,recipientId:recipientForSubscription(record,[...recipients])})).filter(item=>item.recipientId);
  if(!subscriptions.length)return;
  let changed=false;
  await Promise.allSettled(subscriptions.map(async ({record,recipientId})=>{
    try { await webPush.sendNotification(record.subscription,JSON.stringify({...JSON.parse(payload),profileId:recipientId}),{TTL:3600,urgency:'high',timeout:10000}); }
    catch(err) {
      if(err?.statusCode===404||err?.statusCode===410) {
        db.pushSubscriptions=db.pushSubscriptions.filter(s=>s!==record);changed=true;
      } else console.warn('Web push delivery error',Number(err?.statusCode)||'network');
    }
  }));
  if(changed)await save();
}
// Push de eventos pessoais, sem expor endpoints nem chaves.
async function deliverPersonalPush(uid,payload,ttl=3600){
  if(!webPush)return {registered:0,accepted:0,failed:0};
  const records=(db.pushSubscriptions||[]).filter(s=>recipientForSubscription(s,[uid]));
  let accepted=0,failed=0,changed=false;
  await Promise.allSettled(records.map(async record=>{
    try{
      await webPush.sendNotification(record.subscription,JSON.stringify({...payload,profileId:uid}),
        {TTL:ttl,urgency:'high',timeout:10000});
      accepted++;
    }catch(err){
      failed++;
      if(err?.statusCode===404||err?.statusCode===410){
        db.pushSubscriptions=db.pushSubscriptions.filter(s=>s!==record);changed=true;
      }else console.warn('Notificacao push pessoal falhou',Number(err?.statusCode)||'network');
    }
  }));
  if(changed)await save();
  return {registered:records.length,accepted,failed};
}
function validPushSubscription(subscription) {
  if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>2048)return false;
  let host;
  try {const url=new URL(subscription.endpoint);if(url.protocol!=='https:')return false;host=url.hostname.toLowerCase();}
  catch {return false;}
  if(!['push.apple.com','googleapis.com','mozilla.com','windows.com','microsoft.com'].some(domain=>host===domain||host.endsWith('.'+domain)))return false;
  const keys=subscription.keys;
  return keys&&typeof keys.p256dh==='string'&&typeof keys.auth==='string'
    && /^[a-zA-Z0-9_-]{60,150}$/.test(keys.p256dh)
    && /^[a-zA-Z0-9_-]{10,90}$/.test(keys.auth);
}
function push(userIds, type, data) { const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for(const uid of userIds) for(const res of clients.get(uid)||[]) { try { res.write(event); } catch {} } }
function json(res,status,payload,headers={}) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(payload)); }
function error(res,status,message) { json(res,status,{error:message}); }
function cookie(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(p=>p[0])); }
function sessionFrom(req) {
  const token=cookie(req).vozchat_session;
  return token?db.sessions.find(s=>s.hash===sha(token)&&s.expires>Date.now()):null;
}
function accountOwner(user){return user?.ownerId?db.users.find(u=>u.id===user.ownerId&&!u.ownerId):user;}
function ownerIdFor(userId){const person=db.users.find(u=>u.id===userId);return accountOwner(person)?.id||null;}
function recipientForSubscription(record,ids){
  const accountId=ownerIdFor(record.uid);
  return accountId?ids.find(uid=>ownerIdFor(uid)===accountId):null;
}
function userFrom(req) {
  const sess=sessionFrom(req);if(!sess)return null;
  const person=db.users.find(u=>u.id===sess.uid);
  return person && ownerIdFor(person.id)===(sess.ownerUid||sess.uid)?person:null;
}
function identitiesView(user){
  const root=accountOwner(user);
  return db.users.filter(u=>u.id===root.id||u.ownerId===root.id)
    .sort((a,b)=>a.id===root.id?-1:b.id===root.id?1:(a.identityType||'').localeCompare(b.identityType||''))
    .map(profile=>({id:profile.id,label:profile.id===root.id?'Pessoal':profile.identityType,
      name:profile.name,publicId:profile.publicId,avatarUrl:avatarUrl(profile),active:profile.id===user.id}));
}
function sessionCookie(req,token,maxAge) { const secure = req.socket.encrypted || req.headers['x-forwarded-proto']==='https'; return `vozchat_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`; }
async function newSession(req,res,u) { const token=rand(36); db.sessions=db.sessions.filter(s=>s.expires>Date.now()).slice(-3000); db.sessions.push({hash:sha(token),uid:u.id,ownerUid:u.id,expires:Date.now()+30*86400000}); await save(); return sessionCookie(req,token,30*86400); }
async function ensurePublicIds() {
  // IDs públicos começam em 10 e crescem sem limite fixo de dígitos.
  const taken=new Set();
  let next=10n, changed=false;
  for(const u of db.users) {
    if(typeof u.publicId==='string' && /^[1-9][0-9]+$/.test(u.publicId) && !taken.has(u.publicId)) {
      taken.add(u.publicId);
      // IDs aleatórios de identidades secundárias não alteram a sequência principal.
      if(!u.ownerId){const n=BigInt(u.publicId)+1n;if(n>next)next=n;}
    } else if(u.publicId!==undefined) {delete u.publicId;changed=true;}
  }
  if(typeof db.nextPublicId==='string' && /^[1-9][0-9]+$/.test(db.nextPublicId)) {
    const n=BigInt(db.nextPublicId);if(n>next)next=n;
  }
  for(const u of db.users)if(!u.publicId) {
    while(taken.has(String(next)))next++;
    u.publicId=String(next);
    taken.add(u.publicId);next++;changed=true;
  }
  const newNext=String(next);
  if(db.nextPublicId!==newNext){db.nextPublicId=newNext;changed=true;}
  if(changed)await save();
}
function allocatePublicId(){
  let n=BigInt(db.nextPublicId||'10');
  while(db.users.some(u=>u.publicId===String(n) || u.username==='u'+String(n)))n++;
  db.nextPublicId=String(n+1n);
  return String(n);
}
function allocateIsolatedPublicId(){
  for(let attempt=0;attempt<30;attempt++){
    // Números de 9 dígitos, aleatórios, sem associação visível ao ID da conta principal.
    const candidate=String(crypto.randomInt(100000000,1000000000));
    if(!db.users.some(u=>u.publicId===candidate||u.username==='u'+candidate))
      return candidate;
  }
  throw new Error('Não foi possível reservar um ID exclusivo. Tente novamente.');
}
function avatarUrl(u){return u?.avatarId?'/api/avatars/'+u.id:null;}
function safeUser(u) { return {id:u.id,name:u.name,username:u.username,publicId:u.publicId,avatarUrl:avatarUrl(u)}; }
function roomView(r,uid) { const last=[...db.messages].reverse().find(m=>m.roomId===r.id); const peer=r.directKey?db.users.find(u=>u.id!==uid&&r.members.includes(u.id)):null; return {id:r.id,name:peer?.name||r.name,peerId:peer?.publicId||null,avatarUrl:avatarUrl(peer),isDirect:!!r.directKey,isOwner:r.owner===uid,createdAt:r.createdAt,members:r.members.length,owner:r.owner,inviteUrl:r.directKey?null:`/app?join=${encodeURIComponent(r.id)}.${r.secret}`,last:last?{type:last.type,text:last.text||'',fileName:last.fileName||'',createdAt:last.createdAt,senderName:last.senderName}:null}; }
function member(uid,rid) { const r=db.rooms.find(r=>r.id===rid); return r && !r.inactive && r.members.includes(uid) ? r : null; }
function canPlayInRoom(room){
  // Nunca habilitar minijogos no ambiente Profissional.
  return !!(room && !room.inactive && room.directKey && room.members.length===2 &&
    room.members.every(uid=>{const user=db.users.find(u=>u.id===uid);
      return user && user.identityType!=='Profissional';}));
}
const playLines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const gameDeadline=24*60*60*1000;
let playQueue=Promise.resolve();
function withPlayLock(work){
  const result=playQueue.then(work);
  playQueue=result.catch(()=>{});
  return result;
}
function playView(game){
  return {id:game.id,roomId:game.roomId,status:game.status,board:game.board,
    turn:game.turn,winner:game.winner||null,inviterId:game.inviterId,
    players:game.users.map((uid,i)=>{
      const player=db.users.find(u=>u.id===uid);
      return {id:uid,name:player?.name||'Jogador',symbol:i===0?'X':'O'};
    }),createdAt:game.createdAt,updatedAt:game.updatedAt};
}
function expirePlayGame(game){
  if(!['pending','active'].includes(game.status))return false;
  if(Date.now()-new Date(game.updatedAt).getTime()<gameDeadline)return false;
  game.status='expired';game.finishedAt=new Date().toISOString();game.updatedAt=game.finishedAt;
  return true;
}
function emitPlayGame(game){push(game.users,'play-update',playView(game));}
function neonRoomGame(roomId){return [...(db.neonGames||[])].reverse().find(g=>g.roomId===roomId)||null;}
function neonView(game){return viewNeonGame(game,uid=>db.users.find(u=>u.id===uid));}
function neonEmit(game){push(game.users,'neon-update',neonView(game));}
function expireNeon(game){
  if(!game||!['pending','active'].includes(game.status))return false;
  // Movimento automático não prolonga o prazo de uma partida abandonada.
  const reference=game.lastPlayerAt||game.createdAt||game.updatedAt;
  if(Date.now()-new Date(reference).getTime()<24*3600000)return false;
  game.status='expired';game.updatedAt=new Date().toISOString();game.finishedAt=game.updatedAt;
  return true;
}

// Os drones continuam circulando enquanto houver participante online,
 // mesmo sem nenhuma jogada. A lógica fica no servidor para sincronizar ambos.
const neonClock=setInterval(()=>{
  void withPlayLock(async()=>{
    let changed=false;
    for(const game of db.neonGames||[]){
      if(game.status!=='active')continue;
      const room=db.rooms.find(r=>r.id===game.roomId);
      if(!room||room.inactive){game.status='abandoned';game.finishedAt=new Date().toISOString();changed=true;neonEmit(game);continue;}
      if(expireNeon(game)){changed=true;neonEmit(game);continue;}
      if(!game.users.some(uid=>(clients.get(uid)?.size||0)>0))continue;
      neonTick(game);neonEmit(game);changed=true;
    }
    if(changed)await save();
  }).catch(err=>console.warn('Relógio do Labirinto Neon:',err?.message));
},900);
neonClock.unref?.();

function groupMembers(r) {
  return r.members.map(uid=>db.users.find(u=>u.id===uid)).filter(Boolean)
    .map(u=>({name:u.name,publicId:u.publicId,isOwner:r.owner===u.id}));
}
function publishGroupChange(r,removed=[]) {
  for(const uid of r.members)push([uid],'room',roomView(r,uid));
  for(const uid of removed)push([uid],'room-removed',{roomId:r.id});
}
async function purgeGroupMedia(audios,files) {
  const ids=[...audios.map(a=>a.id),...files.map(f=>f.id)];
  const large=files.filter(f=>f.storage==='chunks');
  if(pool&&ids.length)await pool.query('DELETE FROM vozchat_blobs WHERE id=ANY($1::uuid[])',[ids]);
  if(pool&&large.length)await pool.query('DELETE FROM vozchat_transfer_chunks WHERE file_id=ANY($1::uuid[])',[large.map(f=>f.id)]);
  if(!pool){
    await Promise.all([...audios.map(a=>path.join(AUDIO,a.filename)),...files.filter(f=>f.storage!=='chunks').map(f=>path.join(FILES,f.storedName))].map(p=>fsp.unlink(p).catch(()=>{})));
    for(const f of large)await deleteTransferChunks(f.id,Math.ceil(f.bytes/TRANSFER_CHUNK_BYTES));
  }
}
async function sendMsg(room,user,type,extra) { const msg={id:id(),roomId:room.id,senderId:user.id,senderName:user.name,type,createdAt:new Date().toISOString(),...extra}; db.messages.push(msg); await save(); push(room.members,'message',msg); void notifyMembers(room,user,msg).catch(e=>console.warn('Push error',e?.message)); for(const uid of room.members)push([uid],'room',roomView(room,uid)); return msg; }
function contentType(ext) { return {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.ico':'image/x-icon'}[ext]||'application/octet-stream'; }
async function staticFile(req,res,url) { const name=url.pathname==='/talk'?'/talk.html':(url.pathname==='/'||url.pathname==='/app'?'/index.html':url.pathname); const decoded=decodeURIComponent(name); const absolute=path.resolve(STATIC,'.'+decoded); if(!(absolute===STATIC || absolute.startsWith(STATIC+path.sep))) return error(res,403,'Acesso negado.'); let st; try{st=await fsp.stat(absolute);}catch{return error(res,404,'Não encontrado.');} if(!st.isFile()) return error(res,404,'Não encontrado.'); res.writeHead(200,{'Content-Type':contentType(path.extname(absolute)),'Cache-Control':(decoded==='/index.html'||decoded==='/app'||decoded==='/talk'||decoded.endsWith('.js')||decoded.endsWith('.css'))?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'}); fs.createReadStream(absolute).pipe(res); }
const loginAttempts = new Map();
const contactAttempts=new Map();
function limitContactSearch(userId){
  const now=Date.now(),windowMs=60*60*1000;
  const hits=(contactAttempts.get(userId)||[]).filter(t=>now-t<windowMs);
  if(hits.length>=20)return true;
  hits.push(now);contactAttempts.set(userId,hits);
  return false;
}
function tooMany(ip) { const now=Date.now(); let a=loginAttempts.get(ip)||[]; a=a.filter(t=>now-t<15*60*1000); a.push(now); loginAttempts.set(ip,a); return a.length>25; }
// Chamadas de áudio/vídeo efêmeras: não gravam conteúdo e não alteram o histórico do chat.
// A sinalização é por sessão autenticada (SSE + Web Push); a mídia é LiveKit.
const activeCalls=new Map();
const CALL_RING_MS=60000;
const CALL_MAX_MS=2*60*60*1000;
const CALL_LIMIT=150;
function callView(call){
  return {id:call.id,roomId:call.roomId,kind:call.kind,callerName:call.callerName,
    callerId:call.callerId,state:call.state,createdAt:call.createdAt,
    expiresAt:call.expiresAt,accepted:call.accepted.size};
}
function visibleCall(call,uid){
  return call&&call.invitees.includes(uid)&&!call.declined.has(uid)&&call.expiresAt>Date.now();
}
function publishCall(call,type,users=call.invitees){
  for(const uid of users)push([uid],type,callView(call));
}
function finishCall(call,reason='ended'){
  if(!activeCalls.has(call.id))return;
  activeCalls.delete(call.id);
  const history=(db.callHistory||[]).find(entry=>entry.id===call.id);
  if(history){
    history.endedAt=new Date().toISOString();
    history.status=history.answeredAt?'completed':reason==='ended'?'canceled':reason==='timeout'?'missed':reason;
    history.durationSec=history.answeredAt?Math.max(0,Math.floor((Date.now()-new Date(history.answeredAt).getTime())/1000)):0;
    void save().catch(err=>console.error('Falha ao salvar histórico de chamadas:',err.message));
  }
  if(call.timer)clearTimeout(call.timer);
  publishCall(call,'call-ended');
  if(livekitRoomService)void livekitRoomService.deleteRoom('vozchat-call-'+call.id)
    .catch(()=>{});
}
async function alertIncomingCall(call){
  if(!webPush)return;
  const recipients=new Set(call.invitees.filter(uid=>uid!==call.callerId));
  const subscriptions=(db.pushSubscriptions||[]).map(record=>({record,recipientId:recipientForSubscription(record,[...recipients])})).filter(item=>item.recipientId);
  if(!subscriptions.length)return;
  const title=call.kind==='video'?'📹 Chamada de vídeo':'📞 Chamada de áudio';
  const payload=JSON.stringify({title:call.callerName+' · '+title,
    body:'Toque para atender no VozChat.',kind:'call',roomId:call.roomId,
    callId:call.id,tag:'vozchat-call-'+call.id});
  let dirty=false;
  await Promise.allSettled(subscriptions.map(async ({record,recipientId})=>{
    try{await webPush.sendNotification(record.subscription,JSON.stringify({...JSON.parse(payload),profileId:recipientId}),
      {TTL:60,urgency:'high',timeout:7000});}
    catch(e){
      if(e?.statusCode===404||e?.statusCode===410){
        db.pushSubscriptions=db.pushSubscriptions.filter(p=>p!==record);dirty=true;
      }else console.warn('Chamada push falhou',e?.statusCode||'network');
    }
  }));
  if(dirty)await save();
}
function findActiveCall(idValue){
  const call=activeCalls.get(idValue);
  if(call&&call.expiresAt<=Date.now()){finishCall(call,'expired');return null;}
  return call||null;
}
function endCallsForRoom(roomId){
  for(const call of [...activeCalls.values()])if(call.roomId===roomId)finishCall(call);
}
function rejectCallsForMember(roomId,uid){
  for(const call of [...activeCalls.values()]){
    if(call.roomId!==roomId||!call.invitees.includes(uid))continue;
    if(uid===call.callerId)finishCall(call);
    else {call.declined.add(uid);call.accepted.delete(uid);push([uid],'call-ended',callView(call));}
  }
}

async function api(req,res,url) {
  const p=url.pathname, method=req.method;
  if(method==='GET' && p==='/api/health') return json(res,200,{ok:true,service:'vozchat',storage:pool?'postgres':'local',livekit:livekitConfigured?'configured':'not_configured',push:pushEnabled?'configured':'not_configured',time:new Date().toISOString()});
  if(method==='POST' && (p==='/api/register'||p==='/api/login')) {
    const input=JSON.parse((await body(req)).toString('utf8'));
    let username=String(input.username||'').trim().toLowerCase(); const password=String(input.password||'');
    const sourceIp=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
    const rateKey=sourceIp+':'+username;
    if(p==='/api/login'&&(loginAttempts.get(rateKey)||[]).filter(t=>Date.now()-t<15*60*1000).length>=12)return error(res,429,'Muitas tentativas. Tente novamente em 15 minutos.');
    if((p==='/api/login'||username) && !(/^[a-z0-9_.-]{3,24}$/.test(username)||/^[1-9][0-9]{1,79}$/.test(username))) return error(res,400,'Informe seu ID numérico ou nome de usuário válido.');
    if(p==='/api/register') {
      const name=String(input.name||'').trim();
      if(name.length<2||name.length>48 || password.length<8||password.length>128) return error(res,400,'Informe nome e senha de pelo menos 8 caracteres.');
      if(username && db.users.some(u=>u.username===username)) return error(res,409,'Esse nome de usuário já existe.');
      const publicId=allocatePublicId();
      if(!username)username='u'+publicId;
      const u={id:id(),name,username,publicId,password:passwordHash(password),createdAt:new Date().toISOString()}; db.users.push(u); const ck=await newSession(req,res,u); return json(res,201,{user:safeUser(u)},{'Set-Cookie':ck});
    }
    const u=db.users.find(x=>!x.ownerId&&(x.username===username||x.publicId===username));
    if(!u||!matchesPassword(password,u.password)) {const times=(loginAttempts.get(rateKey)||[]).filter(t=>Date.now()-t<15*60*1000);times.push(Date.now());loginAttempts.set(rateKey,times);return error(res,401,'Usuário ou senha incorretos. Se a conta foi criada antes da correção, talvez seja necessário criar outra.');}
    loginAttempts.delete(rateKey);
    const ck=await newSession(req,res,u); return json(res,200,{user:safeUser(u)},{'Set-Cookie':ck});
  }
  const u=userFrom(req);
  if(!u) return error(res,401,'Faça login para continuar.');
  if(method==='POST'&&p==='/api/logout') { const token=cookie(req).vozchat_session; db.sessions=db.sessions.filter(s=>s.hash!==sha(token||'')); await save(); return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(req,'',0)}); }
  if(method==='GET'&&p==='/api/bootstrap') return json(res,200,{user:safeUser(u),identities:identitiesView(u),rooms:db.rooms.filter(r=>!r.inactive&&r.members.includes(u.id)).map(r=>roomView(r,u.id))});
  if(method==='GET'&&p==='/api/identities')return json(res,200,{identities:identitiesView(u)});
  // Histórico privado de partidas do perfil ativo, mesmo após fechar a conversa.
  // Não reúne perfis Pessoal/Família/Profissional e não permite consultar terceiros.
  if(method==='GET'&&p==='/api/play/history'){
    const all=[...(db.games||[]).map(game=>({...game,kind:'tic-tac-toe'})),
      ...(db.neonGames||[]).map(game=>({...game,kind:'neon-maze'}))];
    const history=all.filter(game=>{
      const room=db.rooms.find(r=>r.id===game.roomId);
      return game.users?.includes(u.id)&&room?.directKey&&room.members.includes(u.id)&&
        room.members.length===2&&game.users.every(uid=>{
          const person=db.users.find(user=>user.id===uid);
          return person&&person.identityType!=='Profissional';
        });
    }).sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt))
    .slice(0,100).map(game=>{
      const room=db.rooms.find(r=>r.id===game.roomId);
      const otherId=game.users.find(uid=>uid!==u.id);
      const contact=db.users.find(person=>person.id===otherId);
      return {id:game.id,roomId:game.roomId,kind:game.kind,
        name:game.kind==='neon-maze'?'Labirinto Neon':'Jogo da Velha',
        status:game.status,createdAt:game.createdAt,updatedAt:game.updatedAt,
        finishedAt:game.finishedAt||null,winner:game.winner||null,
        score:game.kind==='neon-maze'?game.score:null,
        otherName:contact?.name||'Contato',otherPublicId:contact?.publicId||null,
        canReopen:!room.inactive};
    });
    return json(res,200,{games:history});
  }
  if(method==='GET'&&p==='/api/play/invites'){
    const invitations=[...(db.games||[]).map(g=>({...g,kind:'tic'})),
      ...(db.neonGames||[]).map(g=>({...g,kind:'neon'}))]
      .filter(g=>g.status==='pending'&&g.inviterId!==u.id&&g.users?.includes(u.id)
        &&Date.now()-new Date(g.createdAt).getTime()<24*3600000
        &&canPlayInRoom(member(u.id,g.roomId)))
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
      .slice(0,10).map(g=>({id:g.id,roomId:g.roomId,kind:g.kind,
        inviterName:db.users.find(person=>person.id===g.inviterId)?.name||'Contato',
        createdAt:g.createdAt}));
    return json(res,200,{invitations});
  }
  if(method==='GET'&&/^\/api\/play\/neon\/room\/[0-9a-f-]{36}$/i.test(p)){
    const roomId=p.split('/').pop(),room=member(u.id,roomId);
    if(!room)return error(res,403,'Acesso negado a esta conversa.');
    if(!canPlayInRoom(room))return error(res,403,'O jogo está disponível somente em conversas Pessoal ou Família.');
    const game=neonRoomGame(roomId);
    if(game&&expireNeon(game)){await save();neonEmit(game);}
    return json(res,200,{game:game?neonView(game):null});
  }
  if(method==='POST'&&p==='/api/play/neon/invite'){
    const input=JSON.parse((await body(req,1024)).toString('utf8'));
    const roomId=String(input.roomId||''),room=member(u.id,roomId);
    if(!room)return error(res,403,'Acesso negado a esta conversa.');
    if(!canPlayInRoom(room))return error(res,403,'O jogo está disponível somente em conversas Pessoal ou Família.');
    return withPlayLock(async()=>{
      db.neonGames ||= [];
      const previous=neonRoomGame(roomId);
      if(previous&&expireNeon(previous)){await save();neonEmit(previous);}
      if(previous&&['pending','active'].includes(previous.status))
        return error(res,409,'Há um convite ou uma partida de labirinto em andamento.');
      const opponent=room.members.find(uid=>uid!==u.id);
      const game=newNeonGame(id(),roomId,[u.id,opponent],u.id,crypto.randomInt(1,0x7fffffff));
      db.neonGames.push(game);await save();neonEmit(game);
      push([opponent],'play-invite',{id:game.id,roomId,kind:'neon',inviterName:u.name,createdAt:game.createdAt});
      await sendMsg(room,u,'maze',{mazeId:game.id,text:'🎮 Convite para Labirinto Neon'});
      return json(res,201,{game:neonView(game)});
    });
  }
  const neonAction=/^\/api\/play\/neon\/([0-9a-f-]{36})\/(accept|decline|cancel|move|quit)$/.exec(p);
  if(method==='POST'&&neonAction){
    const gameId=neonAction[1],action=neonAction[2];
    const input=action==='move'?JSON.parse((await body(req,512)).toString('utf8')):{};
    return withPlayLock(async()=>{
      const game=(db.neonGames||[]).find(item=>item.id===gameId);
      const room=game&&member(u.id,game.roomId);
      if(!room||!game.users.includes(u.id))return error(res,403,'Partida privada indisponível.');
      if(!canPlayInRoom(room))return error(res,403,'Jogo indisponível neste ambiente.');
      if(expireNeon(game)){await save();neonEmit(game);}
      if(action==='accept'||action==='decline'){
        if(game.status!=='pending')return error(res,409,'Convite não está pendente.');
        if(game.inviterId===u.id)return error(res,403,'Somente o convidado pode aceitar ou recusar.');
        if(action==='accept'){beginNeonGame(game);game.lastPlayerAt=new Date().toISOString();}
        else game.status='declined';
      }else if(action==='cancel'){
        if(game.status!=='pending')return error(res,409,'Convite não está pendente.');
        if(game.inviterId!==u.id)return error(res,403,'Somente quem convidou pode cancelar.');
        game.status='canceled';
      }else if(action==='quit'){
        if(game.status!=='active')return error(res,409,'Partida não está ativa.');
        game.status='abandoned';
      }else{
        const moved=neonMove(game,u.id,input.direction);
        if(moved.changed)game.lastPlayerAt=new Date().toISOString();
        if(moved.error)return error(res,moved.code||409,moved.error);
        if(!moved.changed)return json(res,200,{game:neonView(game)});
      }
      game.updatedAt=new Date().toISOString();
      if(!['pending','active'].includes(game.status))game.finishedAt=game.updatedAt;
      await save();neonEmit(game);
      return json(res,200,{game:neonView(game)});
    });
  }
  if(method==='GET'&&/^\/api\/play\/room\/[0-9a-f-]{36}$/i.test(p)){
    const rid=p.split('/').pop(),room=member(u.id,rid);
    if(!room)return error(res,403,'Sem acesso a esta conversa.');
    if(!canPlayInRoom(room))return error(res,403,'VozChat Play está disponível apenas em conversas privadas Pessoal ou Família.');
    const game=[...(db.games||[])].reverse().find(g=>g.roomId===rid)||null;
    if(game&&expirePlayGame(game)){await save();emitPlayGame(game);}
    return json(res,200,{game:game?playView(game):null});
  }
  if(method==='POST'&&p==='/api/play/invite'){
    const input=JSON.parse((await body(req,1024)).toString('utf8'));
    const rid=String(input.roomId||'');
    const room=member(u.id,rid);
    if(!room)return error(res,403,'Sem acesso a esta conversa.');
    if(!canPlayInRoom(room))return error(res,403,'Jogue apenas em conversa privada Pessoal ou Família.');
    return withPlayLock(async()=>{
      db.games ||= [];
      const latest=[...db.games].reverse().find(g=>g.roomId===rid);
      if(latest&&expirePlayGame(latest)){await save();emitPlayGame(latest);}
      if(latest&&['pending','active'].includes(latest.status))
        return error(res,409,'Já existe uma partida em andamento ou convite pendente nesta conversa.');
      const opponent=room.members.find(uid=>uid!==u.id);
      const now=new Date().toISOString();
      const game={id:id(),roomId:rid,users:[u.id,opponent],inviterId:u.id,
        status:'pending',board:Array(9).fill(''),turn:'X',winner:null,
        createdAt:now,updatedAt:now};
      db.games.push(game);await save();
      emitPlayGame(game);
      push([opponent],'play-invite',{id:game.id,roomId:rid,kind:'tic',inviterName:u.name,createdAt:game.createdAt});
      await sendMsg(room,u,'game',{gameId:game.id,text:'🎮 Convite para Jogo da Velha'});
      return json(res,201,{game:playView(game)});
    });
  }
  const gameAction=/^\/api\/play\/([0-9a-f-]{36})\/(accept|decline|cancel|move|resign)$/.exec(p);
  if(method==='POST'&&gameAction){
    const gameId=gameAction[1],action=gameAction[2];
    const input=action==='move'?JSON.parse((await body(req,1024)).toString('utf8')):{};
    return withPlayLock(async()=>{
      const game=(db.games||[]).find(g=>g.id===gameId);
      const room=game&&member(u.id,game.roomId);
      if(!room||!game.users.includes(u.id))
        return error(res,403,'Partida não disponível para esta identidade.');
      if(!canPlayInRoom(room))return error(res,403,'Partida indisponível neste ambiente.');
      if(expirePlayGame(game)){await save();emitPlayGame(game);}
      if(action==='accept'||action==='decline'){
        if(game.status!=='pending')return error(res,409,'Este convite não está mais pendente.');
        if(u.id===game.inviterId)return error(res,403,'Somente o convidado pode responder.');
        game.status=action==='accept'?'active':'declined';
      }else if(action==='cancel'){
        if(game.status!=='pending')return error(res,409,'Este convite não está mais pendente.');
        if(u.id!==game.inviterId)return error(res,403,'Somente quem convidou pode cancelar.');
        game.status='canceled';
      }else if(action==='resign'){
        if(game.status!=='active')return error(res,409,'A partida ainda não está ativa ou já terminou.');
        game.status='abandoned';game.winner=game.users.find(uid=>uid!==u.id);
      }else{
        if(game.status!=='active')return error(res,409,'A partida ainda não está ativa ou já terminou.');
        const symbol=game.users.indexOf(u.id)===0?'X':'O';
        if(game.turn!==symbol)return error(res,409,'Aguarde sua vez.');
        if(!Number.isInteger(input.position)||input.position<0||input.position>8)
          return error(res,400,'Selecione uma casa válida.');
        if(game.board[input.position])return error(res,409,'Essa casa já foi marcada.');
        game.board[input.position]=symbol;
        if(playLines.some(line=>line.every(index=>game.board[index]===symbol))){
          game.status='won';game.winner=u.id;
        }else if(game.board.every(Boolean)){
          game.status='draw';
        }else game.turn=symbol==='X'?'O':'X';
      }
      game.updatedAt=new Date().toISOString();
      if(!['pending','active'].includes(game.status))game.finishedAt=game.updatedAt;
      await save();emitPlayGame(game);
      return json(res,200,{game:playView(game)});
    });
  }
  if(method==='POST'&&p==='/api/identities'){
    const input=JSON.parse((await body(req,2048)).toString('utf8'));
    const label=String(input.label||'');
    if(!['Profissional','Família'].includes(label))return error(res,400,'Escolha Profissional ou Família.');
    const root=accountOwner(u);
    if(db.users.some(person=>person.ownerId===root.id&&person.identityType===label))
      return error(res,409,'Esse perfil já existe. Abra-o na lista.');
    const name=String(input.name||'').trim();
    if(name.length<2||name.length>48)return error(res,400,'Digite um apelido de 2 a 48 caracteres para o perfil.');
    const publicId=allocateIsolatedPublicId();
    const profile={id:id(),ownerId:root.id,identityType:label,name,username:'u'+publicId,
      publicId,password:null,createdAt:new Date().toISOString()};
    db.users.push(profile);await save();
    return json(res,201,{profile:identitiesView(u).find(p=>p.id===profile.id),identities:identitiesView(u)});
  }
  const identitySwitch=/^\/api\/identities\/([0-9a-f-]{36})\/activate$/.exec(p);
  if(method==='POST'&&identitySwitch){
    const session=sessionFrom(req),root=accountOwner(u);
    const chosen=db.users.find(profile=>profile.id===identitySwitch[1]&&
      (profile.id===root.id||profile.ownerId===root.id));
    if(!session||!chosen)return error(res,404,'Perfil não encontrado nesta conta.');
    session.uid=chosen.id;session.ownerUid=root.id;
    await save();return json(res,200,{user:safeUser(chosen),identities:identitiesView(chosen)});
  }
  const identityEdit=/^\/api\/identities\/([0-9a-f-]{36})$/.exec(p);
  if(method==='PATCH'&&identityEdit){
    const root=accountOwner(u);
    const profile=db.users.find(entry=>entry.id===identityEdit[1]&&
      (entry.id===root.id||entry.ownerId===root.id));
    if(!profile)return error(res,404,'Perfil não encontrado nesta conta.');
    const input=JSON.parse((await body(req,2048)).toString('utf8'));
    const name=String(input.name||'').trim();
    if(name.length<2||name.length>48)return error(res,400,'Digite um apelido de 2 a 48 caracteres.');
    profile.name=name;await save();
    const related=new Set([profile.id]);
    for(const room of db.rooms.filter(r=>!r.inactive&&r.members.includes(profile.id)))
      for(const uid of room.members){related.add(uid);push([uid],'room',roomView(room,uid));}
    emitContactRequests([...related]);
    push([...related],'profile-updated',{userId:profile.id,avatarUrl:avatarUrl(profile)});
    return json(res,200,{profile:identitiesView(u).find(p=>p.id===profile.id),identities:identitiesView(u)});
  }
  if(method==='GET'&&p==='/api/events') { res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','Connection':'keep-alive','X-Accel-Buffering':'no'}); res.write(': connected\n\n'); const set=clients.get(u.id)||new Set(); set.add(res); clients.set(u.id,set); const keep=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},20000); req.on('close',()=>{clearInterval(keep);set.delete(res);if(!set.size)clients.delete(u.id);}); return; }
  if(method==='GET'&&p==='/api/push/config') return json(res,200,{
    enabled:pushEnabled,publicKey:pushEnabled?VAPID_PUBLIC_KEY:null,
    registered:(db.pushSubscriptions||[]).filter(record=>recipientForSubscription(record,[u.id])).length
  });
  if(method==='POST'&&p==='/api/push/test'){
    if(!pushEnabled)return error(res,503,'As chaves de notificacoes push nao estao configuradas no servidor.');
    const last=lastPushTestAt.get(u.id)||0;
    if(Date.now()-last<15000)return error(res,429,'Espere 15 segundos para enviar outro teste.');
    lastPushTestAt.set(u.id,Date.now());
    const result=await deliverPersonalPush(u.id,{
      title:'VozChat · Teste de push',
      body:'Push enviado pelo servidor. Seu aparelho recebeu o aviso?',
      kind:'test',tag:'vozchat-test-server'
    },120);
    if(!result.registered)return error(res,409,'Nenhum dispositivo inscrito. Ative as notificacoes primeiro.');
    if(!result.accepted)return error(res,502,'O servico de push nao aceitou a notificacao. Verifique as chaves VAPID e a inscricao.');
    return json(res,200,{ok:true,accepted:result.accepted,registered:result.registered,failed:result.failed});
  }
  if(method==='POST'&&p==='/api/push/subscribe') {
    if(!pushEnabled)return error(res,503,'Notificações push não configuradas.');
    const input=JSON.parse((await body(req,8192)).toString('utf8'));
    if(!validPushSubscription(input.subscription))return error(res,400,'Assinatura de notificações inválida.');
    db.pushSubscriptions ||= [];
    const endpoint=input.subscription.endpoint;
    db.pushSubscriptions=db.pushSubscriptions.filter(s=>s.subscription?.endpoint!==endpoint);
    const own=db.pushSubscriptions.filter(s=>recipientForSubscription(s,[u.id]));
    if(own.length>=6) {
      const oldest=own.sort((a,b)=>a.createdAt-b.createdAt)[0];
      db.pushSubscriptions=db.pushSubscriptions.filter(s=>s!==oldest);
    }
    db.pushSubscriptions.push({uid:u.id,subscription:{endpoint,keys:{p256dh:input.subscription.keys.p256dh,auth:input.subscription.keys.auth}},createdAt:Date.now()});
    await save();
    return json(res,200,{ok:true});
  }
  if(method==='POST'&&p==='/api/push/unsubscribe') {
    const input=JSON.parse((await body(req,4096)).toString('utf8'));
    if(typeof input.endpoint!=='string')return error(res,400,'Endpoint inválido.');
    db.pushSubscriptions=(db.pushSubscriptions||[]).filter(s=>!(recipientForSubscription(s,[u.id])&&s.subscription?.endpoint===input.endpoint));
    await save();
    return json(res,200,{ok:true});
  }
function contactRequestView(request,uid){
  const other=db.users.find(x=>x.id===(request.from===uid?request.to:request.from));
  return {id:request.id,kind:request.to===uid?'incoming':'outgoing',
    name:other?.name||'Pessoa',publicId:other?.publicId||'',avatarUrl:avatarUrl(other),
    createdAt:request.createdAt};
}
function emitContactRequests(users){
  for(const uid of users)push([uid],'contact-requests-changed',{});
}
async function deactivateDirectRoom(room){
  room.inactive=true;room.inactiveAt=new Date().toISOString();
  talkCloseRoom(room.id);
  void closeLivekitRoom(room.id);
  endCallsForRoom(room.id);
  for(const uid of room.members)push([uid],'room-removed',{roomId:room.id});
}

  if(method==='GET'&&p==='/api/contacts/requests'){
    return json(res,200,{requests:(db.contactRequests||[])
      .filter(r=>r.from===u.id||r.to===u.id)
      .map(r=>contactRequestView(r,u.id))});
  }
  if(method==='POST'&&p==='/api/contacts/add') {
    if(limitContactSearch(u.id))return error(res,429,'Muitas buscas por ID. Tente novamente mais tarde.');
    const input=JSON.parse((await body(req)).toString('utf8'));
    const publicId=String(input.publicId||'').trim();
    if(!/^[1-9][0-9]{1,79}$/.test(publicId))return error(res,400,'Informe um ID numérico com pelo menos 2 dígitos.');
    const target=db.users.find(x=>x.publicId===publicId);
    if(!target)return error(res,404,'Nenhuma pessoa encontrada com esse ID.');
    if(ownerIdFor(target.id)===ownerIdFor(u.id))return error(res,400,'Esse ID pertence a outro perfil da sua conta.');
    const pair=[u.id,target.id].sort().join(':');
    const room=db.rooms.find(r=>r.directKey===pair&&!r.inactive);
    if(room)return json(res,200,{status:'connected',room:roomView(room,u.id),contact:safeUser(target)});
    const existing=(db.contactRequests||[]).find(r=>
      (r.from===u.id&&r.to===target.id)||(r.to===u.id&&r.from===target.id));
    if(existing){
      if(existing.to===u.id)return error(res,409,'Esta pessoa já enviou uma solicitação. Aceite ou recuse em Pendentes.');
      return json(res,200,{status:'pending',request:contactRequestView(existing,u.id)});
    }
    if((db.contactRequests||[]).filter(r=>r.from===u.id).length>=30)
      return error(res,429,'Limite de solicitações pendentes. Cancele uma antes de continuar.');
    const request={id:id(),from:u.id,to:target.id,createdAt:new Date().toISOString()};
    db.contactRequests ||= [];db.contactRequests.push(request);
    await save();emitContactRequests([u.id,target.id]);
    void deliverPersonalPush(target.id,{
      title:'👤 Nova solicitação de contato',
      body:u.name+' (ID '+u.publicId+') quer adicionar você. Toque para aceitar ou recusar.',
      kind:'contact-request',requestId:request.id,tag:'vozchat-contact-'+request.id
    },86400).catch(e=>console.warn('Aviso de contato falhou',e?.message));
    return json(res,201,{status:'pending',request:contactRequestView(request,u.id)});
  }
  const requestMatch=/^\/api\/contacts\/requests\/([0-9a-f-]{36})\/(accept|decline|cancel)$/.exec(p);
  if(method==='POST'&&requestMatch){
    const request=(db.contactRequests||[]).find(r=>r.id===requestMatch[1]);
    if(!request)return error(res,404,'Solicitação não encontrada.');
    const action=requestMatch[2];
    if(action==='cancel'&&request.from!==u.id)return error(res,403,'Somente quem enviou pode cancelar.');
    if(action!=='cancel'&&request.to!==u.id)return error(res,403,'Somente o destinatário pode responder.');
    db.contactRequests=db.contactRequests.filter(r=>r.id!==request.id);
    if(action==='accept'){
      const pair=[request.from,request.to].sort().join(':');
      let room=db.rooms.find(r=>r.directKey===pair);
      if(!room){
        room={id:id(),name:'Conversa privada',directKey:pair,secret:rand(24),
          owner:request.from,members:[request.from,request.to],createdAt:new Date().toISOString()};
        db.rooms.push(room);
      }else{room.inactive=false;delete room.inactiveAt;}
      await save();
      for(const uid of room.members)push([uid],'room',roomView(room,uid));
      emitContactRequests([request.from,request.to]);
      void deliverPersonalPush(request.from,{
        title:'✅ Contato adicionado',
        body:u.name+' aceitou sua solicitação de contato.',
        kind:'contact-accepted',roomId:room.id,tag:'vozchat-contact-accepted-'+request.id
      },86400).catch(e=>console.warn('Aviso de contato aceito falhou',e?.message));
      return json(res,200,{status:'accepted',room:roomView(room,u.id)});
    }
    await save();emitContactRequests([request.from,request.to]);
    return json(res,200,{status:action==='decline'?'declined':'canceled'});
  }
  const deleteContact=/^\/api\/contacts\/([0-9a-f-]{36})$/.exec(p);
  if(method==='DELETE'&&deleteContact){
    const room=db.rooms.find(r=>r.id===deleteContact[1]&&r.directKey&&!r.inactive&&r.members.includes(u.id));
    if(!room)return error(res,404,'Contato não encontrado.');
    await deactivateDirectRoom(room);
    const [left,right]=room.members;
    db.contactRequests=(db.contactRequests||[]).filter(r=>!((r.from===left&&r.to===right)||(r.from===right&&r.to===left)));
    await save();
    emitContactRequests(room.members);
    return json(res,200,{ok:true});
  }
  if(method==='POST'&&p==='/api/profile/avatar'){
    const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(!['image/jpeg','image/png','image/webp'].includes(mime))
      return error(res,415,'Envie uma foto JPEG, PNG ou WEBP.');
    if(Number(req.headers['content-length'])>512*1024)return error(res,413,'Foto limitada a 512 KB.');
    const content=await body(req,512*1024);
    const jpeg=content.length>=3&&content[0]===255&&content[1]===216&&content[2]===255;
    const png=content.length>=8&&content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp=content.length>=12&&content.toString('ascii',0,4)==='RIFF'&&content.toString('ascii',8,12)==='WEBP';
    if(!((mime==='image/jpeg'&&jpeg)||(mime==='image/png'&&png)||(mime==='image/webp'&&webp)))
      return error(res,415,'Conteúdo inválido para imagem de perfil.');
    const avatarId=id(),old=u.avatarId;
    await writeBlob(avatarId,path.join(FILES,'avatar-'+avatarId),content);
    u.avatarId=avatarId;u.avatarMime=mime;await save();
    if(old){
      if(pool)await pool.query('DELETE FROM vozchat_blobs WHERE id=$1',[old]).catch(()=>{});
      else await fsp.rm(path.join(FILES,'avatar-'+old),{force:true}).catch(()=>{});
    }
    const related=new Set([u.id]);
    for(const room of db.rooms.filter(r=>!r.inactive&&r.members.includes(u.id)))
      for(const uid of room.members){related.add(uid);push([uid],'room',roomView(room,uid));}
    for(const request of db.contactRequests||[]){
      if(request.from===u.id)related.add(request.to);
      if(request.to===u.id)related.add(request.from);
    }
    emitContactRequests([...related]);
    push([...related],'profile-updated',{userId:u.id,avatarUrl:avatarUrl(u)});
    return json(res,200,{user:safeUser(u)});
  }
  if(method==='DELETE'&&p==='/api/profile/avatar'){
    const old=u.avatarId;delete u.avatarId;delete u.avatarMime;await save();
    if(old){
      if(pool)await pool.query('DELETE FROM vozchat_blobs WHERE id=$1',[old]).catch(()=>{});
      else await fsp.rm(path.join(FILES,'avatar-'+old),{force:true}).catch(()=>{});
    }
    const related=new Set([u.id]);
    for(const room of db.rooms.filter(r=>!r.inactive&&r.members.includes(u.id)))
      for(const uid of room.members){related.add(uid);push([uid],'room',roomView(room,uid));}
    emitContactRequests([...related]);
    return json(res,200,{user:safeUser(u)});
  }
  const avatarMatch=/^\/api\/avatars\/([0-9a-f-]{36})$/.exec(p);
  if(method==='GET'&&avatarMatch){
    const owner=db.users.find(x=>x.id===avatarMatch[1]);
    if(!owner?.avatarId)return error(res,404,'Foto não encontrada.');
    const connected=db.rooms.some(r=>!r.inactive&&r.members.includes(u.id)&&r.members.includes(owner.id));
    const requested=(db.contactRequests||[]).some(r=>
      (r.from===u.id&&r.to===owner.id)||(r.to===u.id&&r.from===owner.id));
    if(owner.id!==u.id&&ownerIdFor(owner.id)!==ownerIdFor(u.id)&&!connected&&!requested)
      return error(res,403,'Foto privada.');
    const data=await readBlob(owner.avatarId,path.join(FILES,'avatar-'+owner.avatarId));
    if(!data)return error(res,404,'Foto indisponível.');
    res.writeHead(200,{'Content-Type':owner.avatarMime||'image/jpeg','Cache-Control':'private,no-store',
      'Content-Length':data.length,'X-Content-Type-Options':'nosniff'});
    res.end(data);return;
  }
  if(method==='POST'&&p==='/api/rooms') { const input=JSON.parse((await body(req)).toString('utf8')); const name=String(input.name||'').trim(); if(name.length<2||name.length>60) return error(res,400,'Nome da conversa deve ter de 2 a 60 caracteres.'); const r={id:id(),secret:rand(24),owner:u.id,name,members:[u.id],createdAt:new Date().toISOString()}; db.rooms.push(r); await save(); const view=roomView(r,u.id); push([u.id],'room',view); return json(res,201,{room:view}); }
  if(method==='POST'&&p==='/api/rooms/join') { const input=JSON.parse((await body(req)).toString('utf8')); const [rid,secret]=String(input.invite||'').split('.'); const r=db.rooms.find(r=>r.id===rid&&!r.directKey&&r.secret===secret); if(!r) return error(res,404,'Convite inválido ou expirado.'); if(!r.members.includes(u.id)){
      if(r.members.some(uid=>ownerIdFor(uid)===ownerIdFor(u.id)))
        return error(res,409,'Outro perfil da sua conta já participa deste grupo.');
      r.members.push(u.id);await save();for(const uid of r.members)push([uid],'room',roomView(r,uid));
    } return json(res,200,{room:roomView(r,u.id)}); }

  if(method==='GET'&&p==='/api/calls/history'){
    const history=(db.callHistory||[]).filter(entry=>
      entry.invitees.includes(u.id)&&!!member(u.id,entry.roomId))
      .slice(-80).reverse().map(entry=>{
        const room=member(u.id,entry.roomId);
        const view=roomView(room,u.id);
        return {id:entry.id,roomId:entry.roomId,name:view.name,avatarUrl:view.avatarUrl,
          kind:entry.kind,direction:entry.callerId===u.id?'outgoing':'incoming',
          status:entry.status,createdAt:entry.createdAt,endedAt:entry.endedAt||null,
          durationSec:entry.durationSec||0};
      });
    return json(res,200,{calls:history});
  }
  if(method==='GET'&&p==='/api/calls/pending'){
    const calls=[...activeCalls.values()].filter(c=>visibleCall(c,u.id))
      .map(c=>callView(c));
    return json(res,200,{calls});
  }
  if(method==='POST'&&p==='/api/calls/start'){
    if(!livekitConfigured)return error(res,503,'Chamadas indisponíveis no momento.');
    const input=JSON.parse((await body(req,1024)).toString('utf8'));
    const rid=String(input.roomId||'');
    const r=member(u.id,rid);
    if(!r)return error(res,403,'Acesso negado à conversa.');
    if(!['audio','video'].includes(input.kind))return error(res,400,'Tipo de chamada inválido.');
    if(r.members.length<2)return error(res,409,'Adicione outra pessoa à conversa.');
    if(r.members.length>8)return error(res,409,'Chamada em grupo aceita até 8 pessoas.');
    if([...activeCalls.values()].some(c=>c.roomId===rid&&c.expiresAt>Date.now()))
      return error(res,409,'Esta conversa já tem uma chamada em andamento.');
    if([...activeCalls.values()].some(c=>c.invitees.includes(u.id)&&c.expiresAt>Date.now()))
      return error(res,409,'Você já participa de outra chamada.');
    if(activeCalls.size>=CALL_LIMIT)return error(res,503,'Muitas chamadas simultâneas. Tente novamente.');
    const now=Date.now();
    const call={id:id(),roomId:rid,kind:input.kind,callerId:u.id,callerName:u.name,
      invitees:[...r.members],accepted:new Set([u.id]),declined:new Set(),
      state:'ringing',createdAt:new Date(now).toISOString(),expiresAt:now+CALL_RING_MS,
      timer:null};
    activeCalls.set(call.id,call);
    db.callHistory ||= [];
    db.callHistory.push({id:call.id,roomId:rid,kind:call.kind,callerId:u.id,
      invitees:[...r.members],createdAt:call.createdAt,status:'ringing',
      answeredAt:null,endedAt:null,durationSec:0});
    if(db.callHistory.length>2000)db.callHistory.splice(0,db.callHistory.length-2000);
    await save();
    call.timer=setTimeout(()=>{if(call.state==='ringing')finishCall(call,'missed');},CALL_RING_MS);
    publishCall(call,'call-incoming',r.members.filter(uid=>uid!==u.id));
    void alertIncomingCall(call).catch(()=>{});
    return json(res,201,{call:callView(call)});
  }
  const callMatch=/^\/api\/calls\/([0-9a-f-]{36})\/(accept|decline|end|token)$/.exec(p);
  if(method==='POST'&&callMatch){
    const call=findActiveCall(callMatch[1]);
    if(!call||!visibleCall(call,u.id))return error(res,404,'Chamada indisponível ou encerrada.');
    const action=callMatch[2];
    if(action==='accept'){
      call.accepted.add(u.id);
      call.state='active';
      const history=(db.callHistory||[]).find(entry=>entry.id===call.id);
      if(history&&!history.answeredAt){history.answeredAt=new Date().toISOString();history.status='active';await save();}
      call.expiresAt=Date.now()+CALL_MAX_MS;
      if(call.timer){clearTimeout(call.timer);call.timer=null;}
      call.timer=setTimeout(()=>finishCall(call,'timeout'),CALL_MAX_MS);
      publishCall(call,'call-update');
      return json(res,200,{call:callView(call)});
    }
    if(action==='decline'){
      if(u.id===call.callerId)return error(res,403,'Use desligar para cancelar a chamada.');
      call.declined.add(u.id);call.accepted.delete(u.id);
      push([u.id],'call-ended',callView(call));
      publishCall(call,'call-update',call.invitees.filter(uid=>uid!==u.id));
      if(!call.invitees.some(uid=>uid!==call.callerId&&!call.declined.has(uid)))finishCall(call,'declined');
      return json(res,200,{ok:true});
    }
    if(action==='end'){
      finishCall(call);
      return json(res,200,{ok:true});
    }
    if(action==='token'){
      if(!call.accepted.has(u.id))return error(res,403,'Atenda a chamada antes de conectar.');
      const token=new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{
        identity:u.id+'-'+rand(8),ttl:'10m'
      });
      token.addGrant({roomJoin:true,room:'vozchat-call-'+call.id,canSubscribe:true,
        canPublish:true,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE,TrackSource.CAMERA]});
      return json(res,200,{url:LIVEKIT_URL,token:await token.toJwt(),call:callView(call)});
    }
  }

  if(method==='GET'&&p==='/api/talk/provider') {
    return json(res,200,{provider:livekitConfigured?'livekit':'legacy'});
  }
  if(method==='POST'&&p==='/api/talk/livekit-token') {
    if(!livekitConfigured)return error(res,503,'LiveKit ainda não configurado neste ambiente.');
    const input=JSON.parse((await body(req,1024)).toString('utf8'));
    const rid=String(input.roomId||'');
    if(!/^[0-9a-f-]{36}$/i.test(rid)||!member(u.id,rid))return error(res,403,'Sem acesso a esta conversa.');
    const token=new AccessToken(LIVEKIT_API_KEY,LIVEKIT_API_SECRET,{
      identity:u.id+'-'+rand(8),ttl:'10m'
    });
    token.addGrant({roomJoin:true,room:'vozchat-'+rid,canPublish:true,
      canSubscribe:true,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]});
    return json(res,200,{url:LIVEKIT_URL,token:await token.toJwt()});
  }
  if(method==='GET'&&p==='/api/talk/ice-config') {
    return json(res,200,{iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]});
  }
  const groupMatch=p.match(/^\/api\/rooms\/([0-9a-f-]{36})(?:\/(members|leave))?(?:\/([1-9][0-9]{1,79}))?$/);
  if(groupMatch) {
    const rid=groupMatch[1],action=groupMatch[2]||'',targetId=groupMatch[3];
    const r=member(u.id,rid);
    if(!r || r.directKey) return error(res,404,'Grupo não encontrado.');
    if(method==='GET'&&action==='members'&&!targetId)
      return json(res,200,{room:roomView(r,u.id),members:groupMembers(r)});
    if(method==='POST'&&action==='members'&&!targetId) {
      if(r.owner!==u.id)return error(res,403,'Somente quem criou o grupo pode adicionar participantes.');
      const input=JSON.parse((await body(req)).toString('utf8'));
      const publicId=String(input.publicId||'').trim();
      if(!/^[1-9][0-9]{1,79}$/.test(publicId))return error(res,400,'Informe um ID válido.');
      const target=db.users.find(x=>x.publicId===publicId);
      if(!target)return error(res,404,'Pessoa não encontrada.');
      if(r.members.includes(target.id))return error(res,409,'Essa pessoa já participa do grupo.');
      if(r.members.some(memberId=>ownerIdFor(memberId)===ownerIdFor(target.id)))
        return error(res,409,'Outro perfil dessa conta já participa deste grupo.');
      if(r.members.length>=100)return error(res,409,'Limite de 100 participantes por grupo.');
      r.members.push(target.id);await save();
      publishGroupChange(r);
      return json(res,201,{room:roomView(r,u.id),members:groupMembers(r)});
    }
    if(method==='DELETE'&&action==='members'&&targetId) {
      if(r.owner!==u.id)return error(res,403,'Somente quem criou o grupo pode remover participantes.');
      const target=db.users.find(x=>x.publicId===targetId);
      if(!target||!r.members.includes(target.id))return error(res,404,'Participante não encontrado.');
      if(target.id===r.owner)return error(res,400,'O criador não pode se remover. Exclua o grupo se necessário.');
      r.members=r.members.filter(uid=>uid!==target.id);
      talkCloseForMember(r.id,target.id);
      rejectCallsForMember(r.id,target.id);
      void revokeLivekitMember(r.id,target.id);
      r.secret=rand(24); // revoga convites antigos que o participante removido possa ter guardado
      await save();publishGroupChange(r,[target.id]);
      return json(res,200,{room:roomView(r,u.id),members:groupMembers(r)});
    }
    if(method==='POST'&&action==='leave'&&!targetId) {
      if(r.owner===u.id)return error(res,409,'O criador não pode sair. Exclua o grupo se necessário.');
      r.members=r.members.filter(uid=>uid!==u.id);
      talkCloseForMember(r.id,u.id);
      rejectCallsForMember(r.id,u.id);
      void revokeLivekitMember(r.id,u.id);
      r.secret=rand(24);
      await save();publishGroupChange(r,[u.id]);
      return json(res,200,{ok:true});
    }
    if(method==='DELETE'&&!action) {
      if(r.owner!==u.id)return error(res,403,'Somente o criador pode excluir o grupo.');
      const recipients=[...r.members],audios=db.audios.filter(a=>a.roomId===rid),files=db.files.filter(f=>f.roomId===rid);
      talkCloseRoom(rid);
      void closeLivekitRoom(rid);
      endCallsForRoom(rid);
      db.rooms=db.rooms.filter(g=>g.id!==rid);
      db.messages=db.messages.filter(m=>m.roomId!==rid);
      db.audios=db.audios.filter(a=>a.roomId!==rid);
      db.files=db.files.filter(f=>f.roomId!==rid);
      const pendingTransfers=(db.largeUploads||[]).filter(f=>f.roomId===rid);
      db.largeUploads=(db.largeUploads||[]).filter(f=>f.roomId!==rid);
      await save();
      for(const item of pendingTransfers)await deleteTransferChunks(item.id,item.chunks);
      for(const uid of recipients)push([uid],'room-removed',{roomId:rid});
      await purgeGroupMedia(audios,files).catch(e=>console.warn('Falha na limpeza de mídia de grupo',e.message));
      return json(res,200,{ok:true});
    }
    return error(res,405,'Operação de grupo não permitida.');
  }
  const match=p.match(/^\/api\/rooms\/([0-9a-f-]{36})\/(messages|audio|flowtalk|files)$/);
  if(match) {
    const rid=match[1]; const r=member(u.id,rid); if(!r) return error(res,403,'Você não participa desta conversa.');
    if(method==='GET'&&match[2]==='messages') { const all=db.messages.filter(m=>m.roomId===rid); return json(res,200,{messages:all.slice(-300)}); }
    if(method==='POST'&&match[2]==='messages') { const input=JSON.parse((await body(req)).toString('utf8')); const content=String(input.text||'').trim(); if(!content||content.length>2000) return error(res,400,'Mensagem deve ter de 1 a 2000 caracteres.'); return json(res,201,{message:await sendMsg(r,u,'text',{text:content})}); }
    if(method==='POST'&&match[2]==='files') {
      const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      let originalName;
      try { originalName=decodeURIComponent(String(req.headers['x-file-name']||'')); }
      catch { return error(res,400,'Nome de arquivo inválido.'); }
      originalName=path.basename(originalName).replace(/[\x00-\x1f\x7f]/g,'').slice(0,150);
      const ext=path.extname(originalName).toLowerCase();
      if(!originalName || !ALLOWED_FILES[ext] || !ALLOWED_FILES[ext].includes(mime)) return error(res,415,'Tipo de arquivo não permitido. Envie imagens, vídeos, PDF, documentos ou ZIP.');
      if(Number(req.headers['content-length'])>MAX_FILE_BYTES) return error(res,413,'O arquivo deve ter no máximo 25 MB.');
      const bytes=await body(req,MAX_FILE_BYTES);
      if(bytes.length===0) return error(res,400,'Arquivo vazio.');
      const fileId=id(), storedName=fileId+ext;
      await writeBlob(fileId,path.join(FILES,storedName),bytes);
      const kind=['.jpg','.jpeg','.png','.webp','.gif','.heic','.heif'].includes(ext) ? 'image' : ['.mp4','.mov','.webm','.m4v','.3gp'].includes(ext) ? 'video' : 'file';
      db.files.push({id:fileId,storedName,originalName,mime,roomId:rid,bytes:bytes.length,kind});
      const message=await sendMsg(r,u,kind,{fileId,fileName:originalName,fileSize:bytes.length,fileMime:mime});
      return json(res,201,{message});
    }
    if(method==='POST'&&match[2]==='flowtalk')
      return error(res,410,'FlowTalk agora transmite voz ao vivo. Atualize o aplicativo e use o modo rádio.');
    if(method==='POST'&&match[2]==='audio') {
      const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
      const extensions={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','audio/x-m4a':'m4a','audio/aac':'aac'};
      if(!extensions[mime]) return error(res,415,'Formato de áudio não suportado.');
      const duration=Math.max(0,Number(req.headers['x-audio-duration'])||0);
      const raw=await body(req,12*1024*1024); if(raw.length<100) return error(res,400,'Áudio vazio ou muito curto.');
      const aid=id(),filename=`${aid}.${extensions[mime]}`; await writeBlob(aid,path.join(AUDIO,filename),raw);
      db.audios.push({id:aid,filename,mime,roomId:rid,bytes:raw.length});
      return json(res,201,{message:await sendMsg(r,u,'audio',{audioId:aid,duration:Math.min(600,duration)})});
    }
  }
  // Upload privado fracionado, obrigatório para anexos acima de 25MB.
  if(method==='GET'&&p==='/api/transfers/config'){
    return json(res,200,{maxBytes:MAX_LARGE_FILE_BYTES,chunkBytes:TRANSFER_CHUNK_BYTES,
      legacyBytes:MAX_FILE_BYTES,quotaBytes:TRANSFER_QUOTA_BYTES,
      availableBytes:Math.max(0,TRANSFER_QUOTA_BYTES-userTransferBytes())});
  }
  if(method==='POST'&&p==='/api/transfers/start'){
    const input=JSON.parse((await body(req,4096)).toString('utf8'));
    const roomId=String(input.roomId||'');
    const room=member(u.id,roomId);
    if(!room)return error(res,403,'Sem permissão para esta conversa.');
    const meta=normalizeTransferFile(input.name,input.mime);
    if(!meta)return error(res,415,'Formato não permitido. Envie documentos, imagens, vídeos e arquivos compactados.');
    const size=Number(input.size);
    if(!Number.isSafeInteger(size)||size<=MAX_FILE_BYTES||size>MAX_LARGE_FILE_BYTES)
      return error(res,413,'Use envio normal até 25MB; arquivos grandes têm limite de 1GB.');
    await expireUploads();
    if(userTransferBytes()+size>TRANSFER_QUOTA_BYTES)
      return error(res,507,'Capacidade de arquivos grandes atingida neste servidor. Será necessário armazenamento externo.');
    if((db.largeUploads||[]).filter(x=>x.userId===u.id).length>=3)
      return error(res,429,'Finalize ou cancele um dos envios em andamento.');
    const chunks=Math.ceil(size/TRANSFER_CHUNK_BYTES);
    const upload={id:id(),roomId,userId:u.id,name:meta.originalName,mime:meta.mime,ext:meta.ext,
      kind:meta.kind,size,chunks,received:0,createdAt:Date.now()};
    db.largeUploads ||= [];db.largeUploads.push(upload);
    await save();
    return json(res,201,{uploadId:upload.id,chunkBytes:TRANSFER_CHUNK_BYTES,chunks,received:0});
  }
  const uploadMatch=p.match(/^\/api\/transfers\/([0-9a-f-]{36})\/(chunk|finish|cancel|status)$/);
  if(uploadMatch){
    const upload=(db.largeUploads||[]).find(x=>x.id===uploadMatch[1]);
    if(!upload||upload.userId!==u.id||!member(u.id,upload.roomId))
      return error(res,404,'Envio não encontrado.');
    const action=uploadMatch[2];
    if(method==='GET'&&action==='status')
      return json(res,200,{received:upload.received,chunks:upload.chunks,chunkBytes:TRANSFER_CHUNK_BYTES,size:upload.size});
    if(method==='POST'&&action==='cancel'){
      await deleteTransferChunks(upload.id,upload.chunks);
      db.largeUploads=db.largeUploads.filter(x=>x!==upload);await save();
      return json(res,200,{ok:true});
    }
    if(method==='POST'&&action==='chunk'){
      const idx=Number(req.headers['x-part-index']);
      if(!Number.isSafeInteger(idx)||idx<0||idx>=upload.chunks)return error(res,400,'Parte inválida.');
      if(idx!==upload.received)return error(res,409,'Ordem de envio inválida.');
      const expected=Math.min(TRANSFER_CHUNK_BYTES,upload.size-idx*TRANSFER_CHUNK_BYTES);
      if(Number(req.headers['content-length'])>expected)return error(res,413,'Parte excede limite.');
      const data=await body(req,TRANSFER_CHUNK_BYTES);
      if(data.length!==expected)return error(res,400,'Parte incompleta.');
      await storeTransferChunk(upload.id,idx,data);
      upload.received++;
      await save();
      return json(res,200,{received:upload.received,chunks:upload.chunks});
    }
    if(method==='POST'&&action==='finish'){
      if(upload.received!==upload.chunks)return error(res,409,'Ainda faltam partes do arquivo.');
      const last=await readTransferChunk(upload.id,upload.chunks-1);
      if(!last||last.length!==upload.size-(upload.chunks-1)*TRANSFER_CHUNK_BYTES)
        return error(res,409,'Última parte ausente.');
      // A conversa pode ter sido removida entre o início e o fim do envio.
      const room=member(u.id,upload.roomId);
      if(!room)return error(res,403,'Conversa indisponível.');
      const fileId=upload.id;
      db.files.push({id:fileId,storedName:fileId+upload.ext,originalName:upload.name,
        mime:upload.mime,roomId:upload.roomId,bytes:upload.size,kind:upload.kind,storage:'chunks'});
      db.largeUploads=db.largeUploads.filter(x=>x!==upload);
      const message=await sendMsg(room,u,upload.kind,
        {fileId,fileName:upload.name,fileSize:upload.size,fileMime:upload.mime});
      return json(res,201,{message});
    }
  }

  const fileMatch=p.match(/^\/api\/files\/([0-9a-f-]{36})$/);
  if(method==='GET'&&fileMatch) {
    const file=db.files.find(f=>f.id===fileMatch[1]);
    if(!file || !member(u.id,file.roomId)) return error(res,404,'Arquivo não encontrado.');
    // Documentos sempre são baixados. Imagem/vídeo podem aparecer diretamente na conversa.
    const inline=file.kind==='image'||file.kind==='video';
    const safeName=file.originalName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
    const disposition=`${inline?'inline':'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
    const headers={'Content-Type':file.mime==='application/octet-stream'?'application/octet-stream':file.mime,
      'Content-Disposition':disposition,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'};
    if(file.storage==='chunks')return streamTransfer(req,res,file,headers);
    const bytes=await readBlob(file.id,path.join(FILES,file.storedName));
    if(!bytes)return error(res,404,'Arquivo indisponível.');
    return serveBlob(req,res,bytes,headers);
  }
  const audioMatch=p.match(/^\/api\/audio\/([0-9a-f-]{36})$/);
  if(method==='GET'&&audioMatch) {
    const a=db.audios.find(a=>a.id===audioMatch[1]); if(!a||!member(u.id,a.roomId)) return error(res,404,'Áudio não encontrado.');
    const filepath=path.join(AUDIO,a.filename);
    const bytes=await readBlob(a.id,filepath);if(!bytes)return error(res,404,'Áudio indisponível.');
    return serveBlob(req,res,bytes,{'Content-Type':a.mime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'});
  }
  return error(res,404,'Rota não encontrada.');
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))await api(req,res,url); else if(req.method==='GET'||req.method==='HEAD')await staticFile(req,res,url); else error(res,405,'Método não permitido.');}
  catch(err){ if(!res.headersSent) { const status=err.status|| (err instanceof SyntaxError?400:500); console.error(status===500?err.message:'');error(res,status,status===500?'Erro interno no servidor.':err.message); } }
});
if(process.env.NODE_ENV==='production'&&!pool)throw new Error('DATABASE_URL ausente: não é seguro usar armazenamento temporário em produção.');
await startStorage();
await ensurePublicIds();

// FlowTalk AO VIVO: frames PCM mono 16 kHz por WebSocket, sem gravação nem persistência.
const talkWss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
const talkRooms=new Map(); // roomId -> conexões autenticadas
const talkFloor=new Map(); // roomId -> conexão que detém o botão de fala

const talkAlertCooldown=new Map();
async function notifyTalkStart(ws){
  const room=member(ws.talkUserId,ws.talkRoom);
  if(!room)return;
  const now=Date.now(),key=room.id+':'+ws.talkUserId;
  const last=talkAlertCooldown.get(key)||0;
  if(now-last<12000)return;
  talkAlertCooldown.set(key,now);
  if(talkAlertCooldown.size>2500){
    for(const [k,t] of talkAlertCooldown)if(now-t>60000)talkAlertCooldown.delete(k);
  }
  const listeners=new Set([...talkRooms.get(room.id)||[]].map(peer=>peer.talkUserId));
  const recipients=room.members.filter(uid=>uid!==ws.talkUserId);
  for(const uid of recipients)push([uid],'talk-incoming',{roomId:room.id,senderName:ws.talkUserName});
  if(!webPush)return;
  // Apenas pessoas sem rádio conectado precisam de convite por push.
  const inactive=new Set(recipients.filter(uid=>!listeners.has(uid)));
  const records=(db.pushSubscriptions||[]).filter(p=>inactive.has(p.uid));
  if(!records.length)return;
  const payload=JSON.stringify({
    title:'📻 '+ws.talkUserName+' chamou no FlowTalk',
    body:'Toque para entrar no rádio ao vivo.',
    roomId:room.id,kind:'talk',url:'/app?open='+encodeURIComponent(room.id)+'&talk=1',
    tag:'vozchat-talk-'+room.id
  });
  let changed=false;
  await Promise.allSettled(records.map(async record=>{
    try{await webPush.sendNotification(record.subscription,payload,{TTL:45,urgency:'high',timeout:7000});}
    catch(e){
      if(e?.statusCode===404||e?.statusCode===410){
        db.pushSubscriptions=db.pushSubscriptions.filter(s=>s!==record);changed=true;
      }else console.warn('FlowTalk push erro',e?.statusCode||'network');
    }
  }));
  if(changed)await save();
}

function talkSend(ws,payload){if(ws.readyState===1)try{ws.send(JSON.stringify(payload));}catch{}}
function talkBroadcast(rid,payload,except=null){
  for(const peer of talkRooms.get(rid)||[])if(peer!==except)talkSend(peer,payload);
}
function talkLeave(ws){
  const rid=ws.talkRoom;if(!rid)return;
  const group=talkRooms.get(rid);
  group?.delete(ws);
  if(talkFloor.get(rid)===ws.talkId){
    talkFloor.delete(rid);
    talkBroadcast(rid,{type:'floor',clientId:null,name:null});
  }
  talkBroadcast(rid,{type:'peer-left',clientId:ws.talkId});
  if(!group?.size){talkRooms.delete(rid);talkFloor.delete(rid);}
  ws.talkRoom=null;
}
function talkCloseForMember(roomId,userId){
  for(const peer of [...talkRooms.get(roomId)||[]])if(peer.talkUserId===userId)peer.close(4003,'Não participa mais do grupo');
}
function talkCloseRoom(roomId){
  for(const peer of [...talkRooms.get(roomId)||[]])peer.close(4003,'Grupo encerrado');
}
function talkHandle(ws,payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return;
  if(!member(ws.talkUserId,ws.talkRoom)){ws.close(4003,'Sem acesso à conversa');return;}
  const peers=talkRooms.get(ws.talkRoom);
  if(payload.type==='floor-request'){
    const active=talkFloor.get(ws.talkRoom);
    if(active&&active!==ws.talkId)return talkSend(ws,{type:'floor-denied'});
    talkFloor.set(ws.talkRoom,ws.talkId);
    talkBroadcast(ws.talkRoom,{type:'floor',clientId:ws.talkId,name:ws.talkUserName});
    talkSend(ws,{type:'floor-granted'});
    void notifyTalkStart(ws).catch(e=>console.warn('FlowTalk alerta',e?.message));
  }else if(payload.type==='floor-release'){
    if(talkFloor.get(ws.talkRoom)===ws.talkId){
      talkFloor.delete(ws.talkRoom);
      talkBroadcast(ws.talkRoom,{type:'floor',clientId:null,name:null});
    }
  }
}
talkWss.on('connection',(ws,req,context)=>{
  ws.talkId=crypto.randomUUID();
  ws.talkUserId=context.user.id;ws.talkUserName=context.user.name;ws.talkRoom=context.rid;
  const group=talkRooms.get(context.rid)||new Set();
  talkRooms.set(context.rid,group);
  talkSend(ws,{type:'ready',clientId:ws.talkId,
    peers:[...group].map(p=>({clientId:p.talkId,name:p.talkUserName})),
    speaker:[...group].find(p=>p.talkId===talkFloor.get(context.rid))?.talkUserName||null,
    speakerId:talkFloor.get(context.rid)||null
  });
  group.add(ws);
  talkBroadcast(context.rid,{type:'peer-joined',clientId:ws.talkId,name:ws.talkUserName},ws);
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true;});
  ws.audioWindowStart=Date.now();ws.audioPackets=0;ws.audioBytes=0;
  ws.on('message',(data,isBinary)=>{
    if(isBinary){
      if(!member(ws.talkUserId,ws.talkRoom)){ws.close(4003,'Sem acesso');return;}
      if(talkFloor.get(ws.talkRoom)!==ws.talkId)return;
      // Frames PCM s16 mono 16 kHz. Cada frame possui 20 ms (640 bytes).
      if(data.length!==640)return;
      const now=Date.now();
      if(now-ws.audioWindowStart>1000){ws.audioWindowStart=now;ws.audioPackets=0;ws.audioBytes=0;}
      if(++ws.audioPackets>75)return; // limite de tráfego, não persistir frames
      for(const peer of talkRooms.get(ws.talkRoom)||[]){
        if(peer===ws || peer.readyState!==1 || peer.bufferedAmount>64*1024)continue;
        try{peer.send(data,{binary:true,compress:false});}catch{}
      }
      return;
    }
    try{talkHandle(ws,JSON.parse(data.toString()));}
    catch{talkSend(ws,{type:'error',message:'Comando de rádio inválido.'});}
  });
  ws.on('close',()=>talkLeave(ws));
  ws.on('error',()=>{});
});
const talkHeartbeat=setInterval(()=>{
  for(const ws of talkWss.clients){
    if(!ws.isAlive){ws.terminate();continue;}
    ws.isAlive=false;ws.ping();
  }
},25000);
talkHeartbeat.unref();
server.on('upgrade',(req,socket,head)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname!=='/api/talk/ws'){socket.destroy();return;}
    const origin=req.headers.origin;
    const expectedProto=req.headers['x-forwarded-proto']==='https'?'https:':'http:';
    const expectedHost=String(req.headers['x-forwarded-host']||req.headers.host||'');
    if(!origin || new URL(origin).host!==expectedHost || new URL(origin).protocol!==expectedProto){
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
    }
    const rid=url.searchParams.get('room')||'';
    const user=userFrom(req);
    if(!user || !/^[0-9a-f-]{36}$/i.test(rid) || !member(user.id,rid)){
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
    }
    const group=talkRooms.get(rid);
    if(group?.size>=8){
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');socket.destroy();return;
    }
    talkWss.handleUpgrade(req,socket,head,ws=>talkWss.emit('connection',ws,req,{rid,user}));
  }catch{socket.destroy();}
});


console.log('Voice Flow / LiveKit configuration: '+(livekitConfigured?'configured':'not configured'));
console.log('Voice Flow / LiveKit diagnostics: URL='+(
  LIVEKIT_URL?'valid_or_normalized':(process.env.LIVEKIT_URL?'invalid_format':'missing')
)+' KEY='+(LIVEKIT_API_KEY?'present':'missing')+
' SECRET='+(LIVEKIT_API_SECRET?'present':'missing'));
if(livekitConfigured){
  Promise.race([
    livekitRoomService.listRooms().then(()=>true),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),7500))
  ]).then(()=>console.log('Voice Flow / LiveKit API: connection OK'))
    .catch(err=>console.warn('Voice Flow / LiveKit API: connection failed ('+
      (err?.status||err?.statusCode||err?.name||'unknown')+')'));
}

server.listen(PORT,'0.0.0.0',()=>console.log('VozChat ativo na porta '+PORT+' | storage: '+(pool?'PostgreSQL':DATA)));