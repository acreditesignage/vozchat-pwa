// VozChat Play · Labirinto Neon. Gráficos vetoriais originais, sem assets externos.
function createNeonPlay({api,toast,getMe,getRoom,onInvitation}){
  const $=id=>document.getElementById(id);
  const panel=$('neonPanel'),canvas=$('neonCanvas'),ctx=canvas.getContext('2d');
  const actions=$('neonActions'),status=$('neonStatus'),score=$('neonScore'),lives=$('neonLives');
  let game=null,roomId=null,busy=false,moving=false,holdTimer=null,heldDirection=null;
  let swipeStart=null;
  const hideGame=()=>{
    stopHold();
    panel.hidden=true;
    panel.classList.remove('game-fullscreen');
    document.documentElement.classList.remove('vozchat-game-active');
  };
  const WIDTH=17,HEIGHT=13,CELL=27,OX=25,OY=19;
  const svgColors=['#5ef7ed','#ffa5dc'];
  const gameStatusLabel={declined:'O convite foi recusado.',canceled:'Convite cancelado.',
    expired:'A partida expirou.',abandoned:'A partida terminou.',won:'🏆 Vocês venceram juntos!',
    lost:'Os drones venceram desta vez. Tentem novamente!'};
  const currentUid=()=>getMe()?.id;
  const show=()=>{
    // Remover apenas o painel do fluxo de mensagens, evitando recortes/zoom do iPhone.
    if(panel.parentElement!==document.body)document.body.append(panel);
    const focused=document.activeElement;
    if(focused&&typeof focused.blur==='function')focused.blur();
    panel.classList.add('game-fullscreen');
    document.documentElement.classList.add('vozchat-game-active');
    panel.hidden=false;
    draw();
  };
  const safeRoom=()=>roomId&&roomId===getRoom();
  const isActive=()=>game?.status==='active';
  function setGame(next){
    if(!next||!safeRoom())return;
    if(game?.id===next.id&&Number(game.moves)>Number(next.moves))return;
    game=next;draw();
  }
  function receive(next){
    if(!next||next.roomId!==getRoom())return;
    const newInvitation=next.status==='pending'&&next.inviterId!==currentUid()&&
      (!game||game.id!==next.id||game.status!=='pending');
    roomId=next.roomId;setGame(next);
    if(newInvitation)onInvitation?.();
  }
  function actionButton(label,actionName,cls){
    const button=document.createElement('button');
    button.type='button';button.className=cls||'';button.textContent=label;
    button.disabled=busy;
    button.addEventListener('click',()=>void perform(actionName));
    return button;
  }
  function draw(){
    if(panel.hidden)return;
    actions.replaceChildren();
    const active=isActive();
    score.textContent='✦ '+(game?.score||0)+' pontos';
    lives.textContent='♥ '.repeat(Math.max(0,game?.lives??3)).trim()||'♡';
    if(!game){
      status.textContent='Convide um contato para escapar do labirinto juntos.';
      actions.append(actionButton('🎮 Convidar para jogar','invite','neon-primary'));
    }else if(game.status==='pending'){
      const mine=game.inviterId===currentUid();
      status.textContent=mine?'Convite enviado. Aguardando o contato aceitar…':'🎮 Seu contato quer jogar com você!';
      if(mine)actions.append(actionButton('Cancelar convite','cancel'));
      else actions.append(actionButton('Aceitar e jogar','accept','neon-primary'),actionButton('Recusar','decline'));
    }else if(active){
      const myIndex=game.players.findIndex(p=>p.id===currentUid());
      const name=myIndex===0?'Ciano':'Rosa';
      status.textContent='Você é '+name+'! Recolham as luzes e evitem os drones.';
      actions.append(actionButton('Encerrar partida','quit'));
    }else{
      status.textContent=gameStatusLabel[game.status]||'Partida encerrada.';
      actions.append(actionButton('▶ Nova partida','invite','neon-primary'));
    }
    const canMove=active&&!busy;
    for(const button of panel.querySelectorAll('[data-neon-dir]'))button.disabled=!canMove;
    if(!ctx)return;
    const w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);
    const bg=ctx.createLinearGradient(0,0,w,h);
    bg.addColorStop(0,'#081426');bg.addColorStop(1,'#080f26');
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    const board=game?.board;
    if(!board){
      ctx.fillStyle='#82bafa';ctx.font='bold 28px system-ui';
      ctx.textAlign='center';ctx.fillText('✦ LABIRINTO NEON',w/2,h/2-8);
      ctx.fillStyle='#9fafd6';ctx.font='15px system-ui';
      ctx.fillText('Dois jogadores · Uma aventura',w/2,h/2+21);
      return;
    }
    const remaining=new Set(game.pellets||[]),powers=new Set(game.powers||[]);
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const left=OX+x*CELL,top=OY+y*CELL,centerX=left+CELL/2,centerY=top+CELL/2;
      if(board[y]?.[x]==='#'){
        ctx.fillStyle='#14366b';ctx.fillRect(left+1,top+1,CELL-2,CELL-2);
        ctx.strokeStyle='#2467b4';ctx.lineWidth=1;ctx.strokeRect(left+1.5,top+1.5,CELL-3,CELL-3);
        continue;
      }
      const cell=y*WIDTH+x;
      if(remaining.has(cell)){
        ctx.fillStyle='#c1f7ff';ctx.beginPath();ctx.arc(centerX,centerY,2.7,0,Math.PI*2);ctx.fill();
      }else if(powers.has(cell)){
        ctx.shadowBlur=10;ctx.shadowColor='#ffe680';ctx.fillStyle='#ffe680';
        ctx.beginPath();ctx.arc(centerX,centerY,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      }
    }
    for(const [i,ghost] of (game.ghosts||[]).entries()){
      const x=OX+(ghost.x+.5)*CELL,y=OY+(ghost.y+.5)*CELL;
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);
      ctx.shadowColor=i?'#ffab6e':'#b18aff';ctx.shadowBlur=11;
      ctx.fillStyle=i?'#ff9f69':'#ad7bff';ctx.fillRect(-8,-8,16,16);ctx.shadowBlur=0;
      ctx.restore();
      ctx.fillStyle='#082049';ctx.beginPath();ctx.arc(x-3,y-2,1.5,0,Math.PI*2);
      ctx.arc(x+3,y-2,1.5,0,Math.PI*2);ctx.fill();
    }
    for(const [i,player] of (game.players||[]).entries()){
      const p=player.position;if(!p)continue;
      const x=OX+(p.x+.5)*CELL,y=OY+(p.y+.5)*CELL;
      const glowing=game.powerUntil>=game.moves&&game.moves>0;
      ctx.save();ctx.translate(x,y);ctx.shadowColor=svgColors[i];ctx.shadowBlur=glowing?20:10;
      ctx.fillStyle=svgColors[i];ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;ctx.strokeStyle='#061328';ctx.lineWidth=3;
      ctx.beginPath();ctx.moveTo(-3,-3);ctx.lineTo(3,0);ctx.lineTo(-3,3);ctx.stroke();
      ctx.restore();
    }
  }
  async function perform(action,direction){
    if(!safeRoom()||busy)return;
    const room=roomId;
    if(action==='quit'&&!confirm('Deseja encerrar o labirinto para os dois jogadores?'))return;
    busy=true;draw();
    try{
      const url=action==='invite'?'/api/play/neon/invite':
        '/api/play/neon/'+encodeURIComponent(game?.id||'')+'/'+action;
      const data=action==='invite'?{roomId:room}:action==='move'?{direction}:{};
      const response=await api(url,{method:'POST',data});
      if(roomId!==room||getRoom()!==room)return;
      setGame(response.game);
      if(action==='invite')toast('🎮 Convite do Labirinto Neon enviado!');
      if(action==='accept')toast('Labirinto liberado! Vocês estão jogando juntos.');
    }catch(error){if(action!=='move')toast(error.message||'Não foi possível jogar.');}
    finally{busy=false;draw();}
  }
  async function move(direction){
    if(!isActive()||!safeRoom()||moving)return;
    moving=true;
    const gameId=game.id,room=roomId;
    try{
      const result=await api('/api/play/neon/'+encodeURIComponent(gameId)+'/move',
        {method:'POST',data:{direction}});
      if(room===getRoom()&&game?.id===gameId)setGame(result.game);
    }catch(error){if(error.message&&!/Aguarde|partida/i.test(error.message))console.warn('Movimento não enviado:',error.message);}
    finally{moving=false;}
  }
  function stopHold(){
    if(holdTimer!==null)clearInterval(holdTimer);
    holdTimer=null;heldDirection=null;
    for(const control of panel.querySelectorAll('[data-neon-dir]'))
      control.classList.remove('is-pressed');
  }
  function beginHold(direction){
    if(!isActive()||panel.hidden)return;
    if(heldDirection===direction)return;
    stopHold();heldDirection=direction;
    const activeButton=panel.querySelector('[data-neon-dir="'+direction+'"]');
    activeButton?.classList.add('is-pressed');
    try{navigator.vibrate?.(12);}catch{}
    void move(direction);
    holdTimer=setInterval(()=>{if(heldDirection===direction)void move(direction);},175);
  }
  for(const button of panel.querySelectorAll('[data-neon-dir]')){
    button.addEventListener('pointerdown',event=>{
      if(button.disabled)return;
      event.preventDefault();
      try{button.setPointerCapture(event.pointerId);}catch{}
      beginHold(button.dataset.neonDir);
    });
    button.addEventListener('pointerup',stopHold);
    button.addEventListener('pointercancel',stopHold);
    button.addEventListener('lostpointercapture',stopHold);
  }
  // Deslizar sobre o labirinto muda a direção; tocar não move automaticamente.
  canvas.addEventListener('pointerdown',event=>{
    if(!isActive()||panel.hidden)return;
    swipeStart={x:event.clientX,y:event.clientY,pointerId:event.pointerId};
    try{canvas.setPointerCapture(event.pointerId);}catch{}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!swipeStart||swipeStart.pointerId!==event.pointerId||!isActive())return;
    const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;
    if(Math.max(Math.abs(dx),Math.abs(dy))<15)return;
    const direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
    beginHold(direction);
    swipeStart={x:event.clientX,y:event.clientY,pointerId:event.pointerId};
  });
  const endSwipe=()=>{swipeStart=null;stopHold();};
  canvas.addEventListener('pointerup',endSwipe);
  canvas.addEventListener('pointercancel',endSwipe);
  canvas.addEventListener('lostpointercapture',endSwipe);
  for(const target of [canvas,panel.querySelector('.neon-pad')]){
    target?.addEventListener('touchmove',event=>{
      if(event.cancelable)event.preventDefault();
    },{passive:false});
  }
  document.addEventListener('pointerup',stopHold);
  const keys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',
    w:'up',s:'down',a:'left',d:'right'};
  document.addEventListener('keydown',event=>{
    if(panel.hidden||!isActive()||event.repeat||!keys[event.key])return;
    const focused=document.activeElement?.tagName;
    if(focused==='INPUT'||focused==='TEXTAREA'||focused==='SELECT')return;
    event.preventDefault();beginHold(keys[event.key]);
  });
  document.addEventListener('keyup',event=>{if(keys[event.key])stopHold();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHold();});
  $('neonClose').addEventListener('click',hideGame);
  return {
    get state(){return game;},
    get visible(){return !panel.hidden;},
    receive,
    close(){hideGame();},
    reset(){hideGame();game=null;roomId=null;},
    async open(rid){
      if(!rid)return;
      roomId=rid;show();
      try{
        const data=await api('/api/play/neon/room/'+encodeURIComponent(rid));
        if(roomId===rid&&rid===getRoom()){game=data.game;draw();}
      }catch(error){toast(error.message);hideGame();}
    }
  };
}

window.createNeonPlay=createNeonPlay;
