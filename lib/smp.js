import fallbackRows from '@/data/smp-monthly.json';
import * as XLSX from 'xlsx';
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
  const s=t(v);
  let m=s.match(/^(20\d{2})(\d{2})(\d{2})$/); if(m)return{year:+m[1],month:+m[2],day:+m[3]};
  m=s.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); if(m)return{year:+m[1],month:+m[2],day:+m[3]};
  m=s.match(/^(\d{1,2})[.\/-](\d{1,2})/); if(m)return{year:defaultYear,month:+m[1],day:+m[2]};
  return null;
}
function parseHourLabel(v){const m=t(v).toLowerCase().match(/^(\d{1,2})\s*h/);if(!m)return null;const h=+m[1];return h>=1&&h<=24?h:null}

export function parseKpxSmpWorkbook(buffer, requestedYear){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true,raw:false});
  const out=new Map();
  for(const sn of wb.SheetNames){
    const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:false});
    if(!matrix.length)continue;

    // smpDataRt_YYYY.xlsx 형식: 날짜 1행 + 1h~24h x 4구간.
    // 시간당 4개 구간이 존재하면 평균값을 그 시간의 SMP로 사용합니다.
    for(let headerRow=0;headerRow<Math.min(12,matrix.length);headerRow++){
      const hrow=matrix[headerRow]||[];
      const hourStarts=[];
      hrow.forEach((v,c)=>{const h=parseHourLabel(v);if(h)hourStarts.push({c,h})});
      if(hourStarts.length>=20){
        for(let r=headerRow+1;r<matrix.length;r++){
          const p=dateParts(matrix[r]?.[0],requestedYear); if(!p||p.year!==requestedYear)continue;
          for(const {c,h} of hourStarts){
            const vals=[0,1,2,3].map(k=>num(matrix[r]?.[c+k])).filter(x=>x!=null);
            if(!vals.length)continue;
            const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
            out.set(hourKey(p.year,p.month,p.day,h===24?23:h),{smp:avg,source:`Drive SMP ${requestedYear}`});
          }
        }
        if(out.size)break;
      }
    }
    if(out.size)continue;

    // 일반형: 날짜행 + 1h~24h 열
    for(let hr=0;hr<Math.min(30,matrix.length);hr++){
      const cols=[];(matrix[hr]||[]).forEach((v,c)=>{const h=parseHourLabel(v);if(h)cols.push({c,h})});
      if(cols.length<8)continue;
      for(let r=hr+1;r<matrix.length;r++){
        const p=dateParts(matrix[r]?.[0],requestedYear)||dateParts(matrix[r]?.[1],requestedYear);if(!p||p.year!==requestedYear)continue;
        for(const {c,h} of cols){const n=num(matrix[r]?.[c]);if(n!=null)out.set(hourKey(p.year,p.month,p.day,h===24?23:h),{smp:n,source:`Drive SMP ${requestedYear}`})}
      }
    }
  }
  return out;
}

function wantedYears(start='',end=''){
  const y=new Date().getFullYear();let a=/^20\d{2}/.test(start)?+start.slice(0,4):y-3;let b=/^20\d{2}/.test(end)?+end.slice(0,4):y;if(a>b)[a,b]=[b,a];
  const arr=[];for(let i=Math.max(2020,a);i<=Math.min(y,b);i++)arr.push(i);return arr;
}

async function driveSmpMap(){
  const files=await listSmpExcelFiles();
  const map=new Map();
  for(const f of files){
    const m=(f.name||'').match(/(20\d{2})/);if(!m)continue;const year=+m[1];
    const prev=map.get(year);
    // 같은 연도 파일이 여러 개면 Drive modifiedTime 최신 파일 우선
    if(!prev||String(f.modifiedTime||'')>String(prev.modifiedTime||''))map.set(year,f);
  }
  return {files,map};
}

export async function loadSmpData({force=false,start='',end=''}={}){
  const years=wantedYears(start,end);const cacheKey=years.join(',');
  if(!force&&memCache&&memCache.key===cacheKey&&Date.now()-memCache.at<CACHE_MS)return memCache.value;

  const hourly=new Map();
  const monthly=new Map(FALLBACK);
  const errors=[];
  const yearStatus=[];
  const {files,map:driveMap}=await driveSmpMap();

  for(const year of years){
    const driveFile=driveMap.get(year);
    if(!driveFile){
      yearStatus.push({year,source:'Drive SMP 파일 없음',rows:0});
      continue;
    }
    try{
      const buffer=await downloadFile(driveFile.id);
      const rows=parseKpxSmpWorkbook(buffer,year);
      if(!rows.size)throw new Error('SMP 시간별 데이터를 찾지 못했습니다. 파일 형식을 확인하세요.');
      for(const [k,v] of rows)hourly.set(k,v);
      yearStatus.push({year,source:'Drive SMP Excel',file:driveFile.name,rows:rows.size,modifiedTime:driveFile.modifiedTime||null});
    }catch(e){
      const msg=`${year} Drive SMP 읽기 실패: ${e?.message||e}`;
      errors.push(msg);
      yearStatus.push({year,source:'Drive SMP 읽기 실패',file:driveFile.name,rows:0});
    }
  }

  const value={hourly,monthly,meta:{fetchedAt:new Date().toISOString(),hourlyCount:hourly.size,yearStatus,errors,driveFileCount:files.length}};
  memCache={key:cacheKey,at:Date.now(),value};
  return value;
}

export function getSmp(date,data){
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();const hk=hourKey(y,m,d,h);
  if(data.hourly.has(hk)){const x=data.hourly.get(hk);return{value:x.smp,source:x.source,precision:'hourly'}}
  const mk=monthKey(y,m);
  if(data.monthly.has(mk))return{value:data.monthly.get(mk),source:'월평균 fallback',precision:'monthly'};
  return{value:null,source:null,precision:null}
}
