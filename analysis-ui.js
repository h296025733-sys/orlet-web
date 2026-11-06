export function createAnalysisUi({api,$,esc,enabled}){
  let generation=0,target=null,busy=false,waiting=null;
  const pending=new Map();
  const pathFor=item=>item.documentId?'/documents/'+encodeURIComponent(item.documentId)+'/analysis':'/articles/'+item.id+'/analysis';
  function invalidate(){generation++;if(waiting){clearTimeout(waiting.timer);waiting.resolve(false);waiting=null;}return generation;}
  function close(){invalidate();target=null;busy=false;$('#analysis-dialog').close();}
  function pause(token){return new Promise(resolve=>{const timer=setTimeout(()=>{waiting=null;resolve(token===generation);},2500);waiting={timer,resolve};});}
  function post(base,versionId){
    const key=base+':'+(versionId||'preparing');let job=pending.get(key);
    if(!job){job=api(base,{method:'POST',body:JSON.stringify(versionId?{versionId}:{}),...(globalThis.AbortSignal?.timeout?{signal:AbortSignal.timeout(30000)}:{})});pending.set(key,job);job.finally(()=>{if(pending.get(key)===job)pending.delete(key);}).catch(()=>{});}
    return job;
  }
  function status(message,retry=false){$('#analysis-status').textContent=message;$('#analysis-status').hidden=!message;$('#analysis-retry').hidden=!retry;}
  function render(data){
    const result=data.result||{},points=Array.isArray(result.keyPoints)?result.keyPoints:[],caveats=Array.isArray(result.caveats)?result.caveats:[];
    $('#analysis-result').innerHTML=`<p class="analysis-brief">${esc(result.brief||'')}</p>${points.length?`<h3>重点</h3><ul>${points.map(point=>`<li>${esc(point)}</li>`).join('')}</ul>`:''}${caveats.length?`<h3>留意</h3><ul>${caveats.map(point=>`<li>${esc(point)}</li>`).join('')}</ul>`:''}`;
    const coverage=data.coverage||{},labels=[];
    if(coverage.scope==='text_only'&&coverage.totalImages)labels.push('仅分析文字');
    if(coverage.scope==='text_and_images')labels.push(`含 ${Number(coverage.imageCount)||0} 张配图`);
    if(coverage.textTruncated)labels.push('已截取部分正文');else if(coverage.bodyComplete===false)labels.push('正文尚未完整');
    if(coverage.skippedImages&&coverage.scope!=='text_only')labels.push('部分图片未分析');
    if(coverage.videoCount)labels.push('未分析视频内容');
    $('#analysis-coverage').textContent=labels.join(' · ');$('#analysis-coverage').hidden=!labels.length;
    status('');
  }
  async function run(item,token,prepareAgain=false){
    busy=true;status('正在分析…');
    try{
      const read=path=>api(path,globalThis.AbortSignal?.timeout?{signal:AbortSignal.timeout(30000)}:{});
      const config=await read('/ai/status');if(token!==generation)return;
      if(!config.configured){status('请先在主机连接 DeepSeek');return;}
      const base=pathFor(item),query=item.versionId?'?versionId='+encodeURIComponent(item.versionId):'';
      let data=await read(base+query),prepared=false,polls=0,submitted=false;const deadline=Date.now()+120000;
      while(token===generation){
        if(data.status==='ready'&&data.result){render(data);return;}
        if(data.status==='body_unavailable'){
          if(prepareAgain&&!prepared){prepared=true;data=await post(base);continue;}
          throw new Error(data.error||'原文暂未取得，请稍后重试');
        }
        if(!['missing','preparing','running','error'].includes(data.status))throw new Error('暂未完成，请稍后重试');
        if(['missing','error'].includes(data.status)&&(item.versionId||data.versionId)){
          if(submitted)throw new Error(data.error||'暂未确认分析请求，请重试');
          submitted=true;status('正在分析…');try{data=await post(base,item.versionId||data.versionId);}catch(error){if(error.status&&error.status<500)throw error;data={status:'running'};}continue;
        }
        status(data.status==='running'?'正在分析…':'正在准备文章…');
        if(data.status==='missing'&&!prepared){prepared=true;data=await post(base);continue;}
        if(polls>=48||Date.now()>=deadline)throw new Error(data.status==='running'?'分析仍在继续，可稍后查看':'文章还在准备，请稍后重试');
        if(!await pause(token)||token!==generation)return;
        if(Date.now()>=deadline)throw new Error('文章还在准备，请稍后重试');
        polls++;try{data=await read(base+query);}catch(error){if(error.status&&error.status<500)throw error;status('正在重新连接…');}
      }
    }catch(error){if(token===generation)status(error.status===409?'暂时无法取得正文，请稍后重试':error.status===503?'请先在主机连接 DeepSeek':['TimeoutError','AbortError'].includes(error.name)?'请求用时较长，请稍后重试':error.message||'分析暂不可用',error.status!==503);}
    finally{if(token===generation)busy=false;}
  }
  async function open(item){
    if(!enabled()||!item)return;target={...item};const token=invalidate();$('#analysis-title').textContent=item.title||'文章分析';$('#analysis-result').innerHTML='';$('#analysis-coverage').hidden=true;$('#analysis-dialog').showModal();await run(target,token);
  }
  $('#analysis-close').addEventListener('click',close);$('#analysis-dialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#analysis-retry').addEventListener('click',()=>{if(target&&!busy)void run(target,invalidate(),true);});
  return{open,close};
}
