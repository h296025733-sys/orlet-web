import {interpretXhsTime} from './xhs-time.js?v=35dca5b261d0';
import {createLibraryUi} from './library-ui.js?v=257a8196ebff';
import {createAnalysisUi} from './analysis-ui.js?v=29b8c7f6a94f';
const $=s=>document.querySelector(s);
const platforms={x:'X',xiaohongshu:'小红书',wechat:'微信公众号'};
const visiblePlatforms=new Set(['x','xiaohongshu','wechat']);
const icons={x:'𝕏',xiaohongshu:'红',wechat:'微'};
const classes={x:'x',xiaohongshu:'red',wechat:'green'};
const state={view:'feed',platform:'',source:'',period:'today',q:'',offset:0,nextOffset:0,snapshot:null,total:0,hasMore:false,totalKnown:true,periodDay:null,articles:[],sources:[],summary:null,watch:null,readerId:null,reader:null,readerDocument:null,pendingArticles:new Map(),loaded:false};
const titles={feed:'全部动态',unread:'未读',starred:'收藏',sources:'订阅管理',activity:'最近记录'};
const periodTitles={today:'今天',history:'历史'};
const briefTimeFormat=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'});
const clockFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'});
const startedAt='2026-11-01T16:00:00.000Z';
const mobileNavigation=globalThis.matchMedia?.('(max-width: 700px)');
function syncMobileViewport(){
  const viewport=globalThis.visualViewport,style=document.documentElement?.style;
  if(viewport&&style){style.setProperty('--visual-height',`${Math.round(viewport.height)}px`);style.setProperty('--visual-top',`${Math.round(viewport.offsetTop)}px`);style.setProperty('--visual-bottom',`${Math.max(0,Math.round((globalThis.innerHeight||viewport.height)-viewport.height-viewport.offsetTop))}px`);}
  const header=$('.topbar')?.getBoundingClientRect?.();if(header&&style)style.setProperty('--topbar-height',`${Math.ceil(header.height)}px`);
}
globalThis.visualViewport?.addEventListener('resize',syncMobileViewport);globalThis.visualViewport?.addEventListener('scroll',syncMobileViewport);
if(globalThis.ResizeObserver){const headerObserver=new ResizeObserver(syncMobileViewport);headerObserver.observe($('.topbar'));}
syncMobileViewport();
let toastTimer,searchTimer,articleRequest=0,summaryRequest=0,loadingMore=false;
let updatesCursor=null,updatesBusy=false,updatesRetryAt=0,metadataBusy=false,applyingUpdates=false,autoUpdateTimer=null;
let readerGeneration=0,readerTimer=null,readerController=null,readerActionBusy=false,readerContentBusyGeneration=null;
let documentReaderSession=null;
const documentBlockNodes=new Map(),documentBlockKeys=new Map();
const DOCUMENT_POLL_DELAY=2500,DOCUMENT_SLOW_POLL_DELAY=10000,DOCUMENT_HIDDEN_POLL_DELAY=30000,DOCUMENT_FAST_WAIT_LIMIT=120000,DOCUMENT_WAIT_LIMIT=3600000;
let feedScrollTop=0,imageRetrySequence=0;
let periodPageCache=null;
let articleLoadController=null,articleLoadTimeout=null,prefetchTimer=null,prefetchController=null;
let feedCacheRevision=0;
const feedViewCache=new Map(),FEED_CACHE_TTL=45000;
const renderedMarkup=new WeakMap();
const articleNodes=new Map(),articleNodeKeys=new Map(),groupNodes=new Map();
const pendingSourceChecks=new Set(),pendingArticleActions=new Set();
let bulkReadBusy=false,scopedReadSupported=false;
state.monitorPlatform='';state.monitorSelected=null;state.monitorFilter='all';state.monitorQ='';state.deleteSource=null;
function renderMarkup(element,markup){if(renderedMarkup.get(element)===markup)return;renderedMarkup.set(element,markup);element.innerHTML=markup;}
function scrollPage(top){globalThis.scrollTo?.({top:Math.max(0,Number(top)||0),left:0,behavior:'instant'});}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function backendUrl(path){return globalThis.orletBackend?.url(path)??path;}
function backendPath(path){return globalThis.orletBackend?.path(path)??(typeof path==='string'&&path.startsWith('/api/')?path:'');}
globalThis.addEventListener?.('orlet-backend-change',()=>{for(const node of document.querySelectorAll?.('[src],[poster]')||[]){if(node.tagName==='VIDEO'&&!node.paused)continue;for(const attr of ['src','poster']){const p=backendPath(node.getAttribute(attr));if(p)node.setAttribute(attr,backendUrl(p));}}});
async function api(path,options={}){const signal=options.signal||(!options.method?globalThis.AbortSignal?.timeout?.(12000):undefined),request=globalThis.orletBackend?.request??fetch;const response=await request('/api'+path,{...options,...(signal?{signal}:{}),headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json();if(!response.ok){const error=new Error(data.error||'请求失败');error.status=response.status;throw error;}return data;}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function time(value){if(!value||!Number.isFinite(Date.parse(value)))return '—';return briefTimeFormat.format(new Date(value));}
function beijingDay(value){const timestamp=typeof value==='number'?value:Date.parse(value);return Number.isFinite(timestamp)?new Date(timestamp+8*3600000).toISOString().slice(0,10):null;}
function xhsTime(article){return article?.platform==='xiaohongshu'?interpretXhsTime({rawLabel:displayLabel(article)||article.content?.timeEvidence?.rawLabel,observedAt:article.platform_time_observed_at||article.time_info?.pageTimeObservedAt||article.content?.timeEvidence?.observedAt,datetime:article.platform_time_datetime||article.content?.timeEvidence?.datetime}):null;}
function displayInstant(article){
  const xhs=xhsTime(article)?.at;if(xhs)return xhs;
  const known=article?.platform_time_label?article.platform_time_at:article?.published_at;
  // 公众号无源发布时间：用首次发现时间参与显示/分组/排序，内部 published_at 保持为空。
  if(article?.platform==='wechat'&&!known)return article.discovered_at||null;
  return known||null;
}
function displayLabel(article){return article?.platform_time_label||article?.time_info?.platformDisplayTime?.rawLabel||'';}
function resolvedRelativeTime(article){return articleTime(article);}
function articlePeriod(article){const day=beijingDay(displayInstant(article));return !day?'unknown':day===beijingDay(Date.now())?'today':day===beijingDay(Date.now()-86400000)?'yesterday':'history';}
function normalizePeriod(period){return ['history','yesterday','unknown'].includes(period)?'history':'today';}
function matchesPeriod(article){return normalizePeriod(state.period)==='today'?articlePeriod(article)==='today':articlePeriod(article)!=='today';}
function historicalSample(article){if(typeof article?.is_historical_sample==='boolean')return article.is_historical_sample;const timestamp=Date.parse(article?.published_at||article?.ingested_at||article?.discovered_at);return Number.isFinite(timestamp)&&timestamp<Date.parse(state.summary?.startedAt||startedAt);}
function articleTime(article){const instant=displayInstant(article),day=beijingDay(instant);if(!day)return '';const precision=xhsTime(article)?.precision||article?.time_info?.platformDisplayTime?.precision;if(precision==='day'||/_date$/.test(article?.platform_time_basis||''))return day.replaceAll('-','/');const clock=clockFormat.format(new Date(instant));return day===beijingDay(Date.now())?'今天 '+clock:day.replaceAll('-','/')+' '+clock;}
function articleTimeTitle(article){return article?.platform==='wechat'&&!article.published_at&&!article.platform_time_at?'首次发现时间（无源发布时间）':'';}
function icon(platform){return `<span class="platform-icon ${classes[platform]}">${icons[platform]}</span>`;}
function safeExternal(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function mediaUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?backendUrl('/api/media?url='+encodeURIComponent(u.href)):'';}catch{return '';}}
function imageHtml(src,alt,attributes=''){return `<figure class="content-image"${attributes?' '+attributes:''}><img src="${esc(src)}" alt="${esc(typeof alt==='string'?alt:'')}" loading="lazy" decoding="async"><div class="media-error" role="status" hidden><span data-image-message>图片未加载</span><button type="button" data-image-retry>重试</button></div></figure>`;}
function articleMediaState(value){
  if(value===null||value===undefined||value==='')return null;
  try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{videos:[]};}catch{return{videos:[]};}
}
function contentHtml(content,mediaState=null,blockOffset=0){
  if(!Array.isArray(content?.blocks))return '';
  const managed=articleMediaState(mediaState);
  return content.blocks.map((block,index)=>{
    if(!block||typeof block!=='object')return '';
    if(['paragraph','heading','quote'].includes(block.type)&&typeof block.text==='string'){
      const tag=block.type==='heading'?(block.level===3?'h3':'h2'):block.type==='quote'?'blockquote':'p';
      return block.text.trim()?`<${tag}>${esc(block.text)}</${tag}>`:'';
    }
    if(block.type==='image'){
      const src=mediaUrl(block.url);return src?imageHtml(src,block.alt):'';
    }
    if(block.type==='video'){
      const src=mediaUrl(block.url),poster=mediaUrl(block.poster);
      if(managed){
        const matches=Array.isArray(managed.videos)?managed.videos.filter(entry=>entry?.index===index+blockOffset):[];
        const status=matches.length===1?matches[0].status:'pending';
        if(status!=='cached'||!src)return `<figure class="content-video"><p class="media-pending" data-video-status>${status==='unavailable'||status==='cached'?'视频暂不可用':'视频待缓存'}</p></figure>`;
        return `<figure class="content-video"><video controls playsinline preload="none" src="${esc(src)}" aria-label="${esc(typeof block.alt==='string'?block.alt:'视频')}"></video><p class="media-pending" data-video-status>已缓存</p></figure>`;
      }
      return src?`<figure class="content-video"><video controls playsinline preload="none" src="${esc(src)}"${poster?` poster="${esc(poster)}"`:''} aria-label="${esc(typeof block.alt==='string'?block.alt:'视频')}"></video><p class="media-pending" data-video-status hidden></p></figure>`:`${poster?imageHtml(poster,block.alt||'视频封面'):''}<p class="media-pending">视频暂未就绪</p>`;
    }
    return '';
  }).join('');
}
function aiAnalysisEnabled(){return state.summary?.features?.aiAnalysis===true;}
const analysisUi=createAnalysisUi({api,$,esc,enabled:aiAnalysisEnabled});
function analysisEntryHtml(article){return aiAnalysisEnabled()?`<button type="button" class="analysis-open" data-analysis="${article.id}">AI 分析</button>`:'';}
function libraryEnabled(){return state.summary?.features?.library===true;}
const libraryUi=createLibraryUi({api,$,esc,state,toast,enabled:libraryEnabled,openReader:openLibraryReader,onFavoriteChange:syncLibraryFavorite});
function libraryView(){return libraryEnabled()&&state.view==='starred';}
function libraryReaderArticle(entry,id){
  const metadata={...entry.document?.metadata,...entry.metadata};
  return {...metadata,id,title:entry.title,author:entry.author,url:entry.url,platform:entry.platform,documentId:entry.documentId,is_read:1,
    published_at:metadata.published_at??metadata.publishedAt??null,
    platform_time_at:metadata.platform_time_at??metadata.platformTimeAt??null,
    platform_time_label:metadata.platform_time_label??metadata.platformTimeLabel??'',
    platform_time_datetime:metadata.platform_time_datetime??metadata.platformTimeDatetime??'',
    platform_time_observed_at:metadata.platform_time_observed_at??metadata.platformTimeObservedAt??null,
    platform_time_basis:metadata.platform_time_basis??metadata.platformTimeBasis??'',
    discovered_at:metadata.discovered_at??metadata.discoveredAt??null,
    starred:entry.document?.starred??(entry.kind==='articles'?1:0),
    favoriteDocumentId:entry.document&&Object.hasOwn(entry.document,'favoriteDocumentId')?entry.document.favoriteDocumentId:(entry.kind==='articles'?entry.documentId:null)};
}
function syncLibraryFavorite(article){
  const docId=article.documentId||article.favoriteDocumentId;for(const item of [...state.articles,...(state.reader?[state.reader]:[])]){
    if(item===article||article.id&&item.id===article.id||docId&&(item.favoriteDocumentId===docId||item.documentId===docId)){item.starred=Number(article.starred);item.favoriteDocumentId=article.favoriteDocumentId??null;if(Number.isSafeInteger(item.id))cacheArticleMetadata(item);}
  }
  if(docId&&state.readerDocument?.documentId===docId){state.readerDocument.starred=Number(article.starred);state.readerDocument.favoriteDocumentId=article.favoriteDocumentId??null;}
  if(state.readerId!==null)renderReader();else if(!libraryView())renderArticles();
}
function documentArchiveEnabled(){return state.summary?.features?.documentArchive===true;}
function documentEntryHtml(article){return documentArchiveEnabled()?`<button type="button" class="document-open" data-open="${article.id}">查看文章</button>`:'';}
function documentAssetUrl(value){
  if(typeof value!=='string'||!/^\/api\/document-assets\/[A-Za-z0-9_%.-]+(?:\?[^#]*)?$/.test(value)||/%(?:2f|5c|00)/i.test(value))return '';
  try{const url=new URL(value,'https://orlet.invalid');return url.origin==='https://orlet.invalid'&&/^\/api\/document-assets\/[^/]+$/.test(url.pathname)?backendUrl(url.pathname+url.search):'';}catch{return '';}
}
function documentInlineHtml(value){
  const text=typeof value?.text==='string'?value.text:'';
  if(!Array.isArray(value?.runs)||!value.runs.length||value.runs.some(run=>typeof run?.text!=='string')||value.runs.map(run=>run.text).join('')!==text)return esc(text);
  return value.runs.map(run=>{let html=esc(run.text);if(run.italic===true)html=`<em>${html}</em>`;if(run.bold===true)html=`<strong>${html}</strong>`;const href=safeExternal(run.href);return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`:html;}).join('');
}
function documentBlockHtml(block,index=0){
  if(!block||typeof block!=='object')return '';
  const attributes=`data-document-block="${esc(block.id||'block-'+index)}"`;
  if(['paragraph','heading','quote'].includes(block.type)){
    const html=documentInlineHtml(block);if(!html.trim())return '';
    const tag=block.type==='heading'?(block.level===3?'h3':'h2'):block.type==='quote'?'blockquote':'p';return `<${tag} ${attributes}>${html}</${tag}>`;
  }
  if(block.type==='code'&&typeof block.text==='string')return `<pre ${attributes}><code>${esc(block.text)}</code></pre>`;
  if(block.type==='list'&&Array.isArray(block.items)){
    let offset=0;const items=block.items.map(item=>{const html=`<li data-document-offset="${offset}">${documentInlineHtml(item)}</li>`;offset+=(item.text||'').length+1;return html;}).join(''),tag=block.ordered?'ol':'ul';return items?`<${tag} ${attributes}>${items}</${tag}>`:'';
  }
  if(block.type==='table'&&Array.isArray(block.rows)){
    const rows=block.rows.filter(row=>Array.isArray(row)&&row.length);if(!rows.length)return '';
    let offset=0;const rowHtml=(row,header=false)=>`<tr>${row.map(cell=>{const html=`<${header?'th':'td'} data-document-offset="${offset}"${header?' scope="col"':''}>${documentInlineHtml(cell)}</${header?'th':'td'}>`;offset+=(cell.text||'').length+1;return html;}).join('')}</tr>`;
    return `<div class="document-table" ${attributes} tabindex="0" role="region" aria-label="表格"><table>${block.header?`<thead>${rowHtml(rows[0],true)}</thead>`:''}<tbody>${rows.slice(block.header?1:0).map(row=>rowHtml(row)).join('')}</tbody></table></div>`;
  }
  if(block.type==='image'||block.type==='video'){
    const src=documentAssetUrl(block.localUrl),ready=block.mediaStatus==='ready'&&!!src,poster=block.posterMediaStatus==='ready'?documentAssetUrl(block.posterLocalUrl):'';
    if(block.type==='image'&&ready)return imageHtml(src,block.alt,attributes);
    if(block.type==='video'&&ready)return `<figure class="content-video" ${attributes}><video controls playsinline preload="none" src="${esc(src)}"${poster?` poster="${esc(poster)}"`:''} aria-label="${esc(block.alt||'视频')}"></video><p class="media-pending" data-video-status hidden></p></figure>`;
    const waiting=!block.unavailable&&['queued','fetching','pending'].includes(block.mediaStatus),word=block.type==='image'?'图片':'视频';
    return `<figure class="content-${block.type} document-media-placeholder" ${attributes}>${block.type==='video'&&poster?`<img src="${esc(poster)}" alt="${esc(block.alt||'视频封面')}" loading="lazy" decoding="async">`:''}<p class="media-pending" role="status">${word}${waiting?'正在准备…':'暂不可用'}</p></figure>`;
  }
  return '';
}
function documentContentHtml(content){return content?.version===2&&Array.isArray(content.blocks)?content.blocks.map(documentBlockHtml).join(''):'';}
function renderDocumentContent(content){
  const container=$('#reader-content'),blocks=content?.version===2&&Array.isArray(content.blocks)?content.blocks:[];
  if(!document.createElement||!container.insertBefore){renderMarkup(container,documentContentHtml(content));return;}
  // Only changed blocks are replaced when an attachment finishes saving.
  renderedMarkup.delete(container);const nodes=[],seen=new Set();
  for(const[index,block]of blocks.entries()){
    const html=documentBlockHtml(block,index);if(!html)continue;
    let key=String(block.id||'block-'+index);if(seen.has(key))key+='-'+index;seen.add(key);
    let node=documentBlockNodes.get(key);
    if(!node||documentBlockKeys.get(key)!==html){const holder=document.createElement('div');holder.innerHTML=html;node=holder.firstElementChild;documentBlockNodes.set(key,node);documentBlockKeys.set(key,html);}
    nodes.push(node);
  }
  // Remove replaced placeholders before reconciliation. Otherwise inserting a
  // new early block can unnecessarily move every later node, including video.
  const wanted=new Set(nodes);for(const node of [...(container.children||[])])if(!wanted.has(node))node.remove();
  reconcileChildren(container,nodes);
  for(const key of documentBlockNodes.keys())if(!seen.has(key)){documentBlockNodes.delete(key);documentBlockKeys.delete(key);}
}
function completeContent(article){return article?.content?.complete===true&&!!contentHtml(article.content,article.media_state);}
function metadataCard(article){return article?.platform==='wechat'&&!completeContent(article);}
function originalLink(article){
  const address=safeExternal(article?.url);if(!address)return '';
  const u=new URL(address);if(u.protocol!=='https:'||u.port)return '';
  if(article?.platform==='wechat')return u.hostname==='mp.weixin.qq.com'&&/^\/s(?:\/[\w-]+)?\/?$/.test(u.pathname)?address:'';
  if(article?.platform==='xiaohongshu'&&['www.xiaohongshu.com','xiaohongshu.com'].includes(u.hostname)){
    const match=u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-zA-Z0-9]{10,40})\/?$/)||u.pathname.match(/^\/user\/profile\/[a-zA-Z0-9]+\/([a-zA-Z0-9]{10,40})\/?$/);
    if(match&&(!article.native_id||match[1]===article.native_id))return address;
  }
  return '';
}
function articleSummary(article){return article?.summary==='图片或视频动态，点击原文查看'?'':article?.summary||'';}
function articleTitle(article){return article?.title==='图片或视频动态，点击原文查看'?'图文动态':article?.title||'';}
// XHS avatars use the existing image cache, including its request limits.
const avatarHosts=new Set(['wx.qlogo.cn','mmbiz.qpic.cn','mmbiz.qlogo.cn']);
const xhsImageHost=host=>host.endsWith('.xhscdn.com')||host.endsWith('.xhscdn.net')||host==='ci.xiaohongshu.com';
const avatarImages=new WeakSet();
const cardImageRetries=new WeakMap();
function retryCardImage(image,failed){
  const prior=cardImageRetries.get(image);
  if(!failed){if(prior?.timer)clearTimeout(prior.timer);cardImageRetries.delete(image);return;}
  const src=image.getAttribute?.('src');
  if(!backendPath(src)||prior?.timer||prior?.attempts>=2)return;
  const retry=prior||{attempts:0,timer:null};retry.attempts++;
  retry.timer=setTimeout(()=>{retry.timer=null;if(!image.isConnected)return;image.loading='eager';image.setAttribute('src',backendUrl(backendPath(src)));},retry.attempts*300000);
  cardImageRetries.set(image,retry);
}
function avatarUrl(value){try{if(typeof value!=='string')return '';const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!(avatarHosts.has(url.hostname)||xhsImageHost(url.hostname))||url.username||url.password||url.port)return '';url.protocol='https:';url.hash='';return url.href;}catch{return '';}}
function avatarHtml(value,initial,className){const url=avatarUrl(value),src=url&&xhsImageHost(new URL(url).hostname)?mediaUrl(url):url;return `<span class="avatar-face ${esc(className)}" aria-hidden="true">${src?`<img data-avatar-image src="${esc(src)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async">`:''}<span class="avatar-letter">${esc(initial)}</span></span>`;}
function installAvatars(container){for(const image of container.querySelectorAll?.('[data-avatar-image]')||[]){if(avatarImages.has(image))continue;avatarImages.add(image);const settle=success=>{const loaded=!!success&&image.naturalWidth>0;image.parentElement?.classList.toggle('has-image',loaded);retryCardImage(image,!loaded);};image.addEventListener('load',()=>settle(true));image.addEventListener('error',()=>settle(false));if(image.complete)settle(true);}}
function sourceAvatar(article){const s=(state.sources||[]).find(x=>x.id===article?.source_id);return article?.platform==='xiaohongshu'?avatarUrl(s?.avatar)||avatarUrl(article?.author_avatar):avatarUrl(article?.author_avatar)||avatarUrl(s?.avatar);}
function xhsCardHtml(a){
  const source=originalLink(a),cover=a.cover_url&&mediaUrl(a.cover_url)?backendUrl('/api/articles/'+a.id+'/cover'+(a.cover_key?'?v='+encodeURIComponent(a.cover_key):'')):mediaUrl(a.content?.blocks?.find(block=>block?.type==='image')?.url),instant=displayInstant(a);
  const linkAttrs=`href="${esc(source)}" target="_blank" rel="noopener noreferrer" data-original="${a.id}"`;
  const image=cover?`<div class="xhs-cover" data-xhs-cover>${source?`<a ${linkAttrs} aria-label="${esc(articleTitle(a))}">`:''}<img data-xhs-cover-image src="${esc(cover)}" alt="${esc(a.author||'')}笔记封面" loading="lazy" decoding="async" referrerpolicy="no-referrer">${source?'</a>':''}</div>`:'';
  const title=source?`<a ${linkAttrs}>${esc(articleTitle(a))}</a>`:esc(articleTitle(a));
  const open=source?`<a class="xhs-open" ${linkAttrs}>查看原文 <span aria-hidden="true">↗</span></a>`:'';
  const links=documentArchiveEnabled()||aiAnalysisEnabled()?`<div class="article-links">${documentEntryHtml(a)}${analysisEntryHtml(a)}${open}</div>`:open;
  return `<article class="article xhs-card ${cover?'has-cover':''} ${a.is_read?'is-read':'is-unread'}" data-id="${a.id}">${image}<div class="xhs-body"><div class="xhs-head">${avatarHtml(sourceAvatar(a),(a.author||'?').slice(0,1).toUpperCase(),'author-avatar red')}<div class="xhs-byline"><span class="article-author">${esc(a.author)}</span><div class="article-meta xhs-meta"><span class="xhs-tag">小红书</span><time class="article-time"${instant?` datetime="${esc(instant)}"`:''}>${esc(articleTime(a))}</time></div></div><span class="unread-dot" title="未读"${a.is_read?' hidden':''}></span></div><h2 class="xhs-title">${title}</h2><div class="xhs-foot">${links}<div class="xhs-actions"><button data-star="${a.id}" class="${a.starred?'is-starred':''}" aria-label="${a.starred?'取消收藏':'收藏'}">${a.starred?'★ 已收藏':'☆ 收藏'}</button><button data-read="${a.id}">${a.is_read?'标为未读':'标为已读'}</button></div></div></div></article>`;
}
function wechatCardHtml(a){
  const source=originalLink(a),avatar=sourceAvatar(a),time=articleTime(a),initial=(a.author||'?').slice(0,1).toUpperCase();
  const head=`<div class="wx-head">${avatarHtml(avatar,initial,'wx-avatar')}<div class="wx-byline"><span class="wx-name">${esc(a.author)}</span><span class="wx-tag">微信公众号</span></div><time class="wx-time"${displayInstant(a)?` datetime="${esc(displayInstant(a))}"`:''} title="${esc(articleTimeTitle(a))}">${esc(time)}</time><span class="unread-dot" title="未读"${a.is_read?' hidden':''}></span></div>`;
  const linkAttrs=`href="${esc(source)}" target="_blank" rel="noopener noreferrer" data-original="${a.id}"`;
  const title=source?`<h2 class="wx-title"><a ${linkAttrs}>${esc(articleTitle(a))}</a></h2>`:`<h2 class="wx-title">${esc(articleTitle(a))}</h2>`;
  const open=source?`<a class="wx-open" ${linkAttrs}>查看原文<span class="wx-arrow" aria-hidden="true">↗</span></a>`:'';
  const links=documentArchiveEnabled()||aiAnalysisEnabled()?`<div class="article-links">${documentEntryHtml(a)}${analysisEntryHtml(a)}${open}</div>`:open;
  const foot=`<div class="wx-foot">${links}<div class="wx-actions"><button data-star="${a.id}" class="${a.starred?'is-starred':''}" aria-label="${a.starred?'取消收藏':'收藏'}">${a.starred?'★ 已收藏':'☆ 收藏'}</button><button data-read="${a.id}">${a.is_read?'标为未读':'标为已读'}</button></div></div>`;
  return `<article class="article wechat-card ${a.is_read?'is-read':'is-unread'}" data-id="${a.id}">${head}${title}${foot}</article>`;
}
function feedContentHtml(content,mediaState=null){const parts=[];let images=[];const flush=()=>{if(images.length){parts.push(`<div class="feed-media-grid media-count-${Math.min(images.length,4)}">${images.map(block=>imageHtml(mediaUrl(block.url),block.alt)).join('')}</div>`);images=[];}};for(const[index,block]of(content?.blocks||[]).entries()){if(block?.type==='image'&&mediaUrl(block.url))images.push(block);else {flush();parts.push(contentHtml({blocks:[block]},mediaState,index));}}flush();return parts.join('');}
function previewHtml(article){
  const blocks=article.content?.blocks||[];
  const full=completeContent(article);
  const inline=article.platform==='x'&&full&&blocks.length<=12&&blocks.reduce((n,block)=>n+(typeof block?.text==='string'?block.text.length:0),0)<=2500;
  if(inline)return `<div class="feed-original reader-content" data-open="${article.id}" role="button" tabindex="0" aria-label="展开原文">${feedContentHtml(article.content,article.media_state)}</div>`;
  const paragraphs=blocks.filter(block=>block&&['paragraph','heading','quote'].includes(block.type)&&typeof block.text==='string').slice(0,3);
  const images=blocks.filter(block=>block?.type==='image'&&mediaUrl(block.url)).slice(0,4);
  const text=paragraphs.length?`<div class="article-excerpt" data-open="${article.id}" role="button" tabindex="0" aria-label="阅读全文">${paragraphs.map(block=>`<p>${esc(block.text)}</p>`).join('')}</div>`:articleSummary(article)?`<div class="article-summary" data-open="${article.id}" role="button" tabindex="0">${esc(articleSummary(article))}</div>`:'';
  const grid=images.length?`<div class="feed-media-grid media-count-${images.length}" data-open="${article.id}">${images.map(block=>imageHtml(mediaUrl(block.url),block.alt)).join('')}</div>`:'';
  return `${text}${grid}${!full?'<span class="content-state">原文未完整</span>':''}`;
}
function articleHtml(a){
  if(a.platform==='xiaohongshu')return xhsCardHtml(a);
  if(a.platform==='wechat'&&documentArchiveEnabled())return wechatCardHtml(a);
  const blocks=a.content?.blocks||[];
  const inline=a.platform==='x'&&completeContent(a)&&blocks.length<=12&&blocks.reduce((n,block)=>n+(typeof block?.text==='string'?block.text.length:0),0)<=2500;
  const metadata=metadataCard(a),source=metadata?originalLink(a):'',linkAttrs=`href="${esc(source)}" target="_blank" rel="noopener noreferrer" data-original="${a.id}"`;
  if(metadata)return wechatCardHtml(a);
  const title=metadata?(source?`<a class="article-title" ${linkAttrs}>${esc(articleTitle(a))}</a>`:esc(articleTitle(a))):`<button class="article-title" data-open="${a.id}">${esc(articleTitle(a))}</button>`;
  const action=documentArchiveEnabled()?`${documentEntryHtml(a)}${safeExternal(a.url)?`<a class="article-read" href="${esc(safeExternal(a.url))}" target="_blank" rel="noopener noreferrer" data-original="${a.id}">查看原文 ↗</a>`:''}`:metadata?(source?`<a class="article-read" ${linkAttrs}>查看原文<span aria-hidden="true"> ↗</span></a>`:''):`<button class="article-read" data-open="${a.id}">${inline?'展开原文':'阅读全文'}<span aria-hidden="true"> →</span></button>`;
  return `<article class="article ${a.is_read?'is-read':'is-unread'}" data-id="${a.id}"><div class="article-header">${avatarHtml(sourceAvatar(a),(a.author||'?').slice(0,1).toUpperCase(),'author-avatar '+(classes[a.platform]||''))}<div class="article-byline"><span class="article-author">${esc(a.author)}</span><div class="article-meta"><span class="platform-name">${esc(platforms[a.platform]||'')}</span><span class="meta-dot">·</span><time class="article-time"${displayInstant(a)?` datetime="${esc(displayInstant(a))}"`:''} title="${esc(articleTimeTitle(a))}">${esc(articleTime(a))}</time></div></div><span class="unread-dot" title="未读"${a.is_read?' hidden':''}></span></div><div class="article-body">${inline?'':`<h2>${title}</h2>`}${metadata?'':previewHtml(a)}<div class="article-actions"><button data-star="${a.id}" class="${a.starred?'is-starred':''}" aria-label="${a.starred?'取消收藏':'收藏'}">${a.starred?'★ 已收藏':'☆ 收藏'}</button><button data-read="${a.id}">${a.is_read?'标为未读':'标为已读'}</button>${action}${analysisEntryHtml(a)}</div></div></article>`;
}
function articleContentKey(a){return JSON.stringify([documentArchiveEnabled(),aiAnalysisEnabled(),a.platform,a.author,a.title,a.summary,a.published_at,a.platform_time_at,a.platform_time_label,a.platform_time_datetime,a.platform_time_observed_at,a.cover_key||a.cover_url,a.media_state??null,a.content||null,sourceAvatar(a)]);}
function mergeArticle(previous,next){const merged={...previous,...next};if(!next.content&&previous?.content)merged.content=previous.content;return merged;}
function cacheArticleMetadata(article){
  feedCacheRevision++;
  const cached=periodPageCache?.items.find(item=>item.id===article.id);if(cached){cached.is_read=article.is_read;cached.starred=article.starred;}
  for(const[key,view]of feedViewCache){
    const index=view.articles.findIndex(item=>item.id===article.id);
    if(index<0){
      if(matchesScope(article,view.scope)){
        if(['unread','starred'].includes(view.scope.view)&&Number(article.id)<=Number(view.snapshot)&&(view.pageCache?.complete||view.pageCache?.seen.has(article.id))){
          view.articles=[...view.articles,article].sort(compareArticles);view.total++;view.nextOffset++;
          view.pageCache.items=[...view.pageCache.items,article].sort(compareArticles);
        }else if(Number(article.id)>Number(view.snapshot)||['unread','starred'].includes(view.scope.view))feedViewCache.delete(key);
      }
      continue;
    }
    const merged=mergeArticle(view.articles[index],article);
    if(!matchesScope(merged,view.scope)){
      if(['unread','starred'].includes(view.scope.view)&&articleContentKey(view.articles[index])===articleContentKey(merged)){
        view.articles=view.articles.filter(item=>item.id!==article.id);view.total=Math.max(0,view.total-1);view.nextOffset=Math.max(0,view.nextOffset-1);
        if(view.pageCache)view.pageCache.items=view.pageCache.items.filter(item=>item.id!==article.id);
      }else feedViewCache.delete(key);
      continue;
    }
    view.articles=view.articles.map((item,i)=>i===index?merged:item);
    if(view.pageCache)view.pageCache.items=view.pageCache.items.map(item=>item.id===article.id?mergeArticle(item,merged):item);
  }
}
function compareArticles(a,b){return (Date.parse(displayInstant(b)||b.ingested_at||b.discovered_at)||0)-(Date.parse(displayInstant(a)||a.ingested_at||a.discovered_at)||0)||Number(b.id)-Number(a.id);}
function matchesScope(a,scope){return visiblePlatforms.has(a.platform)&&(!scope.platform||a.platform===scope.platform)&&(!scope.source||a.source_id===scope.source)&&(normalizePeriod(scope.period)==='today'?articlePeriod(a)==='today':articlePeriod(a)!=='today')&&(scope.view!=='unread'||!a.is_read)&&(scope.view!=='starred'||!!a.starred)&&(!scope.q||[a.title,a.summary,a.author].join(' ').toLocaleLowerCase().includes(scope.q.toLocaleLowerCase()));}
function matchingArticle(a){return matchesScope(a,state);}
function feedScope(){return{view:state.view,platform:state.platform,source:state.source,period:state.period,q:state.q};}
function feedViewKey(scope=state){return JSON.stringify([scope.view,scope.platform,scope.source,scope.period,scope.q,beijingDay(Date.now())]);}
function copyFeedPage(cache){return cache?{...cache,items:cache.items.slice(),seen:new Set(cache.seen)}:null;}
function rememberFeedView(){
  if(!state.loaded||['sources','activity'].includes(state.view)||state.articles.length>200)return;
  const key=feedViewKey(),scope=feedScope();feedViewCache.delete(key);
  feedViewCache.set(key,{scope,articles:state.articles.slice(),total:state.total,snapshot:state.snapshot,nextOffset:state.nextOffset,hasMore:state.hasMore,totalKnown:state.totalKnown,periodDay:state.periodDay,fetchedAt:state.feedFetchedAt||Date.now(),pageCache:copyFeedPage(periodPageCache)});
  while(feedViewCache.size>12)feedViewCache.delete(feedViewCache.keys().next().value);
}
function restoreFeedView(){
  const key=feedViewKey(),view=feedViewCache.get(key);if(!view||Date.now()-view.fetchedAt>FEED_CACHE_TTL)return false;
  const {scope,pageCache,fetchedAt,...saved}=view;Object.assign(state,saved,{articles:view.articles.slice(),loaded:true,feedFetchedAt:fetchedAt,offset:0});periodPageCache=copyFeedPage(pageCache);
  feedViewCache.delete(key);feedViewCache.set(key,view);setFeedLoading(false);renderFeedState();renderPeriodCounts();return true;
}
function setFeedLoading(loading){$('#articles').classList.toggle('is-loading',loading&&!state.articles.length);$('#articles').setAttribute?.('aria-busy',String(loading));if(loading)$('#feed-empty').hidden=true;renderBulkReadControl();}
function renderBulkReadControl(){const button=$('#read-all');button.disabled=bulkReadBusy||!scopedReadSupported||!state.loaded;button.textContent=bulkReadBusy?'正在标记…':state.q?'搜索结果标为已读':'当前内容标为已读';button.title='将当前筛选下的文章标为已读';}
function setArticleBusy(id,busy){const node=$(`#articles [data-id="${id}"]`);node?.setAttribute?.('aria-busy',String(busy));for(const button of node?.querySelectorAll?.('[data-star],[data-read]')||[])button.disabled=busy;}
function cancelFeedLoad(){articleLoadController?.abort();articleLoadController=null;clearTimeout(articleLoadTimeout);clearTimeout(prefetchTimer);prefetchController?.abort();prefetchController=null;}
function recordFeedTiming(start,kind){if(typeof start!=='number'||!globalThis.performance?.measure)return;try{const name='orlet.feed.'+state.period+'.'+kind,duration=performance.now()-start;performance.clearMeasures(name);performance.measure(name,{start,duration});if(new URLSearchParams(globalThis.location?.search||'').get('_perf')==='1')console.info('Orlet performance '+JSON.stringify({period:state.period,mode:kind,ms:Math.round(duration*10)/10,cards:state.articles.length}));}catch{}}
function groupedArticles(){const groups=new Map();for(const article of state.articles){const period=articlePeriod(article)==='today'?'today':'history';if(!groups.has(period))groups.set(period,{period,title:periodTitles[period],items:[]});groups.get(period).items.push(article);}return ['today','history'].flatMap(period=>groups.has(period)?[groups.get(period)]:[]);}
function groupHtml(group){return `<section class="feed-group" data-period-group="${group.period}"><div class="group-heading"${group.title?'':' hidden'}><h2>${esc(group.title)}</h2><span>${group.items.length} 条</span></div><div class="group-articles">${group.items.map(articleHtml).join('')}</div></section>`;}
function reconcileChildren(parent,nodes){let current=parent.firstElementChild;for(const node of nodes){if(node===current)current=current.nextElementSibling;else parent.insertBefore(node,current);}while(current){const next=current.nextElementSibling;current.remove();current=next;}}
function renderArticles(){
  const groups=groupedArticles(),container=$('#articles');
  // Keyed cards retain loaded images and playing media during local refreshes.
  // The string fallback is used by the lightweight, DOM-free regression fixture.
  if(!document.createElement||!container.insertBefore){renderMarkup(container,groups.map(groupHtml).join(''));return;}
  const sections=[];
  for(const group of groups){
    let section=groupNodes.get(group.period);
    if(!section){section=document.createElement('section');section.className='feed-group';section.dataset.periodGroup=group.period;section.innerHTML='<div class="group-heading"><h2></h2><span></span></div><div class="group-articles"></div>';groupNodes.set(group.period,section);}
    section.querySelector('.group-heading').hidden=!group.title;section.querySelector('.group-heading h2').textContent=group.title;
    section.querySelector('.group-heading span').textContent=group.items.length+' 条';
    const cards=group.items.map(article=>{
      const key=articleContentKey(article);let node=articleNodes.get(article.id);
      if(!node||articleNodeKeys.get(article.id)!==key){const holder=document.createElement('div');holder.innerHTML=articleHtml(article);node=holder.firstElementChild;articleNodes.set(article.id,node);articleNodeKeys.set(article.id,key);
        installAvatars(node);}
      node.classList.toggle('is-read',!!article.is_read);node.classList.toggle('is-unread',!article.is_read);
      const dot=node.querySelector('.unread-dot');if(dot)dot.hidden=!!article.is_read;
      const timeEl=node.querySelector('.wx-time,.article-time');if(timeEl)timeEl.textContent=articleTime(article);
      if(article.platform==='xiaohongshu'){const address=originalLink(article);if(address)for(const link of node.querySelectorAll?.('[data-original]')||[])link.setAttribute('href',address);}
      const star=node.querySelector('[data-star]');if(star){star.textContent=article.starred?'★ 已收藏':'☆ 收藏';star.classList.toggle('is-starred',!!article.starred);star.setAttribute('aria-label',article.starred?'取消收藏':'收藏');}
      const readBtn=node.querySelector('[data-read]');if(readBtn)readBtn.textContent=article.is_read?'标为未读':'标为已读';
      const busy=pendingArticleActions.has(article.id);node.setAttribute('aria-busy',String(busy));if(star)star.disabled=busy;if(readBtn)readBtn.disabled=busy;
      return node;
    });
    reconcileChildren(section.querySelector('.group-articles'),cards);sections.push(section);
  }
  reconcileChildren(container,sections);
  if(articleNodes.size>500){const keep=new Set(state.articles.map(a=>a.id));for(const id of articleNodes.keys())if(!keep.has(id)){articleNodes.delete(id);articleNodeKeys.delete(id);}}
}
function renderFeedState(){
  if(periodPageCache?.complete&&state.loaded)state.total=periodPageCache.items.filter(matchingArticle).length;
  $('#feed-count').textContent='';$('#load-more').hidden=!state.hasMore;
  $('#feed-empty').hidden=state.articles.length>0;
  $('#empty-title').textContent=state.hasMore?'继续查看已保存的内容':state.q?'没有匹配的内容':state.view==='starred'?'喜欢的内容，留在这里':state.view==='unread'?'未读已清空':state.period==='today'?'今天还没有新内容':'这里还没有历史内容';
  $('#empty-description').textContent=state.hasMore?'点击加载更多，继续查找这一分类。':state.q?'换一个关键词试试。':state.view==='starred'?'点击文章下方的收藏。':state.view==='unread'?'有新的内容时会出现在这里。':state.sources.some(s=>visiblePlatforms.has(s.platform))?'可以切换日期或作者查看已保存的内容。':'添加一位作者，开始整理你的阅读。';
  $('#search-history').hidden=!(state.q&&state.period==='today'&&!state.hasMore&&!state.articles.length);
  renderArticles();renderUpdateNotice();renderBulkReadControl();
}
function renderAuthorNavigation(){
  const sources=state.sources.filter(source=>visiblePlatforms.has(source.platform)&&(!state.platform||source.platform===state.platform));
  renderMarkup($('#author-list'),sources.length?sources.map(source=>`<button class="author-nav ${state.source===source.id?'active':''}" data-source="${esc(source.id)}" title="${esc(source.name)}">${avatarHtml(source.avatar,(source.name||'?').slice(0,1).toUpperCase(),'author-nav-avatar '+classes[source.platform])}<span class="author-nav-name">${esc(source.name)}</span><span class="author-platform">${esc(platforms[source.platform])}</span></button>`).join(''):'<span class="nav-empty">暂无作者</span>');
  installAvatars($('#author-list'));
  $('#authors-count').textContent=sources.length||'';
}
function updateNavigation(){
  state.period=normalizePeriod(state.period);
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===state.view&&!state.source));
  document.querySelectorAll('[data-platform]').forEach(el=>el.classList.toggle('active',el.dataset.platform===(state.view==='sources'?state.monitorPlatform:state.platform)));
  document.querySelectorAll('[data-workspace]').forEach(el=>{const active=(el.dataset.workspace==='sources')===(state.view==='sources');el.classList.toggle('active',active);el.setAttribute?.('aria-pressed',String(active));});
  document.body?.classList.toggle('monitor-mode',state.view==='sources');
  document.body?.classList.toggle('reading-mode',state.readerId!==null);
  document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('active',el.dataset.filter===state.platform));
  document.querySelectorAll('[data-period]').forEach(el=>{el.classList.toggle('active',el.dataset.period===state.period);el.setAttribute?.('aria-pressed',String(el.dataset.period===state.period));});
  const source=state.sources.find(s=>s.id===state.source),title=source?.name||(state.platform?platforms[state.platform]:titles[state.view]);
  $('#breadcrumb-title').textContent=title;$('#page-heading').textContent=state.view==='sources'?'我的监控':title;
  $('#page-subtitle').textContent=source?(platforms[source.platform]||''):state.view==='unread'?'留给下一次阅读':state.view==='starred'?'值得再读一次':state.view==='sources'?`${state.sources.filter(s=>visiblePlatforms.has(s.platform)).length} 位作者`:state.view==='activity'?'采集与连接状态':new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'});
  const reading=state.readerId!==null,library=libraryView();$('#library-view').hidden=reading||!library;
  if($('#add-open'))$('#add-open').hidden=library||state.view==='activity';
  if($('#workspace-platforms'))$('#workspace-platforms').hidden=reading||library||state.view==='activity';
  $('#page-title').hidden=reading;$('#reader-view').hidden=!reading;
  $('#feed-view').hidden=reading||library||['sources','activity'].includes(state.view);$('#sources-view').hidden=reading||state.view!=='sources';$('#activity-view').hidden=reading||state.view!=='activity';
  const monitor=state.view==='sources',search=$('#search');
  $('#workspace-search').hidden=reading||state.view==='activity';search.value=monitor?state.monitorQ:library?libraryUi.model.q:state.q;search.placeholder=monitor?'搜索订阅名称':'搜索内容或作者';search.setAttribute('aria-label',search.placeholder);
  renderAuthorNavigation();renderPeriodCounts();renderUpdateNotice();renderConnectionStatus();renderBulkReadControl();
}
// The old backend's history excludes yesterday and unknown times. Both visible
// categories instead classify the same unfiltered local snapshot in Beijing time.
function articleParams(offset=0,snapshot=null,scope=state){const params=new URLSearchParams({offset:String(offset),readingPeriod:normalizePeriod(scope.period)});if(snapshot!==null)params.set('snapshot',String(snapshot));if(scope.platform)params.set('platform',scope.platform);if(scope.source)params.set('source',scope.source);if(scope.q)params.set('q',scope.q);return params;}
async function periodArticlesPage(offset,snapshot,request,restart=false,signal=null){
  const key=feedViewKey();
  if(restart||!periodPageCache||periodPageCache.key!==key||periodPageCache.snapshot!==snapshot)periodPageCache={key,snapshot,items:[],seen:new Set(),next:0,complete:false,counts:{today:0,history:0}};
  const cache=periodPageCache;
  // A finite scan budget keeps sparse categories responsive. Load more resumes
  // the same source offset, even when a batch has no matching articles.
  for(let pageNumber=0;!cache.complete&&cache.items.length<offset+40&&pageNumber<20;pageNumber++){
    const page=await api('/articles?'+articleParams(cache.next,cache.snapshot),signal?{signal}:{});if(request!==articleRequest)return null;
    scopedReadSupported=page.scopedReadSupported===true;
    if(cache.snapshot===null)cache.snapshot=page.snapshot??null;
    if(page.readingPeriodApplied===true){cache.serverFiltered=true;cache.total=Number(page.total)||0;}
    let added=0;
    for(const item of page.items){if(cache.seen.has(item.id))continue;cache.seen.add(item.id);added++;if(visiblePlatforms.has(item.platform))cache.counts[articlePeriod(item)==='today'?'today':'history']++;if(matchingArticle(item))cache.items.push(item);}
    if(page.items.length&&!added)throw new Error('内容分页暂不可用，请重试');
    cache.next+=page.items.length;cache.complete=!page.items.length||cache.next>=Number(page.total);
  }
  const items=cache.items.slice(offset,offset+40),nextOffset=offset+items.length;
  const fullyFiltered=cache.serverFiltered&&!['unread','starred'].includes(state.view);
  return{items,total:fullyFiltered?cache.total:cache.items.filter(matchingArticle).length,nextOffset,hasMore:!cache.complete||nextOffset<cache.items.length,totalKnown:fullyFiltered||cache.complete,snapshot:cache.snapshot};
}
async function refreshArticles(append=false,{preferCache=false}={}){
  if(libraryView())return libraryUi.load(append);
  const started=globalThis.performance?.now?.();
  state.period=normalizePeriod(state.period);
  if(state.periodDay!==beijingDay(Date.now()))append=false;
  const request=++articleRequest;
  cancelFeedLoad();
  if(!append&&preferCache&&restoreFeedView()){scheduleFeedPrefetch();recordFeedTiming(started,'cache');return true;}
  const controller=new AbortController();articleLoadController=controller;
  let timedOut=false;articleLoadTimeout=setTimeout(()=>{timedOut=true;controller.abort();},15000);
  if(!append){state.articles=state.articles.filter(matchingArticle);renderArticles();}
  setFeedLoading(true);
  const offset=append?state.nextOffset:0;
  let data;
  try{data=await periodArticlesPage(offset,append?state.snapshot:null,request,!append,controller.signal);}catch(e){if(request!==articleRequest||controller.signal.aborted&&!timedOut)return false;$('#feed-empty').hidden=state.articles.length>0;if(timedOut)throw new Error('加载超时，请稍后重试');throw e;}
  finally{if(request===articleRequest){clearTimeout(articleLoadTimeout);articleLoadController=null;setFeedLoading(false);}}
  if(!data)return false;
  // A slow response from an older search/filter must never overwrite a newer view.
  if(request!==articleRequest)return false;
  const items=data.items.filter(matchingArticle);
  const merged=new Map((append?state.articles:[]).map(item=>[item.id,item]));for(const item of items)merged.set(item.id,mergeArticle(merged.get(item.id),item));
  state.articles=[...merged.values()].filter(matchingArticle).sort(compareArticles);state.total=data.total;state.offset=offset;state.nextOffset=data.nextOffset;state.hasMore=data.hasMore;state.totalKnown=data.totalKnown;state.periodDay=beijingDay(Date.now());state.snapshot=data.snapshot??(append?state.snapshot:null);state.loaded=true;state.feedFetchedAt=Date.now();
  if(updatesCursor===null&&state.snapshot!==null&&/^\d+$/.test(String(state.snapshot)))updatesCursor=String(state.snapshot);
  renderFeedState();renderPeriodCounts();rememberFeedView();scheduleFeedPrefetch();
  recordFeedTiming(started,'network');
  return true;
}
function scheduleFeedPrefetch(){
  clearTimeout(prefetchTimer);if(!periodPageCache?.serverFiltered||['sources','activity'].includes(state.view))return;
  const scope={...feedScope(),period:state.period==='today'?'history':'today'},key=feedViewKey(scope),cached=feedViewCache.get(key);
  if(cached&&Date.now()-cached.fetchedAt<=FEED_CACHE_TTL)return;
  const origin=feedViewKey();
  prefetchTimer=setTimeout(async()=>{
    if(origin!==feedViewKey()||articleLoadController)return;
    const controller=new AbortController(),revision=feedCacheRevision;prefetchController=controller;
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const page=await api('/articles?'+articleParams(0,null,scope),{signal:controller.signal,priority:'low'});
      if(controller.signal.aborted||page.readingPeriodApplied!==true||origin!==feedViewKey()||revision!==feedCacheRevision)return;
      const items=page.items.filter(item=>matchesScope(item,scope)),total=Number(page.total)||0,complete=page.items.length>=total;
      const pageCache={key,snapshot:page.snapshot??null,items:items.slice(),seen:new Set(page.items.map(item=>item.id)),next:page.items.length,complete,counts:{today:0,history:0},serverFiltered:true,total};pageCache.counts[scope.period]=items.length;
      const fullyFiltered=!['unread','starred'].includes(scope.view);
      feedViewCache.set(key,{scope,articles:items.slice().sort(compareArticles),total:fullyFiltered?total:items.length,snapshot:pageCache.snapshot,nextOffset:items.length,hasMore:!complete,totalKnown:fullyFiltered||complete,periodDay:beijingDay(Date.now()),fetchedAt:Date.now(),pageCache});
      while(feedViewCache.size>12)feedViewCache.delete(feedViewCache.keys().next().value);
    }catch{/* Prefetch never blocks navigation or presents an error. */}
    finally{clearTimeout(timeout);if(prefetchController===controller)prefetchController=null;}
  },300);
}
function renderSources(){
  let recoveryOffered=false;let xhsRecoveryOffered=false;
  const stateWord=s=>{
    if(s.access?.allowed===false)return s.enabled?'需处理':'已暂停';
    if(!s.enabled)return '已暂停';
    if(s.status==='checking')return '更新中';
    if(s.status==='error'||s.status==='attention')return '需处理';
    if(s.initialized===0||s.platform==='xiaohongshu'&&s.status==='degraded')return '待更新';
    return '正常';
  };
  const platformSources=state.sources.filter(s=>visiblePlatforms.has(s.platform)&&(!state.monitorPlatform||s.platform===state.monitorPlatform));
  const query=state.monitorQ.toLocaleLowerCase();
  const filtered=platformSources.filter(s=>(!query||s.name.toLocaleLowerCase().includes(query))&&(state.monitorFilter==='paused'?!s.enabled:state.monitorFilter==='attention'?s.enabled&&(s.status==='error'||s.status==='attention'||s.access?.allowed===false):true));
  const selected=filtered.find(s=>s.id===state.monitorSelected)||filtered[0];state.monitorSelected=selected?.id??null;
  const empty=query?'没有匹配的订阅':'暂无订阅';
  const list=`<aside class="monitor-list"><div class="monitor-list-heading"><span>${filtered.length} 个订阅</span><select id="monitor-filter" aria-label="筛选订阅">${[['all','全部'],['paused','已暂停'],['attention','需处理']].map(([key,label])=>`<option value="${key}"${state.monitorFilter===key?' selected':''}>${label}</option>`).join('')}</select></div><div class="monitor-items">${filtered.map(s=>`<button class="monitor-item${s.id===selected?.id?' active':''}" data-source-select="${esc(s.id)}" aria-pressed="${s.id===selected?.id}">${avatarHtml(s.avatar,(s.name||'?').slice(0,1),'monitor-avatar')}<span><strong>${esc(s.name)}</strong><span class="monitor-item-meta">${esc(platforms[s.platform])} · ${esc(stateWord(s))}</span></span></button>`).join('')||`<p class="list-empty">${empty}</p>`}</div></aside>`;
  const markup=selected?[selected].map(s=>{
    const blocked=s.access?.allowed===false;
    const word=stateWord(s),warn=word==='需处理';
    const last=s.last_success?`最近检查 ${time(s.last_success)}`:'等待首次检查';
    const errors={lease_expired:'检查超时，稍后重试',parser_mismatch:'暂时无法读取内容',empty:'暂时无法读取内容',network_error:'连接失败，稍后重试',wrong_tab:'请打开微信读书页面',loading:'检查超时，稍后重试',platform_error:'暂时无法读取内容'};
    const message=(blocked?s.access?.reason:s.error)||'';
    const note=s.access?.code==='source_paused'?'':s.access?.code==='cooldown'&&s.access.retryAt?`更新暂停，预计 ${time(s.access.retryAt)} 后自动检查`:errors[message]||message;
    const platform=s.platform==='wechat'?'公众号':(platforms[s.platform]||'');
    const canOperate=s.platform==='wechat'||s.access?.allowed!==false;
    const recover=s.platform==='wechat'&&!recoveryOffered&&['auth','login','verification','user'].includes(s.access?.code);
    if(recover)recoveryOffered=true;
    const xhsRecover=s.platform==='xiaohongshu'&&!xhsRecoveryOffered&&s.access?.code==='login';
    if(xhsRecover)xhsRecoveryOffered=true;
    const recovery=recover?`<button class="secondary" data-weread-resume="${s.access.code==='user'?'user':'login'}">${s.access.code==='user'?'恢复公众号更新':'我已登录，恢复更新'}</button>`:'';
    const xhsRecovery=xhsRecover?`<button class="secondary" data-xhs-resume="login">我已登录小红书，恢复采集</button>`:'';
    const remove=!s.enabled?`<button class="danger-button outline" data-source-delete="${esc(s.id)}">删除订阅</button>`:'';
    const controls=canOperate?`${recovery}${xhsRecovery}<button class="secondary" data-retry="${esc(s.id)}" ${blocked||!s.enabled||s.status==='checking'||pendingSourceChecks.has(s.id)?'disabled':''}>检查</button><button class="secondary" data-toggle="${esc(s.id)}" ${blocked&&s.access?.code!=='source_paused'&&!s.enabled?'disabled':''}>${s.enabled?'暂停订阅':'恢复订阅'}</button>`:(xhsRecovery||'<span class="source-hint">暂停中</span>');
    const actions=`<div class="source-actions"><button class="primary" data-author-open="${esc(s.id)}">查看内容</button>${controls}${remove}</div>`;
    return `<section class="monitor-detail"><div class="source-row${warn?' is-warn':''}">${avatarHtml(s.avatar,(s.name||'?').slice(0,1).toUpperCase(),'source-face')}<div class="source-main"><h3><span class="source-name">${esc(s.name)}</span><span class="status-badge${!s.enabled?' paused':warn?' warn':''}">${esc(word)}</span></h3><p>${esc(platform)} · ${s.article_count||0} 篇</p></div></div><div class="monitor-dates"><span>订阅于 ${s.created_at?time(s.created_at):'—'}</span><span>${last}</span></div>${note?`<p class="source-error">${esc(note)}</p>`:''}${actions}</section>`;
  }).join(''):`<div class="monitor-detail monitor-empty">${empty}</div>`;
  renderMarkup($('#sources-list'),`<div class="monitor-browser">${list}${markup}</div>`);
  installAvatars($('#sources-list'));
}
function renderRuntime(){
  const summary=state.summary;if(!summary)return;
  $('#extension-version').textContent=summary.bridge.version?'扩展 '+summary.bridge.version:'';
  $('#extension-reload').hidden=!summary.bridge.needsReload;
  const notifications=summary.notifications||{};
  const acceptedAt=notifications.testAcceptedAt??notifications.testDeliveredAt;
  $('#notification-test').disabled=!summary.bridge.connected||summary.bridge.needsReload||notifications.testPending;
  $('#notification-test').textContent=notifications.testPending?'等待发送':'测试通知';
  $('#notification-status').textContent=notifications.lastError||(notifications.permission==='denied'?'通知权限未开启':!notifications.testPending&&acceptedAt?'浏览器已接收 · 桌面显示待确认 · '+time(acceptedAt):'');
  renderMarkup($('#platform-runtime'),[...visiblePlatforms].map(platform=>{const status=platformConnection(platform);return `<div class="platform-runtime-row"><span>${icon(platform)}${platforms[platform]}</span><span class="runtime-state ${status.connected?'':'warn'}">${status.word}</span></div>`;}).join(''));
}
function canAutoApply(){return state.loaded&&!libraryView()&&state.readerId===null&&!['sources','activity'].includes(state.view)&&(Number(globalThis.scrollY)||0)<140&&!loadingMore&&!applyingUpdates&&![...(document.querySelectorAll?.('#articles video')||[])].some(video=>!video.paused&&!video.ended);}
function renderUpdateNotice(){const pending=[...state.pendingArticles.values()].filter(matchingArticle),count=pending.length,newOnly=pending.every(item=>!state.articles.some(a=>a.id===item.id)&&!historicalSample(item));$('#updates-notice').hidden=!count;$('#updates-label').textContent=count?newOnly?`${count} 条新内容`:`${count} 条内容有更新`:'';$('#updates-apply').disabled=applyingUpdates;$('#updates-apply').textContent=applyingUpdates?'正在更新…':'查看更新';$('#new-content-dot').hidden=!count;clearTimeout(autoUpdateTimer);autoUpdateTimer=null;if(count&&!updatesBusy&&canAutoApply())autoUpdateTimer=setTimeout(()=>{autoUpdateTimer=null;return canAutoApply()?applyPendingUpdates():undefined;},180);}
function receiveUpdates(items){
  let changed=false;
  for(const incoming of items||[]){
    if(!visiblePlatforms.has(incoming.platform))continue;
    const index=state.articles.findIndex(article=>article.id===incoming.id),existing=index<0?null:state.articles[index];
    const merged=mergeArticle(existing||state.pendingArticles.get(incoming.id),incoming);
    cacheArticleMetadata(merged);
    if(existing){
      const contentChanged=articleContentKey(existing)!==articleContentKey(merged)||articlePeriod(existing)!==articlePeriod(merged)||(incoming.content_updated_at&&incoming.content_updated_at!==existing.content_updated_at);
      if(contentChanged){state.pendingArticles.set(incoming.id,merged);const metadata={...existing,is_read:merged.is_read,starred:merged.starred};state.articles[index]=metadata;}
      else {state.articles[index]=merged;changed=true;}
    }else if(matchingArticle(merged))state.pendingArticles.set(incoming.id,merged);
  }
  if(changed&&state.readerId===null&&!libraryView())renderArticles();renderUpdateNotice();
}
async function refreshLocalMetadata(){
  if(metadataBusy||!state.loaded||state.readerId!==null||libraryView()||['sources','activity'].includes(state.view)||applyingUpdates)return;
  if(state.periodDay!==beijingDay(Date.now())){const anchor=scrollAnchor();await refreshArticles();restoreAnchor(anchor);return;}
  metadataBusy=true;const request=articleRequest,viewKey=JSON.stringify([state.view,state.platform,state.source,state.period,state.q]);
  try{const data=await api('/articles?'+articleParams(0));if(request!==articleRequest||viewKey!==JSON.stringify([state.view,state.platform,state.source,state.period,state.q]))return;
    // A latest-page read also provides a conservative fallback when /updates is
    // not available yet. It never replaces the current pagination snapshot.
    const items=data.items.filter(item=>state.articles.some(a=>a.id===item.id)||state.snapshot===null||Number(item.id)>Number(state.snapshot));receiveUpdates(items);
  }finally{metadataBusy=false;}
}
async function pollUpdates(){
  if(updatesBusy||Date.now()<updatesRetryAt)return;updatesBusy=true;
  try{
    for(let page=0;page<20;page++){
      const data=await api('/updates'+(updatesCursor===null?'':'?after='+encodeURIComponent(updatesCursor)));
      if(!/^\d+$/.test(String(data.cursor)))throw new Error('更新游标无效');
      const previous=updatesCursor;updatesCursor=String(data.cursor);updatesRetryAt=0;
      receiveUpdates(data.items);if(state.summary&&data.counts){state.summary={...state.summary,...data.counts,startedAt:data.startedAt||state.summary.startedAt,timezone:data.timezone||state.summary.timezone};renderSummary();}
      if(data.reset){state.snapshot=null;await refreshLocalMetadata();}
      if(previous===null)await refreshLocalMetadata();
      if(!data.hasMore||updatesCursor===previous)break;
    }
  }catch(error){updatesRetryAt=Date.now()+(error.status===404||error.status===405?60000:10000);}
  finally{updatesBusy=false;renderUpdateNotice();}
}
function scrollAnchor(){if(!document.querySelectorAll||!globalThis.innerHeight)return null;for(const node of document.querySelectorAll('#articles .article')){const rect=node.getBoundingClientRect();if(rect.bottom>110)return {id:node.dataset.id,top:rect.top};}return null;}
function restoreAnchor(anchor){if(!anchor)return;const node=$(`#articles [data-id="${anchor.id}"]`);if(node?.getBoundingClientRect)scrollPage((Number(globalThis.scrollY)||0)+node.getBoundingClientRect().top-anchor.top);}
async function applyPendingUpdates(){
  if(applyingUpdates||state.readerId!==null)return;applyingUpdates=true;renderUpdateNotice();
  const request=++articleRequest,anchor=(Number(globalThis.scrollY)||0)<140?null:scrollAnchor(),pendingSnapshot=new Map(state.pendingArticles),pendingIds=[...pendingSnapshot.keys()],target=Math.max(40,state.articles.length+pendingIds.filter(id=>!state.articles.some(a=>a.id===id)).length);
  try{
    let offset=0,snapshot=null,total=0,hasMore=false,totalKnown=false,first=true;const result=new Map();
    do{const data=await periodArticlesPage(offset,snapshot,request,first);first=false;if(!data||request!==articleRequest)return;snapshot=data.snapshot??snapshot;total=data.total;hasMore=data.hasMore;totalKnown=data.totalKnown;for(const item of data.items)if(matchingArticle(item))result.set(item.id,mergeArticle(result.get(item.id),item));offset=data.nextOffset;if(!data.items.length)break;}while(hasMore&&offset<target);
    if(request!==articleRequest)return;
    state.articles=[...result.values()].sort(compareArticles);state.snapshot=snapshot;state.total=total;state.offset=0;state.nextOffset=offset;state.hasMore=hasMore;state.totalKnown=totalKnown;state.periodDay=beijingDay(Date.now());state.loaded=true;
    for(const[id,item]of pendingSnapshot)if(state.pendingArticles.get(id)===item)state.pendingArticles.delete(id);renderFeedState();renderPeriodCounts();restoreAnchor(anchor);
  }catch(error){if(request===articleRequest)toast(error.message);}
  finally{applyingUpdates=false;renderUpdateNotice();}
}
function renderSummary(){
  const summary=state.summary;if(!summary)return;
  for(const[key,value]of Object.entries({sources:summary.sources,today:summary.today,unread:summary.unread,attention:summary.attention}))$('#metric-'+key).textContent=value;
  $('#nav-total').textContent=summary.articles;$('#nav-unread').textContent=summary.unread;$('#nav-unread').hidden=!summary.unread;
  for(const p of Object.keys(platforms))$('#count-'+p).textContent=state.sources.filter(s=>s.platform===p).length||'';
  renderConnectionStatus();
  renderPeriodCounts();
}
function platformConnection(platform){
  const summary=state.summary||{},collector=summary.collectors?.[platform],access=summary.access?.[platform];
  const watch=state.watch,plan=watch?.plan;
  if(platform==='x'&&watch?.mode==='watch'&&watch.selected){const running=watch.executionEnabled&&plan?.enabled===1&&['active','blocked_queue'].includes(plan.status)&&Date.parse(plan.authorization_expires_at)>Date.now()&&(!plan.cooldown_until||Date.parse(plan.cooldown_until)<=Date.now());return{word:running?'采集中':'已暂停',connected:!!running};}
  if(access?.allowed===false||collector?.pausedReason)return{word:'已暂停',connected:false};
  if(collector?.partialPaused)return{word:'部分暂停',connected:false};
  if(collector){if(!collector.enabled)return{word:'未启用',connected:false};if(!collector.active)return{word:'已暂停',connected:false};return collector.clientReady?{word:'正常',connected:true}:{word:'待连接',connected:false};}
  if(!state.sources.some(s=>s.platform===platform&&s.enabled))return{word:'未启用',connected:false};
  return summary.bridge?.connected?{word:'正常',connected:true}:{word:'待连接',connected:false};
}
function renderConnectionStatus(){
  if(!state.summary)return;
  const source=state.sources.find(s=>s.id===state.source),platform=state.view==='sources'?state.monitorPlatform:source?.platform||state.platform;
  let label,connected;
  if(platform){const status=platformConnection(platform);label=(platform==='wechat'?'公众号':platforms[platform])+status.word;connected=status.connected;}
  else{const enabled=[...visiblePlatforms].filter(p=>state.sources.some(s=>s.platform===p&&s.enabled)||state.summary.collectors?.[p]?.enabled),statuses=enabled.map(platformConnection);connected=statuses.length>0&&statuses.every(s=>s.connected);label=statuses.some(s=>s.word==='部分暂停')?'部分暂停':statuses.some(s=>s.word==='采集中')?'采集中':connected?'更新正常':statuses.length&&statuses.every(s=>s.word===statuses[0].word)?statuses[0].word:statuses.length?'部分待处理':'未启用';}
  $('#connection-title').textContent=label;$('#connection-dot').classList.toggle('connected',connected);$('#setup-open').title='连接设置 · '+label;
}
function renderPeriodCounts(){
  const globalFeed=state.view==='feed'&&!state.platform&&!state.source&&!state.q,summary=state.summary||{},periods=summary.periods||{};
  const today=Number(periods.today??summary.today)||0,history=Number.isFinite(Number(summary.articles))?Math.max(0,Number(summary.articles)-today):['yesterday','history','unknown'].reduce((n,key)=>n+(Number(periods[key])||0),0);
  const key=JSON.stringify([state.view,state.platform,state.source,state.period,state.q,beijingDay(Date.now())]);
  const counts=globalFeed&&periodPageCache?.complete&&periodPageCache.key===key&&periodPageCache.seen.size===Number(summary.articles)?periodPageCache.counts:{today,history};
  for(const period of Object.keys(periodTitles)){const count=$('#period-count-'+period);if(count)count.textContent=globalFeed?(counts[period]||''):'';}
}
async function refresh({skipFeedMetadata=false}={}){
  const request=++summaryRequest;
  try{
    const [summary,sources,watch]=await Promise.all([api('/summary'),api('/sources'),api('/watch').catch(()=>null)]);if(request!==summaryRequest)return;const avatarState=items=>JSON.stringify(items.map(s=>[s.id,avatarUrl(s.avatar)])),avatarsChanged=avatarState(state.sources)!==avatarState(sources.items),archiveChanged=documentArchiveEnabled()!==(summary.features?.documentArchive===true)||aiAnalysisEnabled()!==(summary.features?.aiAnalysis===true);state.summary=summary;state.sources=sources.items;state.watch=watch;
    renderSummary();
    const events=summary.events;
    renderMarkup($('#events-list'),events.length?events.map(e=>`<div class="event-row ${e.level==='warn'?'warn':''}"><span class="event-time">${time(e.created_at)}</span><span>${e.author?esc(e.author)+' · ':''}${esc(e.message)}</span></div>`).join(''):'<div class="list-empty">暂无记录</div>');
    renderSources();renderRuntime();renderAuthorNavigation();if(!['sources','activity'].includes(state.view)&&!libraryView()){if((avatarsChanged||archiveChanged)&&state.loaded&&state.readerId===null)renderArticles();if(!skipFeedMetadata){if(!state.loaded&&state.readerId===null&&!articleLoadController)await refreshArticles();else if(state.loaded)await refreshLocalMetadata();}}if(request===summaryRequest)$('#refresh-status').textContent='已同步 '+new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});
  }catch(e){if(request===summaryRequest){$('#refresh-status').textContent='本地服务暂时离线';$('#connection-title').textContent='服务离线';$('#connection-dot').classList.toggle('connected',false);}}
}
function readerCurrent(generation,id=state.readerId){return generation===readerGeneration&&state.readerId===id&&id!==null;}
function documentReaderCurrent(session=documentReaderSession){return !!session&&documentReaderSession===session&&readerCurrent(session.generation,session.id);}
function documentWaiting(document){
  const active=status=>['queued','fetching'].includes(status);
  return active(document?.bodyStatus)||(document?.content?.blocks||[]).some(block=>
    block.type==='image'&&!block.unavailable&&(block.assetId||block.url||block.localUrl)&&active(block.mediaStatus)||
    block.type==='video'&&(block.posterAssetId||block.poster||block.posterLocalUrl)&&active(block.posterMediaStatus));
}
function stopReader(){libraryUi.cancel();readerGeneration++;clearTimeout(readerTimer);readerTimer=null;readerController?.abort();readerController=null;readerContentBusyGeneration=null;documentReaderSession=null;state.readerDocument=null;documentBlockNodes.clear();documentBlockKeys.clear();renderedMarkup.delete($('#reader-content'));for(const video of $('#reader-content').querySelectorAll?.('video')||[])video.pause();}
function renderReader(error=''){
  const article=state.reader;
  $('#reader-title').textContent=articleTitle(article);
  $('#reader-meta').textContent=article?[article.author,platforms[article.platform],articleTime(article)].filter(Boolean).join(' · '):'';
  const archived=documentReaderCurrent(),document=state.readerDocument,complete=archived?document?.content?.complete===true:completeContent(article),metadata=!archived&&metadataCard(article);
  $('#reader-title').hidden=!archived&&complete&&article?.platform==='x';
  if(archived){
    const hasBody=!!documentContentHtml(document?.content),waiting=documentWaiting(document),failed=!!documentReaderSession.error||document?.status==='error'||(!hasBody&&!waiting&&!!document);
    renderDocumentContent(document?.content);
    $('#reader-content').setAttribute?.('aria-busy',String(!hasBody&&waiting));
    const connectionWaiting=!hasBody&&['network_error','timeout','closed'].includes(document?.failureCode);
    const message=documentReaderSession.error||(connectionWaiting?'原文连接暂不可用，将自动重试':documentReaderSession.pollExpired&&!hasBody?'文章仍在准备，可刷新查看':failed?'正文暂未取得，请重试':hasBody?(complete?'':'正文暂未完整'):'正在准备正文…');
    $('#reader-status').textContent=message;$('#reader-status').hidden=!message;$('#reader-status').classList.toggle('is-error',failed);
    $('#reader-retry-wrap').hidden=!documentReaderSession.pollExpired&&!failed&&(waiting||!document||!['partial','error'].includes(document.status));
    $('#reader-retry').textContent=documentReaderSession.pollExpired?'刷新':'重试';
  }else{
    $('#reader-retry').textContent='重试';
    const failed=!!error||['error','attention'].includes(article?.content_status);
    renderMarkup($('#reader-content'),metadata?'':contentHtml(article?.content,article?.media_state));
    $('#reader-content').setAttribute?.('aria-busy',String(!complete&&!metadata&&!failed));
    $('#reader-status').textContent=error||(complete?'':failed?article.content_error||'原文获取失败':'正在获取原文…');
    $('#reader-status').hidden=metadata?!error:complete&&!error;$('#reader-status').classList.toggle('is-error',failed);
    $('#reader-retry-wrap').hidden=metadata||!failed||article?.access?.allowed===false;
  }
  $('#reader-analysis').hidden=!aiAnalysisEnabled();$('#reader-analysis').disabled=!article;
  $('#reader-star').textContent=article?.starred?'★ 已收藏':'☆ 收藏';
  $('#reader-read').textContent=article?.is_read?'标为未读':'标为已读';
  $('#reader-star').disabled=!article||readerActionBusy;$('#reader-read').disabled=!article||readerActionBusy;$('#reader-read').hidden=!!documentReaderSession?.libraryPath;$('#reader-prev').hidden=!!documentReaderSession?.libraryPath;$('#reader-next').hidden=!!documentReaderSession?.libraryPath;
  const source=archived?safeExternal(article?.url||document?.url):metadata?originalLink(article):safeExternal(article?.url);$('#reader-source').href=source;$('#reader-source').hidden=!source;$('#reader-source').textContent=archived||metadata?'查看原文 ↗':'来源 ↗';
  const index=state.articles.findIndex(item=>item.id===state.readerId);$('#reader-prev').disabled=index<=0;$('#reader-next').disabled=index<0||index>=state.articles.length-1;
}
function applyReader(article,generation){
  if(!readerCurrent(generation)||Number(article?.id)!==state.readerId)return false;
  state.reader=article;
  cacheArticleMetadata(article);
  const index=state.articles.findIndex(item=>item.id===article.id);if(index>=0)state.articles[index]={...state.articles[index],...article};
  renderReader();return true;
}
function applyReaderDocument(document,session){
  if(!documentReaderCurrent(session)||(session.libraryPath?document?.documentId!==session.entry.documentId:Number(document?.articleId)!==session.id))return false;
  if(!['missing','queued','fetching','ready','partial','error'].includes(document.status))throw new Error('Invalid document status');
  state.readerDocument=document;
  if(!state.reader)state.reader={id:session.id,is_read:0,starred:0};
  for(const key of ['platform','author','title','url'])if(!state.reader[key]&&typeof document[key]==='string')state.reader[key]=document[key];
  renderReader();return true;
}
async function documentRequest(session,method){
  const controller=new AbortController(),cancel=()=>controller.abort();let timedOut=false;
  session.controller.signal.addEventListener('abort',cancel,{once:true});if(session.controller.signal.aborted)cancel();
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},12000);
  try{if(session.libraryPath){if(method)await api('/documents/'+encodeURIComponent(session.entry.documentId)+'/document',{method:'POST',body:'{}',signal:controller.signal});const entry=await api(session.libraryPath,{signal:controller.signal});if(documentReaderCurrent(session)){state.reader=libraryReaderArticle(entry,session.id);session.entry=entry;}return entry.document;}return await api('/articles/'+session.id+'/document',{signal:controller.signal,...(method?{method,body:'{}'}:{})});}
  catch(error){if(timedOut)throw new Error('document_timeout');throw error;}
  finally{clearTimeout(timeout);session.controller.signal.removeEventListener('abort',cancel);}
}
function scheduleDocumentReader(session){
  clearTimeout(readerTimer);readerTimer=null;
  if(!documentReaderCurrent(session)||!documentWaiting(state.readerDocument))return;
  const elapsed=Date.now()-session.startedAt;
  if(elapsed>=DOCUMENT_WAIT_LIMIT){session.pollExpired=true;renderReader();return;}
  const delay=elapsed<DOCUMENT_FAST_WAIT_LIMIT?DOCUMENT_POLL_DELAY:document.hidden?DOCUMENT_HIDDEN_POLL_DELAY:DOCUMENT_SLOW_POLL_DELAY;
  readerTimer=setTimeout(()=>{readerTimer=null;if(!documentReaderCurrent(session))return;if(Date.now()-session.startedAt>=DOCUMENT_WAIT_LIMIT){session.pollExpired=true;renderReader();return;}session.polls++;return loadReaderDocument(session);},Math.min(delay,DOCUMENT_WAIT_LIMIT-elapsed));
}
async function loadReaderDocument(session,{queue=false}={}){
  if(!documentReaderCurrent(session)||session.busy)return;
  session.busy=true;session.error='';
  try{
    let document=await documentRequest(session,queue?'POST':undefined);
    if(!documentReaderCurrent(session))return;
    if(!applyReaderDocument(document,session))throw new Error('Invalid document');
    if(document.status==='missing'&&!session.enqueued&&!session.libraryPath){
      session.enqueued=true;document=await documentRequest(session,'POST');
      if(!documentReaderCurrent(session))return;
      if(!applyReaderDocument(document,session))throw new Error('Invalid document');
    }
    if(session.libraryPath&&!session.located&&document.content){session.located=true;libraryUi.locate(session.entry);}
    scheduleDocumentReader(session);
  }catch(error){if(documentReaderCurrent(session)&&!session.controller.signal.aborted){session.error='正文暂时无法加载，请重试';renderReader();}}
  finally{session.busy=false;}
}
async function requestDocumentContent(session){
  if(!documentReaderCurrent(session)||session.busy)return;
  const queue=!session.pollExpired;
  clearTimeout(readerTimer);readerTimer=null;session.startedAt=Date.now();session.polls=0;session.enqueued=true;session.error='';session.pollExpired=false;
  $('#reader-retry-wrap').hidden=true;$('#reader-status').hidden=false;$('#reader-status').textContent='正在准备正文…';
  await loadReaderDocument(session,{queue});
}
async function openLibraryReader(entry){
  if(!libraryEnabled())return;feedScrollTop=Math.max(0,Number(globalThis.scrollY)||0);stopReader();readerController=new AbortController();readerActionBusy=false;
  const id='library:'+entry.kind+':'+entry.id;state.readerId=id;state.reader=libraryReaderArticle(entry,id);
  const session=documentReaderSession={id,generation:readerGeneration,controller:readerController,startedAt:Date.now(),polls:0,enqueued:true,busy:false,error:'',libraryPath:'/library/'+entry.kind+'/'+encodeURIComponent(entry.id),entry};updateNavigation();renderReader();scrollPage(0);await loadReaderDocument(session);
}
async function openDocumentReader(id,selected){
  if(documentReaderCurrent()&&state.readerId===id)return;
  if(state.readerId===null)feedScrollTop=Math.max(0,Number(globalThis.scrollY)||0);
  stopReader();const generation=readerGeneration;readerController=new AbortController();readerActionBusy=false;
  state.readerId=id;state.reader=selected||null;articleRequest++;
  const session=documentReaderSession={id,generation,controller:readerController,startedAt:Date.now(),polls:0,enqueued:false,busy:false,error:''};
  updateNavigation();renderReader();scrollPage(0);$('#reader-title').focus?.({preventScroll:true});
  const metadata=(async()=>{
    try{
      const article=selected||await api('/articles/'+id,{signal:session.controller.signal});if(!applyReader(article,generation))return;
      if(!article.is_read){
        await api('/articles/'+id,{method:'PATCH',body:JSON.stringify({read:true}),signal:session.controller.signal});
        if(!documentReaderCurrent(session))return;
        state.reader.is_read=1;cacheArticleMetadata(state.reader);const cached=state.articles.find(value=>value.id===id);if(cached)cached.is_read=1;renderReader();
      }
    }catch(error){if(documentReaderCurrent(session)&&error.name!=='AbortError')toast('已读状态暂未同步');}
  })();
  await Promise.all([metadata,loadReaderDocument(session)]);
  if(documentReaderCurrent(session))await refresh();
}
function scheduleReader(generation){
  clearTimeout(readerTimer);
  if(!readerCurrent(generation)||metadataCard(state.reader)||completeContent(state.reader)||['error','attention'].includes(state.reader?.content_status))return;
  readerTimer=setTimeout(()=>pollReader(generation),2500);
}
async function pollReader(generation){
  if(!readerCurrent(generation))return;
  try{const article=await api('/articles/'+state.readerId,{signal:readerController.signal});if(applyReader(article,generation))scheduleReader(generation);}
  catch(e){if(readerCurrent(generation)&&e.name!=='AbortError')renderReader(e.message);}
}
async function requestReaderContent(generation){
  if(documentReaderCurrent()&&generation===documentReaderSession.generation)return requestDocumentContent(documentReaderSession);
  if(!readerCurrent(generation)||metadataCard(state.reader)||readerContentBusyGeneration===generation)return;
  readerContentBusyGeneration=generation;
  clearTimeout(readerTimer);$('#reader-retry-wrap').hidden=true;$('#reader-status').hidden=false;$('#reader-status').textContent='正在获取原文…';
  try{const article=await api('/articles/'+state.readerId+'/content',{method:'POST',body:'{}',signal:readerController.signal});if(applyReader(article,generation))scheduleReader(generation);}
  catch(e){if(readerCurrent(generation)&&e.name!=='AbortError')renderReader(e.message);}
  finally{if(readerContentBusyGeneration===generation)readerContentBusyGeneration=null;}
}
async function openReader(id){
  id=Number(id);if(!Number.isSafeInteger(id)||id<1)return;
  const selected=state.articles.find(article=>article.id===id);
  if(documentArchiveEnabled())return openDocumentReader(id,selected);
  if(selected?.platform==='xiaohongshu'){
    const address=originalLink(selected);if(!address)return;
    globalThis.open?.(address,'_blank','noopener,noreferrer');
    try{await markOriginalRead(selected);}catch(e){toast(e.message);}return;
  }
  if(state.readerId===null)feedScrollTop=Math.max(0,Number(globalThis.scrollY)||0);
  stopReader();const generation=readerGeneration;readerController=new AbortController();readerActionBusy=false;
  state.readerId=id;state.reader=state.articles.find(article=>article.id===id)||null;articleRequest++;
  updateNavigation();renderReader();scrollPage(0);($('#reader-title').hidden?$('#reader-view'):$('#reader-title')).focus?.({preventScroll:true});
  try{
    const article=await api('/articles/'+id,{signal:readerController.signal});if(!applyReader(article,generation))return;
    if(!article.is_read){
      await api('/articles/'+id,{method:'PATCH',body:JSON.stringify({read:true}),signal:readerController.signal});
      if(!readerCurrent(generation,id))return;
      state.reader.is_read=1;cacheArticleMetadata(state.reader);const cached=state.articles.find(value=>value.id===id);if(cached)cached.is_read=1;renderReader();
    }
    if(!metadataCard(state.reader)&&!completeContent(state.reader)&&state.reader.access?.allowed!==false)await requestReaderContent(generation);
    if(readerCurrent(generation,id))await refresh();
  }catch(e){if(readerCurrent(generation,id)&&e.name!=='AbortError')renderReader(e.message);}
}
async function closeReader(){
  const id=state.readerId;stopReader();const generation=readerGeneration;state.readerId=null;state.reader=null;readerActionBusy=false;renderMarkup($('#reader-content'),'');updateNavigation();
  if(libraryView()){scrollPage(feedScrollTop);await libraryUi.load();return;}
  if(['unread','starred'].includes(state.view))state.offset=0;
  state.articles=state.articles.filter(matchingArticle);renderFeedState();
  scrollPage(feedScrollTop);
  try{await refresh();}catch(e){toast(e.message);}
  if(generation===readerGeneration&&state.readerId===null){scrollPage(feedScrollTop);$(`[data-open="${id}"]`)?.focus?.({preventScroll:true});}
}
async function readerAction(patch){
  if(!state.reader||readerActionBusy)return;const id=state.readerId,generation=readerGeneration;
  readerActionBusy=true;renderReader();
  try{if(libraryEnabled()&&'starred'in patch)await libraryUi.favorite(state.reader,patch.starred);else await api('/articles/'+id,{method:'PATCH',body:JSON.stringify(patch)});if(readerCurrent(generation,id)){if('starred'in patch)state.reader.starred=patch.starred;if('read'in patch)state.reader.is_read=patch.read;cacheArticleMetadata(state.reader);const cached=state.articles.find(value=>value.id===id);if(cached)Object.assign(cached,state.reader);await refresh();}}
  catch(e){if(readerCurrent(generation,id))toast(e.message);}
  finally{if(readerCurrent(generation,id)){readerActionBusy=false;renderReader();}}
}
async function navigate(view='feed',platform='',source='',{clearSearch=false}={}){const changed=state.view!==view||state.platform!==platform||state.source!==source||clearSearch&&!!state.q;clearTimeout(searchTimer);rememberFeedView();cancelFeedLoad();stopReader();state.readerId=null;state.reader=null;readerActionBusy=false;if(clearSearch)state.q='';state.view=view;state.platform=platform;state.source=source;state.period=normalizePeriod(state.period);state.offset=0;state.nextOffset=0;state.snapshot=null;state.loaded=false;articleRequest++;toggleMobileNav(false);updateNavigation();if(view==='sources')renderSources();if(!['sources','activity'].includes(view))try{await refreshArticles(false,{preferCache:changed});}catch(e){toast(e.message);}}
async function filterPeriod(period){const next=normalizePeriod(period),changed=state.period!==next;if(!changed&&articleLoadController)return;clearTimeout(searchTimer);rememberFeedView();cancelFeedLoad();state.period=next;state.offset=0;state.nextOffset=0;state.snapshot=null;state.loaded=false;articleRequest++;updateNavigation();try{await refreshArticles(false,{preferCache:changed});}catch(e){toast(e.message);}}
function readerStep(direction){const index=state.articles.findIndex(a=>a.id===state.readerId),next=state.articles[index+direction];if(next)void openReader(next.id);}

