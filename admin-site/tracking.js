(() => {
  const API = 'https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/driver-tracking';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {pending:'Awaiting driver',accepted:'Ready to start',active:'Sharing location',paused:'Sharing paused',completed:'Completed',cancelled:'Cancelled',declined:'Declined',expired:'Expired'};
  const closed = status => ['completed','cancelled','declined','expired'].includes(status);
  let context, items = [], selected = '', timer, loading = false, map, marker, trail, mappedLoad = '', requestId = '', saving = false, owner = '';
  let routePoints = [], pointLoad = '', pointRequest = 0, actionBusy = false, actionItem = '';
  let documentEditor, savedLoadId = '';
  const pickup = window.deepTruckPickupDocuments;
  const needsAttention = v => !closed(statusOf(v)) && (v.invitationStatus === 'failed' || statusOf(v) === 'paused' || (statusOf(v) === 'pending' && Date.now()-Date.parse(v.createdAt)>86400000) || (statusOf(v) === 'active' && (!v.latestLocation || Date.now()-Date.parse(v.latestLocation.capturedAt)>300000)));
  function syncFilters() { document.querySelectorAll('[data-tracking-filter]').forEach(button => { const active = button.dataset.trackingFilter === $('tracking-filter').value; button.classList.toggle('active', active); button.setAttribute('aria-pressed',String(active)); }); }
  const date = value => value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Not specified';
  const localDate = value => new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const statusOf = item => !closed(item.status) && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : item.status;
  function message(text, error = false, target = 'tracking-message') { $(target).textContent = text; $(target).classList.toggle('error',error); }
  async function api(path, data) {
    const session = context.getSession();
    if (!session) throw new Error('Please sign in again.');
    let response;
    try {
      response = await fetch(API + path,{method:data === undefined ? 'GET':'POST',headers:{Authorization:'Bearer '+session.access_token,...(data instanceof FormData?{}:{'Content-Type':'application/json'})},body:data === undefined ? undefined:data instanceof FormData?data:JSON.stringify(data),signal:AbortSignal.timeout(data instanceof FormData?60000:20000)});
    } catch {
      throw new Error('Could not connect to tracking. Please try again.');
    }
    const value = await response.json().catch(()=>({}));
    if (!response.ok || value.error) throw new Error(value.error || 'Unable to load tracking. Please try again.');
    return value;
  }
  function freshness(item) {
    const point = item.latestLocation, status = statusOf(item);
    if (!point) return status === 'active' ? 'Waiting for first location' : status === 'pending' ? 'Location available after driver consent' : 'No location recorded';
    const minutes = Math.max(0,Math.floor((Date.now()-Date.parse(point.capturedAt))/60000));
    if (status !== 'active') return 'Last location · ' + date(point.capturedAt);
    return minutes < 1 ? 'Updated just now' : minutes < 5 ? `Updated ${minutes} min ago` : `Location delayed · ${minutes} min ago`;
  }
  function render() {
    $('tracking-active-count').textContent = items.filter(v=>statusOf(v)==='active').length;
    $('tracking-pending-count').textContent = items.filter(v=>statusOf(v)==='pending').length;
    $('tracking-completed-count').textContent = items.filter(v=>closed(statusOf(v))).length;
    $('tracking-open-count').textContent = items.filter(v=>!closed(statusOf(v))).length;
    $('tracking-attention-count').textContent = items.filter(needsAttention).length; syncFilters();
    const filter = $('tracking-filter').value, query = $('tracking-search').value.trim().toLowerCase();
    const visible = items.filter(v=>(filter==='all' || (filter==='open' ? !closed(statusOf(v)) : filter==='closed' ? closed(statusOf(v)) : filter==='attention' ? needsAttention(v) : statusOf(v)===filter)) && [v.title,v.driverName,v.carrierName,v.driverPhone].some(s=>String(s || '').toLowerCase().includes(query)));
    if (!visible.some(v=>v.id===selected)) { selected = visible[0]?.id || ''; document.querySelector('.tracking-layout').classList.remove('mobile-detail'); }
    const listScroll = $('tracking-list').scrollTop, focused = document.activeElement?.dataset.trackingSelect;
    $('tracking-list').innerHTML = visible.length ? visible.map(v=>`<button type="button" class="tracking-card ${v.id===selected?'selected':''}" data-tracking-select="${escape(v.id)}" aria-pressed="${v.id===selected}"><div class="tracking-card-top"><b>${escape(v.title)}</b><span class="tracking-status ${escape(statusOf(v))}">${escape(labels[statusOf(v)])}</span></div><span class="tracking-driver">${escape(v.driverName)} <small>${escape(v.carrierName)}</small></span><span class="tracking-route">${escape(v.deliveryAddress || 'Delivery address not specified')}</span><span class="tracking-freshness ${statusOf(v)==='active'?'active':''} ${statusOf(v)==='active' && (!v.latestLocation || Date.now()-Date.parse(v.latestLocation.capturedAt)>300000)?'delayed':''}"><i></i>${escape(v.invitationStatus==='failed' && !closed(statusOf(v)) ? 'SMS delivery failed' : freshness(v))}</span></button>`).join('') : `<section class="panel empty-panel"><span class="panel-icon"><svg aria-hidden="true"><use href="#icon-tracking"></use></svg></span><h2>${items.length?'No matching loads':'Your deliveries, in view'}</h2><p>${items.length?'Try another search or filter.':'Create a load and invite its driver to share location.'}</p>${items.length?'':'<button class="primary" type="button" data-tracking-create>Create your first tracking</button>'}</section>`;
    $('tracking-list').scrollTop = listScroll;
    if (focused) $('tracking-list').querySelector(`[data-tracking-select="${focused}"]`)?.focus({preventScroll:true});
    renderDetail();
  }
  function renderDetail() {
    const item = items.find(v=>v.id===selected);
    if (actionItem !== selected) { message('',false,'tracking-action-message'); actionItem = selected; }
    $('tracking-map').hidden = true; $('tracking-map-note').hidden = true;
    if (!item) { $('tracking-detail-meta').innerHTML = ''; $('tracking-detail-content').innerHTML = '<h2>Track your deliveries</h2><p>Select a load to view its driver and location.</p>'; return; }
    const status = statusOf(item);
    $('tracking-detail-meta').innerHTML = `<div class="tracking-detail-heading"><h2>${escape(item.title)}</h2><span class="tracking-status ${status}">${escape(labels[status])}</span></div><dl class="tracking-info"><div><dt>Driver</dt><dd>${escape(item.driverName)}<small>${escape(item.driverPhone)}</small></dd></div><div><dt>Carrier</dt><dd>${escape(item.carrierName)}<small>USDOT ${escape(item.carrierDot)}</small></dd></div><div><dt>Pickup</dt><dd>${escape(item.pickupAddress || 'Not specified')}</dd></div><div><dt>Delivery</dt><dd>${escape(item.deliveryAddress || 'Not specified')}</dd></div><div><dt>Planned pickup</dt><dd>${escape(date(item.plannedAt))}</dd></div><div><dt>Access expires</dt><dd>${escape(date(item.expiresAt))}</dd></div></dl>${item.vehicles?.length?`<div class="tracking-vehicles"><b>Vehicles</b><ul>${item.vehicles.map(v=>'<li>'+escape(v)+'</li>').join('')}</ul></div>`:''}<div class="tracking-location-summary"><b>${escape(freshness(item))}</b><p>${item.latestLocation?(status==='active' && Date.now()-Date.parse(item.latestLocation.capturedAt)>300000 ? 'Waiting for a new GPS fix from the driver’s phone. The map shows the last recorded position.' : 'Accuracy: approximately '+Math.round(item.latestLocation.accuracy)+' m. Position is from the driver’s phone.'):status==='pending'?'The driver must accept this load and start sharing.':status==='accepted'?'The driver has accepted and can start sharing when the trip begins.':status==='paused'?'The driver paused sharing for this load.':'No coordinates have been received for this load.'}</p></div>${status==='pending'?`<p class="tracking-sms-state ${item.invitationStatus==='failed'?'sms-failed':''}">${item.invitationStatus==='sent'?'SMS invitation sent · '+escape(date(item.invitedAt)):item.invitationStatus==='failed'?'SMS invitation was not sent. Retry below.':'SMS invitation has not been sent.'}</p>`:''}${pickup.render(item)}${!closed(status)?`<div class="tracking-load-actions">${status==='pending'?'<button class="secondary" type="button" data-tracking-action="resend">Resend invitation</button>':''}${['accepted','active','paused'].includes(status)?'<button class="primary" type="button" data-tracking-action="complete">Complete load</button>':''}<button class="text-button" type="button" data-tracking-action="cancel">Cancel load</button></div>`:''}`;
    const heading = $('tracking-detail-meta').querySelector('.tracking-detail-heading');
    const summary = $('tracking-detail-meta').querySelector('.tracking-location-summary');
    $('tracking-detail-content').replaceChildren(heading,summary);
    if (item.latestLocation) {
      $('tracking-map').hidden = false; $('tracking-map-note').hidden = false;
      $('tracking-map-note').textContent = 'Last recorded: '+date(item.latestLocation.capturedAt)+(closed(status)?'. Access is closed; no new locations will be shared.':'.');
      drawMap(item);
      if (pointLoad !== item.id) loadPoints(item.id);
    }
  }
  function drawMap(item) {
    if (!window.L) { $('tracking-map').hidden = true; $('tracking-map-note').textContent += ' Map could not load. Refresh to retry.'; return; }
    if (!map) {
      map = L.map('tracking-map',{scrollWheelZoom:false}).setView([39,-98],4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);
      marker = L.circleMarker([39,-98],{radius:8,color:'#fff',weight:3,fillColor:'#286bc0',fillOpacity:1}).addTo(map);
      trail = L.polyline([],{color:'#286bc0',weight:3,opacity:.5}).addTo(map);
    }
    const p = item.latestLocation, position = [p.latitude,p.longitude];
    marker.setLatLng(position); marker.bindTooltip(escape(item.driverName));
    trail.setLatLngs(pointLoad===item.id ? routePoints.map(v=>[v.latitude,v.longitude]):[]);
    requestAnimationFrame(()=>{map.invalidateSize(); if (mappedLoad!==item.id) {map.setView(position,12);mappedLoad=item.id;}});
  }
  async function loadPoints(id) {
    pointLoad = id; routePoints = []; const request = ++pointRequest;
    try {
      const data = await api(`/loads/${id}/points`);
      if (request!==pointRequest || selected!==id) return;
      routePoints = data.points; const item = items.find(v=>v.id===id); if (item?.latestLocation) drawMap(item);
    } catch { pointLoad = ''; }
  }
  async function load(manual = false) {
    if (loading || actionBusy || !context.getSession()) return;
    loading = true; $('tracking-refresh').disabled = true;
    const user = context.getSession().user.id;
    try {
      const data = await api('/loads');
      if (context.getSession()?.user.id!==user) return;
      items = data.items;
      message(''); if (manual) window.workspaceToast('Tracking refreshed.');
      render();
      if (selected && items.find(v=>v.id===selected)?.latestLocation) loadPoints(selected);
    } catch (e) {
      message(e.message,true);
      if (!items.length) $('tracking-list').innerHTML = '<section class="panel empty-panel"><h2>Unable to load tracking</h2><p>Use Refresh to try again.</p></section>';
    } finally { loading = false; $('tracking-refresh').disabled = false; }
  }
  function activate() {
    if (!context?.getSession()) return;
    if (owner!==context.getSession().user.id) {items=[];selected='';owner=context.getSession().user.id;}
    load(); clearInterval(timer);
    timer = setInterval(()=>{if ($('tracking').classList.contains('active') && !document.hidden) load();},15000);
  }
  function updateCarriers(preferredId = '') {
    const value = preferredId || $('tracking-carrier')?.value;
    if (!$('tracking-carrier')) return;
    const seen = new Set();
    const verified = context.getVerifications().filter(v=>v.emailVerified&&v.phoneVerified&&v.licenseUploaded&&v.w9Uploaded&&v.coiUploaded).sort((a,b)=>Number(b.id===value)-Number(a.id===value)).filter(v=>{if(seen.has(v.dot))return false;seen.add(v.dot);return true;});
    $('tracking-carrier').innerHTML = '<option value="">Choose a completed verification</option>' + verified.map(v=>`<option value="${escape(v.id)}">${escape(v.carrierName)} · USDOT ${escape(v.dot)}</option>`).join('');
    if (verified.some(v=>v.id===value)) $('tracking-carrier').value = value;
    $('tracking-carrier-hint').textContent = verified.length?'Use the driver’s own phone number, which may differ from the carrier’s office number.':'Complete a carrier verification first. Create tracking from its carrier details.';
    $('tracking-create-submit').disabled = !verified.length;
  }
  function openCreate(verificationId = '') {
    documentEditor?.destroy(); savedLoadId='';
    $('tracking-create-form').querySelectorAll('input,select,textarea').forEach(el=>el.disabled=false);
    context.showTracking(); $('tracking-create-form').reset(); document.querySelector('.tracking-optional').open=false; requestId = crypto.randomUUID();
    $('tracking-expiry').value = localDate(new Date(Date.now()+7*86400000));
    $('tracking-expiry').min = localDate(new Date(Date.now()+10*60000));
    $('tracking-expiry').max = localDate(new Date(Date.now()+30*86400000-60000));
    message('',false,'tracking-create-message'); updateCarriers(verificationId); $('tracking-carrier').value = verificationId;
    documentEditor=pickup.editor($('tracking-create-documents'),{addressInput:$('tracking-pickup')});
    $('tracking-create-dialog').showModal();
  }
  function closeCreate() { if (!saving) $('tracking-create-dialog').close(); }
  function init(options) {
    context = options;
    // Native dialog supplies focus trapping and restores focus on close.
    const dialog = document.createElement('dialog'); dialog.id = 'tracking-create-dialog'; dialog.className = 'tracking-dialog'; dialog.setAttribute('aria-labelledby','tracking-dialog-title');
    dialog.innerHTML = `<div class="tracking-dialog-heading"><div><p class="eyebrow">Driver invitation</p><h2 id="tracking-dialog-title">New tracking</h2><p>Create a load and invite its driver.</p></div><button id="tracking-dialog-close" class="icon-button" type="button" aria-label="Close new tracking"><svg aria-hidden="true"><use href="#icon-close"></use></svg></button></div><form id="tracking-create-form"><section class="tracking-form-section"><h3>1. Carrier & driver</h3><label for="tracking-carrier">Verified carrier<select id="tracking-carrier" required></select></label><div class="tracking-form-row"><label for="tracking-driver-name">Driver name<input id="tracking-driver-name" required maxlength="120" autocomplete="off" placeholder="Full name"></label><label for="tracking-driver-phone">Driver phone<input id="tracking-driver-phone" type="tel" required maxlength="24" autocomplete="off" placeholder="+1 (555) 123-4567"></label></div><p id="tracking-carrier-hint" class="muted"></p></section><section class="tracking-form-section"><h3>2. Load details</h3><label for="tracking-load-name">Load name / reference<input id="tracking-load-name" required maxlength="160" placeholder="e.g. Load #1042 — Miami delivery"></label><details class="tracking-optional"><summary>Add route, vehicles & pickup time <span class="muted">· optional</span></summary><div><div class="tracking-form-row"><label for="tracking-pickup">Pickup address<input id="tracking-pickup" maxlength="500" placeholder="Auction or pickup location"></label><label for="tracking-delivery">Delivery address<input id="tracking-delivery" maxlength="500" placeholder="Dealership or delivery location"></label></div><label for="tracking-vehicles">Vehicles <small>One vehicle per line</small><textarea id="tracking-vehicles" rows="2" maxlength="8000" placeholder="2024 Toyota Camry · VIN or stock number"></textarea></label><label for="tracking-planned">Planned pickup<input id="tracking-planned" type="datetime-local"></label></div></details></section><section class="tracking-form-section"><h3>3. Location access</h3><label for="tracking-expiry">Tracking expires<input id="tracking-expiry" type="datetime-local" required></label><p class="tracking-consent-note">The driver accepts this load and starts sharing in DeepTruck Driver. Access ends when the load is completed or expires.</p></section><section id="tracking-create-documents" class="pickup-editor"></section><div id="tracking-create-message" class="inline-message" role="status" aria-live="polite"></div><div class="tracking-dialog-actions"><button id="tracking-dialog-cancel" class="secondary" type="button">Cancel</button><button id="tracking-create-submit" class="primary" type="submit">Send invitation</button></div></form>`;
    document.body.append(dialog);
    $('new-tracking-button').addEventListener('click',()=>openCreate());
    $('tracking-dialog-close').addEventListener('click',closeCreate); $('tracking-dialog-cancel').addEventListener('click',closeCreate);
    dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
    $('tracking-refresh').addEventListener('click',()=>load(true));
    $('tracking-search').addEventListener('input',render); $('tracking-filter').addEventListener('change',render);
    document.querySelectorAll('[data-tracking-filter]').forEach(button => button.addEventListener('click',()=>{ $('tracking-filter').value=button.dataset.trackingFilter; render(); }));
    $('tracking-back').addEventListener('click',()=>{document.querySelector('.tracking-layout').classList.remove('mobile-detail');$('tracking-list').querySelector(`[data-tracking-select="${selected}"]`)?.focus();});
    $('tracking-list').addEventListener('click',e=>{
      const card = e.target.closest('[data-tracking-select]');
      if (card) {selected=card.dataset.trackingSelect;render();document.querySelector('.tracking-layout').classList.add('mobile-detail');if(matchMedia('(max-width:760px)').matches){$('tracking-back').focus();$('tracking-detail').scrollIntoView({block:'start'});}else $('tracking-list').querySelector(`[data-tracking-select="${selected}"]`)?.focus();}
      if (e.target.closest('[data-tracking-create]')) openCreate();
    });
    $('tracking-detail').addEventListener('click',async e=>{
      const item=items.find(v=>v.id===selected);
      const inspection=e.target.closest('[data-pickup-inspection]');
      if(inspection && item && !actionBusy){void pickup.openInspection(item,inspection.dataset.pickupInspection,api);return;}
      if(e.target.closest('[data-pickup-add]') && item && !actionBusy){pickup.openEditor(item,api,()=>load());return;}
      const openDocument=e.target.closest('[data-pickup-open]'),unlockDocuments=e.target.closest('[data-pickup-unlock]');
      if((openDocument || unlockDocuments) && !actionBusy && item){
        if(unlockDocuments && !confirm('Unlock pickup documents for this driver now?'))return;
        const target=selected,button=openDocument || unlockDocuments;
        const preview=openDocument?window.open('about:blank','_blank'):null;if(preview)preview.opener=null;
        actionBusy=true;button.disabled=true;message('',false,'tracking-action-message');
        try{
          const data=await api(`/loads/${target}/documents/${openDocument?openDocument.dataset.pickupOpen+'/open':'unlock'}`,{});
          if(openDocument){if(preview)preview.location.replace(data.url);else window.location.assign(data.url);}
          else {actionBusy=false;await load();window.workspaceToast('Pickup documents unlocked.');}
        }catch(error){preview?.close();if(target===selected)message(error.message,true,'tracking-action-message');else window.workspaceToast(error.message);}
        finally{actionBusy=false;button.disabled=false;}return;
      }
      const button = e.target.closest('[data-tracking-action]'); if (!button || actionBusy) return;
      const action = button.dataset.trackingAction, id = selected;
      if (action!=='resend' && !confirm(action==='complete'?'Complete this load and close its location access?':'Cancel this load and close its location access?')) return;
      actionBusy = true; button.disabled = true; message('',false,'tracking-action-message');
      try {const data = await api(`/loads/${id}/${action}`,{});actionBusy=false;await load();const result=data.invitation?.message || (action==='complete'?'Load completed. Location access is closed.':'Load cancelled.'); if(data.invitation?.sent===false && selected===id) message(result,true,'tracking-action-message'); else window.workspaceToast(result);}
      catch (err) {if(selected===id) message(err.message,true,'tracking-action-message'); else window.workspaceToast(err.message);button.disabled=false;} finally {actionBusy=false;}
    });
    $('tracking-create-form').addEventListener('submit',async e=>{
      e.preventDefault(); if (saving) return;
      const vehicles = $('tracking-vehicles').value.split('\n').map(v=>v.trim()).filter(Boolean);
      if (vehicles.length>50) {message('Add no more than 50 vehicles.',true,'tracking-create-message');return;}
      const expiry = new Date($('tracking-expiry').value), planned = $('tracking-planned').value ? new Date($('tracking-planned').value) : null;
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime()<=Date.now()+300000 || expiry.getTime()>Date.now()+30*86400000 || (planned && planned>=expiry)) {message('Choose a valid expiry after planned pickup, within 30 days.',true,'tracking-create-message');return;}
      try{documentEditor.validate();}catch(error){message(error.message,true,'tracking-create-message');return;}
      saving = true; $('tracking-create-submit').disabled=true; $('tracking-create-submit').textContent='Saving…'; message('',false,'tracking-create-message');
      try {
        let data;
        if(!savedLoadId){
          data = await api('/loads',{clientRequestId:requestId,verificationId:$('tracking-carrier').value,driverName:$('tracking-driver-name').value,driverPhone:$('tracking-driver-phone').value,title:$('tracking-load-name').value,vehicles,pickupAddress:$('tracking-pickup').value,deliveryAddress:$('tracking-delivery').value,plannedAt:planned?.toISOString() || null,expiresAt:expiry.toISOString(),deferInvitation:documentEditor.hasFiles()});
          savedLoadId=data.load.id;
          $('tracking-create-form').querySelectorAll('.tracking-form-section input,.tracking-form-section select,.tracking-form-section textarea').forEach(el=>el.disabled=true);
        }
        if(documentEditor.hasFiles()){
          $('tracking-create-submit').textContent='Uploading…';await documentEditor.save(savedLoadId,api);
          data={load:{id:savedLoadId},...await api(`/loads/${savedLoadId}/resend`,{})};
        }else if(!data){data={load:{id:savedLoadId},invitation:{sent:false,message:'Load saved. You can send its invitation from the tracking card.'}};}
        selected=data.load.id; $('tracking-filter').value='open'; $('tracking-search').value='';dialog.close(); await load(); document.querySelector('.tracking-layout').classList.add('mobile-detail'); if(data.invitation.sent) window.workspaceToast('Driver invitation sent.'); else message(data.invitation.message,true,'tracking-action-message');
      } catch (err) {message((savedLoadId?'Load saved. ':'')+err.message,true,'tracking-create-message');}
      finally {saving=false;$('tracking-create-submit').disabled=false;$('tracking-create-submit').textContent='Send invitation';}
    });
  }
  window.deepTruckTracking = {init,activate,openCreate,updateCarriers};
})();
