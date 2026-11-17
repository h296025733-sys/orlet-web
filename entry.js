(()=>{
  if(globalThis.orletEntryStarted)return;
  globalThis.orletEntryStarted=true;
  let busy=false;
  async function connect(){
    if(busy)return;busy=true;
    const status=document.getElementById('entry-status'),retry=document.getElementById('entry-retry');
    if(status)status.textContent='正在连接…';if(retry)retry.hidden=true;
    try{
      const response=await fetch(new URL('./backend.json',location.href),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('configuration');
      const {backendOrigin}=await response.json(),origin=new URL(backendOrigin);
      if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(origin.hostname)||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw Error('configuration');
      const target=new URL('/',origin);
      target.search=location.search;target.hash=location.hash;
      location.replace(target.href);
    }catch{
      if(status)status.textContent='暂时无法连接，请稍后重试。';
      if(retry)retry.hidden=false;
    }finally{busy=false;}
  }
  document.getElementById('entry-retry')?.addEventListener('click',connect);
  void connect();
})();
