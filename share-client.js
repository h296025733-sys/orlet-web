// Shared-device UI for the independent adapter and the fixed static frontend.
const cursorKey='streamShareNotificationCursor';
let cursor=null,busy=false;
const request=(url,options)=>globalThis.orletBackend?.request?globalThis.orletBackend.request(url,options):fetch(url,options);
const notificationIcon=()=>document.baseURI?new URL('./mark.svg',document.baseURI).href:'/mark.svg';
function noticeText(){return !('Notification'in window)?'此浏览器不支持桌面通知':Notification.permission==='granted'?'本设备已允许通知；需保持网页打开':Notification.permission==='denied'?'本设备未允许通知':'点击测试通知，可允许本设备接收通知';}
function decorate(){
  document.querySelectorAll('.setup-advanced,.setup-rss').forEach(el=>{if(!el.hidden)el.hidden=true;});
  const field=document.querySelector('#bridge-key');if(field?.value)field.value='';
  const status=document.querySelector('#notification-status'),text=noticeText();if(status&&status.textContent!==text)status.textContent=text;
  const version=document.querySelector('#extension-version');if(version&&version.textContent!=='本设备通知')version.textContent='本设备通知';
  const reload=document.querySelector('#extension-reload');if(reload&&!reload.hidden)reload.hidden=true;
  const test=document.querySelector('#notification-test'),unavailable=!('Notification'in window)||Notification.permission==='denied';if(test&&test.disabled!==unavailable)test.disabled=unavailable;
}
document.addEventListener('click',async event=>{
  if(!event.target.closest('#notification-test'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!('Notification'in window))return;
  if(Notification.permission==='default')await Notification.requestPermission();
  if(Notification.permission==='granted')new Notification('Orlet',{body:'本设备通知已连接，保持网页打开即可接收更新。',icon:notificationIcon()});
  decorate();
},true);
async function poll(){
  if(busy)return;busy=true;
  try{
    if(cursor===null){const baseline=await request('/api/updates').then(r=>{if(!r.ok)throw 0;return r.json();});cursor=baseline.cursor;localStorage.setItem(cursorKey,cursor);return;}
    const saved=localStorage.getItem(cursorKey);if(saved&&Number(saved)>Number(cursor))cursor=saved;
    const response=await request('/api/updates?after='+encodeURIComponent(cursor));if(!response.ok)return;
    const data=await response.json();
    if(data.reset||!('Notification'in window)||Notification.permission!=='granted'){
      cursor=data.cursor;localStorage.setItem(cursorKey,cursor);return;
    }
    const items=data.items||[];
    for(const item of items.slice(0,5)){
      const notification=new Notification(item.author||'Orlet',{body:item.title||'有新内容',tag:'stream-share-'+item.id,icon:notificationIcon()});
      notification.onclick=()=>{window.focus();notification.close();};
      // Advance only after the browser accepts this notification. The next
      // poll retries a failed item and drains bursts five at a time.
      cursor=String(item.id);localStorage.setItem(cursorKey,cursor);
    }
    if(items.length<=5){cursor=data.cursor;localStorage.setItem(cursorKey,cursor);}
  }catch{/* A disconnected page keeps its cursor and retries on the next tick. */}
  finally{busy=false;}
}
const dialog=document.querySelector('#setup-dialog');
if(dialog)new MutationObserver(decorate).observe(dialog,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','open']});
decorate();poll();setInterval(()=>{decorate();poll();},10000);
