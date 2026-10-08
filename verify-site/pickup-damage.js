(() => {
  const demo = document.querySelector('.damage-demo');
  if (!demo) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const states = ['idle','opening','inspecting','selecting','sizing','photo','notes','printing','delivered'];
  const ends = [1600,2600,4000,5500,7000,9500,11500,14500,19000];
  const duration = ends[ends.length - 1];
  const part = demo.querySelector('[data-damage-part]');
  const action = demo.querySelector('[data-damage-action]');
  const phoneCaption = demo.querySelector('[data-damage-phone-caption]');
  const docCaption = demo.querySelector('[data-damage-document-caption]');
  const printer = demo.querySelector('.damage-printer-top span');
  let timer = 0, elapsed = 0, started = 0, running = false, visible = false;
  function render(state) {
    if (demo.dataset.damageState === state && demo.dataset.damageRendered) return;
    demo.dataset.damageState = state; demo.dataset.damageRendered = 'true';
    const stage = states.indexOf(state);
    for (const [name,at] of [['inspection',2],['part',3],['type',4],['size',5],['photo',6],['notes',6],['print',7],['copy',8]]) demo.classList.toggle('has-' + name, stage >= at);
    demo.querySelector('[data-damage-type-label]').textContent = stage >= 6 ? 'RECORDED DAMAGE' : 'DAMAGE TYPE';
    part.textContent = stage >= 3 ? 'Left front door' : 'Tap a part';
    action.textContent = stage >= 6 ? 'Saved to gate pass' : 'Add damage & photo';
    phoneCaption.textContent = stage < 2 ? 'Open Inspection on the driver app' : stage < 6 ? 'Choose the part, damage and size. Add a photo.' : 'Damage code and photo recorded';
    docCaption.textContent = stage < 6 ? 'The original pass. Notes in the space below.' : 'Damage codes and photo QR added below';
    printer.textContent = stage === 7 ? 'Printing gate pass…' : stage >= 8 ? 'Copy ready' : 'Ready to print';
  }
  function tick() {
    const time = (elapsed + performance.now() - started) % duration;
    render(states[ends.findIndex(end => time < end)]);
    timer = setTimeout(tick,100);
  }
  function update() {
    clearTimeout(timer);
    if (running) elapsed = (elapsed + performance.now() - started) % duration;
    running = visible && !document.hidden && !motion.matches;
    demo.classList.toggle('demo-offscreen',!running); demo.dataset.damageRunning = String(running);
    if (motion.matches) { render('delivered'); return; }
    if (running) { started = performance.now(); tick(); }
  }
  new IntersectionObserver(([entry]) => {
    if (visible === entry.isIntersecting) return;
    visible = entry.isIntersecting; update();
  },{threshold:.05}).observe(demo);
  document.addEventListener('visibilitychange',update);
  motion.addEventListener('change',() => { elapsed = 0; running = false; update(); });
  render(motion.matches ? 'delivered' : 'idle');
})();
