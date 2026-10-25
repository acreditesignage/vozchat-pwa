// Motor original do Labirinto Neon. Não utiliza personagens ou artes de jogos licenciados.
// Fonte única de regras: validação e colisões sempre executadas no servidor.
export const NEON_WIDTH=17,NEON_HEIGHT=13;
const STEP={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const idx=(x,y)=>y*NEON_WIDTH+x;
const nowISO=()=>new Date().toISOString();
export function createNeonBoard(seed=157){
  let rnd=(seed>>>0)||1;
  const random=n=>{rnd=(Math.imul(rnd,1664525)+1013904223)>>>0;return rnd%n;};
  const grid=Array.from({length:NEON_HEIGHT},()=>Array(NEON_WIDTH).fill('#'));
  const visit=new Set(['1,1']),stack=[[1,1]];
  grid[1][1]=' ';
  while(stack.length){
    const [x,y]=stack[stack.length-1];
    const choices=[[0,-2],[2,0],[0,2],[-2,0]].map(([dx,dy])=>[x+dx,y+dy,dx,dy])
      .filter(([nx,ny])=>nx>0&&ny>0&&nx<NEON_WIDTH-1&&ny<NEON_HEIGHT-1&&!visit.has(nx+','+ny));
    if(!choices.length){stack.pop();continue;}
    const [nx,ny,dx,dy]=choices[random(choices.length)];
    grid[y+dy/2][x+dx/2]=' ';grid[ny][nx]=' ';
    visit.add(nx+','+ny);stack.push([nx,ny]);
  }
  for(let i=0;i<16;i++){
    const x=2+random(NEON_WIDTH-4),y=2+random(NEON_HEIGHT-4);
    if(grid[y][x]!=='#')continue;
    if((grid[y][x-1]===' '&&grid[y][x+1]===' ')||(grid[y-1][x]===' '&&grid[y+1][x]===' '))
      grid[y][x]=' ';
  }
  const board=grid.map(row=>row.join(''));
  const starts=[[1,1],[NEON_WIDTH-2,NEON_HEIGHT-2]];
  const free=[];
  for(let y=1;y<NEON_HEIGHT-1;y++)for(let x=1;x<NEON_WIDTH-1;x++)
    if(grid[y][x]===' '&&!starts.some(([sx,sy])=>sx===x&&sy===y))free.push(idx(x,y));
  // Drones iniciam em pontos distantes de ambos os jogadores.
  const ghostSpawns=[free[Math.floor(free.length*.43)],free[Math.floor(free.length*.73)]];
  const powers=[free[Math.floor(free.length*.13)],free[Math.floor(free.length*.89)]];
  const pellets=free.filter(v=>!powers.includes(v)&&!ghostSpawns.includes(v));
  return {board,players:starts.map(([x,y],i)=>({x,y,direction:i?'left':'right',safeUntil:0})),
    ghostSpawns,ghosts:ghostSpawns.map((v,i)=>({x:v%NEON_WIDTH,y:Math.floor(v/NEON_WIDTH),seed:i})),
    pellets,powers};
}
export function beginNeonGame(game){
  game.status='active';game.updatedAt=nowISO();
  return game;
}
export function neonMove(game,uid,direction,at=Date.now()){
  if(game.status!=='active')return {error:'A partida não está ativa.',code:409};
  if(!Object.hasOwn(STEP,direction))return {error:'Direção inválida.',code:400};
  const i=game.users.indexOf(uid);
  if(i<0)return {error:'Jogador não participa desta partida.',code:403};
  const last=game.lastMove?.[uid]||0;
  if(at-last<130)return {changed:false};
  const player=game.players[i],[dx,dy]=STEP[direction];
  const x=player.x+dx,y=player.y+dy;
  if(x<0||y<0||x>=NEON_WIDTH||y>=NEON_HEIGHT||game.board[y][x]==='#')
    return {changed:false};
  game.lastMove ||= {};game.lastMove[uid]=at;
  player.x=x;player.y=y;player.direction=direction;
  game.moves=(game.moves||0)+1;
  const cell=idx(x,y);
  const dot=game.pellets.indexOf(cell);
  if(dot>=0){game.pellets.splice(dot,1);game.score+=10;}
  const power=game.powers.indexOf(cell);
  if(power>=0){game.powers.splice(power,1);game.score+=50;game.powerUntil=game.moves+22;}
  if(game.pellets.length===0&&game.powers.length===0){
    game.status='won';game.finishedAt=nowISO();game.updatedAt=game.finishedAt;return {changed:true};
  }
  if(game.moves%3===0)moveNeonDrones(game);
  neonCollisions(game);
  game.updatedAt=nowISO();
  return {changed:true};
}
function moveNeonDrones(game){
  for(const ghost of game.ghosts){
    const targets=game.players.filter(Boolean);
    const possible=Object.values(STEP).map(([dx,dy])=>({x:ghost.x+dx,y:ghost.y+dy}))
      .filter(p=>game.board[p.y]?.[p.x]===' ');
    if(!possible.length)continue;
    // Perseguidores simples, desempate determinístico por turno para evitar bloqueio.
    const target=targets[(game.moves+ghost.seed)%targets.length];
    possible.sort((a,b)=>
      (Math.abs(a.x-target.x)+Math.abs(a.y-target.y))-
      (Math.abs(b.x-target.x)+Math.abs(b.y-target.y))||
      ((a.x+a.y+game.moves+ghost.seed)%3)-((b.x+b.y+game.moves+ghost.seed)%3));
    ghost.x=possible[0].x;ghost.y=possible[0].y;
  }
}
function neonCollisions(game){
  for(let i=0;i<game.players.length;i++){
    const player=game.players[i];
    const ghost=game.ghosts.find(ghost=>ghost.x===player.x&&ghost.y===player.y);
    if(!ghost)continue;
    if((game.powerUntil||0)>=game.moves){
      game.score+=80;
      const spawn=game.ghostSpawns[ghost.seed];
      ghost.x=spawn%NEON_WIDTH;ghost.y=Math.floor(spawn/NEON_WIDTH);
      continue;
    }
    if(player.safeUntil>game.moves)continue;
    game.lives=Math.max(0,game.lives-1);
    const [sx,sy]=i===0?[1,1]:[NEON_WIDTH-2,NEON_HEIGHT-2];
    player.x=sx;player.y=sy;player.safeUntil=game.moves+8;
    if(!game.lives){game.status='lost';game.finishedAt=nowISO();break;}
  }
}
export function newNeonGame(id,roomId,users,inviterId,seed=Date.now()){
  const maze=createNeonBoard(seed);
  const now=nowISO();
  return {id,roomId,users,inviterId,kind:'neon-maze',status:'pending',score:0,lives:3,moves:0,
    powerUntil:0,lastMove:{},createdAt:now,updatedAt:now,...maze};
}
export function viewNeonGame(game,userLookup){
  return {id:game.id,roomId:game.roomId,kind:'neon-maze',status:game.status,
    inviterId:game.inviterId,score:game.score,lives:game.lives,moves:game.moves,
    powerUntil:game.powerUntil,board:game.board,players:game.users.map((uid,i)=>({
      id:uid,name:userLookup(uid)?.name||'Jogador',position:game.players[i]
    })),ghosts:game.ghosts,pellets:game.pellets,powers:game.powers,
    createdAt:game.createdAt,updatedAt:game.updatedAt};
}
