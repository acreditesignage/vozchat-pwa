// VozChat Play: jogos individuais opcionais, sem conta externa e sem contato obrigatório.
// O Labirinto usa exatamente o mesmo motor de regras do multiplayer, no próprio aparelho.
function createPlaySolo({getProfileId,returnToHub,toast}){
  const $=id=>document.getElementById(id),dialog=$('playSoloDialog'),canvas=$('playSoloCanvas');
  const ctx=canvas.getContext('2d'),status=$('playSoloStatus'),score=$('playSoloScore');
  const ticBoard=$('playSoloTicBoard'),pad=$('playSoloDpad');
  const W=17,H=13,C=27,OX=25,OY=19;
  let kind=null,engine=null,maze=null,tic=Array(9).fill(''),ticEnd=false;
  let timer=null,cpuTimer=null,droneTimer=null,holdDirection=null;
  let swipeOrigin=null;
  const directions={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',
    w:'up',a:'left',s:'down',d:'right'};
  const winLines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const storageKey=()=> 'vozchat_solo_neon_'+getProfileId();
  function persistMaze(){
    if(!maze)return;
    try{localStorage.setItem(storageKey(),JSON.stringify(maze));}catch{}
  }
  function stopMovement(){
    if(timer!==null)clearInterval(timer);
    timer=null;holdDirection=null;
    for(const control of pad.querySelectorAll('[data-solo-direction]'))
      control.classList.remove('is-pressed');
  }
  function stopTimers(){
    stopMovement();if(cpuTimer!==null)clearTimeout(cpuTimer);
    cpuTimer=null;
    if(droneTimer!==null)clearInterval(droneTimer);
    droneTimer=null;
  }
  function startDrones(){
    if(droneTimer!==null)clearInterval(droneTimer);
    if(kind!=='neon'||!maze||maze.status!=='active')return;
    droneTimer=setInterval(()=>{
      if(!dialog.open||document.hidden||kind!=='neon'||!maze||maze.status!=='active')return;
      const result=engine?.neonTick(maze);
      if(result?.changed){persistMaze();drawMaze();}
    },900);
  }
  function winner(board){
    for(const line of winLines){
      const mark=board[line[0]];
      if(mark&&line.every(i=>board[i]===mark))return mark;
    }
    return board.every(Boolean)?'draw':null;
  }
  function findBotMove(){
    const available=tic.map((value,index)=>value===null||value===''?index:-1).filter(n=>n>=0);
    for(const mark of ['O','X']){
      for(const i of available){const trial=[...tic];trial[i]=mark;if(winner(trial)===mark)return i;}
    }
    if(available.includes(4))return 4;
    const corner=[0,2,6,8].find(i=>available.includes(i));return corner??available[0];
  }
  function renderTic(){
    ticBoard.replaceChildren();
    const outcome=winner(tic);
    ticEnd=!!outcome;
    if(outcome==='X')status.textContent='🏆 Você venceu! Quer jogar outra?';
    else if(outcome==='O')status.textContent='O computador venceu. Tente novamente!';
    else if(outcome==='draw')status.textContent='Empate! Boa partida.';
    else status.textContent='Você é X. Toque em uma casa para jogar contra o computador.';
    score.textContent='Você ✕ · CPU ○';
    for(let i=0;i<9;i++){
      const button=document.createElement('button');button.type='button';
      button.className='play-solo-tic-square'+(tic[i]==='O'?' mark-o':'');
      button.textContent=tic[i]==='X'?'✕':tic[i]==='O'?'○':'';
      button.setAttribute('role','gridcell');
      button.setAttribute('aria-label','Linha '+(Math.floor(i/3)+1)+', coluna '+(i%3+1));
      button.disabled=!!tic[i]||ticEnd||cpuTimer!==null;
      button.addEventListener('click',()=>{
        if(ticEnd||tic[i]||cpuTimer!==null)return;
        tic[i]='X';renderTic();
        if(ticEnd)return;
        status.textContent='Computador pensando…';
        cpuTimer=setTimeout(()=>{
          cpuTimer=null;
          if(kind!=='tic'||!dialog.open)return;
          const move=findBotMove();if(move!==undefined)tic[move]='O';renderTic();
        },310);
      });
      ticBoard.append(button);
    }
  }
  function drawMaze(){
    if(!maze||!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
    gradient.addColorStop(0,'#071324');gradient.addColorStop(1,'#10172e');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
    const pellets=new Set(maze.pellets),powers=new Set(maze.powers);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const left=OX+x*C,top=OY+y*C,cx=left+C/2,cy=top+C/2;
      if(maze.board[y][x]==='#'){
        ctx.fillStyle='#143568';ctx.fillRect(left+1,top+1,C-2,C-2);
        ctx.strokeStyle='#2269a7';ctx.strokeRect(left+2,top+2,C-4,C-4);
        continue;
      }
      const cell=y*W+x;
      if(pellets.has(cell)){ctx.fillStyle='#b8f4ff';ctx.beginPath();ctx.arc(cx,cy,2.8,0,Math.PI*2);ctx.fill();}
      if(powers.has(cell)){ctx.fillStyle='#ffe48c';ctx.shadowColor='#ffc654';ctx.shadowBlur=10;
        ctx.beginPath();ctx.arc(cx,cy,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
    }
    for(const [i,ghost] of maze.ghosts.entries()){
      const x=OX+(ghost.x+.5)*C,y=OY+(ghost.y+.5)*C;
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);
      ctx.fillStyle=i?'#ff9a66':'#b989ff';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=11;
      ctx.fillRect(-8,-8,16,16);ctx.restore();
    }
    const p=maze.players[0];
    const x=OX+(p.x+.5)*C,y=OY+(p.y+.5)*C;
    ctx.fillStyle='#68f3ea';ctx.shadowColor='#68f3ea';ctx.shadowBlur=14;
    ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#102437';ctx.beginPath();ctx.arc(x+4,y-2,2,0,Math.PI*2);ctx.fill();
    score.textContent='✦ '+maze.score+' pontos · '+maze.lives+' vida'+(maze.lives===1?'':'s');
    if(maze.status==='won')status.textContent='🏆 Labirinto concluído! Todas as luzes coletadas.';
    else if(maze.status==='lost')status.textContent='Fim de jogo! Os drones venceram.';
    else status.textContent='Colete as luzes ✦ e evite os drones ◆. Use as setas para se mover.';
    const playing=maze.status==='active';
    for(const b of pad.querySelectorAll('button'))b.disabled=!playing;
    if(!playing){stopMovement();if(droneTimer!==null){clearInterval(droneTimer);droneTimer=null;}}
  }
  function move(direction){
    if(kind!=='neon'||!dialog.open||!maze||maze.status!=='active'||!engine)return;
    const result=engine.neonMove(maze,'solo',direction);
    if(result.changed){persistMaze();drawMaze();}
  }
  function startHold(direction){
    if(kind!=='neon'||!maze||maze.status!=='active'||!dialog.open)return;
    if(holdDirection===direction)return;
    stopMovement();holdDirection=direction;
    pad.querySelector('[data-solo-direction="'+direction+'"]')?.classList.add('is-pressed');
    try{navigator.vibrate?.(12);}catch{}
    move(direction);
    timer=setInterval(()=>{if(holdDirection===direction)move(direction);},165);
  }
  for(const button of pad.querySelectorAll('[data-solo-direction]')){
    button.addEventListener('pointerdown',event=>{
      if(button.disabled)return;
      event.preventDefault();
      try{button.setPointerCapture(event.pointerId);}catch{}
      startHold(button.dataset.soloDirection);
    });
    button.addEventListener('pointerup',stopMovement);
    button.addEventListener('pointercancel',stopMovement);
    button.addEventListener('lostpointercapture',stopMovement);
  }
  document.addEventListener('pointerup',stopMovement);
  document.addEventListener('keydown',event=>{
    if(!dialog.open||kind!=='neon'||!directions[event.key]||event.repeat)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    event.preventDefault();startHold(directions[event.key]);
  });
  document.addEventListener('keyup',event=>{if(directions[event.key])stopMovement();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMovement();});
  canvas.addEventListener('pointerdown',event=>{
    if(kind!=='neon'||!maze||maze.status!=='active')return;
    swipeOrigin={x:event.clientX,y:event.clientY,pointerId:event.pointerId};
    try{canvas.setPointerCapture(event.pointerId);}catch{}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!swipeOrigin||swipeOrigin.pointerId!==event.pointerId)return;
    const dx=event.clientX-swipeOrigin.x,dy=event.clientY-swipeOrigin.y;
    if(Math.max(Math.abs(dx),Math.abs(dy))<15)return;
    const direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
    startHold(direction);
    swipeOrigin={x:event.clientX,y:event.clientY,pointerId:event.pointerId};
  });
  const finishSwipe=()=>{swipeOrigin=null;stopMovement();};
  canvas.addEventListener('pointerup',finishSwipe);
  canvas.addEventListener('pointercancel',finishSwipe);
  canvas.addEventListener('lostpointercapture',finishSwipe);
  for(const target of [canvas,pad])
    target.addEventListener('touchmove',event=>{if(event.cancelable)event.preventDefault();},{passive:false});
  function newMaze(){
    if(!engine)return;
    maze=engine.newNeonGame('local','solo',['solo'],'solo',Date.now());
    maze.players=maze.players.slice(0,1);
    engine.beginNeonGame(maze);persistMaze();drawMaze();startDrones();
  }
  async function open(nextKind){
    if(nextKind!=='neon'&&nextKind!=='tic')return;
    stopTimers();kind=nextKind;
    $('playSoloTitle').textContent=nextKind==='neon'?'Labirinto Neon · Solo':'Jogo da Velha · Solo';
    canvas.hidden=nextKind!=='neon';ticBoard.hidden=nextKind!=='tic';pad.hidden=nextKind!=='neon';
    if(!dialog.open)dialog.showModal();
    if(nextKind==='tic'){tic=Array(9).fill('');renderTic();return;}
    status.textContent='Preparando labirinto…';
    try{
      engine ||= await import('/neon-maze-engine.js');
      if(!dialog.open||kind!=='neon')return;
      let prior=null;
      try{prior=JSON.parse(localStorage.getItem(storageKey())||'null');}catch{}
      if(prior&&prior.status==='active'&&prior.users?.[0]==='solo'&&prior.board?.length===H){
        maze=prior;drawMaze();startDrones();
      }else newMaze();
    }catch(err){status.textContent='Não foi possível abrir o labirinto. Atualize o aplicativo.';toast('Erro ao carregar Labirinto Neon.');}
  }
  $('playSoloRestart').addEventListener('click',()=>{
    stopTimers();
    if(kind==='tic'){tic=Array(9).fill('');renderTic();}
    else if(kind==='neon')newMaze();
  });
  $('playSoloClose').addEventListener('click',()=>dialog.close());
  $('playSoloBack').addEventListener('click',()=>{dialog.close();returnToHub();});
  dialog.addEventListener('close',stopTimers);
  return {open,close(){stopTimers();if(dialog.open)dialog.close();}};
}
window.createPlaySolo=createPlaySolo;
