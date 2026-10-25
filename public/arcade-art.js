// Desenho vetorial original em alta definição: personagens sem imagens externas.
function drawArcadeHero(ctx,x,y,r,color='#60e9fb',direction='down',alive=true){
 ctx.save();ctx.translate(x,y);if(!alive)ctx.globalAlpha=.24;
 const dark=color==='#ff91d1'?'#772854':'#146390',bright=color==='#ff91d1'?'#fff1fa':'#effdff';
 // Sombra projetada.
 ctx.fillStyle='#02091299';ctx.beginPath();ctx.ellipse(0,r*.82,r*.84,r*.3,0,0,Math.PI*2);ctx.fill();
 // Botas e luvas.
 ctx.fillStyle=dark;
 for(const side of [-1,1]){
  ctx.beginPath();ctx.ellipse(side*r*.45,r*.64,r*.29,r*.31,side*.24,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(side*r*.83,0,r*.21,0,Math.PI*2);ctx.fill();
 }
 // Capacete com gradiente para sensação de volume.
 let gradient=ctx.createLinearGradient(-r,-r,r,r);
 gradient.addColorStop(0,bright);gradient.addColorStop(.26,color);gradient.addColorStop(1,dark);
 ctx.fillStyle=gradient;ctx.shadowBlur=r*.5;ctx.shadowColor=color;
 ctx.beginPath();ctx.arc(0,-r*.1,r*.84,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
 ctx.strokeStyle='#081c37';ctx.lineWidth=Math.max(1,r*.1);ctx.stroke();
 // Viseira e expressão.
 ctx.fillStyle='#102543';ctx.beginPath();ctx.roundRect(-r*.62,-r*.28,r*1.24,r*.57,r*.23);ctx.fill();
 ctx.fillStyle='#e9fbff';ctx.beginPath();ctx.ellipse(-r*.27,-r*.04,r*.17,r*.19,0,0,Math.PI*2);
 ctx.ellipse(r*.27,-r*.04,r*.17,r*.19,0,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#2472a6';ctx.beginPath();ctx.arc(-r*.21,-r*.02,r*.07,0,Math.PI*2);
 ctx.arc(r*.33,-r*.02,r*.07,0,Math.PI*2);ctx.fill();
 // Brilho, topo do capacete e fecho.
 ctx.fillStyle='#ffffffbb';ctx.beginPath();ctx.ellipse(-r*.33,-r*.48,r*.34,r*.10,-.4,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#ffd96f';ctx.beginPath();ctx.arc(0,r*.45,r*.14,0,Math.PI*2);ctx.fill();
 if(direction==='left'||direction==='right'){
  ctx.fillStyle='#ffffff80';ctx.beginPath();ctx.arc(direction==='left'?-r*.9:r*.9,r*.05,r*.12,0,Math.PI*2);ctx.fill();
 }
 ctx.restore();
}
window.VozChatArcadeArt={drawHero:drawArcadeHero};
