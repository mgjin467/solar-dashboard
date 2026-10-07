import { listGenerationExcelFiles, downloadFile } from './drive';
import { parseGenerationFile, mergeGenerationRows } from './generation';
import { loadSmpData, getSmp } from './smp';

function pad(n){return String(n).padStart(2,'0')}
function keyFor(date,grain){const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${y}-${pad(m)}-${pad(d)} ${pad(h)}:00`;if(grain==='day')return`${y}-${pad(m)}-${pad(d)}`;if(grain==='year')return String(y);return`${y}-${pad(m)}`}
function alignedLabel(date,grain,offset){const y=date.getUTCFullYear()+offset,m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${pad(m)}-${pad(d)} ${pad(h)}시`;if(grain==='day')return`${pad(m)}-${pad(d)}`;if(grain==='year')return String(y);return`${pad(m)}월`}
function inRange(iso,start,end){const day=iso.slice(0,10);return(!start||day>=start)&&(!end||day<=end)}
function shiftYear(isoDate,offset){const [y,m,d]=isoDate.split('-').map(Number);const dt=new Date(Date.UTC(y-offset,m-1,d));if(dt.getUTCMonth()!==m-1)dt.setUTCDate(0);return`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`}

async function loadGeneration(){
  const files=await listGenerationExcelFiles();const parsed=[];const errors=[];
  for(let i=0;i<files.length;i+=5){const result=await Promise.all(files.slice(i,i+5).map(async f=>{try{const buffer=await downloadFile(f.id);return{ok:true,file:f,rows:parseGenerationFile({name:f.name,modifiedTime:f.modifiedTime,buffer})}}catch(e){return{ok:false,file:f,error:e?.message||String(e)}}}));for(const r of result){if(r.ok)parsed.push(...r.rows);else errors.push({file:r.file?.name,error:r.error})}}
  return{files,rows:mergeGenerationRows(parsed),errors};
}

function parseDateOnly(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  return new Date(Date.UTC(+m[1],+m[2]-1,+m[3],0,0,0));
}

function bucketStart(dt,grain){
  const y=dt.getUTCFullYear(),m=dt.getUTCMonth(),d=dt.getUTCDate(),h=dt.getUTCHours();
  if(grain==='year')return new Date(Date.UTC(y,0,1));
  if(grain==='month')return new Date(Date.UTC(y,m,1));
  if(grain==='day')return new Date(Date.UTC(y,m,d));
  return new Date(Date.UTC(y,m,d,h));
}

function nextBucket(dt,grain){
  const x=new Date(dt);
  if(grain==='year')x.setUTCFullYear(x.getUTCFullYear()+1);
  else if(grain==='month')x.setUTCMonth(x.getUTCMonth()+1);
  else if(grain==='day')x.setUTCDate(x.getUTCDate()+1);
  else x.setUTCHours(x.getUTCHours()+1);
  return x;
}

function periodBuckets(start,end,grain){
  const a=parseDateOnly(start),b=parseDateOnly(end);
  if(!a||!b||a>b)return[];
  let cur=bucketStart(a,grain);
  const last=bucketStart(grain==='hour'?new Date(b.getTime()+23*3600*1000):b,grain);
  const out=[];
  let guard=0;
  while(cur<=last&&guard<100000){out.push(new Date(cur));cur=nextBucket(cur,grain);guard++}
  return out;
}

function aggregate(rows,smpData,{grain,start,end,offset=0}){
  const merged=rows.filter(r=>inRange(r.ts,start,end));
  const groups=new Map();
  let totalGeneration=0,totalRevenue=0,knownKwh=0,exactRows=0;

  // 먼저 실제 발전 데이터를 집계합니다.
  for(const row of merged){
    const dt=new Date(row.ts);
    const key=keyFor(dt,grain);
    const s=getSmp(dt,smpData).value;
    const revenue=s==null?0:row.kwh*s;
    if(!groups.has(key))groups.set(key,{dt:bucketStart(dt,grain),kwh:0,revenue:0,knownKwh:0,smpNum:0});
    const g=groups.get(key);
    g.kwh+=row.kwh;
    g.revenue+=revenue;
    if(s!=null){g.knownKwh+=row.kwh;g.smpNum+=row.kwh*s;knownKwh+=row.kwh}
    totalGeneration+=row.kwh;
    totalRevenue+=revenue;
    if(row.precision==='hourly_exact')exactRows++;
  }

  // 선택한 기간의 모든 버킷을 만들어 데이터가 없는 기간도 0으로 표시합니다.
  const series=periodBuckets(start,end,grain).map(dt=>{
    const key=keyFor(dt,grain);
    const g=groups.get(key);
    let smp=null;
    if(g?.knownKwh){
      smp=+(g.smpNum/g.knownKwh).toFixed(2);
    }else{
      const lookup=getSmp(dt,smpData).value;
      if(lookup!=null)smp=+Number(lookup).toFixed(2);
    }
    return{
      axis:alignedLabel(dt,grain,offset),
      actual:key,
      kwh:+Number(g?.kwh||0).toFixed(3),
      revenue:Math.round(g?.revenue||0),
      smp
    };
  });

  return{series,kpi:{totalGeneration:+totalGeneration.toFixed(1),totalRevenue:Math.round(totalRevenue),weightedSmp:knownKwh?+(totalRevenue/knownKwh).toFixed(2):null,exactRows}};
}

export async function buildDashboard({grain='month',start='',end='',forceSmp=false,compareOffsets=[]}={}){
  const offsets=[0,...compareOffsets.filter(x=>[1,2,3].includes(x))];const minStart=offsets.reduce((min,o)=>{const s=shiftYear(start,o);return!min||s<min?s:min},start);const maxEnd=end;
  const [{files,rows,errors},smpData]=await Promise.all([loadGeneration(),loadSmpData({force:forceSmp,start:minStart,end:maxEnd})]);
  const periods=offsets.map(offset=>{const s=shiftYear(start,offset),e=shiftYear(end,offset);return{offset,start:s,end:e,...aggregate(rows,smpData,{grain,start:s,end:e,offset})}});
  const primary=periods[0];
  const yearly=[];for(const p of periods){yearly.push({label:p.offset?`${p.offset}년 전`:'현재',period:`${p.start} ~ ${p.end}`,kwh:p.kpi.totalGeneration,revenue:p.kpi.totalRevenue,avgSmp:p.kpi.weightedSmp})}
  return{syncedAt:new Date().toISOString(),fileCount:files.length,files:files.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime))),errors,smpMeta:smpData.meta,kpi:primary.kpi,series:primary.series,comparisons:periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:p.series,kpi:p.kpi})),yearly};
}
