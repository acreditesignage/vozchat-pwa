import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Labirinto multiplayer abre fora do chat e fecha limpando modo de tela cheia',()=>{
  const js=read('public/neon-maze-ui.js');
  assert.match(js,/document\.body\.append\(panel\)/);
  assert.match(js,/panel\.classList\.add\('game-fullscreen'\)/);
  assert.match(js,/document\.documentElement\.classList\.add\('vozchat-game-active'\)/);
  assert.match(js,/document\.documentElement\.classList\.remove\('vozchat-game-active'\)/);
  assert.match(js,/focused\.blur\(\)/);
  assert.match(js,/\$\('neonClose'\)\.addEventListener\('click',hideGame\)/);
  assert.match(js,/canvas\.addEventListener\('pointermove'/);
  assert.match(js,/button\.setPointerCapture\(event\.pointerId\)/);
  assert.match(js,/touchmove/);
  assert.match(js,/175/);
  assert.match(js,/navigator\.vibrate\?\.\(12\)/);
  assert.doesNotThrow(()=>new Function(js));
});

test('Jogo da Velha em tela própria e navegação nunca apaga mensagens',()=>{
  const js=read('public/app.js');
  assert.match(js,/panel\.classList\.add\('game-fullscreen'\)/);
  assert.match(js,/panel\.parentElement!==document\.body/);
  assert.match(js,/panel\.classList\.remove\('game-fullscreen'\)/);
  assert.match(js,/playPanelOpen=false;renderPlayPanel\(\)/);
  assert.match(js,/current=roomId;playHistory\.roomOpened\(roomId\)/);
  assert.doesNotThrow(()=>new Function(js));
});

test('Modo solo suporta swipe, botão segurado e tela cheia do iPhone',()=>{
  const js=read('public/play-solo.js'),css=read('public/premium.css');
  assert.match(js,/canvas\.addEventListener\('pointermove'/);
  assert.match(js,/button\.setPointerCapture\(event\.pointerId\)/);
  assert.match(js,/function startHold\(/);
  assert.match(js,/stopMovement\(\)/);
  assert.match(js,/event\.preventDefault\(\)/);
  assert.match(css,/#playSoloDialog\.play-solo-dialog/);
  assert.match(css,/height:100dvh!important/);
  assert.match(css,/env\(safe-area-inset-top\)/);
  assert.match(css,/\.play-solo-dpad button\.is-pressed/);
  assert.doesNotThrow(()=>new Function(js));
});

test('Somente a área do jogo cancela gestos e controles duplicados não poluem a conversa',()=>{
  const css=read('public/premium.css'),mobile=read('public/styles.css'),sw=read('public/sw.js');
  assert.match(css,/#chatPlayBar,\.chat-play-bar\{display:none!important\}/);
  assert.match(css,/#playButton\{display:none!important\}/);
  assert.match(css,/\.neon-panel\.game-fullscreen/);
  assert.match(css,/#neonCanvas[\s\S]*?touch-action:none!important/);
  assert.match(css,/\.neon-pad button\.is-pressed/);
  assert.match(css,/min-width:44px;min-height:44px/);
  assert.match(mobile,/\.composer textarea[\s\S]*?font-size:16px/);
  assert.doesNotMatch(css,/user-scalable\s*=\s*no/i);
  assert.match(sw,/vozchat-shell-v33/);
});
