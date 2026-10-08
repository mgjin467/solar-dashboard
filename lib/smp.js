import fallbackRows from '@/data/smp-monthly.json';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { listSmpExcelFiles, downloadFile } from './drive';

const FALLBACK = new Map(fallbackRows.map(r => [`${r.year}-${String(r.month).padStart(2,'0')}`, Number(r.smp)]));
const CACHE_MS = Number(process.env.SMP_DRIVE_CACHE_MINUTES || 10) * 60 * 1000;
let memCache = null;

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
  for(const sn of wb.SheetNames){const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});if(!matrix.length)continue;
    for(let headerRow=0;headerRow<Math.min(12,matrix.length);headerRow++){
      const hrow=matrix[headerRow]||[],hourStarts=[];hrow.forEach((v,c)=>{const h=parseHourLabel(v);if(h)hourStarts.push({c,h})});
      if(hourStarts.length>=20){for(let r=headerRow+1;r<matrix.length;r++){const p=dateParts(matrix[r]?.[0],requestedYear);if(!p||p.year!==requestedYear)continue;for(const {c,h} of hourStarts){const vals=[0,1,2,3].map(k=>num(matrix[r]?.[c+k])).filter(x=>x!=null);if(!vals.length)continue;const avg=vals.reduce((a,b)=>a+b,0)/vals.length;out.set(hourKey(p.year,p.month,p.day,h===24?23:h),{smp:avg,source:`Drive ${area==='jeju'?'제주':'육지'} SMP ${requestedYear}`})}}if(out.size)break}
    }
    if(out.size)continue;
    for(let hr=0;hr<Math.min(30,matrix.length);hr++){
      const cols=[];(matrix[hr]||[]).forEach((v,c)=>{const h=parseHourLabel(v);if(h)cols.push({c,h})});if(cols.length<8)continue;
      for(let r=hr+1;r<matrix.length;r++){const p=dateParts(matrix[r]?.[0],requestedYear)||dateParts(matrix[r]?.[1],requestedYear);if(!p||p.year!==requestedYear)continue;for(const {c,h} of cols){const n=num(matrix[r]?.[c]);if(n!=null)out.set(hourKey(p.year,p.month,p.day,h===24?23:h),{smp:n,source:`Drive ${area==='jeju'?'제주':'육지'} SMP ${requestedYear}`})}}
    }
  }
  return out;
}

function wantedYears(start='',end=''){const y=new Date().getFullYear();let a=/^20\d{2}/.test(start)?+start.slice(0,4):y-3,b=/^20\d{2}/.test(end)?+end.slice(0,4):y;if(a>b)[a,b]=[b,a];const arr=[];for(let i=Math.max(2020,a);i<=Math.min(y+1,b);i++)arr.push(i);return arr}
function isJejuFile(name=''){return /jeju|제주/i.test(name)}
function newestByYear(files){const map=new Map();for(const f of files){const m=(f.name||'').match(/(20\d{2})/);if(!m)continue;const year=+m[1],prev=map.get(year);if(!prev||String(f.modifiedTime||'')>String(prev.modifiedTime||''))map.set(year,f)}return map}
function monthlyFromHourly(hourly,years,{allowFallback=false}={}){const monthly=new Map();for(const year of years){for(let month=1;month<=12;month++){const prefix=`${year}-${String(month).padStart(2,'0')}-`,vals=[];for(const [k,v] of hourly){if(k.startsWith(prefix)&&Number.isFinite(Number(v?.smp)))vals.push(Number(v.smp))}const mk=monthKey(year,month);if(vals.length)monthly.set(mk,{smp:vals.reduce((a,b)=>a+b,0)/vals.length,source:`${year}-${String(month).padStart(2,'0')} 월평균 SMP`,samples:vals.length});else if(allowFallback&&FALLBACK.has(mk))monthly.set(mk,{smp:FALLBACK.get(mk),source:'월평균 fallback',samples:0})}}return monthly}
function localJejuSample(year){try{const p=path.join(process.cwd(),'data',`smpJeju_${year}.xlsx`);if(fs.existsSync(p))return fs.readFileSync(p)}catch{}return null}

