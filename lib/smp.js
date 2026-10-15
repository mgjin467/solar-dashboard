import fallbackRows from '@/data/smp-monthly.json';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { listSmpExcelFiles, downloadFile } from './drive';

const FALLBACK = new Map(fallbackRows.map(r => [`${r.year}-${String(r.month).padStart(2,'0')}`, Number(r.smp)]));
const CACHE_MS = Number(process.env.SMP_DRIVE_CACHE_MINUTES || 10) * 60 * 1000;
let memCache = null;
const parsedDriveCache=new Map();

function t(v){return String(v??'').replace(/\s+/g,' ').trim()}
function num(v){const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:null}
function hourKey(y,m,d,h){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}`}
function monthKey(y,m){return `${y}-${String(m).padStart(2,'0')}`}
function dateParts(v, defaultYear){
  if (v instanceof Date && !Number.isNaN(v.getTime())) return {year:v.getUTCFullYear(),month:v.getUTCMonth()+1,day:v.getUTCDate()};
  const s=t(v);let m=s.match(/^(20\d{2})(\d{2})(\d{2})$/); if(m)return{year:+m[1],month:+m[2],day:+m[3]};
  m=s.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); if(m)return{year:+m[1],month:+m[2],day:+m[3]};
  m=s.match(/^(\d{1,2})[.\/-](\d{1,2})/); if(m)return{year:defaultYear,month:+m[1],day:+m[2]};return null;
}
function parseHourLabel(v){const m=t(v).toLowerCase().match(/^(\d{1,2})\s*h/);if(!m)return null;const h=+m[1];return h>=1&&h<=24?h:null}

export function parseKpxSmpWorkbook(buffer, requestedYear, area='mainland'){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true,raw:false});const out=new Map();
  for(const sn of wb.SheetNames){
    const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});if(!matrix.length)continue;
    // KPX 육지/제주 SMP 원본은 날짜 1열 + 1h~24h 각 1개 열 + 최대/최소/평균 구조입니다.
    // 과거 구현은 각 시간 열에서 오른쪽 4개 셀을 평균해 인접 시간까지 섞었고,
    // 1h를 01시로 저장하여 24h와 키가 겹치는 문제가 있었습니다. 각 시간 셀을 그대로 읽습니다.
    let parsed=false;
    for(let headerRow=0;headerRow<Math.min(20,matrix.length);headerRow++){
      const hrow=matrix[headerRow]||[],hourCols=[];
      hrow.forEach((v,c)=>{const h=parseHourLabel(v);if(h)hourCols.push({c,h})});
      if(hourCols.length<20)continue;
      for(let r=headerRow+1;r<matrix.length;r++){
        const row=matrix[r]||[];
        // 일부 파일은 첫 열이 index, 둘째 열이 YYYYMMDD이므로 앞쪽 몇 열에서 날짜를 찾습니다.
        let p=null;
        for(let c=0;c<Math.min(5,row.length);c++){p=dateParts(row[c],requestedYear);if(p)break}
        if(!p||p.year!==requestedYear)continue;
        for(const {c,h} of hourCols){
          const n=num(row[c]);if(n==null)continue;
          // KPX 1h는 00:00~01:00, 24h는 23:00~24:00 구간으로 매핑합니다.
          const hour=Math.max(0,Math.min(23,h-1));
          out.set(hourKey(p.year,p.month,p.day,hour),{smp:n,source:`Drive ${area==='jeju'?'제주':'육지'} SMP ${requestedYear}`});
        }
      }
      if(out.size){parsed=true;break}
    }
    if(parsed)continue;
  }
  return out;
}

function wantedYears(start='',end=''){const y=new Date().getFullYear();let a=/^20\d{2}/.test(start)?+start.slice(0,4):y-3,b=/^20\d{2}/.test(end)?+end.slice(0,4):y;if(a>b)[a,b]=[b,a];const arr=[];for(let i=Math.max(2020,a);i<=Math.min(y+1,b);i++)arr.push(i);return arr}
function isJejuFile(name=''){return /jeju|제주/i.test(name)}
function newestByYear(files){const map=new Map();for(const f of files){const m=(f.name||'').match(/(20\d{2})/);if(!m)continue;const year=+m[1],prev=map.get(year);if(!prev||String(f.modifiedTime||'')>String(prev.modifiedTime||''))map.set(year,f)}return map}
function dailyFromHourly(hourly,years){
  const daily=new Map();
  for(const year of years){
    const sums=new Map(),counts=new Map();
    for(const [k,v] of hourly){
      if(!k.startsWith(`${year}-`))continue;
      const day=k.slice(0,10),n=Number(v?.smp);if(!Number.isFinite(n))continue;
      sums.set(day,(sums.get(day)||0)+n);counts.set(day,(counts.get(day)||0)+1);
    }
    for(const [day,sum] of sums){const count=counts.get(day)||0;if(count)daily.set(day,{smp:sum/count,source:`${day} 일평균 SMP`,samples:count})}
  }
  return daily;
}
function monthlyFromHourly(hourly,years,{allowFallback=false}={}){
  const monthly=new Map();for(const year of years){for(let month=1;month<=12;month++){const prefix=`${year}-${String(month).padStart(2,'0')}-`,vals=[];for(const [k,v] of hourly){if(k.startsWith(prefix)&&Number.isFinite(Number(v?.smp)))vals.push(Number(v.smp))}const mk=monthKey(year,month);if(vals.length)monthly.set(mk,{smp:vals.reduce((a,b)=>a+b,0)/vals.length,source:`${year}-${String(month).padStart(2,'0')} 월평균 SMP`,samples:vals.length});else if(allowFallback&&FALLBACK.has(mk))monthly.set(mk,{smp:FALLBACK.get(mk),source:'월평균 fallback',samples:0})}}return monthly}

function localJejuSample(year){try{const p=path.join(process.cwd(),'data',`smpJeju_${year}.xlsx`);if(fs.existsSync(p))return fs.readFileSync(p)}catch{}return null}

async function parseDriveSmpCached(file,year,area){
  if(!file)return null;
  const key=`${file.id}|${file.modifiedTime||''}|${year}|${area}`;
  if(parsedDriveCache.has(key))return parsedDriveCache.get(key);
  const promise=(async()=>{
    const rows=parseKpxSmpWorkbook(await downloadFile(file.id),year,area);
    if(!rows.size)throw new Error(`${area==='jeju'?'제주':'육지'} SMP 시간별 데이터를 찾지 못했습니다.`);
    return rows;
  })();
  parsedDriveCache.set(key,promise);
  try{
    const rows=await promise;
    // Vercel warm instance 메모리가 과도하게 늘지 않도록 최근 파일만 유지
    if(parsedDriveCache.size>30){for(const k of [...parsedDriveCache.keys()].slice(0,parsedDriveCache.size-24))parsedDriveCache.delete(k)}
    return rows;
  }catch(e){parsedDriveCache.delete(key);throw e}
}

export async function loadSmpData({force=false,start='',end=''}={}){
  const years=wantedYears(start,end),cacheKey=years.join(',');
  if(!force&&memCache&&memCache.key===cacheKey&&Date.now()-memCache.at<CACHE_MS)return memCache.value;
  const hourly=new Map(),jejuHourly=new Map(),errors=[],yearStatus=[],jejuYearStatus=[];
  const files=await listSmpExcelFiles({force});
  const mainlandMap=newestByYear(files.filter(f=>!isJejuFile(f.name||''))),jejuMap=newestByYear(files.filter(f=>isJejuFile(f.name||'')));

  // 연도별 SMP 파일은 서로 독립이므로 병렬로 읽습니다. 과거에는 5~10개 파일을 순차 다운로드해 전체 조회가 느렸습니다.
  const results=await Promise.all(years.map(async year=>{
    const mainland=mainlandMap.get(year)||null,jeju=jejuMap.get(year)||null;
    const mainTask=mainland?parseDriveSmpCached(mainland,year,'mainland').then(rows=>({ok:true,rows,file:mainland})).catch(e=>({ok:false,error:e,file:mainland})):Promise.resolve({ok:false,missing:true,file:null});
    const jejuTask=(async()=>{
      if(jeju){try{return{ok:true,rows:await parseDriveSmpCached(jeju,year,'jeju'),file:jeju,local:false}}catch(e){return{ok:false,error:e,file:jeju,local:false}}}
      const buf=localJejuSample(year);
      if(!buf)return{ok:false,missing:true,file:null,local:false};
      try{const rows=parseKpxSmpWorkbook(buf,year,'jeju');if(!rows.size)throw new Error('제주 SMP 시간별 데이터를 찾지 못했습니다.');return{ok:true,rows,file:null,local:true}}catch(e){return{ok:false,error:e,file:null,local:true}}
    })();
    const [mainRes,jejuRes]=await Promise.all([mainTask,jejuTask]);
    return{year,mainland,jeju,mainRes,jejuRes};
  }));

  for(const r of results){
    const {year,mainland,jeju,mainRes,jejuRes}=r;
    if(mainRes.ok){for(const [k,v] of mainRes.rows)hourly.set(k,v);yearStatus.push({year,area:'육지',source:'Drive SMP Excel',file:mainland.name,rows:mainRes.rows.size,modifiedTime:mainland.modifiedTime||null})}
    else if(mainRes.missing)yearStatus.push({year,area:'육지',source:'Drive SMP 파일 없음',rows:0});
    else{errors.push(`${year} 육지 SMP 읽기 실패: ${mainRes.error?.message||mainRes.error}`);yearStatus.push({year,area:'육지',source:'읽기 실패',file:mainland?.name,rows:0})}

    if(jejuRes.ok){for(const [k,v] of jejuRes.rows)jejuHourly.set(k,v);jejuYearStatus.push({year,area:'제주',source:jejuRes.local?'번들 제주 SMP 샘플':'Drive 제주 SMP Excel',file:jejuRes.local?`smpJeju_${year}.xlsx`:jeju?.name,rows:jejuRes.rows.size,modifiedTime:jeju?.modifiedTime||null})}
    else if(jejuRes.missing)jejuYearStatus.push({year,area:'제주',source:'제주 SMP 파일 없음',rows:0});
    else{errors.push(`${year} 제주 SMP 읽기 실패: ${jejuRes.error?.message||jejuRes.error}`);jejuYearStatus.push({year,area:'제주',source:'읽기 실패',file:jeju?.name||`smpJeju_${year}.xlsx`,rows:0})}
  }
  const daily=dailyFromHourly(hourly,years),jejuDaily=dailyFromHourly(jejuHourly,years),monthly=monthlyFromHourly(hourly,years,{allowFallback:true}),jejuMonthly=monthlyFromHourly(jejuHourly,years,{allowFallback:false});
  const value={hourly,daily,monthly,jejuHourly,jejuDaily,jejuMonthly,meta:{fetchedAt:new Date().toISOString(),hourlyCount:hourly.size,jejuHourlyCount:jejuHourly.size,monthlyOfficialCount:[...monthly.values()].filter(v=>v?.samples>0).length,jejuMonthlyOfficialCount:[...jejuMonthly.values()].filter(v=>v?.samples>0).length,pricingRule:'시간 집계는 시간별 SMP, 일 이상 집계는 해당 일의 1h~24h 일평균 SMP를 발전량에 적용합니다. 선택기간 평균 SMP는 발전량이 0인 날을 제외한 일평균 SMP의 산술평균이며, 제주만 제주 전용 SMP를 사용합니다.',yearStatus,jejuYearStatus,errors,driveFileCount:files.length}};
  memCache={key:cacheKey,at:Date.now(),value};return value;
}

export function getSmp(date,data,area='mainland',mode='month'){
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();
  const mk=monthKey(y,m),dk=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,hk=hourKey(y,m,d,h);
  const prefix=area==='jeju'?'jeju':'';
  if(mode==='hour'){
    const map=area==='jeju'?data.jejuHourly:data.hourly,row=map?.get?.(hk);
    if(row&&typeof row==='object')return{value:Number(row.smp),source:row.source,precision:'hourly_exact'};
    if(row!=null)return{value:Number(row),source:area==='jeju'?'제주 시간별':'육지 시간별',precision:'hourly_exact'};
  }
  if(mode==='day'||mode==='hour'){
    const map=area==='jeju'?data.jejuDaily:data.daily,row=map?.get?.(dk);
    if(row&&typeof row==='object')return{value:Number(row.smp),source:row.source,precision:'daily_average'};
    if(row!=null)return{value:Number(row),source:area==='jeju'?'제주 일평균':'육지 일평균',precision:'daily_average'};
  }
  const map=area==='jeju'?data.jejuMonthly:data.monthly,row=map?.get?.(mk);
  if(row&&typeof row==='object')return{value:Number(row.smp),source:row.source,precision:row.samples>0?'monthly_average':'monthly_fallback'};
  if(row!=null)return{value:Number(row),source:area==='jeju'?'제주 월평균':'육지 월평균',precision:'monthly_fallback'};
  return{value:null,source:null,precision:null};
}