function installImageHandlers(container){
  const settle=(event,failed)=>{
    if(event.target?.tagName==='VIDEO'){
      if(failed){const message=event.target.closest?.('.content-video')?.querySelector('[data-video-status]');if(message){message.textContent='视频暂无法播放';message.hidden=false;}}
      return;
    }
    const image=event.target;if(image?.tagName!=='IMG')return;
    if(image.matches?.('[data-xhs-cover-image]')){const cover=image.closest('[data-xhs-cover]');if(cover){cover.hidden=failed;cover.closest('.xhs-card')?.classList.toggle('has-cover',!failed);}retryCardImage(image,failed);return;}
    const figure=image.closest('.content-image');if(!figure)return;
    image.hidden=failed;figure.classList.toggle('is-error',failed);
    figure.querySelector('.media-error').hidden=!failed;
    figure.querySelector('[data-image-message]').textContent='图片未加载';
    figure.querySelector('[data-image-retry]').disabled=false;
  };
  container.addEventListener('error',event=>settle(event,true),true);
  container.addEventListener('load',event=>settle(event,false),true);
  container.addEventListener('click',event=>{
    const button=event.target.closest('[data-image-retry]');if(!button)return;
    event.preventDefault();event.stopPropagation();
    const figure=button.closest('.content-image'),image=figure?.querySelector('img');if(!image)return;
    const original=backendPath(image.dataset.mediaSrc||image.getAttribute('src'));if(!original?.startsWith('/api/media?'))return;
    image.dataset.mediaSrc=original;button.disabled=true;
    figure.querySelector('[data-image-message]').textContent='正在重试…';
    image.src=backendUrl(original+'&_retry='+Date.now()+'-'+(++imageRetrySequence));
  });
}

