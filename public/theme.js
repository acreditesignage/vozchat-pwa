/* PWA Voice/VozChat appearance: light, dark and automatic by device preference. */
(()=>{
  'use strict';
  const KEY='vozchat_theme_v1';
  const root=document.documentElement;
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const choices=['auto','light','dark'];
  let saved='auto';
  try{saved=localStorage.getItem(KEY)||'auto';}catch{}
  if(!choices.includes(saved))saved='auto';
  let current=saved;
  function effective(){return current==='auto'?(media?.matches?'dark':'light'):current;}
  function paint(){
    const theme=effective();
    root.dataset.theme=theme;
    root.dataset.themeChoice=current;
    root.style.colorScheme=theme;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=theme==='dark'?'#071323':'#f7faff';
    for(const control of document.querySelectorAll('[data-theme-value]')){
      const selected=control.dataset.themeValue===current;
      control.setAttribute('aria-pressed',String(selected));
      control.classList.toggle('is-selected',selected);
    }
    for(const control of document.querySelectorAll('[data-theme-toggle]')){
      const label=theme==='dark'?'Ativar tema claro':'Ativar tema escuro';
      control.setAttribute('aria-label',label);
      control.setAttribute('title',label);
      control.setAttribute('aria-pressed',String(theme==='dark'));
    }
    const status=document.getElementById('themeCurrentLabel');
    if(status)status.textContent=current==='auto'?'Acompanha o tema do iPhone ou Android':
      current==='light'?'Sempre claro':'Sempre escuro';
  }
  function set(value){
    if(!choices.includes(value))return false;
    current=value;
    try{localStorage.setItem(KEY,value);}catch{}
    paint();return true;
  }
  if(media){
    if(media.addEventListener)media.addEventListener('change',()=>{if(current==='auto')paint();});
    else media.addListener?.(()=>{if(current==='auto')paint();});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    for(const button of document.querySelectorAll('[data-theme-value]')){
      button.addEventListener('click',()=>set(button.dataset.themeValue));
    }
    for(const button of document.querySelectorAll('[data-theme-toggle]')){
      button.addEventListener('click',()=>set(effective()==='dark'?'light':'dark'));
    }
    paint();
  });
  window.VozChatTheme={get:()=>current,effective,set};
  paint();
})();
