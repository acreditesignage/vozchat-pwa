// Arena Bomba · multiplayer pelo VozChat. Apenas renderiza; servidor valida as jogadas.
function createBombArena({api,toast,getMe,getRoom}){
 const $=id=>document.getElementById(id),panel=$('bombPanel'),canvas=$('bombCanvas');
 const ctx=canvas.getContext('2d'),status=$('bombStatus'),actions=$('bombActions');
 const score=$('bombScore'),pad=$('bombDpad'),bombButton=$('bombPlace');
 const W=13,H=11,C=36,OX=26,OY=22;
 let game=null,roomId=null,busy=false,moving=false,hold=null,dir=null,swipe=null;
 const uid=()=>getMe()?.id,allowed=()=>roomId===getRoom();
 function stop(){if(hold)clearInterval(hold);hold=null;dir=null;
  for(const b of pad.querySelectorAll('[data-bomb-dir]'))b.classList.remove('pressed');}
 function hide(){stop();panel.hidden=true;panel.classList.remove('game-fullscreen');
  document.documentElement.classList.remove('vozchat-game-active');}
 function show(){
  if(panel.parentElement!==document.body)document.body.append(panel);
  document.activeElement?.blur?.();
  panel.hidden=false;panel.classList.add('game-fullscreen');
  document.documentElement.classList.add('vozchat-game-active');draw();
 }
 function current(){return game&&game.fighters.some(f=>f.id===uid());}
 function view(next){
  if(!next||!allowed())return;
  if(game?.id===next.id&&game.turn>next.turn)return;
  game=next;draw();
 }
 function receive(next){
  if(!next||next.roomId!==getRoom())return;
  roomId=next.roomId;view(next);
 }
 function action(label,kind,primary=false){
  const b=document.createElement('button');b.type='button';b.textContent=label;
  if(primary)b.className='bomb-primary';b.disabled=busy;
  b.addEventListener('click',()=>void perform(kind));actions.append(b);
 }
 function draw(){
  if(panel.hidden)return;
  actions.replaceChildren();
  const active=game?.status==='active';
  const myself=game?.fighters?.find(f=>f.id===uid());
  score.textContent=game?'● '+game.fighters.map((f,i)=>(i===0?'Azul':'Rosa')+' '+(f.alive?'●':'×')).join('  ·  '):'Duas pessoas · uma arena';
  if(!game){status.textContent='Convide seu contato para a Arena Bomba.';action('Convidar para jogar','invite',true);}
  else if(game.status==='pending'){
   if(game.inviterId===uid()){status.textContent='Convite enviado, aguardando o contato…';action('Cancelar convite','cancel');}
   else{status.textContent='Seu contato convidou você!';action('Aceitar e jogar','accept',true);action('Recusar','decline');}
  }else if(active){status.textContent=myself?.alive?'Use o direcional e toque em 💣 para colocar a bomba.':'Você foi atingido. Aguardando resultado.';
   action('Encerrar partida','quit');
  }else{
   status.textContent=game.status==='won'?(game.winner===uid()?'🏆 Você venceu!':'Seu contato venceu.'):
     game.status==='draw'?'Empate!':game.status==='declined'?'Convite recusado.':
     game.status==='canceled'?'Convite cancelado.':game.status==='abandoned'?'Partida encerrada.':'Partida expirada.';
   action('▶ Nova partida','invite',true);
  }
  for(const b of pad.querySelectorAll('[data-bomb-dir]'))b.disabled=!active||!myself?.alive;
  bombButton.disabled=!active||!myself?.alive||busy;
  ctx.clearRect(0,0,520,440);
  const bg=ctx.createLinearGradient(0,0,520,440);
  bg.addColorStop(0,'#061327');bg.addColorStop(1,'#10193b');
  ctx.fillStyle=bg;ctx.fillRect(0,0,520,440);
  if(!game){
   ctx.fillStyle='#77c8ff';ctx.textAlign='center';ctx.font='bold 28px system-ui';
   ctx.fillText('💣 ARENA BOMBA',260,195);ctx.font='15px system-ui';
   ctx.fillStyle='#d4e6ff';ctx.fillText('Dois jogadores · Um vencedor',260,228);return;
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const left=OX+x*C,top=OY+y*C,tile=game.tiles[y*W+x];
   ctx.fillStyle=(x+y)%2?'#102544':'#10213d';
   ctx.fillRect(left,top,C,C);
   if(tile==='#'){
    const g=ctx.createLinearGradient(left,top,left+C,top+C);
    g.addColorStop(0,'#456eae');g.addColorStop(1,'#142d5f');
    ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(left+2,top+2,C-4,C-4,5);ctx.fill();
    ctx.strokeStyle='#6995df';ctx.lineWidth=1.4;ctx.stroke();
    ctx.fillStyle='#cce8ff55';ctx.fillRect(left+6,top+5,C-12,3);
   }else if(tile==='+'){
    const g=ctx.createLinearGradient(left,top,left+C,top+C);
    g.addColorStop(0,'#c68f5c');g.addColorStop(1,'#784567');
    ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(left+3,top+3,C-6,C-6,5);ctx.fill();
    ctx.strokeStyle='#ffd6a0';ctx.lineWidth=1;ctx.stroke();
    ctx.strokeStyle='#533c4d';ctx.beginPath();ctx.moveTo(left+8,top+8);ctx.lineTo(left+C-8,top+C-8);
    ctx.moveTo(left+C-8,top+8);ctx.lineTo(left+8,top+C-8);ctx.stroke();
   }else{
    ctx.fillStyle='#223a6155';ctx.beginPath();ctx.arc(left+C/2,top+C/2,2,0,Math.PI*2);ctx.fill();
   }
  }
  for(const f of game.flames||[]){
   const cx=OX+(f.x+.5)*C,cy=OY+(f.y+.5)*C;
   ctx.fillStyle='#ff893c';ctx.shadowColor='#ffd85f';ctx.shadowBlur=18;
   ctx.beginPath();ctx.roundRect(cx-15,cy-10,30,20,9);ctx.fill();
   ctx.fillStyle='#fffac0';ctx.beginPath();ctx.roundRect(cx-8,cy-6,16,12,6);ctx.fill();ctx.shadowBlur=0;
  }
  for(const bomb of game.bombs||[]){
   const cx=OX+(bomb.x+.5)*C,cy=OY+(bomb.y+.5)*C;
   ctx.save();ctx.translate(cx,cy);ctx.shadowColor='#ee91ff';ctx.shadowBlur=11;
   const g=ctx.createRadialGradient(-5,-5,2,0,0,17);
   g.addColorStop(0,'#c4c4ff');g.addColorStop(.4,'#313e78');g.addColorStop(1,'#101b3c');
   ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,3,13,0,Math.PI*2);ctx.fill();
   ctx.strokeStyle='#c4caff';ctx.lineWidth=2;ctx.stroke();
   ctx.strokeStyle='#ffc770';ctx.beginPath();ctx.moveTo(4,-11);ctx.lineTo(7,-18);ctx.stroke();
   ctx.fillStyle='#ffdb73';ctx.beginPath();ctx.arc(7,-18,3,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  for(const [i,p] of (game.fighters||[]).entries()){
   const art=window.VozChatArcadeArt?.drawHero,x=OX+(p.x+.5)*C,y=OY+(p.y+.5)*C;
   if(art)art(ctx,x,y,17,i?'#ff91d1':'#60e9fb',p.dir,p.alive);
   else{ctx.fillStyle=i?'#ff91d1':'#60e9fb';ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();}
   if(p.id===uid()&&p.alive){ctx.strokeStyle='#ffffffc0';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,19,0,Math.PI*2);ctx.stroke();}
  }
 }
 async function perform(kind,direction){
  if(!allowed()||busy)return;
  if(kind==='quit'&&!confirm('Encerrar a partida para os dois jogadores?'))return;
  const rid=roomId;busy=true;
  try{
   const endpoint=kind==='invite'?'/api/play/bomb/invite':'/api/play/bomb/'+game?.id+'/'+kind;
   const result=await api(endpoint,{method:'POST',data:kind==='invite'?{roomId:rid}:kind==='move'?{direction}:{}});
   if(rid!==getRoom())return;
   view(result.game);
   if(kind==='invite')toast('💣 Convite da Arena Bomba enviado!');
  }catch(err){if(kind!=='move'&&kind!=='place')toast(err.message||'Não foi possível jogar.');}
  finally{busy=false;draw();}
 }
 async function move(direction){
  if(!game||game.status!=='active'||moving||!current()||panel.hidden)return;
  moving=true;
  const id=game.id,rid=roomId;
  try{const res=await api('/api/play/bomb/'+id+'/move',{method:'POST',data:{direction}});
   if(rid===getRoom()&&game?.id===id)view(res.game);
  }catch(err){/* Movimento bloqueado pelo servidor. */}
  finally{moving=false;}
 }
 function begin(direction){
  if(panel.hidden||game?.status!=='active')return;
  stop();dir=direction;
  pad.querySelector('[data-bomb-dir="'+direction+'"]')?.classList.add('pressed');
  try{navigator.vibrate?.(9);}catch{}
  void move(direction);
  hold=setInterval(()=>{if(dir===direction)void move(direction);},175);
 }
 for(const b of pad.querySelectorAll('[data-bomb-dir]')){
  b.addEventListener('pointerdown',e=>{if(b.disabled)return;e.preventDefault();
   try{b.setPointerCapture(e.pointerId);}catch{}begin(b.dataset.bombDir);});
  b.addEventListener('pointerup',stop);b.addEventListener('pointercancel',stop);
  b.addEventListener('lostpointercapture',stop);
 }
 const keys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',a:'left',s:'down',d:'right'};
 document.addEventListener('keydown',e=>{
  if(panel.hidden||e.repeat||!keys[e.key]||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  e.preventDefault();begin(keys[e.key]);
 });
 document.addEventListener('keyup',e=>{if(keys[e.key])stop();});
 document.addEventListener('pointerup',stop);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 bombButton.addEventListener('click',()=>{if(game?.status==='active')void perform('place');});
 $('bombClose').addEventListener('click',hide);
 for(const e of [pad,canvas,bombButton])e.addEventListener('touchmove',ev=>{if(ev.cancelable)ev.preventDefault();},{passive:false});
 return {receive,open:async rid=>{
   roomId=rid;show();
   try{const r=await api('/api/play/bomb/room/'+encodeURIComponent(rid));
     if(rid===getRoom()){game=r.game;draw();}
   }catch(err){toast(err.message);hide();}
  },close:hide,reset:()=>{hide();game=null;roomId=null;},get visible(){return !panel.hidden;}};
}
window.createBombArena=createBombArena;
