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
let db = { users: [], sessions: [], rooms: [], messages: [], audios: [], files: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (err) { if (err.code !== 'ENOENT') throw err; }
function save() { const tmp = `${DATA_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DATA_FILE); }
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
function newSession(req,res,u) { const token=rand(36); db.sessions=db.sessions.filter(s=>s.expires>Date.now()).slice(-3000); db.sessions.push({hash:sha(token),uid:u.id,expires:Date.now()+30*86400000}); save(); return sessionCookie(req,token,30*86400); }
function safeUser(u) { return {id:u.id,name:u.name,username:u.username}; }
function roomView(r,uid) { const last=[...db.messages].reverse().find(m=>m.roomId===r.id); return {id:r.id,name:r.name,createdAt:r.createdAt,members:r.members.length,owner:r.owner,inviteUrl:`/app?join=${encodeURIComponent(r.id)}.${r.secret}`,last:last?{type:last.type,text:last.text||'',fileName:last.fileName||'',createdAt:last.createdAt,senderName:last.senderName}:null}; }
function member(uid,rid) { const r=db.rooms.find(r=>r.id===rid); return r && r.members.includes(uid) ? r : null; }
function sendMsg(room,user,type,extra) { const msg={id:id(),roomId:room.id,senderId:user.id,senderName:user.name,type,createdAt:new Date().toISOString(),...extra}; db.messages.push(msg); save(); push(room.members,'message',msg); push(room.members,'room',roomView(room,user.id)); return msg; }
function contentType(ext) { return {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.ico':'image/x-icon'}[ext]||'application/octet-stream'; }
async function staticFile(req,res,url) { const name=url.pathname==='/'||url.pathname==='/app' ? '/index.html' : url.pathname; const decoded=decodeURIComponent(name); const absolute=path.resolve(STATIC,'.'+decoded); if(!(absolute===STATIC || absolute.startsWith(STATIC+path.sep))) return error(res,403,'Acesso negado.'); let st; try{st=await fsp.stat(absolute);}catch{return error(res,404,'Não encontrado.');} if(!st.isFile()) return error(res,404,'Não encontrado.'); res.writeHead(200,{'Content-Type':contentType(path.extname(absolute)),'Cache-Control':decoded==='/index.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'}); fs.createReadStream(absolute).pipe(res); }
const loginAttempts = new Map();
function tooMany(ip) { const now=Date.now(); let a=loginAttempts.get(ip)||[]; a=a.filter(t=>now-t<15*60*1000); a.push(now); loginAttempts.set(ip,a); return a.length>25; }
async function api(req,res,url) {
  const p=url.pathname, method=req.method;
  if(method==='GET' && p==='/api/health') return json(res,200,{ok:true,service:'vozchat',time:new Date().toISOString()});
  if(method==='POST' && (p==='/api/register'||p==='/api/login')) {
    if(tooMany(req.socket.remoteAddress||'unknown')) return error(res,429,'Muitas tentativas. Tente novamente mais tarde.');
    const input=JSON.parse((await body(req)).toString('utf8'));
    const username=String(input.username||'').trim().toLowerCase(); const password=String(input.password||'');
    if(!/^[a-z0-9_.-]{3,24}$/.test(username)) return error(res,400,'Usuário: 3 a 24 caracteres (letras, números, _ . -).');
    if(p==='/api/register') {
      const name=String(input.name||'').trim();
      if(name.length<2||name.length>48 || password.length<8||password.length>128) return error(res,400,'Informe nome e senha de pelo menos 8 caracteres.');
      if(db.users.some(u=>u.username===username)) return error(res,409,'Esse nome de usuário já existe.');
      const u={id:id(),name,username,password:passwordHash(password),createdAt:new Date().toISOString()}; db.users.push(u); const ck=newSession(req,res,u); return json(res,201,{user:safeUser(u)},{'Set-Cookie':ck});
    }
    const u=db.users.find(x=>x.username===username);
    if(!u||!matchesPassword(password,u.password)) return error(res,401,'Usuário ou senha incorretos.');
    const ck=newSession(req,res,u); return json(res,200,{user:safeUser(u)},{'Set-Cookie':ck});
  }
  const u=userFrom(req);
  if(!u) return error(res,401,'Faça login para continuar.');
  if(method==='POST'&&p==='/api/logout') { const token=cookie(req).vozchat_session; db.sessions=db.sessions.filter(s=>s.hash!==sha(token||'')); save(); return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(req,'',0)}); }
  if(method==='GET'&&p==='/api/bootstrap') return json(res,200,{user:safeUser(u),rooms:db.rooms.filter(r=>r.members.includes(u.id)).map(r=>roomView(r,u.id))});
  if(method==='GET'&&p==='/api/events') { res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','Connection':'keep-alive','X-Accel-Buffering':'no'}); res.write(': connected\n\n'); const set=clients.get(u.id)||new Set(); set.add(res); clients.set(u.id,set); const keep=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},20000); req.on('close',()=>{clearInterval(keep);set.delete(res);if(!set.size)clients.delete(u.id);}); return; }
  if(method==='POST'&&p==='/api/rooms') { const input=JSON.parse((await body(req)).toString('utf8')); const name=String(input.name||'').trim(); if(name.length<2||name.length>60) return error(res,400,'Nome da conversa deve ter de 2 a 60 caracteres.'); const r={id:id(),secret:rand(24),owner:u.id,name,members:[u.id],createdAt:new Date().toISOString()}; db.rooms.push(r); save(); const view=roomView(r,u.id); push([u.id],'room',view); return json(res,201,{room:view}); }
  if(method==='POST'&&p==='/api/rooms/join') { const input=JSON.parse((await body(req)).toString('utf8')); const [rid,secret]=String(input.invite||'').split('.'); const r=db.rooms.find(r=>r.id===rid&&r.secret===secret); if(!r) return error(res,404,'Convite inválido ou expirado.'); if(!r.members.includes(u.id)){r.members.push(u.id);save();push(r.members,'room',roomView(r,u.id));} return json(res,200,{room:roomView(r,u.id)}); }
  const match=p.match(/^\/api\/rooms\/([0-9a-f-]{36})\/(messages|audio|files)$/);
  if(match) {
    const rid=match[1]; const r=member(u.id,rid); if(!r) return error(res,403,'Você não participa desta conversa.');
    if(method==='GET'&&match[2]==='messages') { const all=db.messages.filter(m=>m.roomId===rid); return json(res,200,{messages:all.slice(-300)}); }
    if(method==='POST'&&match[2]==='messages') { const input=JSON.parse((await body(req)).toString('utf8')); const content=String(input.text||'').trim(); if(!content||content.length>2000) return error(res,400,'Mensagem deve ter de 1 a 2000 caracteres.'); return json(res,201,{message:sendMsg(r,u,'text',{text:content})}); }
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
      await fsp.writeFile(path.join(FILES,storedName),bytes,{flag:'wx'});
      const kind=['.jpg','.jpeg','.png','.webp','.gif','.heic','.heif'].includes(ext) ? 'image' : ['.mp4','.mov','.webm','.m4v','.3gp'].includes(ext) ? 'video' : 'file';
      db.files.push({id:fileId,storedName,originalName,mime,roomId:rid,bytes:bytes.length,kind});
      const message=sendMsg(r,u,kind,{fileId,fileName:originalName,fileSize:bytes.length,fileMime:mime});
      return json(res,201,{message});
    }
    if(method==='POST'&&match[2]==='audio') {
      const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
      const extensions={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','audio/x-m4a':'m4a','audio/aac':'aac'};
      if(!extensions[mime]) return error(res,415,'Formato de áudio não suportado.');
      const raw=await body(req,12*1024*1024); if(raw.length<100) return error(res,400,'Áudio vazio ou muito curto.');
      const aid=id(),filename=`${aid}.${extensions[mime]}`; await fsp.writeFile(path.join(AUDIO,filename),raw,{flag:'wx'});
      db.audios.push({id:aid,filename,mime,roomId:rid,bytes:raw.length});
      return json(res,201,{message:sendMsg(r,u,'audio',{audioId:aid,duration:Math.min(600,Number(req.headers['x-audio-duration'])||0)})});
    }
  }
  const fileMatch=p.match(/^\/api\/files\/([0-9a-f-]{36})$/);
  if(method==='GET'&&fileMatch) {
    const file=db.files.find(f=>f.id===fileMatch[1]);
    if(!file || !member(u.id,file.roomId)) return error(res,404,'Arquivo não encontrado.');
    const filepath=path.join(FILES,file.storedName);
    let stat;try { stat=await fsp.stat(filepath); } catch { return error(res,404,'Arquivo indisponível.'); }
    // Documentos sempre são baixados. Imagem/vídeo podem aparecer diretamente na conversa.
    const inline=file.kind==='image'||file.kind==='video';
    const safeName=file.originalName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
    const disposition=`${inline?'inline':'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
    const headers={'Content-Type':file.mime==='application/octet-stream'?'application/octet-stream':file.mime,
      'Content-Disposition':disposition,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'};
    const range=req.headers.range;
    if(range) {const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return error(res,416,'Intervalo inválido.');let start=m[1]?Number(m[1]):0,end=m[2]?Number(m[2]):stat.size-1;
      if(!m[1]&&m[2]){start=Math.max(0,stat.size-Number(m[2]));end=stat.size-1;}
      if(start>=stat.size||start>end)return error(res,416,'Intervalo inválido.');
      end=Math.min(end,stat.size-1);
      res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`});
      return fs.createReadStream(filepath,{start,end}).pipe(res);
    }
    res.writeHead(200,{...headers,'Content-Length':stat.size});
    return fs.createReadStream(filepath).pipe(res);
  }
  const audioMatch=p.match(/^\/api\/audio\/([0-9a-f-]{36})$/);
  if(method==='GET'&&audioMatch) {
    const a=db.audios.find(a=>a.id===audioMatch[1]); if(!a||!member(u.id,a.roomId)) return error(res,404,'Áudio não encontrado.');
    const filepath=path.join(AUDIO,a.filename); let stat; try{stat=await fsp.stat(filepath);}catch{return error(res,404,'Áudio indisponível.');}
    const range=req.headers.range;
    if(range){ const m=/^bytes=(\d*)-(\d*)$/.exec(range); if(!m)return error(res,416,'Intervalo inválido.'); let start=m[1]?Number(m[1]):0,end=m[2]?Number(m[2]):stat.size-1; if(!m[1]&&m[2]) { start=Math.max(0,stat.size-Number(m[2]));end=stat.size-1; } if(start>=stat.size||start>end) return error(res,416,'Intervalo inválido.'); end=Math.min(end,stat.size-1); res.writeHead(206,{'Content-Type':a.mime,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'}); return fs.createReadStream(filepath,{start,end}).pipe(res); }
    res.writeHead(200,{'Content-Type':a.mime,'Content-Length':stat.size,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'}); return fs.createReadStream(filepath).pipe(res);
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
server.listen(PORT,'0.0.0.0',()=>console.log(`VozChat ativo na porta ${PORT} | dados: ${DATA}`));