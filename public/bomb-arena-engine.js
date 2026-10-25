// Arena Bomba: jogo arcade original, autoritativo no servidor.
// Mapa 13x11: pedra (#), caixas (+), piso (espaço). Sem sprites licenciados.
export const BW=13,BH=11;
const DIR={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const index=(x,y)=>y*BW+x;
const key=(x,y)=>x+','+y;
const WAIT=145,BOMB_MS=2300,FIRE_MS=720;
const startPos=[[1,1],[BW-2,BH-2]];
const safeSpawn=(x,y)=>startPos.some(([a,b])=>(Math.abs(a-x)+Math.abs(b-y)<=2));
const stamp=t=>new Date(t).toISOString();
export function createArena(seed=12345){
 let state=(seed>>>0)||1;
 const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const cells=[];
 for(let y=0;y<BH;y++)for(let x=0;x<BW;x++){
  let type=' ';
  if(x===0||y===0||x===BW-1||y===BH-1||(x%2===0&&y%2===0))type='#';
  else if(!safeSpawn(x,y)&&rand()<.69)type='+';
  cells.push(type);
 }
 // Garantir rotas de saída e espaço central conectado.
 for(const [x,y] of [[1,2],[2,1],[BW-2,BH-3],[BW-3,BH-2],[6,5]])cells[index(x,y)]=' ';
 return cells;
}
export function createBombGame(id,roomId,users,inviterId,seed=Date.now(),now=Date.now()){
 return {id,roomId,users,inviterId,kind:'bomb',status:'pending',createdAt:stamp(now),updatedAt:stamp(now),
  lastPlayerAt:stamp(now),winner:null,tiles:createArena(seed),
  fighters:startPos.map(([x,y])=>({x,y,alive:true,dir:'down',lastMoveAt:0,shieldUntil:0})),
  bombs:[],flames:[],turn:0};
}
export function bombView(game,lookup=()=>null){
 return {id:game.id,roomId:game.roomId,kind:'bomb',status:game.status,createdAt:game.createdAt,
   updatedAt:game.updatedAt,inviterId:game.inviterId,winner:game.winner,
   tiles:game.tiles,fighters:game.users.map((uid,i)=>({id:uid,name:lookup(uid)?.name||'Jogador',
     ...game.fighters[i]})),bombs:game.bombs,flames:game.flames,turn:game.turn};
}
export function startBombGame(game,now=Date.now()){
 if(game.status!=='pending')return false;
 game.status='active';game.updatedAt=stamp(now);game.lastPlayerAt=stamp(now);
 game.fighters.forEach(p=>{p.shieldUntil=now+1200;});
 return true;
}
function finish(game,now){
 const alive=game.fighters.map((p,i)=>p.alive?i:-1).filter(i=>i>=0);
 if(alive.length>=2)return;
 game.status=alive.length?'won':'draw';
 game.winner=alive.length?game.users[alive[0]]:null;
 game.finishedAt=stamp(now);game.updatedAt=stamp(now);
}
function hit(game,x,y,now){
 for(const p of game.fighters)if(p.alive&&p.x===x&&p.y===y&&now>=p.shieldUntil)p.alive=false;
}
function explode(game,origin,now){
 const queue=[origin],seen=new Set();
 while(queue.length){
  const bomb=queue.shift();if(!bomb||seen.has(bomb.id))continue;seen.add(bomb.id);
  game.bombs=game.bombs.filter(b=>b.id!==bomb.id);
  const squares=[{x:bomb.x,y:bomb.y}];
  for(const [dx,dy] of Object.values(DIR)){
   for(let n=1;n<=bomb.range;n++){
    const x=bomb.x+dx*n,y=bomb.y+dy*n,cell=game.tiles[index(x,y)];
    if(cell===undefined||cell==='#')break;
    squares.push({x,y});
    if(cell==='+'){game.tiles[index(x,y)]=' ';break;}
   }
  }
  for(const p of squares){
   game.flames.push({...p,until:now+FIRE_MS});
   hit(game,p.x,p.y,now);
   for(const other of game.bombs)if(other.x===p.x&&other.y===p.y)queue.push(other);
  }
 }
 finish(game,now);
}
export function tickBombGame(game,now=Date.now()){
 if(game.status!=='active')return false;
 let changed=false;
 const flames=game.flames.filter(f=>f.until>now);
 if(flames.length!==game.flames.length){game.flames=flames;changed=true;}
 const old=game.bombs.length;
 for(const bomb of [...game.bombs])if(bomb.expiresAt<=now){explode(game,bomb,now);changed=true;}
 if(old!==game.bombs.length)changed=true;
 const wasAlive=game.fighters.map(p=>p.alive);
 for(const p of game.fighters)if(p.alive&&game.flames.some(f=>f.x===p.x&&f.y===p.y))hit(game,p.x,p.y,now);
 if(game.fighters.some((p,i)=>p.alive!==wasAlive[i]))changed=true;
 finish(game,now);
 if(game.status!=='active')changed=true;
 if(changed){game.turn++;game.updatedAt=stamp(now);}
 return changed;
}
export function moveBombGame(game,uid,direction,now=Date.now()){
 if(game.status!=='active')return {code:409,error:'A partida não está ativa.'};
 if(!Object.hasOwn(DIR,direction))return {code:400,error:'Direção inválida.'};
 const i=game.users.indexOf(uid);if(i<0)return {code:403,error:'Jogador não autorizado.'};
 const p=game.fighters[i];if(!p.alive)return {code:409,error:'Você já foi eliminado.'};
 if(now-p.lastMoveAt<WAIT)return {changed:false};
 const [dx,dy]=DIR[direction],x=p.x+dx,y=p.y+dy;
 if(game.tiles[index(x,y)]!==' '||game.bombs.some(b=>b.x===x&&b.y===y))return {changed:false};
 p.x=x;p.y=y;p.dir=direction;p.lastMoveAt=now;
 game.lastPlayerAt=stamp(now);game.updatedAt=stamp(now);game.turn++;
 if(game.flames.some(f=>f.x===x&&f.y===y))hit(game,x,y,now);
 finish(game,now);
 return {changed:true};
}
export function placeBomb(game,uid,now=Date.now()){
 if(game.status!=='active')return {code:409,error:'A partida não está ativa.'};
 const i=game.users.indexOf(uid);if(i<0)return {code:403,error:'Jogador não autorizado.'};
 const p=game.fighters[i];if(!p.alive)return {code:409,error:'Você foi eliminado.'};
 if(game.bombs.some(b=>b.owner===uid))return {code:409,error:'Aguarde sua bomba explodir.'};
 if(game.bombs.some(b=>b.x===p.x&&b.y===p.y))return {code:409,error:'Já existe uma bomba aqui.'};
 const bomb={id:(game.turn+1)+'-'+i,x:p.x,y:p.y,owner:uid,range:2,expiresAt:now+BOMB_MS};
 game.bombs.push(bomb);game.lastPlayerAt=stamp(now);game.updatedAt=stamp(now);game.turn++;
 return {changed:true};
}
