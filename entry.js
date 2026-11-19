(()=>{
  if(globalThis.orletEntryStarted)return;
  globalThis.orletEntryStarted=true;
  let busy=false;
  const retryDelays=[0,1000,2000,3500];
  async function connectTarget(retrying){
    const config=new URL('./backend.json',location.href);
    if(retrying)config.searchParams.set('check',String(Date.now()));
    const options={cache:'no-store',credentials:'omit'};
    const response=await fetch(config,{...options,signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error('configuration');
    const {backendOrigin}=await response.json(),origin=new URL(backendOrigin);
    if(origin.protocol!=='https:'||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(origin.hostname)||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw Error('configuration');
    const check=await fetch(new URL('/api/health',origin),{...options,signal:AbortSignal.timeout(4000)});
    if(!check.ok||(await check.json()).ok!==true)throw Error('gateway');
    const target=new URL('/',origin);
    target.search=location.search;target.hash=location.hash;
    return target;
  }

  async function connect(){
    if(busy)return;busy=true;
    const status=document.getElementById('entry-status'),retry=document.getElementById('entry-retry');
    if(status)status.textContent='正在连接…';if(retry)retry.hidden=true;
    try{
      for(const delay of retryDelays){
        if(delay){
          if(status)status.textContent='正在重新连接…';
          await new Promise(done=>setTimeout(done,delay));
        }
        let target;
        try{target=await connectTarget(delay>0);}catch{continue;}
        location.replace(target.href);
        return;
      }
      if(status)status.textContent='暂时无法连接，请稍后重试。';
      if(retry)retry.hidden=false;
    }finally{busy=false;}
  }
  document.getElementById('entry-retry')?.addEventListener('click',connect);
  void connect();
})();
