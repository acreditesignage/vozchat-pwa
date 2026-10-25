/* Compartilhado entre VozChat e FlowTalk; mostra uma única vez em navegadores móveis. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const root=$('installGuide');
  if(!root)return;
  const key='vozchat_install_guide_seen_v1';
  const card=root.querySelector('.install-guide-card');
  const action=$('installGuideAction'),steps=$('installGuideSteps');
  const isTalk=document.querySelector('link[rel="manifest"]')?.getAttribute('href')==='/talk.webmanifest';
  const name=isTalk?'FlowTalk':'VozChat';
  const agent=navigator.userAgent||'';
  const isApple=/iPad|iPhone|iPod/i.test(agent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isAndroid=/Android/i.test(agent);
  const isMobile=isApple||isAndroid;
  const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true;
  let promptEvent=null,previousFocus=null,opened=false;
  function marked(){try{return localStorage.getItem(key)==='1';}catch{return false;}}
  function mark(){try{localStorage.setItem(key,'1');}catch{}}
  function step(number,text){
    const container=document.createElement('div');container.className='install-guide-step';
    const marker=document.createElement('span');marker.className='install-guide-step-number';marker.textContent=number;
    const label=document.createElement('span');label.className='install-guide-step-copy';label.textContent=text;
    container.append(marker,label);return container;
  }
  function render(){
    $('installGuideTitle').textContent='Tenha o '+name+' na sua tela inicial';
    $('installGuideDescription').textContent='Acesse com um toque, como um aplicativo, sem procurar o link.';
    $('installGuideIcon').src=isTalk?'/icons/flowtalk.svg':'/icons/icon.svg';
    steps.replaceChildren();
    if(isApple){
      steps.append(
        step('1','Abra este endereço no Safari do iPhone.'),
        step('2','Toque em Compartilhar (quadrado com seta para cima).'),
        step('3','Selecione “Adicionar à Tela de Início” e confirme em “Adicionar”.')
      );
      action.textContent='Entendi';
    }else if(isAndroid){
      steps.append(
        step('1','Abra esta página no Chrome do Android.'),
        step('2','Toque no menu ⋮ (três pontos).'),
        step('3','Escolha “Instalar aplicativo” ou “Adicionar à tela inicial” e confirme.')
      );
      action.textContent=promptEvent?'Instalar agora':'Entendi';
    }else{
      steps.append(step('1','No menu do navegador, procure “Instalar aplicativo” ou “Adicionar à tela inicial”.'));
      action.textContent=promptEvent?'Instalar agora':'Entendi';
    }
  }
  function close({remember=true}={}){
    if(remember)mark();
    root.hidden=true;opened=false;
    document.removeEventListener('keydown',handleKeys,true);
    if(previousFocus?.isConnected)previousFocus.focus();
    previousFocus=null;
  }
  function handleKeys(event){
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const controls=[...root.querySelectorAll('button:not([disabled])')];
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function open(){
    if(isStandalone())return;
    previousFocus=document.activeElement;
    render();root.hidden=false;opened=true;
    document.addEventListener('keydown',handleKeys,true);
    $('installGuideClose').focus();
  }
  window.VozChatInstallGuide={open};
  $('installGuideClose').addEventListener('click',()=>close());
  $('installGuideLater').addEventListener('click',()=>close());
  // Clique fora do cartão também dispensa o aviso.
  root.addEventListener('click',event=>{if(event.target===root)close();});
  action.addEventListener('click',async()=>{
    if(promptEvent&&!isStandalone()){
      const chosen=promptEvent;promptEvent=null;
      try{
        await chosen.prompt();
        const result=await chosen.userChoice;
        if(result?.outcome==='accepted'){close();return;}
      }catch{}
      // O navegador pode cancelar a solicitação. A orientação manual continua disponível.
      render();
      action.textContent='Entendi';
      return;
    }
    close();
  });
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();promptEvent=event;
    if(opened)render();
  });
  window.addEventListener('appinstalled',()=>{
    mark();if(opened)close();
  });
  // O botão existente permanece disponível para rever o tutorial quando quiser.
  $('installButton')?.addEventListener('click',open);
  $('installGuideTalk')?.addEventListener('click',open);
  // Nunca interromper a entrada via convite ou o atendimento de uma chamada.
  if(isMobile&&!isStandalone()&&!marked()&&
    !new URLSearchParams(location.search).has('join')&&
    !new URLSearchParams(location.search).has('call')){
    setTimeout(()=>{if(document.visibilityState!=='hidden'&&!opened&&!marked())open();},1500);
  }
})();
