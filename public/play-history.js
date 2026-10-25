// VozChat Play · Acesso permanente + histórico de partidas por perfil.
// Não guarda jogos no navegador: só recupera o histórico autorizado pelo servidor.
function createPlayHistory({api,toast,getMe,getIdentities,getRooms,openChat}){
  const $=id=>document.getElementById(id);
  const dialog=$('playHistoryDialog');
  const eligible=()=>{const me=getMe();return !!me&&!getIdentities().some(p=>p.id===me.id&&p.label==='Profissional');};
  function lastRoom(){
    const me=getMe();if(!me)return null;
    let lastId='';try{lastId=localStorage.getItem('vozchat_last_room_'+me.id)||'';}catch{}
    const rooms=getRooms();
    return rooms.find(room=>room.id===lastId)||rooms[0]||null;
  }
  function sync(){
    const allowed=eligible();
    $('playHubButton').hidden=!allowed;
    const room=getRooms().find(r=>r.id===getMe()?.currentRoomId)||null;
    const last=lastRoom();
    $('resumeLastChat').hidden=!last;
    if(last)$('resumeLastChat').textContent='↩ Retomar conversa com '+last.name;
    if(!allowed&&dialog.open)dialog.close();
  }
  function syncChat(room){
    $('chatPlayBar').hidden=!(eligible()&&room?.isDirect);
  }
  function roomOpened(roomId){
    const me=getMe();if(!me)return;
    try{localStorage.setItem('vozchat_last_room_'+me.id,roomId);}catch{}
    sync();
  }
  function resultText(entry){
    switch(entry.status){
      case 'won':return entry.kind==='neon-maze'?'🏆 Labirinto concluído':entry.winner===getMe()?.id?'🏆 Vitória':'Derrota';
      case 'lost':return 'Os drones venceram';
      case 'draw':return 'Empate';
      case 'abandoned':return 'Partida interrompida';
      case 'active':return 'Em andamento';
      case 'pending':return 'Aguardando resposta';
      case 'declined':return 'Convite recusado';
      case 'canceled':return 'Convite cancelado';
      case 'expired':return 'Partida expirada';
      default:return 'Partida registrada';
    }
  }
  function addGame(entry){
    const item=document.createElement('div');item.className='play-history-row';
    const emblem=document.createElement('span');emblem.className='play-history-icon';
    emblem.textContent=entry.kind==='neon-maze'?'✦':'✕';
    const info=document.createElement('div');info.className='play-history-info';
    const title=document.createElement('strong');title.textContent=entry.name+' com '+entry.otherName;
    const result=document.createElement('span');
    result.textContent=resultText(entry)+(entry.kind==='neon-maze'?' · '+(entry.score||0)+' pontos':'');
    const when=document.createElement('small');
    const timestamp=entry.finishedAt||entry.updatedAt||entry.createdAt;
    when.textContent=timestamp?new Date(timestamp).toLocaleString('pt-BR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    info.append(title,result,when);
    const open=document.createElement('button');open.type='button';open.className='play-history-open';
    const available=entry.canReopen&&getRooms().some(room=>room.id===entry.roomId);
    open.textContent=available?'Abrir conversa':'Contato removido';open.disabled=!available;
    open.addEventListener('click',()=>{dialog.close();void openChat(entry.roomId,false);});
    item.append(emblem,info,open);
    return item;
  }
  async function refresh(){
    if(!eligible()||!dialog.open)return;
    const target=$('playHistoryList');
    try{
      const response=await api('/api/play/history');
      if(!dialog.open||!eligible())return;
      const games=Array.isArray(response.games)?response.games:[];
      $('playHistoryStats').textContent=games.length+' partida'+(games.length===1?'':'s')+
        ' · '+games.filter(g=>g.status==='won').length+' vitória(s)';
      target.replaceChildren();
      if(games.length)for(const game of games)target.append(addGame(game));
      else{
        const message=document.createElement('p');message.className='pending-empty';
        message.textContent='Nenhuma partida registrada neste perfil. Escolha um contato abaixo para começar.';
        target.append(message);
      }
    }catch(err){
      if(!dialog.open)return;
      target.replaceChildren();
      const error=document.createElement('p');error.className='pending-empty';
      error.textContent='Erro ao carregar histórico: '+err.message;
      target.append(error);
    }
  }
  function showContacts(){
    const target=$('playHistoryContacts');target.replaceChildren();
    const contacts=getRooms().filter(room=>room.isDirect);
    if(!contacts.length){
      const message=document.createElement('p');message.className='pending-empty';
      message.textContent='Adicione um contato por ID e aceite a solicitação para começar a jogar.';
      target.append(message);return;
    }
    for(const room of contacts){
      const button=document.createElement('button');button.type='button';button.className='play-history-contact';
      const person=document.createElement('span');person.textContent=room.name;
      const play=document.createElement('strong');play.textContent='🎮 Jogar';
      button.append(person,play);
      button.addEventListener('click',()=>{dialog.close();void openChat(room.id,true);});
      target.append(button);
    }
  }
  async function show(){
    if(!eligible())return toast('VozChat Play está disponível nos perfis Pessoal e Família.');
    $('playHistoryStats').textContent='Carregando seu histórico…';
    $('playHistoryList').replaceChildren();
    showContacts();dialog.showModal();
    await refresh();
  }
  $('playHubButton').addEventListener('click',()=>void show());
  $('chatPlayHistory').addEventListener('click',()=>void show());
  $('chatPlayStart').addEventListener('click',()=>{const room=getRooms().find(room=>room.id===getMe()?.currentRoomId);if(room)void openChat(room.id,true);});
  $('resumeLastChat').addEventListener('click',()=>{const room=lastRoom();if(room)void openChat(room.id,false);});
  return {sync,syncChat,roomOpened,refresh,show,
    reset(){dialog.open&&dialog.close();$('playHubButton').hidden=true;$('chatPlayBar').hidden=true;$('resumeLastChat').hidden=true;}};
}
window.createPlayHistory=createPlayHistory;
