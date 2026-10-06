(() => {
  const dialog = document.getElementById('search-dialog');
  const input = document.getElementById('guide-search');
  const results = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  let index = null, pending = null, searchOpener = null;
  const normalize = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function renderResults() {
    if (!index) return;
    const tokens = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
    const matches = index.map(article => {
      const title = normalize(article.title), description = normalize(article.description), body = normalize(article.text);
      if (!tokens.every(token => (title+' '+description+' '+body).includes(token))) return null;
      const score = tokens.reduce((sum, token) => sum + (title.includes(token) ? 10 : description.includes(token) ? 5 : 1), 0);
      return {article, score};
    }).filter(Boolean).sort((a,b) => b.score-a.score).slice(0,12);
    results.replaceChildren();
    status.textContent = tokens.length ? `${matches.length} guide${matches.length === 1 ? '' : 's'} found` : 'Browse guides or search a topic';
    for (const {article} of matches) {
      const a = document.createElement('a'); a.className = 'search-result'; a.href = article.url;
      const group = document.createElement('span'); group.textContent = article.group;
      const title = document.createElement('strong'); title.textContent = article.title;
      const description = document.createElement('p'); description.textContent = article.description;
      a.append(group,title,description); results.append(a);
    }
    if (!matches.length) {
      const empty = document.createElement('div'); empty.className = 'search-empty';
      empty.append(document.createTextNode('Try a shorter phrase, such as “SMS”, “driver” or “Always”.'));
      const support = document.createElement('a'); support.href = 'mailto:verify@deeptruck.io'; support.textContent = 'Contact support ↗';
      empty.append(document.createElement('br'), support); results.append(empty);
    }
  }
  async function loadIndex() {
    if (index) { renderResults(); return; }
    if (pending) return pending;
    status.textContent = 'Loading guides…';
    pending = (async () => {
      try {
        const response = await fetch('/help/search-index.json');
        if (!response.ok) throw new Error('Search unavailable');
        index = await response.json();
        renderResults();
      } catch {
        status.textContent = 'Search could not load. You can still browse the guides in the menu.';
        const retry = document.createElement('button'); retry.type='button';retry.className='dialog-close';retry.style.width='auto';retry.style.fontSize='12px';retry.style.padding='8px 14px';retry.textContent='Retry search';
        retry.addEventListener('click', () => { results.replaceChildren();void loadIndex(); });
        results.replaceChildren(retry);
      } finally { pending = null; }
    })();
    return pending;
  }
  function openSearch(opener) {
    closeNavigation(false);
    if (dialog.open) return;
    searchOpener = opener || document.activeElement;
    dialog.showModal();input.focus();void loadIndex();
  }
  document.querySelectorAll('[data-search-open]').forEach(button => button.addEventListener('click', () => openSearch(button)));
  document.querySelector('[data-search-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if(searchOpener?.isConnected) searchOpener.focus(); });
  input.addEventListener('input',renderResults);
  dialog.addEventListener('keydown', event => {
    if(event.key === 'Escape') {event.preventDefault();event.stopPropagation();dialog.close();return;}
    const links = [...results.querySelectorAll('.search-result')];
    const current = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && links.length) {event.preventDefault();links[(current+1)%links.length].focus();}
    if (event.key === 'ArrowUp' && links.length) {event.preventDefault();if(current<=0) input.focus();else links[current-1].focus();}
    if (event.key === 'Enter' && document.activeElement === input && links.length) {event.preventDefault();links[0].click();}
  });
  document.addEventListener('keydown', event => {
    const editing = event.target.closest('input,textarea,[contenteditable="true"]');
    if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !editing && !document.querySelector('dialog[open]'))) {event.preventDefault();openSearch();}
  });
  for (const modal of document.querySelectorAll('dialog')) modal.addEventListener('click',event => {
    if (event.target !== modal) return;
    const r = modal.getBoundingClientRect();
    if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) modal.close();
  });
  const menu = document.querySelector('.menu-toggle'), navigation = document.getElementById('guide-nav');
  function closeNavigation(restore = true) {
    if(!navigation.classList.contains('is-open')) return;
    navigation.classList.remove('is-open');document.body.classList.remove('nav-open');
    menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open guide navigation');
    if(restore) menu.focus();
  }
  menu.addEventListener('click', () => {
    if(navigation.classList.contains('is-open')) {closeNavigation();return;}
    navigation.classList.add('is-open');document.body.classList.add('nav-open');
    menu.setAttribute('aria-expanded','true');menu.setAttribute('aria-label','Close guide navigation');
    navigation.querySelector('[aria-current]')?.focus();
  });
  document.addEventListener('keydown',event => {
    if(!navigation.classList.contains('is-open')) return;
    if(event.key==='Escape') {event.preventDefault();closeNavigation();}
    if(event.key==='Tab') {
      const focusable = [menu,...navigation.querySelectorAll('a')], first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  window.matchMedia('(min-width:761px)').addEventListener('change',event => {if(event.matches)closeNavigation(false);});
  const imageDialog=document.getElementById('image-dialog'), zoomImage=document.getElementById('zoom-image');
  document.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click',() => {
    const source=button.querySelector('img');zoomImage.src=source.src;zoomImage.alt=source.alt;imageDialog.showModal();
  }));
  document.querySelector('[data-image-close]').addEventListener('click',() => imageDialog.close());
  document.getElementById('copy-guide')?.addEventListener('click',async () => {
    const status=document.getElementById('copy-status');
    try {await navigator.clipboard.writeText(location.origin+location.pathname);status.textContent='Link copied';}
    catch {status.textContent='Copy this page’s address from your browser.';}
  });
  document.getElementById('print-guide')?.addEventListener('click',() => window.print());
  const rail=document.querySelector('.contents-rail nav');
  if(rail) {
    const headings=[...document.querySelectorAll('.article-section>h2')];let scheduled=false;
    const update=()=>{let active=headings[0];for(const h of headings){if(h.getBoundingClientRect().top<=140)active=h;}rail.querySelectorAll('a').forEach(a=>{if(a.hash==='#'+active.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});scheduled=false;};
    window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}},{passive:true});update();
  }
  const query=new URLSearchParams(location.search).get('q');if(query){input.value=query;openSearch();}
})();