export async function loadSmpData({force=false,start='',end=''}={}){
  const years=wantedYears(start,end),cacheKey=years.join(',');if(!force&&memCache&&memCache.key===cacheKey&&Date.now()-memCache.at<CACHE_MS)return memCache.value;
  const hourly=new Map(),jejuHourly=new Map(),errors=[],yearStatus=[],jejuYearStatus=[];const files=await listSmpExcelFiles();
  const mainlandMap=newestByYear(files.filter(f=>!isJejuFile(f.name||''))),jejuMap=newestByYear(files.filter(f=>isJejuFile(f.name||'')));
  for(const year of years){
    const mainland=mainlandMap.get(year);if(mainland){try{const rows=parseKpxSmpWorkbook(await downloadFile(mainland.id),year,'mainland');if(!rows.size)throw new Error('SMP 시간별 데이터를 찾지 못했습니다.');for(const [k,v] of rows)hourly.set(k,v);yearStatus.push({year,area:'육지',source:'Drive SMP Excel',file:mainland.name,rows:rows.size,modifiedTime:mainland.modifiedTime||null})}catch(e){errors.push(`${year} 육지 SMP 읽기 실패: ${e?.message||e}`);yearStatus.push({year,area:'육지',source:'읽기 실패',file:mainland.name,rows:0})}}else yearStatus.push({year,area:'육지',source:'Drive SMP 파일 없음',rows:0});
    let jeju=jejuMap.get(year),buf=null,local=false;if(jeju){try{buf=await downloadFile(jeju.id)}catch(e){errors.push(`${year} 제주 SMP Drive 읽기 실패: ${e?.message||e}`)}}if(!buf){buf=localJejuSample(year);local=!!buf}
    if(buf){try{const rows=parseKpxSmpWorkbook(buf,year,'jeju');if(!rows.size)throw new Error('제주 SMP 시간별 데이터를 찾지 못했습니다.');for(const [k,v] of rows)jejuHourly.set(k,v);jejuYearStatus.push({year,area:'제주',source:local?'번들 제주 SMP 샘플':'Drive 제주 SMP Excel',file:local?`smpJeju_${year}.xlsx`:jeju?.name,rows:rows.size,modifiedTime:jeju?.modifiedTime||null})}catch(e){errors.push(`${year} 제주 SMP 읽기 실패: ${e?.message||e}`);jejuYearStatus.push({year,area:'제주',source:'읽기 실패',file:jeju?.name||`smpJeju_${year}.xlsx`,rows:0})}}else jejuYearStatus.push({year,area:'제주',source:'제주 SMP 파일 없음',rows:0});
  }
  const monthly=monthlyFromHourly(hourly,years,{allowFallback:true}),jejuMonthly=monthlyFromHourly(jejuHourly,years,{allowFallback:false});
  const value={hourly,monthly,jejuHourly,jejuMonthly,meta:{fetchedAt:new Date().toISOString(),hourlyCount:hourly.size,jejuHourlyCount:jejuHourly.size,monthlyOfficialCount:[...monthly.values()].filter(v=>v?.samples>0).length,jejuMonthlyOfficialCount:[...jejuMonthly.values()].filter(v=>v?.samples>0).length,pricingRule:'육지 지역은 육지 월평균 SMP, 제주 지역 평균 수익은 제주 전용 월평균 SMP 적용',yearStatus,jejuYearStatus,errors,driveFileCount:files.length}};
  memCache={key:cacheKey,at:Date.now(),value};return value;
}

export function getSmp(date,data,area='mainland'){
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,mk=monthKey(y,m),map=area==='jeju'?data.jejuMonthly:data.monthly,row=map?.get?.(mk);
  if(row&&typeof row==='object')return{value:Number(row.smp),source:row.source,precision:row.samples>0?'monthly_average':'monthly_fallback'};
  if(row!=null)return{value:Number(row),source:area==='jeju'?'제주 월평균':'육지 월평균',precision:'monthly_fallback'};
  return{value:null,source:null,precision:null};
}
