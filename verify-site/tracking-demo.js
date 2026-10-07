(() => {
  const preview = document.querySelector('.tracking-preview');
  if (!preview) return;
  const path = preview.querySelector('[data-demo-route]');
  const truck = preview.querySelector('[data-demo-truck]');
  let length;
  const workspace = preview.querySelector('[data-demo-workspace-status]');
  const phone = preview.querySelector('[data-demo-phone-status]');
  const action = preview.querySelector('[data-demo-action]');
  const update = preview.querySelector('[data-demo-update]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width:760px)');
  const states = {
    ready: ['Awaiting driver', 'Ready to start', 'Start tracking', 'Waiting to start'],
    pressing: ['Awaiting driver', 'Ready to start', 'Start tracking', 'Waiting to start'],
    sharing: ['Sharing', 'Location sharing on', 'Pause tracking', 'Location updated'],
    delivered: ['Delivered', 'Load completed', 'Delivery complete', 'Delivery reached']
  };
  let visible = false, frame = 0, started = null, elapsed = 0;
  function layout() {
    const small = compact.matches;
    path.setAttribute('d', small ? path.dataset.compactRoute : path.dataset.wideRoute);
    preview.querySelector('.tracking-map-route-base').setAttribute('d', path.getAttribute('d'));
    preview.querySelector('.tracking-map-art').setAttribute('viewBox', small ? '0 0 540 270' : '0 0 900 400');
    const points = small ? [[82,214],[184,52]] : [[140,280],[600,135]];
    preview.querySelectorAll('.tracking-map-endpoint').forEach((circle,i) => {
      circle.setAttribute('cx', points[i][0]);circle.setAttribute('cy', points[i][1]);
    });
    const labels = [preview.querySelector('.tracking-map-pickup'),preview.querySelector('.tracking-map-delivery')];
    labels.forEach((label,i) => {label.setAttribute('x', points[i][0]);label.setAttribute('y', points[i][1] + (i ? -36 : 36));});
    length = path.getTotalLength();path.style.strokeDasharray = String(length);
    const position = motion.matches ? .5 : Math.max(0, Math.min(1, (elapsed-1550)/7350));
    render(preview.dataset.demoState || (motion.matches ? 'sharing' : 'ready'), motion.matches ? .5 : position*position*(3-2*position));
  }
  function render(state, progress) {
    if (preview.dataset.demoState !== state) {
      preview.dataset.demoState = state;
      [workspace,phone,action,update].forEach((element,index) => element.textContent = states[state][index]);
    }
    const point = path.getPointAtLength(progress * length);
    truck.setAttribute('transform', `translate(${point.x} ${point.y})`);
    path.style.strokeDashoffset = String(length * (1-progress));
  }
  function tick(now) {
    if (!visible || motion.matches || document.hidden) return;
    if (started === null) started = now - elapsed;
    elapsed = (now - started) % 10800;
    const state = elapsed < 1100 ? 'ready' : elapsed < 1550 ? 'pressing' : elapsed < 8900 ? 'sharing' : 'delivered';
    const position = Math.max(0, Math.min(1, (elapsed-1550)/7350));
    // A gentle departure and arrival; the marker follows the actual SVG route.
    render(state, position * position * (3 - 2*position));
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);started = null;
    preview.classList.toggle('demo-offscreen', !visible || document.hidden);
    preview.dataset.demoRunning = String(visible && !motion.matches && !document.hidden);
    if (motion.matches) {render('sharing', .5);return;}
    if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  }
  layout();
  sync();
  new IntersectionObserver(([entry]) => {visible = entry.isIntersecting;sync();}, {threshold:.15}).observe(preview);
  document.addEventListener('visibilitychange',sync);
  motion.addEventListener('change', () => {elapsed = 0;sync();});
  compact.addEventListener('change',layout);
})();