$('#reader-back').addEventListener('click',closeReader);
$('#reader-retry').addEventListener('click',()=>requestReaderContent(readerGeneration));
$('#reader-analysis').addEventListener('click',()=>void analysisUi.open({...state.reader,documentId:state.readerDocument?.documentId||state.reader?.documentId,versionId:state.readerDocument?.versionId}));
$('#articles').addEventListener('click',event=>{const button=event.target.closest('[data-analysis]');if(button){const article=state.articles.find(a=>a.id===Number(button.dataset.analysis));if(article)void analysisUi.open(article);}});
$('#reader-star').addEventListener('click',()=>readerAction({starred:!state.reader?.starred}));
$('#reader-read').addEventListener('click',()=>readerAction({read:!state.reader?.is_read}));
$('#reader-prev').addEventListener('click',()=>readerStep(-1));
$('#reader-next').addEventListener('click',()=>readerStep(1));
$('#updates-apply').addEventListener('click',applyPendingUpdates);
$('#author-list').addEventListener('click',event=>{const button=event.target.closest('[data-source]');const source=state.sources.find(s=>s.id===button?.dataset.source);if(source)void navigate('feed',source.platform,source.id);});
function toggleMobileNav(open){$('#sidebar').classList.toggle('is-open',open);$('#sidebar').inert=!!mobileNavigation?.matches&&!open;$('.shell').inert=!!mobileNavigation?.matches&&open;$('#nav-backdrop').hidden=!open;$('#nav-toggle').setAttribute?.('aria-expanded',String(open));if(open)$('#sidebar').querySelector?.('a,button')?.focus?.({preventScroll:true});}
$('#nav-toggle').addEventListener('click',()=>toggleMobileNav($('#nav-backdrop').hidden));
$('#nav-backdrop').addEventListener('click',()=>toggleMobileNav(false));
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.view)));
document.querySelectorAll('[data-platform]').forEach(el=>el.addEventListener('click',()=>{if(state.view==='sources'){state.monitorPlatform=el.dataset.platform;state.monitorSelected=null;updateNavigation();renderSources();}else void navigate('feed',el.dataset.platform);}));
document.querySelectorAll('[data-workspace]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.workspace)));
document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>navigate(state.view,el.dataset.filter)));
document.querySelectorAll('[data-period]').forEach(el=>el.addEventListener('click',()=>filterPeriod(el.dataset.period)));
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>$('#'+el.dataset.close).close()));
function showAdd(){ $('#source-error').textContent='';$('#wechat-search-error').textContent='';applyAddPlatform(state.view==='sources'&&state.monitorPlatform?state.monitorPlatform:addPlatform);$('#add-dialog').showModal(); }
$('#add-open').addEventListener('click',showAdd);

