(() => {
  const preview = document.querySelector('.tracking-preview');
  if (!preview) return;
  const path = preview.querySelector('[data-demo-route]');
  const truck = preview.querySelector('[data-demo-truck]');
  const map = preview.querySelector('.tracking-map');
  const roads = preview.querySelector('.tracking-map-roads');
  const phonePreview = preview.querySelector('.tracking-phone');
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
    // Match the map to the available area without stretching the marker or phone.
    const mapHeight = small ? 270 : Math.max(1, 900 * map.clientHeight / Math.max(1, map.clientWidth));
    const markerScale = small ? 1 : Math.min(1, mapHeight / 160);
    const points = small ? [[82,214],[184,52]] : [[140,.7*mapHeight],[600,.3375*mapHeight]];
    path.setAttribute('d', small ? path.dataset.compactRoute : `M140 ${.7*mapHeight} C220 ${.7*mapHeight} 235 ${.525*mapHeight} 320 ${.525*mapHeight} S410 ${.3375*mapHeight} 490 ${.3375*mapHeight} L600 ${.3375*mapHeight}`);
    preview.querySelector('.tracking-map-route-base').setAttribute('d', path.getAttribute('d'));
    preview.querySelector('.tracking-map-art').setAttribute('viewBox', `0 0 ${small ? 540 : 900} ${mapHeight}`);
    roads.setAttribute('transform', `scale(1 ${small ? 1 : mapHeight/400})`);
    preview.querySelector('.tracking-truck-disc').setAttribute('r', 20*markerScale);
    preview.querySelector('.tracking-map-halo').setAttribute('r', 32*markerScale);
    preview.querySelector('.tracking-truck-icon').setAttribute('transform', `scale(${markerScale})`);
    preview.querySelectorAll('.tracking-map-endpoint').forEach((circle,i) => {
      circle.setAttribute('cx', points[i][0]);circle.setAttribute('cy', points[i][1]);
      circle.setAttribute('r', 6*markerScale);
    });
    const labels = [preview.querySelector('.tracking-map-pickup'),preview.querySelector('.tracking-map-delivery')];
    labels.forEach((label,i) => {
      label.setAttribute('x', points[i][0]);label.setAttribute('y', points[i][1] + (i ? -36 : 36)*markerScale);
      label.style.fontSize = small ? '' : `${13*markerScale}px`;
    });
    const phoneTop = small ? 74 : Math.max(56, Math.min(65, preview.clientHeight*.12));
    const angle = (small || innerWidth<=1100 ? 2 : 3)*Math.PI/180;
    const phoneHeight = phonePreview.offsetHeight*Math.cos(angle) + phonePreview.offsetWidth*Math.sin(angle);
    const desiredScale = small || innerWidth<1280 ? 1 : innerWidth<1600 ? 1.3 : 1.55;
    preview.style.setProperty('--tracking-phone-top', `${phoneTop}px`);
    preview.style.setProperty('--tracking-phone-scale', String(Math.max(0, Math.min(desiredScale, (preview.clientHeight-phoneTop-18)/phoneHeight))));
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
  new ResizeObserver(layout).observe(preview);
})();
