import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BW,POWERUPS,createBombGame,bombView,startBombGame,tickBombGame,moveBombGame,placeBomb} from '../public/bomb-arena-engine.js';
import {chooseBombBotAction} from '../public/bomb-solo-bot.js';

function reveal(kind){
  const game=createBombGame('id-'+kind,'room',['ana','bia'],'ana',2026,2000);
  game.tiles[BW+3]='+';
  game.hiddenPowerups={'3,1':kind};
  startBombGame(game,2000); // invulnerabilidade do spawn até 3200
  game.bombs.push({id:'forced',owner:'ana',x:2,y:1,range:2,expiresAt:3000});
  tickBombGame(game,3000);
  assert.equal(game.status,'active');
  assert.equal(game.tiles[BW+3],' ');
  assert.deepEqual(game.powerups,[{x:3,y:1,kind}]);
  assert.equal(Object.hasOwn(game.hiddenPowerups,'3,1'),false);
  assert.equal(Object.hasOwn(bombView(game),'hiddenPowerups'),false);
  tickBombGame(game,3800);
  assert.equal(moveBombGame(game,'ana','right',3850).changed,true);
  assert.equal(moveBombGame(game,'ana','right',4100).changed,true);
  assert.deepEqual(game.powerups,[]);
  return game;
}

test('Poderes surgem somente depois de destruir caixas e não vazam ocultos pela API',()=>{
 const game=createBombGame('g','r',['a','b'],'a',2468,1000);
 assert.ok(Object.keys(game.hiddenPowerups).length>0);
 assert.ok(Object.values(game.hiddenPowerups).every(kind=>POWERUPS.includes(kind)));
 assert.deepEqual(game.powerups,[]);
 const publicGame=bombView(game);
 assert.deepEqual(publicGame.powerups,[]);
 assert.equal('hiddenPowerups' in publicGame,false);
 assert.equal('hiddenPowerups' in publicGame.fighters[0],false);
 for(const kind of POWERUPS)assert.ok(reveal(kind));
});

test('Bomba extra acumula até o limite e explosões não precisam decrementar contador manual',()=>{
 const game=reveal('bomb');
 const fighter=game.fighters[0];
 assert.equal(fighter.bombLimit,2);
 assert.equal(placeBomb(game,'ana',4300).changed,true);
 assert.equal(moveBombGame(game,'ana','left',4550).changed,true);
 assert.equal(placeBomb(game,'ana',4570).changed,true);
 assert.equal(game.bombs.filter(b=>b.owner==='ana').length,2);
 assert.equal(placeBomb(game,'ana',4580).code,409);
 tickBombGame(game,7000);
 assert.equal(game.bombs.filter(b=>b.owner==='ana').length,0);
});

test('Alcance e velocidade melhoram os atributos usados nas próximas jogadas',()=>{
 const range=reveal('range');
 assert.equal(range.fighters[0].range,3);
 assert.equal(placeBomb(range,'ana',4300).changed,true);
 assert.equal(range.bombs[0].range,3);
 const speed=reveal('speed');
 assert.equal(speed.fighters[0].moveDelay,130);
 assert.equal(moveBombGame(speed,'ana','left',4235).changed,true,'Intervalo de 135 ms autorizado somente com velocidade');
});

test('Escudo absorve uma explosão e concede janela curta contra labaredas',()=>{
 const game=reveal('shield'),player=game.fighters[0];
 assert.equal(player.shieldHits,1);
 player.x=2;player.y=1;player.shieldUntil=0;
 game.bombs=[{id:'shield-first',owner:'bia',x:2,y:1,range:1,expiresAt:9000}];
 tickBombGame(game,9000);
 assert.equal(player.alive,true);assert.equal(player.shieldHits,0);
 assert.equal(player.shieldUntil,9950);
 tickBombGame(game,9200);
 assert.equal(player.alive,true);
 game.bombs.push({id:'shield-second',owner:'bia',x:2,y:1,range:1,expiresAt:10500});
 tickBombGame(game,10500);
 assert.equal(player.alive,false);assert.equal(game.winner,'bia');
});

test('CPU procura poderes revelados e não escolhe bomba no lugar de melhoria próxima',()=>{
 const game=createBombGame('s','solo',['solo','cpu'],'solo',157,1000);
 startBombGame(game,1000);
 const bot=game.fighters[1];bot.x=3;bot.y=3;
 for(const i of [2,3,4])game.tiles[i*BW+3]=' ';
 game.tiles[3*BW+2]=' ';game.tiles[3*BW+4]=' ';
 game.powerups=[{x:4,y:3,kind:'speed'}];
 const action=chooseBombBotAction(game,2000,()=>0);
 assert.deepEqual(action,{type:'move',direction:'right'});
});

test('Interface mostra os quatro poderes e restringe zoom iOS apenas ao painel de jogo',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const ui=read('public/bomb-arena-ui.js');
 const css=read('public/premium.css');
 const html=read('public/index.html');
 const sw=read('public/sw.js');
 for(const icon of ['💣','🔥','⚡','🛡️'])assert.ok(ui.includes(icon));
 assert.match(ui,/game\.powerups\|\|\[\]/);
 assert.match(ui,/myself\.bombLimit\|\|1/);
 assert.match(ui,/panel\.addEventListener\('gesturestart'/);
 assert.match(ui,/panel\.addEventListener\('dblclick'/);
 assert.match(css,/#bombPanel\.game-fullscreen\{\s*touch-action:manipulation!important/);
 assert.match(css,/#bombPanel\.game-fullscreen \.bomb-drop/);
 assert.match(css,/touch-action:none!important/);
 assert.doesNotMatch(html,/user-scalable\s*=\s*(?:no|0)/i);
 assert.match(sw,/vozchat-shell-v36/);
 assert.doesNotThrow(()=>new Function(ui));
});
