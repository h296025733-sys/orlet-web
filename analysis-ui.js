// Render received text at a steady frame cadence, independently of network
// chunk boundaries. Cached results bypass this queue entirely.
export function createProgressiveReveal({draw,requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis),reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches}={}){
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  const split=text=>segmenter?[...segmenter.segment(text)].map(x=>x.segment):Array.from(text);
  let fields=[],frame=null,last=null,credit=0,waiters=[],started=false,finished=false;
  const remaining=()=>fields.reduce((sum,f)=>sum+f.chars.length-f.count,0);
  const snapshot=()=>{const value={brief:'',keyPoints:[],caveats:[]};for(const f of fields){const text=f.chars.slice(0,f.count).join('');if(f.key==='brief')value.brief=text;else if(text)value[f.key].push(text);}return value;};
  const settle=()=>{for(const resolve of waiters.splice(0))resolve();};
  const stop=()=>{if(frame!==null)cancelFrame?.(frame);frame=null;last=null;credit=0;settle();};
  function tick(time){
    frame=null;const pending=remaining(),elapsed=last===null?16:Math.min(32,Math.max(0,time-last));last=time;
    // Research may offer a short opening several seconds before the analysis.
    // Start only once the explanation is flowing, with a small reserve to cover
    // gaps between network updates. The existing spinner stays visible meanwhile.
    const explanation=fields.filter(f=>f.key!=='brief').reduce((sum,f)=>sum+f.chars.length,0);
    if(!started&&!finished&&(explanation<24||pending<72)){last=null;return;}
    started=true;
    // Ease down as the reserve shrinks instead of consuming every new batch at
    // once. Completion drains at the same upper speed, never dumping the tail.
    const rate=finished?60:Math.min(60,Math.max(14,pending/2));
    credit=Math.min(2,credit+elapsed*rate/1000);
    let budget=Math.min(2,Math.floor(credit)),changed=false;credit-=budget;
    for(const f of fields){const count=Math.min(budget,f.chars.length-f.count);if(count){f.count+=count;budget-=count;changed=true;}if(!budget)break;}
    if(changed)draw(snapshot());
    if(remaining())frame=requestFrame(tick);else{last=null;credit=0;settle();}
  }
  return{
    update(value){
      const previous=new Map(fields.map(f=>[f.key+':'+f.index,f]));
      fields=[{key:'brief',index:0,text:typeof value.brief==='string'?value.brief:''},...['keyPoints','caveats'].flatMap(key=>(Array.isArray(value[key])?value[key]:[]).filter(x=>typeof x==='string').map((text,index)=>({key,index,text})))].map(({text,...f})=>{
        const chars=split(text),old=previous.get(f.key+':'+f.index);let count=0;
        while(old&&count<old.count&&count<chars.length&&old.chars[count]===chars[count])count++;
        return{...f,chars,count};
      });
      if(!requestFrame||reducedMotion()){stop();for(const f of fields)f.count=f.chars.length;draw(snapshot());return;}
      if(!remaining()){stop();draw(snapshot());return;}
      if(remaining()&&frame===null)frame=requestFrame(tick);
    },
    drain(){finished=true;if(!remaining())return Promise.resolve();if(frame===null)frame=requestFrame(tick);return new Promise(resolve=>waiters.push(resolve));},
    reset(){stop();fields=[];started=false;finished=false;}
  };
}

