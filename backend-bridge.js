// GitHub Pages only. Configuration contains one public API origin, no secrets.
(()=>{
  const nativeFetch=window.fetch.bind(window),configUrl=new URL('https://raw.githubusercontent.com/h296025733-sys/orlet-web/main/backend.json'),known=new Set();
  let base='',flight=null,changedAt=0;
  function origin(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('连接暂时不可用，请稍后重试');return u.origin;}
  function path(value){if(typeof value!=='string')return'';if(value.startsWith('/api/')||value==='/api')return value;try{const u=new URL(value);return known.has(u.origin)&&u.pathname.startsWith('/api/')?u.pathname+u.search:'';}catch{return'';}}
  async function refresh(force=false){
    if(flight)return flight;if(!force&&base&&Date.now()-changedAt<30000)return base;
    flight=(async()=>{const u=new URL(configUrl);u.searchParams.set('v',String(Date.now()));const r=await nativeFetch(u,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('连接暂时不可用，请稍后重试');const data=await r.json(),next=origin(data.backendOrigin),previous=base;known.add(next);base=next;changedAt=Date.now();if(previous&&previous!==next)window.dispatchEvent(new CustomEvent('orlet-backend-change'));return base;})();
    try{return await flight;}finally{flight=null;}
  }
  function url(value){const p=path(value);return p?base+p:value;}
  async function request(value,options={}){
    if(!base)await ready.catch(()=>refresh(true));const p=path(value);if(!p)throw Error('请求地址无效');
    const method=(options.method||'GET').toUpperCase(),headers=new Headers(options.headers||{});if(['GET','HEAD'].includes(method))headers.delete('Content-Type');
    const send=()=>nativeFetch(base+p,{...options,headers,credentials:'omit'}),before=base;
    try{const r=await send();if(r.status<500)return r;try{await refresh(true);}catch{}if(base!==before&&['GET','HEAD'].includes(method))return send();return r;}
    catch(error){if(options.signal?.aborted)throw error;try{await refresh(true);}catch{}if(base!==before&&['GET','HEAD'].includes(method))return send();throw Error('连接暂时不可用，请稍后重试');}
  }
  function updateLinks(){for(const a of document.querySelectorAll('a[href]')){const p=path(a.getAttribute('href'));if(p)a.href=url(p);}}
  const ready=refresh(true);ready.then(updateLinks).catch(()=>{});document.addEventListener('DOMContentLoaded',()=>ready.then(updateLinks).catch(()=>{}));window.addEventListener('orlet-backend-change',updateLinks);
  window.orletBackend={ready,url,path,request,refresh};
  setInterval(()=>{if(document.visibilityState!=='hidden')refresh().catch(()=>{});},30000);
})();
