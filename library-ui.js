export function savedBlockText(block){
  if(['paragraph','heading','quote','code'].includes(block?.type))return block.text||'';
  if(block?.type==='list')return block.items.map(item=>item.text).join('\n');
  if(block?.type==='table')return block.rows.map(row=>row.map(cell=>cell.text).join('\t')).join('\n');
  return '';
}
export function quoteText(content,range){
  const blocks=(content?.blocks||[]).filter(b=>savedBlockText(b));let cursor=0;const positions=new Map();
  for(const b of blocks){positions.set(b.id,{at:cursor,text:savedBlockText(b)});cursor+=savedBlockText(b).length+1;}
  const a=positions.get(range?.start?.blockId),b=positions.get(range?.end?.blockId),start=range?.start?.offset,end=range?.end?.offset;
  const boundary=(text,n)=>Number.isInteger(n)&&n>=0&&n<=text.length&&!(n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n]));
  if(!a||!b||!boundary(a.text,start)||!boundary(b.text,end))return '';
  const from=a.at+start,to=b.at+end;if(to<=from||to-from>20000)return '';
  return blocks.map(savedBlockText).join('\n').slice(from,to);
}
export function selectionAnchor(selection,container,content){
  if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
  const range=selection.getRangeAt(0);
  const boundary=(node,offset)=>{
    const element=node.nodeType===1?node:node.parentElement;let block=element?.closest?.('[data-document-block]');
    const textOf=block=>savedBlockText(content.blocks.find(b=>b.id===block.dataset.documentBlock));
    try{
      if(!block&&container.contains(node)){
        const blocks=[...container.querySelectorAll('[data-document-block]')].filter(textOf);
        for(const candidate of blocks){const probe=container.ownerDocument.createRange();probe.selectNodeContents(candidate);const position=probe.comparePoint(node,offset);if(position<0)return{blockId:candidate.dataset.documentBlock,offset:0};if(position===0){block=candidate;break;}}
        if(!block&&blocks.length){const last=blocks.at(-1);return{blockId:last.dataset.documentBlock,offset:textOf(last).length};}
      }
      if(!block||!container.contains(block))return null;
      const part=element.closest('[data-document-offset]'),segments=part?[]:[...(block.querySelectorAll?.('[data-document-offset]')||[])];
      if(segments.length){
        for(const segment of segments){const probe=container.ownerDocument.createRange();probe.selectNodeContents(segment);const position=probe.comparePoint(node,offset),base=Number(segment.dataset.documentOffset);if(position<0)return{blockId:block.dataset.documentBlock,offset:base};if(position===0){probe.setEnd(node,offset);return{blockId:block.dataset.documentBlock,offset:base+probe.toString().length};}}
        return{blockId:block.dataset.documentBlock,offset:textOf(block).length};
      }
      const probe=container.ownerDocument.createRange();probe.selectNodeContents(part||block);probe.setEnd(node,offset);
      return{blockId:block.dataset.documentBlock,offset:Number(part?.dataset.documentOffset||0)+probe.toString().length};
    }catch{return null;}
  };
  const anchor={start:boundary(range.startContainer,range.startOffset),end:boundary(range.endContainer,range.endOffset)};
  const text=quoteText(content,anchor);return text.trim()?{range:anchor,text}:null;
}