export function createAnalysisUi({api,$,esc,enabled,streamRequest}){
  let generation=0,target=null,busy=false,waiting=null,streaming=null,nodes=null,hasPreview=false,animate=false,revealData=null,cursor=null;
  const reveal=createProgressiveReveal({draw:result=>paint({...revealData,result},false,busy)});
  const pending=new Map();
  const requestStream=streamRequest||((path,options)=>globalThis.orletBackend?.request?globalThis.orletBackend.request('/api'+path,options):fetch('/api'+path,options));
  const pathFor=item=>item.documentId?'/documents/'+encodeURIComponent(item.documentId)+'/analysis':'/articles/'+item.id+'/analysis';
  function invalidate(){generation++;animate=false;reveal.reset();cursor?.classList?.remove('analysis-cursor');cursor=null;if(waiting){clearTimeout(waiting.timer);waiting.resolve(false);waiting=null;}if(streaming){streaming.controller.abort();void streaming.reader?.cancel().catch(()=>{});streaming=null;}return generation;}
  function close(){invalidate();target=null;busy=false;$('#analysis-dialog').close();}
  function pause(token){return new Promise(resolve=>{const timer=setTimeout(()=>{waiting=null;resolve(token===generation);},2500);waiting={timer,resolve};});}
  function post(base,versionId){
    const key=base+':'+(versionId||'preparing');let job=pending.get(key);
    if(!job){job=api(base+'?background=1',{method:'POST',body:JSON.stringify(versionId?{versionId}:{}),...(globalThis.AbortSignal?.timeout?{signal:AbortSignal.timeout(30000)}:{})});pending.set(key,job);job.finally(()=>{if(pending.get(key)===job)pending.delete(key);}).catch(()=>{});}
    return job;
  }
  function status(message,retry=false){const node=$('#analysis-status');node.textContent=message;node.hidden=!message;node.classList?.toggle('analysis-pending',!retry&&/^正在/.test(message));$('#analysis-retry').hidden=!retry;}
  function render(data,partial=false){
    const result=(partial?data.preview:data.result)||{};
    if(!animate){paint(data,partial);return;}
    if(!result.brief&&!result.keyPoints?.some(Boolean)&&!result.caveats?.some(Boolean))return;
    revealData=data;reveal.update(result);
  }
  function paint(data,partial=false,clearStatus=true){
    const result=(partial?data.preview:data.result)||{},brief=typeof result.brief==='string'?result.brief:'',points=Array.isArray(result.keyPoints)?result.keyPoints.filter(x=>typeof x==='string'):[],caveats=Array.isArray(result.caveats)?result.caveats.filter(x=>typeof x==='string'):[];
    if(partial&&!brief&&!points.some(Boolean)&&!caveats.some(Boolean))return;
    const panel=$('#analysis-dialog'),follow=animate&&panel.scrollHeight-panel.scrollTop-panel.clientHeight<48;
    const container=$('#analysis-result'),doc=container.ownerDocument;
    if(doc?.createElement){
      if(!nodes){
        const make=(tag,className)=>{const node=doc.createElement(tag);node.className=className;container.appendChild(node);return node;};
        nodes={brief:make('p','analysis-brief'),points:make('ul','analysis-points'),caveats:make('ul','analysis-notes')};
      }
      const setText=(node,text)=>{const old=node.textContent;if(old===text)return;if(node.childNodes.length===1&&node.firstChild.nodeType===3&&text.startsWith(old))node.firstChild.appendData(text.slice(old.length));else node.textContent=text;};
      const setPoint=(node,text)=>{
        const {lead,body}=pointParts(text);
        if(!lead){setText(node,text);return;}
        // Build the emphasis once when its colon arrives, then keep appending
        // to the same text nodes as the reveal queue advances.
        if(node.firstChild?.tagName?.toLowerCase()!=='strong'){node.textContent='';node.appendChild(doc.createElement('strong'));node.appendChild(doc.createElement('span'));}
        setText(node.firstChild,lead);setText(node.lastChild,body);
      };
      const list=(node,items)=>{node.hidden=!items.length;for(let i=0;i<items.length;i++){let child=node.children[i];if(!child){child=doc.createElement('li');node.appendChild(child);}setPoint(child,items[i]);}while(node.children.length>items.length)node.removeChild(node.lastChild);};
      setText(nodes.brief,brief);nodes.brief.hidden=!brief;list(nodes.points,points);list(nodes.caveats,caveats);
      const next=animate?(nodes.caveats.lastChild||nodes.points.lastChild||(!nodes.brief.hidden?nodes.brief:null)):null;
      if(next!==cursor){cursor?.classList?.remove('analysis-cursor');cursor=next;cursor?.classList?.add('analysis-cursor');}
    }else{
      const pointHtml=text=>{const {lead,body}=pointParts(text);return lead?`<strong>${esc(lead)}</strong>${esc(body)}`:esc(text);};
      container.innerHTML=`<p class="analysis-brief">${esc(brief)}</p>${points.length?`<ul class="analysis-points">${points.map(point=>`<li>${pointHtml(point)}</li>`).join('')}</ul>`:''}${caveats.length?`<ul class="analysis-notes">${caveats.map(point=>`<li>${pointHtml(point)}</li>`).join('')}</ul>`:''}`;
    }
    hasPreview=!!brief||points.some(Boolean)||caveats.some(Boolean);
    const coverage=data.coverage||{},labels=[];
    if(coverage.textTruncated)labels.push('已截取部分正文');else if(coverage.textComplete===false)labels.push('正文尚未完整');
    $('#analysis-coverage').textContent=labels.join(' · ');$('#analysis-coverage').hidden=!labels.length;
    if(clearStatus)status('');
    if(follow)panel.scrollTop=panel.scrollHeight;
  }
  function pointParts(text){
    // Treat only a short, sentence-free prefix as a label, never model HTML or
    // Markdown. Old cached paragraphs, links and times stay ordinary text.
    const match=/^([^：:\n。！？!?；;]{2,36}[：:])/.exec(text);
    return match&&!/^https?:/i.test(match[1])&&/\p{L}/u.test(match[1])?{lead:match[1],body:text.slice(match[0].length)}:{lead:'',body:text};
  }
  async function receiveStream(path,initial,token,deadline){
    const session={controller:new AbortController(),reader:null};streaming=session;
    const timer=setTimeout(()=>session.controller.abort(),Math.max(1,deadline-Date.now()));
    let latest=initial,buffer='',bytes=0,finished=false;
    try{
      const response=await requestStream(path,{method:'GET',headers:{Accept:'text/event-stream'},cache:'no-store',signal:session.controller.signal});
      if(token!==generation){await response.body?.cancel();return latest;}
      if(!response.ok||!/^text\/event-stream\b/i.test(response.headers.get('content-type')||'')||!response.body?.getReader){await response.body?.cancel();return latest;}
      const reader=response.body.getReader();session.reader=reader;const decoder=new TextDecoder();
      const event=block=>{
        const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');if(!data)return;
        const value=JSON.parse(data);if(!value||!['running','preparing','ready','error'].includes(value.status))throw Error('stream_status');
        if(value.jobId&&value.jobId!==initial.jobId||value.versionId&&initial.versionId&&value.versionId!==initial.versionId||value.documentId&&initial.documentId&&value.documentId!==initial.documentId)throw Error('stream_identity');
        latest=value;
        if(value.preview)render(value,true);
        if(value.status==='ready'||value.status==='error')finished=true;
      };
      while(token===generation&&!session.controller.signal.aborted&&!finished){
        const part=await reader.read();if(token!==generation)break;
        if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024)throw Error('stream_size');
        buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>65536)throw Error('stream_size');
        // CRLF may itself span network chunks. Wait for a full delimiter before
        // normalizing lines, so a split CRLF cannot invent an event boundary.
        let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index).replaceAll('\r\n','\n');buffer=buffer.slice(match.index+match[0].length);event(block);if(finished)break;}
      }
    }catch{/* A read-only GET below resumes the same job without another POST. */}
    finally{clearTimeout(timer);session.controller.abort();try{await session.reader?.cancel();}catch{}if(streaming===session)streaming=null;}
    return latest;
  }
  async function receiveUpdate(path,initial,token,deadline){
    const session={controller:new AbortController(),reader:null};streaming=session;
    const timer=setTimeout(()=>session.controller.abort(),Math.max(1,Math.min(15000,deadline-Date.now())));
    try{
      const value=await api(path,{method:'GET',cache:'no-store',signal:session.controller.signal});
      if(token!==generation)return initial;
      if(!value||!['running','preparing','ready','error'].includes(value.status))throw Error('analysis_update_status');
      if(value.jobId&&value.jobId!==initial.jobId||value.versionId&&initial.versionId&&value.versionId!==initial.versionId||value.documentId&&initial.documentId&&value.documentId!==initial.documentId)throw Error('analysis_update_identity');
      if(value.status==='running'&&Number.isSafeInteger(value.revision)&&Number.isSafeInteger(initial.revision)&&value.revision<initial.revision)return initial;
      return value;
    }finally{clearTimeout(timer);session.controller.abort();if(streaming===session)streaming=null;}
  }
  async function run(item,token,prepareAgain=false){
    let analysisRunning=false;
    busy=true;status('正在读取…');
    try{
      const read=path=>api(path,globalThis.AbortSignal?.timeout?{signal:AbortSignal.timeout(30000)}:{});
      const base=pathFor(item),query=item.versionId?'?versionId='+encodeURIComponent(item.versionId):'';
      let data=await read(base+query),prepared=false,polls=0,submitted=false,pollQuery=query;const deadline=Date.now()+120000,streamed=new Set();
      if(token!==generation)return;if(data.status==='ready'&&data.result){render(data);return;}
      const config=await read('/ai/status');if(token!==generation)return;
      if(!config.configured){status('请先在主机连接 DeepSeek');return;}
      animate=true;
      while(token===generation){
        if(data.status==='preparing'&&data.phase==='analysis')data={...data,status:'running'};
        analysisRunning=data.status==='running';
        if(data.status==='ready'&&data.result){render(data);await reveal.drain();return;}
        if(data.preview)render(data,true);
        if(data.status==='body_unavailable'){
          if(prepareAgain&&!prepared){prepared=true;data=await post(base);continue;}
          throw new Error(data.error||'原文暂未取得，请稍后重试');
        }
        if(!['missing','preparing','running','error'].includes(data.status))throw new Error('暂未完成，请稍后重试');
        if(data.status==='running')submitted=true;
        if(data.status==='running'&&/^[a-f0-9]{64}$/.test(data.jobId)){
          const pinned=query||(data.versionId?'?versionId='+encodeURIComponent(data.versionId):'');pollQuery=pinned+(pinned?'&':'?')+'jobId='+encodeURIComponent(data.jobId);
          if(config.progressTransport==='updates'){
            if(Date.now()>=deadline)throw new Error('分析仍在继续，可稍后查看');
            const revision=Number.isSafeInteger(data.revision)&&data.revision>=0?data.revision:0,started=Date.now();
            if(!hasPreview)status('正在分析…');
            try{
              data=await receiveUpdate(base+pollQuery+'&wait=1&afterRevision='+revision,data,token,deadline);
              if(token!==generation)return;
              // Normally the server holds an unchanged revision for ten seconds.
              // A proxy or older server returning it immediately must not spin.
              if(['running','preparing'].includes(data.status)&&(data.revision??0)<=revision&&Date.now()-started<1000){if(!await pause(token)||token!==generation)return;}
            }catch(error){
              if(token!==generation)return;if(error.status&&error.status<500)throw error;
              if(Date.now()>=deadline)throw new Error('分析仍在继续，可稍后查看');
              if(!hasPreview)status('正在重新连接…');if(!await pause(token)||token!==generation)return;
            }
            continue;
          }
          if(!streamed.has(data.jobId)){streamed.add(data.jobId);if(!hasPreview)status('正在分析…');data=await receiveStream(base+pollQuery+'&stream=1',data,token,deadline);continue;}
        }
        if(['missing','error'].includes(data.status)&&(item.versionId||data.versionId)){
          if(submitted)throw new Error(data.error||'暂未确认分析请求，请重试');
          submitted=true;status('正在分析…');try{data=await post(base,item.versionId||data.versionId);}catch(error){if(error.status&&error.status<500)throw error;data={status:'running'};}continue;
        }
        status(data.status==='running'?(hasPreview?'':'正在分析…'):'正在准备文章…');
        if(data.status==='missing'&&!prepared){prepared=true;data=await post(base);continue;}
        if(polls>=48||Date.now()>=deadline)throw new Error(data.status==='running'?'分析仍在继续，可稍后查看':'文章还在准备，请稍后重试');
        if(!await pause(token)||token!==generation)return;
        if(Date.now()>=deadline)throw new Error(data.status==='running'?'分析仍在继续，可稍后查看':'文章还在准备，请稍后重试');
        polls++;try{data=await read(base+pollQuery);}catch(error){if(error.status&&error.status<500)throw error;status('正在重新连接…');}
      }
    }catch(error){
      if(token===generation){
        // Finish displaying received text before presenting a confirmed failure.
        // A viewing timeout does not mean the background job should be restarted.
        if(animate)await reveal.drain();
        if(token!==generation)return;
        status(error.status===409?'暂时无法取得正文，请稍后重试':error.status===503?'请先在主机连接 DeepSeek':['TimeoutError','AbortError'].includes(error.name)?'请求用时较长，请稍后重试':error.message||'分析暂不可用',!analysisRunning&&error.status!==503);
      }
    }
    finally{if(token===generation){busy=false;animate=false;cursor?.classList?.remove('analysis-cursor');cursor=null;}}
  }
  async function open(item){
    if(!enabled()||!item)return;target={...item};const token=invalidate();nodes=null;hasPreview=false;$('#analysis-title').textContent=item.title||'文章分析';$('#analysis-result').innerHTML='';$('#analysis-coverage').hidden=true;$('#analysis-dialog').showModal();$('#analysis-dialog').scrollTop=0;await run(target,token);
  }
  $('#analysis-close').addEventListener('click',close);$('#analysis-dialog').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#analysis-retry').addEventListener('click',()=>{if(target&&!busy)void run(target,invalidate(),true);});
  return{open,close};
}
