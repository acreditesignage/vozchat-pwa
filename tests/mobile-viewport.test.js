import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const worker=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('layout do iPhone sem zoom involuntário mantém a ampliação acessível',()=>{
  assert.match(html,/name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.doesNotMatch(html,/maximum-scale\s*=|user-scalable\s*=\s*no/i);
  const mobile=css.slice(css.indexOf('/* Estabilidade de viewport no iOS/Android'));
  assert.ok(mobile.startsWith('/* Estabilidade de viewport'), 'Regras de estabilização devem existir');
  assert.match(mobile,/touch-action:manipulation/);
  assert.match(mobile,/\.field input[\s\S]*?font-size:16px/);
  assert.match(mobile,/\.composer textarea[\s\S]*?font-size:16px/);
  assert.match(mobile,/\.search-wrap input[\s\S]*?font-size:16px/);
  assert.match(mobile,/\.dialog input:not\(\[type="checkbox"\]\)[\s\S]*?font-size:16px/);
  assert.match(mobile,/\.app\{[\s\S]*?height:100dvh/);
  assert.match(mobile,/\.room-list,\.messages\{[\s\S]*?overscroll-behavior-y:contain/);
  assert.match(mobile,/\.flowtalk-hold\.talking\{transform:none\}/);
  assert.doesNotMatch(mobile,/touch-action:\s*none\s*;/);
  assert.doesNotMatch(css,/position:fixed[^}]*\sbody\s*\{/);
  assert.match(worker,/vozchat-shell-v32/);
});
