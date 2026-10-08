(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kindName = kind => kind==='release_form' ? 'Release form' : 'Gate pass';
  const closed = load => ['completed','cancelled','declined','expired'].includes(load.status) || Date.parse(load.expiresAt)<=Date.now();
  function render(load) {
    const state=load.pickupDocuments || {documents:[],status:'locked'}, files=state.documents || [];
    return `<section class="pickup-documents"><div class="pickup-documents-heading"><h3>Pickup documents</h3>${!closed(load)?'<button type="button" class="text-button" data-pickup-add>Add documents</button>':''}</div>${files.length ? `<p class="pickup-document-note">${closed(load)?'Driver access is closed.':state.status==='available'?`Unlocked ${state.unlockMethod==='manual'?'by you':'at pickup'}.`:'Unlocks within 1 mile of the pickup address.'}</p><ul class="pickup-document-list">${files.map(file=>`<li><span class="pickup-file-icon"><svg aria-hidden="true"><use href="#icon-doc"></use></svg></span><div><b>${escape(file.name)}</b><small>${kindName(file.kind)} · ${file.openedAt?'Opened':closed(load)?'Closed':state.status==='available'?'Available':'Locked'}</small></div><button type="button" class="secondary" data-pickup-open="${escape(file.id)}" aria-label="Open ${escape(file.name)}">View</button></li>`).join('')}</ul>${!closed(load) && state.status==='locked'?'<button type="button" class="secondary" data-pickup-unlock>Unlock documents</button>':''}` : '<p class="pickup-document-note">Gate passes and release forms for this pickup.</p>'}</section>`;
  }
  function editor(root,{load=null,addressInput=null}={}) {
    let files=[],point=load?.pickupLocation ? {...load.pickupLocation} : null,map,marker,circle,searchController,busy=false;
    const frozen=Boolean(load?.pickupDocuments?.unlockedAt), existingCount=load?.pickupDocuments?.documents?.length || 0;
    root.innerHTML=`<div class="pickup-upload-heading"><div><h3>Pickup documents <small>· optional</small></h3><p>Gate passes and release forms · PDF, JPG or PNG · up to 10 MB each</p></div><label class="secondary pickup-file-picker">Add files<input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple aria-label="Add pickup documents"></label></div><div class="pickup-upload-list"></div><div class="pickup-location-fields" hidden><label>Exact pickup address<div class="pickup-address-search"><input type="text" maxlength="500" autocomplete="street-address" placeholder="Street address, city, state and ZIP" aria-label="Exact pickup address" ${frozen?'readonly':''}><button class="secondary" type="button" data-pickup-search ${frozen?'hidden':''}>Find address</button></div></label><div class="pickup-address-results" role="list"></div><div class="pickup-pin-map" aria-label="Pickup location and one-mile unlock radius"></div><p class="pickup-map-hint">${frozen?'Pickup location is fixed because documents are already unlocked.':'Select the exact pickup entrance on the map. Documents unlock within 1 mile.'}</p><label class="pickup-pin-confirm"><input type="checkbox" aria-label="Confirm pickup location" ${point?'checked':''} ${frozen?'disabled':''}>This pin marks the correct pickup location.</label><small class="pickup-map-credit">Address search: Photon / OpenStreetMap</small></div><p class="pickup-editor-message" role="status" aria-live="polite"></p>`;
    const input=root.querySelector('[aria-label="Exact pickup address"]'),confirm=root.querySelector('[aria-label="Confirm pickup location"]'),fileInput=root.querySelector('input[type="file"]'),fields=root.querySelector('.pickup-location-fields'),list=root.querySelector('.pickup-upload-list'),message=root.querySelector('.pickup-editor-message'),results=root.querySelector('.pickup-address-results'),search=root.querySelector('[data-pickup-search]');
    input.value=load?.pickupAddress || addressInput?.value || '';
    function showMessage(value) {message.textContent=value;}
    function place(lat,lng,zoom=true) {
      point={latitude:lat,longitude:lng};confirm.checked=false;
      if (!map) return;
      if (!marker) {
        marker=L.marker([lat,lng],{draggable:!frozen,icon:L.divIcon({className:'pickup-map-pin',html:'',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
        marker.on('dragend',()=>{const p=marker.getLatLng();place(p.lat,p.lng,false);});
        circle=L.circle([lat,lng],{radius:1609.344,color:'#286bc0',weight:1.5,fillOpacity:.08}).addTo(map);
      } else {marker.setLatLng([lat,lng]);circle.setLatLng([lat,lng]);}
      if(zoom)map.fitBounds(circle.getBounds(),{padding:[16,16]});
    }
    function showLocation() {
      let createdMap=false;
      fields.hidden=!(files.length || existingCount);
      if(addressInput){addressInput.closest('label').hidden=!fields.hidden;if(!fields.hidden)addressInput.value=input.value;}
      if(fields.hidden)return;
      if(!map && window.L){
        createdMap=true;
        map=L.map(root.querySelector('.pickup-pin-map'),{scrollWheelZoom:false}).setView([39,-98],4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
        if(!frozen)map.on('click',event=>place(event.latlng.lat,event.latlng.lng,false));
        if(point){const wasConfirmed=confirm.checked;place(point.latitude,point.longitude);confirm.checked=wasConfirmed;}
      }
      requestAnimationFrame(()=>{if(!map)return;map.invalidateSize();if(createdMap && circle)map.fitBounds(circle.getBounds(),{padding:[16,16],animate:false});});
    }
    function renderFiles() {
      list.innerHTML=files.map((entry,index)=>`<div class="pickup-upload-row"><span class="pickup-file-name" title="${escape(entry.file.name)}">${escape(entry.file.name)}</span><select aria-label="Document type for ${escape(entry.file.name)}" data-pickup-kind="${index}" ${entry.uploaded?'disabled':''}><option value="gate_pass" ${entry.kind==='gate_pass'?'selected':''}>Gate pass</option><option value="release_form" ${entry.kind==='release_form'?'selected':''}>Release form</option></select>${entry.uploaded?'<span class="pickup-uploaded">Uploaded</span>':`<button type="button" class="icon-button" data-pickup-remove="${index}" aria-label="Remove ${escape(entry.file.name)}">×</button>`}</div>`).join('');showLocation();
    }
    fileInput.addEventListener('change',()=>{
      if(busy)return;
      showMessage('');
      for(const file of fileInput.files){
        if(files.length+existingCount>=20){showMessage('Add no more than 20 pickup documents.');break;}
        if(!file.size || file.size>10485760 || !/\.(pdf|jpe?g|png)$/i.test(file.name)){showMessage('Choose PDF, JPG or PNG files, up to 10 MB each.');continue;}
        if(file.name.length>180){showMessage('Use a file name shorter than 180 characters.');continue;}
        files.push({file,id:crypto.randomUUID(),kind:/release/i.test(file.name)?'release_form':'gate_pass',uploaded:false});
      }
      fileInput.value='';renderFiles();
    });
    list.addEventListener('change',event=>{const index=event.target.dataset.pickupKind;if(index!==undefined&&!busy)files[Number(index)].kind=event.target.value;});
    list.addEventListener('click',event=>{const button=event.target.closest('[data-pickup-remove]');if(button&&!busy){files.splice(Number(button.dataset.pickupRemove),1);renderFiles();}});
    input.addEventListener('input',()=>{confirm.checked=false;results.replaceChildren();if(addressInput)addressInput.value=input.value;});
    search.addEventListener('click',async()=>{
      if(busy)return;
      const query=input.value.trim();if(query.length<5){showMessage('Enter the exact pickup address.');return;}
      searchController?.abort();searchController=new AbortController();const controller=searchController;
      search.disabled=true;showMessage('Finding address…');results.replaceChildren();const timeout=setTimeout(()=>controller.abort(),15000);
      try {
        // Deliberate searches only: no keystroke polling of the public geocoder.
        const response=await fetch('https://photon.komoot.io/api/?limit=5&lang=en&q='+encodeURIComponent(query),{signal:controller.signal});
        if(!response.ok)throw new Error();const data=await response.json();
        const matches=(data.features || []).filter(f=>f.geometry?.type==='Point' && f.geometry.coordinates?.length===2 && f.geometry.coordinates.every(Number.isFinite));
        if(!matches.length){showMessage('Address not found. You can select the pickup entrance directly on the map.');return;}
        showMessage('Select your pickup location, then confirm its map pin.');
        matches.forEach(feature=>{
          const p=feature.properties || {},label=[p.name,[p.housenumber,p.street].filter(Boolean).join(' '),p.city || p.county,p.state,p.postcode].filter(Boolean).join(', ');
          const button=document.createElement('button');button.type='button';button.className='pickup-address-result';button.textContent=label || query;
          button.addEventListener('click',()=>{place(feature.geometry.coordinates[1],feature.geometry.coordinates[0]);results.replaceChildren();showMessage('');});results.append(button);
        });
      }catch{if(searchController===controller)showMessage('Address search unavailable. Select the pickup entrance directly on the map.');}
      finally{clearTimeout(timeout);if(searchController===controller)search.disabled=false;}
    });
    showLocation();
    return {
      hasFiles:()=>files.length>0,
      validate(){if(!files.length)return;if(!window.L || !point || !confirm.checked || input.value.trim().length<5)throw new Error('Confirm the exact pickup address and map pin for your documents.');},
      async save(id,api){
        if(!files.length)return;this.validate();busy=true;
        const controls=[...root.querySelectorAll('input,select,button')];controls.forEach(el=>el.disabled=true);
        try{
          await api(`/loads/${id}/pickup`,{address:input.value.trim(),latitude:point.latitude,longitude:point.longitude,confirmed:true});
          for(const entry of files){if(entry.uploaded)continue;const form=new FormData();form.append('id',entry.id);form.append('kind',entry.kind);form.append('file',entry.file);await api(`/loads/${id}/documents`,form);entry.uploaded=true;renderFiles();}
        }finally{busy=false;controls.forEach(el=>el.disabled=false);if(frozen)confirm.disabled=true;renderFiles();}
      },
      destroy(){searchController?.abort();map?.remove();map=null;if(addressInput)addressInput.closest('label').hidden=false;},
    };
  }
  async function openEditor(load,api,onSaved) {
    const dialog=document.createElement('dialog');dialog.className='tracking-dialog pickup-edit-dialog';dialog.setAttribute('aria-labelledby','pickup-edit-title');
    dialog.innerHTML='<div class="tracking-dialog-heading"><h2 id="pickup-edit-title">Add pickup documents</h2><button type="button" class="icon-button" data-pickup-close aria-label="Close pickup documents">×</button></div><form><div class="pickup-editor"></div><p class="inline-message" data-pickup-message role="status"></p><div class="tracking-dialog-actions"><button type="button" class="secondary" data-pickup-close>Cancel</button><button class="primary" type="submit">Save documents</button></div></form>';
    document.body.append(dialog);const edit=editor(dialog.querySelector('.pickup-editor'),{load});let saving=false;
    const close=()=>{if(!saving)dialog.close();};dialog.querySelectorAll('[data-pickup-close]').forEach(el=>el.addEventListener('click',close));
    dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});dialog.addEventListener('close',()=>{edit.destroy();dialog.remove();});
    dialog.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();if(saving)return;const message=dialog.querySelector('[data-pickup-message]'),button=dialog.querySelector('[type="submit"]');
      try{if(!edit.hasFiles())throw new Error('Choose a pickup document.');edit.validate();saving=true;button.disabled=true;button.textContent='Uploading…';message.textContent='';await edit.save(load.id,api);saving=false;dialog.close();await onSaved();window.workspaceToast('Pickup documents added.');}
      catch(error){message.textContent=error.message;message.classList.add('error');}
      finally{saving=false;button.disabled=false;button.textContent='Save documents';}
    });dialog.showModal();
  }
  window.deepTruckPickupDocuments={render,editor,openEditor};
})();
