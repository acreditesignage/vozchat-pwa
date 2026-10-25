import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createNeonBoard,newNeonGame,beginNeonGame,neonMove,viewNeonGame,NEON_WIDTH,NEON_HEIGHT} from '../public/neon-maze-engine.js';

const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});

test('Labirinto Neon original é conectado, tem luzes e movimentos validados',()=>{
 const maze=createNeonBoard(145);
 assert.equal(maze.board.length,NEON_HEIGHT);
 assert.ok(maze.board.every(row=>row.length===NEON_WIDTH));
 assert.ok(maze.pellets.length>30);
 assert.equal(maze.players.length,2);
 assert.equal(maze.ghosts.length,2);
 const visited=new Set(['1,1']),stack=[[1,1]];
 while(stack.length){
  const [x,y]=stack.pop();
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,ny=y+dy,k=nx+','+ny;
    if(maze.board[ny]?.[nx]!==' '||visited.has(k))continue;
    visited.add(k);stack.push([nx,ny]);
  }
 }
 for(let y=0;y<NEON_HEIGHT;y++)for(let x=0;x<NEON_WIDTH;x++)
   if(maze.board[y][x]===' ')assert.ok(visited.has(x+','+y),'Acessível: '+x+','+y);
 const game=newNeonGame('abc','room',['a','b'],'a',145);
 assert.equal(game.status,'pending');
 beginNeonGame(game);assert.equal(game.status,'active');
 assert.equal(neonMove(game,'c','down',1000).code,403);
 assert.equal(neonMove(game,'a','hack',1000).code,400);
 assert.equal(neonMove(game,'a','left',1000).changed,false);
 const direction=game.board[1][2]===' '?'right':'down';
 const moved=neonMove(game,'a',direction,1000);
 assert.equal(moved.changed,true);
 assert.equal(game.moves,1);
 assert.ok(game.score>=0);
 assert.equal(neonMove(game,'a','left',1050).changed,false,'Respeita limite de frequência');
 const view=viewNeonGame(game,uid=>({name:uid==='a'?'Visitante':'Convidado'}));
 assert.equal(view.players[0].name,'Visitante');
 assert.equal(view.players[1].position.x,NEON_WIDTH-2);
 assert.equal('lastMove' in view,false,'Não expor mapa interno de frequência');
});

