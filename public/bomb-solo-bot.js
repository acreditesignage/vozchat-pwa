// IA local da Arena Bomba. O modo solo não usa dados nem salas de outros contatos.
import {BW,BH} from './bomb-arena-engine.js';
const dirs=[['up',0,-1],['right',1,0],['down',0,1],['left',-1,0]];
const cell=(x,y)=>y*BW+x;
const point=(x,y)=>x+','+y;

// O bot considera as explosões em cruz; bombas são obstáculos até detonarem.
export function bombDangerCells(game){
 const danger=new Set();
 for(const flame of game.flames||[])danger.add(point(flame.x,flame.y));
 for(const bomb of game.bombs||[]){
  danger.add(point(bomb.x,bomb.y));
  for(const [,dx,dy] of dirs){
   for(let n=1;n<=bomb.range;n++){
    const x=bomb.x+dx*n,y=bomb.y+dy*n,tile=game.tiles[cell(x,y)];
    if(tile===undefined||tile==='#')break;
    danger.add(point(x,y));
    if(tile==='+')break;
   }
  }
 }
 return danger;
}

export function chooseBombBotAction(game,now=Date.now(),random=Math.random){
 if(game.status!=='active')return null;
 const bot=game.fighters[1],player=game.fighters[0];
 if(!bot?.alive)return null;
 const danger=bombDangerCells(game);
 const threatened=danger.has(point(bot.x,bot.y));
 const bombBlocked=(x,y)=>game.bombs.some(b=>b.x===x&&b.y===y);
 const options=dirs.map(([direction,dx,dy])=>({direction,x:bot.x+dx,y:bot.y+dy}))
  .filter(c=>game.tiles[cell(c.x,c.y)]===' '&&!bombBlocked(c.x,c.y));
 if(!options.length)return null;
 const safe=options.filter(c=>!danger.has(point(c.x,c.y)));
 if(threatened&&safe.length){
  safe.sort((a,b)=>{
   const dist=p=>game.bombs.reduce((sum,bomb)=>sum+Math.abs(p.x-bomb.x)+Math.abs(p.y-bomb.y),0);
   return dist(b)-dist(a);
  });
  return {type:'move',direction:safe[0].direction};
 }
 const owned=game.bombs.some(b=>b.owner===game.users[1]);
 const cratesNear=dirs.some(([,dx,dy])=>game.tiles[cell(bot.x+dx,bot.y+dy)]==='+');
 const playerNear=player?.alive&&Math.abs(player.x-bot.x)+Math.abs(player.y-bot.y)<=3;
 const chance=random();
 // Bomba apenas se houver caminho livre para escapar.
 if(!owned&&!threatened&&safe.length>0&&(cratesNear||playerNear)&&chance<.38)
  return {type:'place'};
 const candidates=safe.length?safe:options;
 const targets=[];
 if(player?.alive)targets.push({x:player.x,y:player.y});
 for(let y=1;y<BH-1;y++)for(let x=1;x<BW-1;x++)if(game.tiles[cell(x,y)]==='+')
  targets.push({x,y});
 // Direciona-se para áreas que possam liberar caixas e alcançar o adversário.
 const goal=targets.sort((a,b)=>{
  const d=p=>Math.abs(bot.x-p.x)+Math.abs(bot.y-p.y);
  return d(a)-d(b);
 })[0];
 const scored=candidates.map(c=>({direction:c.direction,score:
   (goal?-(Math.abs(c.x-goal.x)+Math.abs(c.y-goal.y)):0)+random()*2.5
   -(danger.has(point(c.x,c.y))?15:0)
   -(game.flames.some(f=>f.x===c.x&&f.y===c.y)?20:0)
 }));
 scored.sort((a,b)=>b.score-a.score);
 return {type:'move',direction:scored[0].direction};
}