// ── 统一「添加订阅」：选平台换字段 ──
let addPlatform='wechat';
function applyAddPlatform(platform){
  addPlatform=['x','xiaohongshu','wechat'].includes(platform)?platform:'wechat';
  const select=$('#source-platform');if(select)select.value=addPlatform==='wechat'?'x':addPlatform;
  for(const button of document.querySelectorAll('[data-add-platform]')){
    const on=button.dataset.addPlatform===addPlatform;
    button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));
  }
  const wechat=addPlatform==='wechat';
  if($('#pane-wechat'))$('#pane-wechat').hidden=!wechat;
  if($('#pane-author'))$('#pane-author').hidden=wechat;
  if($('#source-submit'))$('#source-submit').hidden=wechat;
  if(wechat){ setTimeout(()=>$('#wechat-search-input')?.focus(),60); }
  else { syncSourceForm(); setTimeout(()=>document.querySelector('#source-form input[name="name"]')?.focus(),60); }
}
for(const button of document.querySelectorAll('[data-add-platform]'))button.addEventListener('click',()=>applyAddPlatform(button.dataset.addPlatform));

// ── 公众号搜索与添加（公众平台 searchbiz，经本机搜索服务） ──
async function wechatSearch(value){
  const q=String(value||'').trim();if(!q)return;
  const results=$('#wechat-search-results'),error=$('#wechat-search-error'),submit=$('#wechat-search-submit'),note=$('#wechat-search-note');
  error.textContent='';submit.disabled=true;results.innerHTML='<p class="list-empty">搜索中…</p>';
  let followed=new Set();
  try{ const current=await api('/weread'); followed=new Set((current.sources||[]).map(s=>String(s.bookId))); }catch{}
  try{
    const data=await api('/weread/search?q='+encodeURIComponent(q));
    const items=Array.isArray(data.items)?data.items:[];
    note.textContent=items.length?`找到 ${items.length} 个公众号`:'换个名字再试试';
    results.innerHTML=items.length?items.map(x=>{
      const avatar=/^https?:\/\/(mmbiz|wx\.qlogo)/.test(x.avatar||'')?x.avatar:'';
      const already=followed.has('MP_WXS_'+(x.bid||''));
      return `<div class="wx-result${already?' is-followed':''}"><span class="wx-result-face">${avatar?`<img src="${esc(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:esc((x.nickname||'?').slice(0,1))}</span><div class="wx-result-main"><strong>${esc(x.nickname||'')}${already?' <span class="wx-followed">已追更</span>':''}</strong><p>${esc(x.signature||x.alias||'')}</p></div><button class="secondary" data-wechat-add="${esc(x.bid||'')}" data-wechat-name="${esc(x.nickname||'')}" data-wechat-avatar="${esc(avatar)}"${already?' disabled':''}>${already?'已追更':'添加'}</button></div>`;
    }).join(''):'<p class="list-empty">没有找到匹配的公众号</p>';
  }catch(e){results.innerHTML='';error.textContent=e.message||'搜索失败';}
  finally{submit.disabled=false;}
}
$('#wechat-add-open')?.addEventListener('click',()=>{ applyAddPlatform('wechat');$('#source-error').textContent='';$('#wechat-search-error').textContent='';$('#add-dialog').showModal();setTimeout(()=>$('#wechat-search-input')?.focus(),60); });
$('#wechat-search-submit')?.addEventListener('click',()=>wechatSearch($('#wechat-search-input').value));
$('#wechat-search-input')?.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault();wechatSearch($('#wechat-search-input').value); } });
$('#wechat-search-results')?.addEventListener('click',async event=>{
  const button=event.target.closest('[data-wechat-add]');if(!button||button.disabled)return;
  const bid=button.dataset.wechatAdd,name=button.dataset.wechatName,avatar=button.dataset.wechatAvatar||'';
  button.disabled=true;button.textContent='添加中…';
  try{
    await api('/weread/add',{method:'POST',body:JSON.stringify({bid,name,avatar})});
    toast('已添加：'+name);$('#add-dialog').close();await refresh();
  }catch(e){button.disabled=false;button.textContent='添加';$('#wechat-search-error').textContent=e.message||'添加失败';}
});
$('#author-add').addEventListener('click',showAdd);
async function showSetup(){try{const data=await api('/setup');$('#extension-path').textContent=data.extensionPath;$('#bridge-key').value=data.bridgeKey;$('#setup-dialog').showModal();}catch(e){toast(e.message);}}
$('#setup-open').addEventListener('click',showSetup);
$('#notification-test').addEventListener('click',async()=>{const button=$('#notification-test');button.disabled=true;try{await api('/notifications/test',{method:'POST',body:'{}'});await refresh();toast('已排入通知测试');}catch(e){toast(e.message);renderRuntime();}});
$('#copy-key').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#bridge-key').value);toast('已复制');}catch{$('#bridge-key').type='text';$('#bridge-key').select();toast('请手动复制');}});
function syncSourceForm(){const p=$('#source-platform').value,xhs=p==='xiaohongshu';$('#source-url').placeholder=p==='x'?'https://x.com/NASA':xhs?'https://www.xiaohongshu.com/user/profile/…':'http://127.0.0.1:8001/feed/…';$('#source-name').placeholder=xhs?'留空，自动识别':'例如：NASA';$('#url-label').textContent=p==='wechat'?'RSS 链接':'主页链接';$('#source-interval-field').hidden=xhs;$('#source-interval').disabled=xhs;$('#source-interval').value='30';$('#source-note').textContent='';}
$('#source-platform').addEventListener('change',syncSourceForm);
$('#source-form').addEventListener('submit',async event=>{event.preventDefault();$('#source-submit').disabled=true;$('#source-error').textContent='';try{const data=Object.fromEntries(new FormData(event.target));const isXhs=data.platform==='xiaohongshu';if(!String(data.url||'').trim()||(!isXhs&&!String(data.name||'').trim())){$('#source-error').textContent=isXhs?'请粘贴博主主页链接':'请填写名称和主页链接';$('#source-submit').disabled=false;return;}if(isXhs){await api('/xhs/add',{method:'POST',body:JSON.stringify({url:data.url,name:data.name})});$('#add-dialog').close();event.target.reset();syncSourceForm();await navigate('sources');await refresh();toast('已添加订阅，稍后自动识别博主信息');return;}data.intervalMinutes=Number(data.intervalMinutes);await api('/sources',{method:'POST',body:JSON.stringify(data)});$('#add-dialog').close();event.target.reset();syncSourceForm();await navigate('sources');await refresh();toast(state.summary?.access?.[data.platform]?.allowed===false?'订阅已保存，接入待确认':'订阅已添加');}catch(e){$('#source-error').textContent=e.message;}finally{$('#source-submit').disabled=false;}});
$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);const q=$('#search').value.trim();if(state.view==='sources'){state.monitorQ=q;state.monitorSelected=null;renderSources();return;}if(state.readerId!==null||state.view==='activity')return;if(libraryView()){libraryUi.search(q);return;}rememberFeedView();state.q=q;state.offset=0;state.nextOffset=0;state.snapshot=null;state.loaded=false;cancelFeedLoad();articleRequest++;state.articles=state.articles.filter(matchingArticle);renderArticles();renderPeriodCounts();setFeedLoading(true);searchTimer=setTimeout(()=>refreshArticles().catch(e=>toast(e.message)),250);});
$('#search-history').addEventListener('click',()=>filterPeriod('history'));
$('#load-more').addEventListener('click',async()=>{if(loadingMore)return;loadingMore=true;$('#load-more').disabled=true;try{await refreshArticles(true);}catch(e){toast(e.message);}finally{loadingMore=false;$('#load-more').disabled=false;}});
$('#read-all').addEventListener('click',async()=>{if(bulkReadBusy||!scopedReadSupported||!state.loaded)return;bulkReadBusy=true;renderBulkReadControl();const scope=feedScope(),key=feedViewKey(),filters=Object.fromEntries(articleParams(0,state.snapshot,scope));delete filters.offset;if(scope.view==='starred')filters.starred='true';try{
  feedCacheRevision++;const result=await api('/articles/read-all',{method:'POST',body:JSON.stringify(filters)});feedCacheRevision++;
  if(!Array.isArray(result.ids))throw new Error('操作结果未确认，请刷新后重试');
  const ids=new Set(result.ids),known=new Map();
  for(const item of [...state.articles,...(periodPageCache?.items||[]),...state.pendingArticles.values(),...[...feedViewCache.values()].flatMap(view=>[...view.articles,...(view.pageCache?.items||[])])])known.set(item.id,item);
  for(const item of known.values())if(ids.has(item.id))cacheArticleMetadata({...item,is_read:1});
  state.articles=state.articles.map(item=>ids.has(item.id)?{...item,is_read:1}:item).filter(matchingArticle);
  for(const[id,item]of state.pendingArticles)if(ids.has(id))state.pendingArticles.set(id,{...item,is_read:1});
  if(key===feedViewKey()&&state.view==='unread')await refreshArticles();else if(state.readerId===null)renderFeedState();
  await refresh({skipFeedMetadata:true});toast(result.changed?`已标记 ${result.changed} 篇内容`:'当前内容已全部读过');
}catch(e){toast(e.message);}finally{bulkReadBusy=false;renderBulkReadControl();}});
async function patchArticle(a,patch){if(!a||pendingArticleActions.has(a.id))return;pendingArticleActions.add(a.id);setArticleBusy(a.id,true);try{if(libraryEnabled()&&'starred'in patch)await libraryUi.favorite(a,patch.starred);else await api('/articles/'+a.id,{method:'PATCH',body:JSON.stringify(patch)});if('starred'in patch)a.starred=Number(patch.starred);if('read'in patch)a.is_read=Number(patch.read);cacheArticleMetadata(a);state.articles=state.articles.map(item=>item.id===a.id?mergeArticle(item,a):item).filter(matchingArticle);renderFeedState();await refresh({skipFeedMetadata:true});}finally{pendingArticleActions.delete(a.id);setArticleBusy(a.id,false);}}
async function markOriginalRead(a){if(a&&!a.is_read)await patchArticle(a,{read:true});}
$('#articles').addEventListener('click',async event=>{if(event.target.closest('video,[data-image-retry]'))return;const original=event.target.closest('[data-original]');if(original){const a=state.articles.find(x=>x.id===Number(original.dataset.original));try{await markOriginalRead(a);}catch(e){toast(e.message);}return;}const b=event.target.closest('[data-star],[data-read],[data-open]');if(!b||b.disabled)return;const id=Number(b.dataset.star||b.dataset.read||b.dataset.open);if(b.dataset.open){if(globalThis.getSelection?.()?.toString())return;event.preventDefault();await openReader(id);return;}const a=state.articles.find(x=>x.id===id);if(!a)return;try{await patchArticle(a,b.dataset.star?{starred:!a.starred}:{read:!a.is_read});}catch(e){toast(e.message);}});
$('#articles').addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key)||event.target.closest('button,a,video'))return;const item=event.target.closest('[data-open]');if(item){event.preventDefault();void openReader(Number(item.dataset.open));}});
$('#sources-list').addEventListener('click',async event=>{
  const select=event.target.closest('[data-source-select]');
  if(select){state.monitorSelected=select.dataset.sourceSelect;renderSources();return;}
  const remove=event.target.closest('[data-source-delete]');
  if(remove){const source=state.sources.find(s=>s.id===remove.dataset.sourceDelete);if(!source||source.enabled)return;state.deleteSource=source.id;$('#source-delete-name').textContent=source.name;$('#source-delete-error').textContent='';$('#source-delete-dialog').showModal();return;}
  const resume=event.target.closest('[data-weread-resume]');
  if(resume){
    if(resume.disabled)return;resume.disabled=true;
    try{await api('/weread/resume',{method:'POST',body:JSON.stringify(resume.dataset.wereadResume==='user'?{confirmResume:true}:{confirmBrowserLogin:true})});await refresh();toast('已安排恢复检查');}
    catch(e){toast(e.message);}finally{resume.disabled=false;}
    return;
  }
  const xhsResume=event.target.closest('[data-xhs-resume]');
  if(xhsResume){
    if(xhsResume.disabled)return;xhsResume.disabled=true;
    try{await api('/xhs/resume',{method:'POST',body:JSON.stringify({confirmBrowserLogin:true})});await refresh();toast('已安排恢复小红书采集');}
    catch(e){toast(e.message);}finally{xhsResume.disabled=false;}
    return;
  }
  const author=event.target.closest('[data-author-open]');
  if(author){const source=state.sources.find(s=>s.id===author.dataset.authorOpen);if(source)await navigate('feed',source.platform,source.id,{clearSearch:true});return;}
  const b=event.target.closest('[data-retry],[data-toggle]');if(!b)return;
  const id=b.dataset.retry||b.dataset.toggle,s=state.sources.find(x=>x.id===id);
  if(b.dataset.retry){
    if(pendingSourceChecks.has(id))return;
    pendingSourceChecks.add(id);renderSources();
    const before={last:s?.last_success||null,count:s?.article_count||0};
    try{
      await api('/sources/'+id,{method:'PATCH',body:JSON.stringify({retry:true})});
      toast('正在检查…');
      let done=false;
      for(let i=0;i<4&&!done;i++){
        await new Promise(r=>setTimeout(r,8000));
        await refresh();
        const now=state.sources.find(x=>x.id===id);
        if(now&&now.last_success!==before.last){
          done=true;
          const added=(now.article_count||0)-before.count;
          toast(added>0?`检查完成：发现 ${added} 篇新文章`:'本次未发现新内容');
        }else if(now&&(now.error||now.access?.allowed===false||!now.enabled)){
          done=true;toast(now.access?.reason||now.error||'这个订阅已暂停');
        }
      }
      if(!done)toast('仍在等待检查，结果稍后更新');
    }catch(e){toast(e.message);}finally{pendingSourceChecks.delete(id);renderSources();}
    return;
  }
  try{await api('/sources/'+id,{method:'PATCH',body:JSON.stringify({enabled:!s.enabled})});await refresh();toast(s.enabled?'已暂停这个订阅':'已恢复这个订阅');}catch(e){toast(e.message);}
});
$('#sources-list').addEventListener('change',event=>{if(event.target.id==='monitor-filter'){state.monitorFilter=event.target.value;state.monitorSelected=null;renderSources();}});
$('#source-delete-confirm').addEventListener('click',async()=>{
  const id=state.deleteSource,button=$('#source-delete-confirm');if(!id||button.disabled)return;button.disabled=true;
  try{await api('/sources/'+id+'/remove',{method:'POST',body:JSON.stringify({confirm:true})});state.deleteSource=null;state.monitorSelected=null;$('#source-delete-dialog').close();await refresh();toast('已删除订阅');}
  catch(error){$('#source-delete-error').textContent=error.message;}finally{button.disabled=false;}
});
$('#source-delete-dialog').addEventListener('close',()=>{state.deleteSource=null;});
document.addEventListener?.('keydown',event=>{if(document.querySelector('dialog[open]')?.open)return;if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape'){if(!$('#nav-backdrop').hidden)toggleMobileNav(false);else if(state.readerId!==null)void closeReader();}else if(event.key==='/'&&state.readerId===null&&state.view!=='activity'){event.preventDefault();$('#search').focus();}else if(state.readerId!==null&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();readerStep(event.key==='ArrowLeft'?-1:1);}});
installImageHandlers($('#articles'));installImageHandlers($('#reader-content'));
mobileNavigation?.addEventListener?.('change',()=>toggleMobileNav(false));toggleMobileNav(false);
updateNavigation();await Promise.all([refreshArticles().catch(error=>toast(error.message)),refresh({skipFeedMetadata:true})]);void pollUpdates();setInterval(pollUpdates,5000);setInterval(refresh,15000);