export function createLibraryUi({api,$,esc,state,toast,enabled,openReader,onFavoriteChange}){
  const model={kind:'articles',tag:'',q:'',items:[],total:0,tags:[],offset:0,loading:false};
  let request=0,controller=null,tagEntry=null,tagSelection=new Set(),selection=null,quoteBusy=false,quotePress=null,consumedPointerClick=false,searchTimer;
  const active=()=>enabled()&&state.view==='starred'&&state.readerId===null;
  const path=(kind,id)=>'/library/'+kind+'/'+encodeURIComponent(id);
  function render(){
    if(!active())return;
    $('#library-kind-articles').setAttribute('aria-pressed',String(model.kind==='articles'));$('#library-kind-quotes').setAttribute('aria-pressed',String(model.kind==='quotes'));
    $('#library-tag-filter').innerHTML='<option value="">全部标签</option>'+model.tags.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');$('#library-tag-filter').value=model.tag;
    $('#library-list').innerHTML=model.items.map(item=>`<article class="library-card"><button class="library-entry" data-library-open="${esc(item.id)}">${model.kind==='quotes'?`<blockquote>${esc(item.text)}</blockquote>`:''}<h2>${esc(item.title||'未命名文章')}</h2><span>${esc(item.author||'')}</span></button><div class="library-card-foot"><div class="library-entry-tags">${item.tags.map(t=>`<span>${esc(t.name)}</span>`).join('')}</div><div><button data-library-tags="${esc(item.id)}">标签</button><button data-library-remove="${esc(item.id)}">${model.kind==='quotes'?'删除语录':'取消收藏'}</button></div></div></article>`).join('');
    $('#library-empty').hidden=!!model.items.length||model.loading;$('#library-empty').textContent=model.q||model.tag?'没有匹配的收藏':model.kind==='quotes'?'划线收藏的句子会出现在这里':'收藏的文章会出现在这里';
    $('#library-status').textContent=model.loading?'正在加载…':`${model.total} ${model.kind==='quotes'?'条语录':'篇文章'}`;
    $('#library-more').hidden=model.items.length>=model.total;$('#library-more').disabled=model.loading;
  }
  async function tags(){const result=await api('/library/tags');model.tags=result.items||[];return model.tags;}
  async function load(append=false){
    if(!active())return;const token=++request;controller?.abort();controller=new AbortController();const current=controller;let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;current.abort();},12000);model.loading=true;if(!append)model.items=[];render();
    const query=new URLSearchParams({kind:model.kind,offset:String(append?model.items.length:0)});if(model.tag)query.set('tag',model.tag);if(model.q)query.set('q',model.q);
    try{const [result]=await Promise.all([api('/library?'+query,{signal:controller.signal}),tags()]);if(token!==request||!active())return;model.items=append?[...model.items,...result.items]:result.items;model.total=result.total;}
    catch(error){if(token===request&&(timedOut||error.name!=='AbortError'))toast(timedOut?'加载超时，请重试':error.message);}
    finally{clearTimeout(timeout);if(token===request){model.loading=false;render();}}
  }
  function cancel(){request++;controller?.abort();model.loading=false;clearTimeout(searchTimer);hideSelection();globalThis.CSS?.highlights?.delete('orlet-quote');}
  function renderTags(){
    $('#library-tag-options').innerHTML=model.tags.map(t=>`<label class="tag-option"><input type="checkbox" value="${esc(t.id)}"${tagSelection.has(t.id)?' checked':''}><span>${esc(t.name)}</span></label>`).join('');
  }
  async function editTags(entry){
    tagEntry=entry;tagSelection=new Set(entry.tags?.map(t=>t.id)||[]);$('#library-tag-error').textContent='';$('#library-tag-name').value='';
    try{await tags();renderTags();$('#library-tag-dialog').showModal();}catch(error){toast(error.message);}
  }
  async function favorite(article,value){
    let entry;
    const documentId=article.favoriteDocumentId||article.documentId||(state.reader===article?state.readerDocument?.documentId:null);
    if(documentId)article.documentId=documentId;
    if(value){entry=await api(documentId?'/documents/'+encodeURIComponent(documentId)+'/favorite':'/articles/'+article.id+'/favorite',{method:'POST',body:'{}'});article.favoriteDocumentId=entry.documentId;article.starred=1;}
    else{if(!documentId)throw new Error('收藏状态尚未同步，请刷新后重试');await api(path('articles',documentId),{method:'DELETE'});article.favoriteDocumentId=null;article.starred=0;}
    onFavoriteChange(article);if(entry)void editTags(entry);return entry;
  }
  function hideSelection(){selection=null;quotePress=null;$('#quote-save').hidden=true;}
  function inspectSelection(){
    if(quotePress||quoteBusy)return;
    hideSelection();if(!enabled()||state.readerId===null||!state.readerDocument?.versionId)return;
    const saved=selectionAnchor(globalThis.getSelection?.(),$('#reader-content'),state.readerDocument.content);if(!saved)return;
    selection={...saved,documentId:state.readerDocument.documentId,versionId:state.readerDocument.versionId,readerId:state.readerId};
    $('#quote-save').hidden=false;
  }
  async function saveQuote(saved=selection){
    if(!saved||quoteBusy||saved.readerId!==state.readerId||saved.versionId!==state.readerDocument?.versionId)return;quoteBusy=true;$('#quote-save').disabled=true;
    try{const entry=await api('/documents/'+encodeURIComponent(saved.documentId)+'/quotes',{method:'POST',body:JSON.stringify({versionId:saved.versionId,range:saved.range,text:saved.text})});hideSelection();globalThis.getSelection?.()?.removeAllRanges();toast('已保存语录');void editTags(entry);}
    catch(error){toast(error.message);}finally{quoteBusy=false;$('#quote-save').disabled=false;}
  }
  function locate(entry){
    if(!entry?.anchor)return;const blocks=[...($('#reader-content').querySelectorAll?.('[data-document-block]')||[])];
    const start=blocks.find(b=>b.dataset.documentBlock===entry.anchor.start.blockId);for(const b of blocks)b.classList.remove?.('quote-location');
    if(start){
      start.classList.add?.('quote-location');
      // The Highlight API marks text without changing saved DOM or video nodes.
      if(globalThis.CSS?.highlights&&globalThis.Highlight){try{
        const point=boundary=>{const block=blocks.find(b=>b.dataset.documentBlock===boundary.blockId);if(!block)return null;const parts=[...(block.querySelectorAll?.('[data-document-offset]')||[])];const part=parts.reverse().find(p=>Number(p.dataset.documentOffset)<=boundary.offset)||block;let remaining=boundary.offset-Number(part.dataset.documentOffset||0);const walker=document.createTreeWalker(part,4);let node;while((node=walker.nextNode())){if(remaining<=node.textContent.length)return{node,offset:remaining};remaining-=node.textContent.length;}return null;};
        const a=point(entry.anchor.start),b=point(entry.anchor.end);if(a&&b){const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);CSS.highlights.set('orlet-quote',new Highlight(range));}
      }catch{}}
      start.scrollIntoView?.({block:'center',behavior:'smooth'});
    }
  }
  for(const kind of ['articles','quotes'])$('#library-kind-'+kind).addEventListener('click',()=>{if(model.kind!==kind){model.kind=kind;void load();}});
  $('#library-tag-filter').addEventListener('change',()=>{model.tag=$('#library-tag-filter').value;void load();});
  $('#library-more').addEventListener('click',()=>{if(!model.loading)void load(true);});
  $('#library-list').addEventListener('click',async event=>{
    const button=event.target.closest('button[data-library-open],button[data-library-tags],button[data-library-remove]');if(!button||button.disabled)return;
    const id=button.dataset.libraryOpen||button.dataset.libraryTags||button.dataset.libraryRemove,item=model.items.find(i=>i.id===id);if(!item)return;
    if(button.dataset.libraryOpen){void openReader(item);return;}if(button.dataset.libraryTags){void editTags(item);return;}
    button.disabled=true;try{await api(path(model.kind,id),{method:'DELETE'});if(model.kind==='articles')onFavoriteChange({documentId:id,favoriteDocumentId:null,starred:0});await load();}catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  $('#library-tag-options').addEventListener('change',event=>{const input=event.target;if(input.type!=='checkbox')return;if(input.checked)tagSelection.add(input.value);else tagSelection.delete(input.value);});
  $('#library-tag-create').addEventListener('click',async()=>{
    const name=$('#library-tag-name').value.trim();if(!name)return;const button=$('#library-tag-create');button.disabled=true;
    try{const tag=await api('/library/tags',{method:'POST',body:JSON.stringify({name})});tagSelection.add(tag.id);await tags();renderTags();$('#library-tag-name').value='';}catch(error){$('#library-tag-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#library-tag-save').addEventListener('click',async()=>{
    if(!tagEntry)return;const button=$('#library-tag-save');button.disabled=true;
    try{await api(path(tagEntry.kind,tagEntry.id)+'/tags',{method:'PUT',body:JSON.stringify({tags:[...tagSelection]})});$('#library-tag-dialog').close();if(active())await load();}catch(error){$('#library-tag-error').textContent=error.message;}finally{button.disabled=false;}
  });
  function renderTagManager(){
    const options=model.tags.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');$('#library-tag-source').innerHTML=options;$('#library-tag-target').innerHTML=options;$('#library-tag-rename').value=model.tags[0]?.name||'';
  }
  $('#library-tags-manage').addEventListener('click',async()=>{try{await tags();renderTagManager();$('#library-tag-manager-error').textContent='';$('#library-tag-manager').showModal();}catch(error){toast(error.message);}});
  $('#library-tag-source').addEventListener('change',()=>{$('#library-tag-rename').value=model.tags.find(t=>t.id===$('#library-tag-source').value)?.name||'';});
  for(const operation of ['rename','merge'])$('#library-tag-'+operation+'-save').addEventListener('click',async()=>{
    const source=$('#library-tag-source').value,button=$('#library-tag-'+operation+'-save');if(!source)return;button.disabled=true;
    try{await api('/library/tags/'+encodeURIComponent(source)+(operation==='merge'?'/merge':''),{method:operation==='merge'?'POST':'PATCH',body:JSON.stringify(operation==='merge'?{targetId:$('#library-tag-target').value}:{name:$('#library-tag-rename').value})});await tags();renderTagManager();model.tag='';if(active())await load();}
    catch(error){$('#library-tag-manager-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#quote-save').addEventListener('pointerdown',event=>{consumedPointerClick=false;if(!selection)return;quotePress={saved:selection,id:event.pointerId,x:event.clientX,y:event.clientY,type:event.pointerType};if(event.pointerType!=='touch'&&event.pointerType!=='pen')event.preventDefault();});
  $('#quote-save').addEventListener('pointerup',event=>{const press=quotePress;quotePress=null;if(!press||press.id!==event.pointerId)return;if(['touch','pen'].includes(press.type)){consumedPointerClick=true;if(Math.hypot(event.clientX-press.x,event.clientY-press.y)<=12){event.preventDefault();void saveQuote(press.saved);}else inspectSelection();}});
  $('#quote-save').addEventListener('pointercancel',()=>{quotePress=null;consumedPointerClick=true;inspectSelection();});
  document.addEventListener?.('pointerup',()=>{if(quotePress){quotePress=null;inspectSelection();}});
  $('#quote-save').addEventListener('click',(event={})=>{if(consumedPointerClick&&event.detail>0)return;void saveQuote();});
  document.addEventListener?.('selectionchange',inspectSelection);$('#reader-content').addEventListener('pointerup',inspectSelection);$('#reader-content').addEventListener('touchend',()=>setTimeout(inspectSelection,0));
  return{model,active,load,cancel,favorite,editTags,locate,inspectSelection,saveQuote,search(q){model.q=q;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void load(),250);}};
}
