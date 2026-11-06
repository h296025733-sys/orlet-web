const DAY=86400000,OFFSET=8*3600000;
function iso(value){
  const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
  if(!match||!Number.isFinite(Date.parse(value))||wall(...match.slice(1).map(Number))===null)return null;
  return new Date(value).toISOString();
}
const local=stamp=>new Date(stamp+OFFSET);
function wall(year,month,day,hour=0,minute=0,second=0){
  if(![year,month,day,hour,minute,second].every(Number.isInteger)||year<1000||month<1||month>12||day<1||day>31||hour<0||hour>23||minute<0||minute>59||second<0||second>59)return null;
  const stamp=Date.UTC(year,month-1,day,hour,minute,second),date=new Date(stamp);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?stamp-OFFSET:null;
}

// User-selected XHS display interpretation. It never establishes publication
// time. Relative labels are anchored only to their saved observation, not now.
export function interpretXhsTime(evidence){
  const rawLabel=typeof evidence?.rawLabel==='string'?evidence.rawLabel.trim():'',observedAt=iso(evidence?.observedAt);
  const result={at:null,rawLabel:rawLabel||null,observedAt,context:/^(?:编辑于|编辑时间|最后编辑)/.test(rawLabel)?'edited':/^(?:发布于|发表于|发布时间)/.test(rawLabel)?'published_label':'unspecified',precision:null,basis:rawLabel?'xhs_beijing_invalid_label':'missing',sourceTimezone:'Asia/Shanghai',status:rawLabel?'unresolved':'missing',interpretation:'user_selected_beijing'};
  if(!rawLabel)return result;
  if(!observedAt)return{...result,basis:'invalid_observation'};
  const observed=Date.parse(observedAt),sample=local(observed);
  const resolved=(stamp,precision,basis='xhs_beijing_label')=>Number.isFinite(stamp)&&Math.abs(stamp)<=8640000000000000&&stamp<=observed?{...result,at:new Date(stamp).toISOString(),precision,basis:precision==='day'?basis+'_date':basis,status:'resolved'}:{...result,basis:Number.isFinite(stamp)&&stamp>observed?'future':'xhs_beijing_invalid_label'};
  const datetime=iso(evidence?.datetime);if(datetime)return resolved(Date.parse(datetime),'second','rendered_datetime');
  const label=rawLabel.replace(/^(?:编辑于|编辑时间|最后编辑|发布于|发表于|发布时间)\s*[:：]?\s*/,'');
  const absolute=label.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))(?:\s|$)/);
  if(absolute){const at=iso(absolute[1]);return at?resolved(Date.parse(at),'second','explicit_offset'):result;}
  const duration=label.match(/^(\d+)\s*(秒|分钟|小时|天)前(?:\s+\p{L}[\p{L}\s]*)?$/u);
  if(duration||label==='刚刚'){
    const count=Number(duration?.[1]??0),unit=duration?.[2]??'分钟',scale={秒:1000,分钟:60000,小时:3600000,天:DAY}[unit];
    if(unit==='天'&&Number.isSafeInteger(count)){const day=local(observed-count*scale);return resolved(wall(day.getUTCFullYear(),day.getUTCMonth()+1,day.getUTCDate()),'day','xhs_beijing_duration');}
    return Number.isSafeInteger(count)?resolved(observed-count*scale,'approximate_'+{秒:'second',分钟:'minute',小时:'hour'}[unit],'xhs_beijing_duration'):result;
  }
  const relative=label.match(/^(今天|昨天|前天)(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+\p{L}[\p{L}\s]*)?$/u);
  if(relative){
    const date=new Date(Date.UTC(sample.getUTCFullYear(),sample.getUTCMonth(),sample.getUTCDate())-({今天:0,昨天:1,前天:2}[relative[1]])*DAY);
    const stamp=wall(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),Number(relative[2]??0),Number(relative[3]??0),Number(relative[4]??0));
    return resolved(stamp,relative[2]?(relative[4]?'second':'minute'):'day');
  }
  const calendarLabel=label.replace(/^(\d{1,2})月(\d{1,2})日(?=\s|$)/,'$1-$2');
  const calendar=calendarLabel.match(/^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+\p{L}[\p{L}\s]*)?$/u);
  if(calendar){
    let year=Number(calendar[1]??sample.getUTCFullYear());
    const month=Number(calendar[2]),day=Number(calendar[3]),hour=Number(calendar[4]??0),minute=Number(calendar[5]??0),second=Number(calendar[6]??0);
    let stamp=wall(year,month,day,hour,minute,second);
    if(!calendar[1]&&(stamp===null||Date.UTC(year,month-1,day)>Date.UTC(sample.getUTCFullYear(),sample.getUTCMonth(),sample.getUTCDate())))stamp=wall(--year,month,day,hour,minute,second);
    return resolved(stamp,calendar[4]?(calendar[6]?'second':'minute'):'day',calendar[1]?'xhs_beijing_label':'xhs_beijing_inferred_year');
  }
  const clock=label.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+\p{L}[\p{L}\s]*)?$/u);
  return clock?resolved(wall(sample.getUTCFullYear(),sample.getUTCMonth()+1,sample.getUTCDate(),Number(clock[1]),Number(clock[2]),Number(clock[3]??0)),clock[3]?'second':'minute'):result;
}
