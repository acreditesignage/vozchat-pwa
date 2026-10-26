import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBombGame,startBombGame,BW} from '../public/bomb-arena-engine.js';
import {bombDangerCells,chooseBombBotAction} from '../public/bomb-solo-bot.js';

test('Arena Bomba tem modo individual e o computador pode se movimentar',()=>{
 const game=createBombGame('solo','solo',['solo','cpu'],'solo',157,1000);
 assert.equal(startBombGame(game,1000),true);
 const action=chooseBombBotAction(game,1100,()=>0.95);
 assert.ok(action,'O bot não pode ficar parado na primeira jogada');
 assert.ok(['move','place'].includes(action.type));
 if(action.type==='move')assert.ok(['up','down','left','right'].includes(action.direction));
});

test('CPU respeita as paredes, o risco das bombas e coloca bomba perto de caixas',()=>{
 const game=createBombGame('solo','solo',['solo','cpu'],'solo',157,1000);
 startBombGame(game,1000);
 game.fighters[1].x=3;game.fighters[1].y=3;
 game.tiles[3*BW+4]='+';
 game.tiles[3*BW+2]=' ';
 game.tiles[2*BW+3]=' ';
 game.tiles[4*BW+3]=' ';
 const action=chooseBombBotAction(game,1100,()=>0);
 assert.deepEqual(action,{type:'place'});
 game.bombs.push({id:'b',x:3,y:3,range:2,owner:'cpu',expiresAt:3100});
 game.tiles[3*BW+4]='#';
 const danger=bombDangerCells(game);
 assert.ok(danger.has('3,3'));
 assert.ok(!danger.has('4,3'),'Parede não pode transmitir explosão');
 assert.equal(chooseBombBotAction({...game,status:'won'},1200,()=>0),null);
});

test('Botão Jogar sozinho da Arena Bomba está ligado ao modo solo real, sem exigir contato',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const hub=readFileSync(new URL('../public/play-history.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/bomb-arena-ui.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
 assert.match(html,/id="playHubSoloBomb"[^>]*>▶ Jogar sozinho/);
 assert.match(html,/id="playHubDuoBomb"[^>]*>👥 Com contato/);
 assert.ok(html.indexOf('id="playHubSoloBomb"')<html.indexOf('id="playHubDuoBomb"'));
 assert.match(hub,/\$\('playHubSoloBomb'\)\.addEventListener/);
 assert.match(hub,/void openBombSolo\(\)/);
 assert.match(app,/openBombSolo:async\(\)=>/);
 assert.match(app,/bombPlay\.openSolo\(\)/);
 assert.match(ui,/async function openSolo\(/);
 assert.match(ui,/newSoloRound\(/);
 assert.match(ui,/import\('\/bomb-solo-bot\.js'\)/);
 assert.match(ui,/soloEngine\.placeBomb\(soloGame,'solo'\)/);
 assert.match(ui,/soloEngine\.moveBombGame\(soloGame,'solo',direction\)/);
 assert.match(sw,/vozchat-shell-v36/);
 assert.match(sw,/\/bomb-solo-bot\.js/);
 assert.doesNotThrow(()=>new Function(hub));
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(app));
});
