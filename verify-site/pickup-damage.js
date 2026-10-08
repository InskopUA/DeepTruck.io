(() => {
  const demo=document.querySelector('.damage-demo');
  if(!demo)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),part=demo.querySelector('[data-damage-part]'),photo=demo.querySelector('[data-damage-photo]');
  let timer=0,elapsed=0,started=0,visible=false;
  function render(state){
    if(demo.dataset.damageState===state)return;
    demo.dataset.damageState=state;
    part.textContent=state==='idle'?'Select a part':'Left front door';
    photo.textContent=state==='photo'||state==='ready'?'Photo added':'Add a damage photo';
  }
  function tick(){
    const time=(elapsed+performance.now()-started)%11000;
    render(time<1500?'idle':time<4000?'selecting':time<6500?'photo':'ready');
    timer=setTimeout(tick,120);
  }
  function update(){
    clearTimeout(timer);timer=0;
    const active=visible&&!document.hidden&&!motion.matches;
    demo.classList.toggle('demo-offscreen',!active);demo.dataset.damageRunning=String(active);
    if(motion.matches){render('ready');return;}
    if(active){started=performance.now();tick();}else elapsed=(elapsed+performance.now()-started)%11000;
  }
  new IntersectionObserver(([entry])=>{if(visible===entry.isIntersecting)return;visible=entry.isIntersecting;update();},{threshold:.15}).observe(demo);
  document.addEventListener('visibilitychange',update);motion.addEventListener('change',()=>{elapsed=0;update();});
  if(motion.matches)render('ready');
})();
