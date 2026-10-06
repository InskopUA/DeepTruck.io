(() => {
  const id = new URLSearchParams(location.search).get('invite');
  if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) document.getElementById('open-driver').href = 'deeptruck-driver://loads?invite=' + encodeURIComponent(id);
  fetch('https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/driver-tracking/config',{signal:AbortSignal.timeout(10000)})
    .then(response=>{if(!response.ok)throw new Error();return response.json();})
    .then(config=>{
      let available = false;
      for (const [field,element,host] of [['iosStoreUrl','ios-store','apps.apple.com'],['androidStoreUrl','android-store','play.google.com']]) {
        if(!config[field])continue;
        try {const url=new URL(config[field]);if(url.protocol!=='https:' || url.hostname!==host)continue;const link=document.getElementById(element);link.href=url.href;link.hidden=false;available=true;}catch{}
      }
      document.getElementById('store-links').hidden=!available;
      document.getElementById('install-status').textContent=available?'If you installed the app, tap Open above.':'DeepTruck Driver is in pilot testing. If you do not have the app installed, ask your dealer for a test build.';
    }).catch(()=>{document.getElementById('install-status').textContent='If you do not have the app installed, contact your dealer for installation instructions.';});
})();