test('Labirinto Neon: convites, aceite, movimentos em 2 celulares e isolamento de perfis',async t=>{
 const PORT=await freePort(),DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vozchat-neon-'));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),
  env:{...process.env,DATA_DIR,PORT:String(PORT),DATABASE_URL:'',VOZCHAT_DATABASE_URL:'',
   VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:'',NODE_ENV:'test'},stdio:'pipe'});
 t.after(()=>{child.kill('SIGTERM');fs.rmSync(DATA_DIR,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+PORT;
 for(let i=0;i<110;i++){try{const res=await fetch(base+'/api/health');if(res.ok)break;}catch{}await new Promise(r=>setTimeout(r,40));}
 async function req(method,url,data,cookie){
  const response=await fetch(base+url,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
   body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const a=await req('POST','/api/register',{name:'Arco',password:'senha-segura-123'});
 const b=await req('POST','/api/register',{name:'Lua',password:'senha-segura-456'});
 const c=await req('POST','/api/register',{name:'Fora',password:'senha-segura-789'});
 assert.equal(a.status,201);assert.equal(b.status,201);
 const ca=a.cookie,cb=b.cookie,cc=c.cookie;
 const inviteContact=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},ca);
 const acceptContact=await req('POST','/api/contacts/requests/'+inviteContact.data.request.id+'/accept',{},cb);
 const roomId=acceptContact.data.room.id;
 assert.equal((await req('GET','/api/play/neon/room/'+roomId,null,ca)).data.game,null);
 assert.equal((await req('GET','/api/play/neon/room/'+roomId,null,cc)).status,403);
 assert.equal((await req('POST','/api/play/neon/invite',{roomId},cc)).status,403);
 const invite=await req('POST','/api/play/neon/invite',{roomId},ca);
 assert.equal(invite.status,201);
 const id=invite.data.game.id;
 assert.equal(invite.data.game.status,'pending');
 assert.equal(invite.data.game.board.length,NEON_HEIGHT);
 assert.equal((await req('POST','/api/play/neon/invite',{roomId},ca)).status,409);
 assert.equal((await req('POST','/api/play/neon/'+id+'/accept',{},ca)).status,403);
 assert.equal((await req('POST','/api/play/neon/'+id+'/accept',{},cc)).status,403);
 assert.equal((await req('POST','/api/play/neon/'+id+'/move',{direction:'down'},ca)).status,409);
 const accept=await req('POST','/api/play/neon/'+id+'/accept',{},cb);
 assert.equal(accept.status,200);assert.equal(accept.data.game.status,'active');
 assert.equal((await req('POST','/api/play/neon/'+id+'/move',{direction:'bad'},ca)).status,400);
 assert.equal((await req('POST','/api/play/neon/'+id+'/move',{direction:'left'},ca)).status,200);
 const direction=accept.data.game.board[1][2]===' '?'right':'down';
 const moved=await req('POST','/api/play/neon/'+id+'/move',{direction},ca);
 assert.equal(moved.status,200);
 assert.ok(moved.data.game.moves>=1);
 const directionB=accept.data.game.board[NEON_HEIGHT-2][NEON_WIDTH-3]===' '?'left':'up';
 const movedB=await req('POST','/api/play/neon/'+id+'/move',{direction:directionB},cb);
 assert.equal(movedB.status,200);assert.ok(movedB.data.game.moves>=2);
 assert.equal((await req('POST','/api/play/neon/'+id+'/move',{direction:'up'},cc)).status,403);
 const fromOtherPhone=await req('GET','/api/play/neon/room/'+roomId,null,cb);
 assert.equal(fromOtherPhone.data.game.id,id);
 assert.equal(fromOtherPhone.data.game.moves,movedB.data.game.moves);
 const messages=await req('GET','/api/rooms/'+roomId+'/messages',null,cb);
 assert.equal(messages.status,200);
 assert.ok(messages.data.messages.some(message=>message.type==='maze'&&message.mazeId===id));
 const stopped=await req('POST','/api/play/neon/'+id+'/quit',{},cb);
 assert.equal(stopped.status,200);assert.equal(stopped.data.game.status,'abandoned');
 assert.equal((await req('POST','/api/play/neon/'+id+'/move',{direction:'up'},ca)).status,409);
 const again=await req('POST','/api/play/neon/invite',{roomId},cb);
 assert.equal(again.status,201);
 assert.equal((await req('POST','/api/play/neon/'+again.data.game.id+'/cancel',{},ca)).status,403);
 assert.equal((await req('POST','/api/play/neon/'+again.data.game.id+'/cancel',{},cb)).status,200);
 const pro=await req('POST','/api/identities',{label:'Profissional',name:'Arco Trabalho'},ca);
 assert.equal(pro.status,201);
 assert.equal((await req('POST','/api/identities/'+pro.data.profile.id+'/activate',{},ca)).status,200);
 assert.equal((await req('GET','/api/play/neon/room/'+roomId,null,ca)).status,403);
 const proContact=await req('POST','/api/contacts/add',{publicId:b.data.user.publicId},ca);
 const proAccept=await req('POST','/api/contacts/requests/'+proContact.data.request.id+'/accept',{},cb);
 assert.equal(proAccept.status,200);
 assert.equal((await req('POST','/api/play/neon/invite',{roomId:proAccept.data.room.id},cb)).status,403);
 const store=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'database.json'),'utf8'));
 assert.ok(store.neonGames.length>=2);
});

test('Seletor no chat, painel móvel e código do labirinto estão integrados',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const client=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../public/neon-maze-ui.js',import.meta.url),'utf8');
 const css=fs.readFileSync(new URL('../public/premium.css',import.meta.url),'utf8');
 for(const id of ['playChooser','chooseNeonMaze','chooseTicTacToe','neonPanel','neonCanvas','neonActions'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(client,/addEventListener\('neon-update'/);
 assert.match(client,/function renderPlayPanel\(/);
 assert.match(ui,/data-neon-dir/);
 assert.match(css,/\.neon-pad/);
 assert.doesNotThrow(()=>new Function(ui.replace(/^export /gm,'')));
});
