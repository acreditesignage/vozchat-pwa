import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const AUDIO = path.join(DATA, 'audio');
const FILES = path.join(DATA, 'files');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_FILES = {
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.gif': ['image/gif'],
  '.heic': ['image/heic', 'image/heif', 'application/octet-stream'], '.heif': ['image/heif', 'image/heic', 'application/octet-stream'],
  '.mp4': ['video/mp4'], '.mov': ['video/quicktime', 'video/mp4', 'application/octet-stream'], '.webm': ['video/webm'], '.m4v': ['video/x-m4v', 'video/mp4'], '.3gp': ['video/3gpp'],
  '.pdf': ['application/pdf'], '.txt': ['text/plain'], '.csv': ['text/csv','application/vnd.ms-excel','text/plain'],
  '.doc': ['application/msword','application/octet-stream'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'],
  '.xls': ['application/vnd.ms-excel','application/octet-stream'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],
  '.ppt': ['application/vnd.ms-powerpoint','application/octet-stream'], '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'],
  '.zip': ['application/zip','application/x-zip-compressed','application/octet-stream'],
};

const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(AUDIO, { recursive: true });
fs.mkdirSync(FILES, { recursive: true });
const DATA_FILE = path.join(DATA, 'database.json');
const POSTGRES_URL = process.env.DATABASE_URL || process.env.VOZCHAT_DATABASE_URL;
const pool = POSTGRES_URL ? new (await import('pg')).default.Pool({connectionString:POSTGRES_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000}) : null;
let db = { users: [], sessions: [], rooms: [], messages: [], audios: [], files: [], nextPublicId: '10' };
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
function push(userIds, type, data) { const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for(const uid of userIds) for(const res of clients.get(uid)||[]) { try { res.write(event); } catch {} } }
function json(res,status,payload,headers={}) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(payload)); }
function error(res,status,message) { json(res,status,{error:message}); }
function cookie(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(p=>p[0])); }
function userFrom(req) { const token = cookie(req).vozchat_session; if(!token) return null; const sess=db.sessions.find(s=>s.hash===sha(token) && s.expires>Date.now()); return sess ? db.users.find(u=>u.id===sess.uid) : null; }
function sessionCookie(req,token,maxAge) { const secure = req.socket.encrypted || req.headers['x-forwarded-proto']==='https'; return `vozchat_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`; }
async function newSession(req,res,u) { const token=rand(36); db.sessions=db.sessions.filter(s=>s.expires>Date.now()).slice(-3000); db.sessions.push({hash:sha(token),uid:u.id,expires:Date.now()+30*86400000}); await save(); return sessionCookie(req,token,30*86400); }
async function ensurePublicIds() {
  // IDs públicos começam em 10 e crescem sem limite fixo de dígitos.
  const taken=new Set();
  let next=10n, changed=false;
  for(const u of db.users) {
    if(typeof u.publicId==='string' && /^[1-9][0-9]+$/.test(u.publicId) && !taken.has(u.publicId)) {
      taken.add(u.publicId);
      const n=BigInt(u.publicId)+1n;
      if(n>next)next=n;
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
function safeUser(u) { return {id:u.id,name:u.name,username:u.username,publicId:u.publicId}; }
function roomView(r,uid) { const last=[...db.messages].reverse().find(m=>m.roomId===r.id); const peer=r.directKey?db.users.find(u=>u.id!==uid&&r.members.includes(u.id)):null; return {id:r.id,name:peer?.name||r.name,peerId:peer?.publicId||null,isDirect:!!r.directKey,createdAt:r.createdAt,members:r.members.length,owner:r.owner,inviteUrl:r.directKey?null:`/app?join=${encodeURIComponent(r.id)}.${r.secret}`,last:last?{type:last.type,text:last.text||'',fileName:last.fileName||'',createdAt:last.createdAt,senderName:last.senderName}:null}; }
function member(uid,rid) { const r=db.rooms.find(r=>r.id===rid); return r && r.members.includes(uid) ? r : null; }
async function sendMsg(room,user,type,extra) { const msg={id:id(),roomId:room.id,senderId:user.id,senderName:user.name,type,createdAt:new Date().toISOString(),...extra}; db.messages.push(msg); await save(); push(room.members,'message',msg); for(const uid of room.members)push([uid],'room',roomView(room,uid)); return msg; }
function contentType(ext) { return {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.ico':'image/x-icon'}[ext]||'application/octet-stream'; }
async function staticFile(req,res,url) { const name=url.pathname==='/'||url.pathname==='/app' ? '/index.html' : url.pathname; const decoded=decodeURIComponent(name); const absolute=path.resolve(STATIC,'.'+decoded); if(!(absolute===STATIC || absolute.startsWith(STATIC+path.sep))) return error(res,403,'Acesso negado.'); let st; try{st=await fsp.stat(absolute);}catch{return error(res,404,'Não encontrado.');} if(!st.isFile()) return error(res,404,'Não encontrado.'); res.writeHead(200,{'Content-Type':contentType(path.extname(absolute)),'Cache-Control':decoded==='/index.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'}); fs.createReadStream(absolute).pipe(res); }
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
async function api(req,res,url) {
  const p=url.pathname, method=req.method;
  if(method==='GET' && p==='/api/health') return json(res,200,{ok:true,service:'vozchat',storage:pool?'postgres':'local',time:new Date().toISOString()});
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
    const u=db.users.find(x=>x.username===username||x.publicId===username);
    if(!u||!matchesPassword(password,u.password)) {const times=(loginAttempts.get(rateKey)||[]).filter(t=>Date.now()-t<15*60*1000);times.push(Date.now());loginAttempts.set(rateKey,times);return error(res,401,'Usuário ou senha incorretos. Se a conta foi criada antes da correção, talvez seja necessário criar outra.');}
    loginAttempts.delete(rateKey);
    const ck=await newSession(req,res,u); return json(res,200,{user:safeUser(u)},{'Set-Cookie':ck});
  }
  const u=userFrom(req);
  if(!u) return error(res,401,'Faça login para continuar.');
  if(method==='POST'&&p==='/api/logout') { const token=cookie(req).vozchat_session; db.sessions=db.sessions.filter(s=>s.hash!==sha(token||'')); await save(); return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(req,'',0)}); }
  if(method==='GET'&&p==='/api/bootstrap') return json(res,200,{user:safeUser(u),rooms:db.rooms.filter(r=>r.members.includes(u.id)).map(r=>roomView(r,u.id))});
  if(method==='GET'&&p==='/api/events') { res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','Connection':'keep-alive','X-Accel-Buffering':'no'}); res.write(': connected\n\n'); const set=clients.get(u.id)||new Set(); set.add(res); clients.set(u.id,set); const keep=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},20000); req.on('close',()=>{clearInterval(keep);set.delete(res);if(!set.size)clients.delete(u.id);}); return; }
  if(method==='POST'&&p==='/api/contacts/add') {
    if(limitContactSearch(u.id))return error(res,429,'Muitas buscas por ID. Tente novamente mais tarde.');
    const input=JSON.parse((await body(req)).toString('utf8'));
    const publicId=String(input.publicId||'').trim();
    if(!/^[1-9][0-9]{1,79}$/.test(publicId))return error(res,400,'Informe um ID numérico com pelo menos 2 dígitos.');
    const target=db.users.find(x=>x.publicId===publicId);
    if(!target)return error(res,404,'Nenhuma pessoa encontrada com esse ID.');
    if(target.id===u.id)return error(res,400,'Esse ID pertence à sua própria conta.');
    const pair=[u.id,target.id].sort().join(':');
    let room=db.rooms.find(r=>r.directKey===pair);
    const wasNew=!room;
    if(!room) {
      room={id:id(),name:'Conversa privada',directKey:pair,secret:rand(24),owner:u.id,members:[u.id,target.id],createdAt:new Date().toISOString()};
      db.rooms.push(room);
      await save();
    }
    for(const uid of room.members)push([uid],'room',roomView(room,uid));
    return json(res,wasNew?201:200,{room:roomView(room,u.id),contact:safeUser(target)});
  }
  if(method==='POST'&&p==='/api/rooms') { const input=JSON.parse((await body(req)).toString('utf8')); const name=String(input.name||'').trim(); if(name.length<2||name.length>60) return error(res,400,'Nome da conversa deve ter de 2 a 60 caracteres.'); const r={id:id(),secret:rand(24),owner:u.id,name,members:[u.id],createdAt:new Date().toISOString()}; db.rooms.push(r); await save(); const view=roomView(r,u.id); push([u.id],'room',view); return json(res,201,{room:view}); }
  if(method==='POST'&&p==='/api/rooms/join') { const input=JSON.parse((await body(req)).toString('utf8')); const [rid,secret]=String(input.invite||'').split('.'); const r=db.rooms.find(r=>r.id===rid&&r.secret===secret); if(!r) return error(res,404,'Convite inválido ou expirado.'); if(!r.members.includes(u.id)){r.members.push(u.id);await save();for(const uid of r.members)push([uid],'room',roomView(r,uid));} return json(res,200,{room:roomView(r,u.id)}); }
  const match=p.match(/^\/api\/rooms\/([0-9a-f-]{36})\/(messages|audio|files)$/);
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
    if(method==='POST'&&match[2]==='audio') {
      const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
      const extensions={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','audio/x-m4a':'m4a','audio/aac':'aac'};
      if(!extensions[mime]) return error(res,415,'Formato de áudio não suportado.');
      const raw=await body(req,12*1024*1024); if(raw.length<100) return error(res,400,'Áudio vazio ou muito curto.');
      const aid=id(),filename=`${aid}.${extensions[mime]}`; await writeBlob(aid,path.join(AUDIO,filename),raw);
      db.audios.push({id:aid,filename,mime,roomId:rid,bytes:raw.length});
      return json(res,201,{message:await sendMsg(r,u,'audio',{audioId:aid,duration:Math.min(600,Number(req.headers['x-audio-duration'])||0)})});
    }
  }
  const fileMatch=p.match(/^\/api\/files\/([0-9a-f-]{36})$/);
  if(method==='GET'&&fileMatch) {
    const file=db.files.find(f=>f.id===fileMatch[1]);
    if(!file || !member(u.id,file.roomId)) return error(res,404,'Arquivo não encontrado.');
    const filepath=path.join(FILES,file.storedName);
    const bytes=await readBlob(file.id,filepath);if(!bytes)return error(res,404,'Arquivo indisponível.');
    // Documentos sempre são baixados. Imagem/vídeo podem aparecer diretamente na conversa.
    const inline=file.kind==='image'||file.kind==='video';
    const safeName=file.originalName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
    const disposition=`${inline?'inline':'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
    const headers={'Content-Type':file.mime==='application/octet-stream'?'application/octet-stream':file.mime,
      'Content-Disposition':disposition,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'};
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
  res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))await api(req,res,url); else if(req.method==='GET'||req.method==='HEAD')await staticFile(req,res,url); else error(res,405,'Método não permitido.');}
  catch(err){ if(!res.headersSent) { const status=err.status|| (err instanceof SyntaxError?400:500); console.error(status===500?err.message:'');error(res,status,status===500?'Erro interno no servidor.':err.message); } }
});
if(process.env.NODE_ENV==='production'&&!pool)throw new Error('DATABASE_URL ausente: não é seguro usar armazenamento temporário em produção.');
await startStorage();
await ensurePublicIds();
server.listen(PORT,'0.0.0.0',()=>console.log('VozChat ativo na porta '+PORT+' | storage: '+(pool?'PostgreSQL':DATA)));