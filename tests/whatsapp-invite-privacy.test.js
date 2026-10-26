import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('convite por WhatsApp leva ao ID com confirmação, sem exigir telefone',()=>{
  const html=read('public/index.html'),app=read('public/app.js');
  for(const id of ['inviteWhatsApp','welcomeInviteWhatsApp','settingsInviteWhatsApp','copyPersonalInvite']){
    assert.match(html,new RegExp('id="'+id+'"'),'controle '+id);
  }
  assert.match(app,/https:\/\/wa\.me\/\?text=/);
  assert.match(app,/encodeURIComponent\(message\)/);
  assert.match(app,/new URL\('\/app',location\.origin\)/);
  assert.match(app,/link\.searchParams\.set\('add',String\(me\.publicId\)\)/);
  assert.match(app,/validAddContactParam/);
  assert.match(app,/openContactDialog\(addContactParam\)/);
  assert.match(app,/deferContactInviteUntilWelcome/);
  assert.match(app,/\[data-whatsapp-invite\]/);
  assert.match(app,/\$\('#contactForm'\)\.addEventListener\('submit'/);
  assert.doesNotThrow(()=>new Function(app),'app.js continua com sintaxe válida');
});

test('discrição oculta miniatura sem alegar bloqueio de prints no iPhone',()=>{
  const html=read('public/index.html'),css=read('public/premium.css'),app=read('public/app.js'),sw=read('public/sw.js');
  assert.match(html,/id="settingsHidePreview"/);
  assert.match(html,/id="privacyShield"/);
  assert.match(html,/não impede prints/i);
  assert.match(css,/\.privacy-shield\[hidden\]/);
  assert.match(css,/z-index:9999/);
  assert.match(app,/document\.visibilityState==='hidden'/);
  assert.match(app,/settingsHidePreview/);
  assert.match(app,/addEventListener\('visibilitychange',syncPrivacyShield\)/);
  assert.match(sw,/vozchat-shell-v37/);
});
