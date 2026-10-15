import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';

// 공급사 발전보고서는 시기별로 실제 파일 포맷이 달랐습니다.
// - HTML을 .xls 확장자로 저장한 구형 파일
// - 실제 BIFF .xls
// - OOXML .xlsx/.xlsm인데 파일명만 .xls인 파일
// - Google Sheets로 변환된 파일 / CSV·TSV 계열
// 확장자를 신뢰하지 않고 파일 바이트와 셀 내용을 기준으로 판별합니다.

const FALLBACK_HOURS = Array.from({length:17}, (_,i) => i + 5); // 05~21시
const NUM_TOKEN = '[-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const DATE_TOKEN = '(?:19|20)\\d{2}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}';

function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/,/g,'').replace(/[^0-9+\-.]/g,'').trim();
  if (!s || s === '-' || s === '.' || s === '+') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateString(v) {
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth()+1).padStart(2,'0')}-${String(v.getUTCDate()).padStart(2,'0')}`;
  }
  let s = String(v ?? '').trim();
  if (!s) return null;
  s = s.replace(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,'$1-$2-$3');
  const m = s.match(/((?:19|20)\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (!m) return null;
  const y=+m[1],mo=+m[2],d=+m[3];
  if (mo<1||mo>12||d<1||d>31) return null;
  const dt = new Date(Date.UTC(y,mo-1,d));
  if (dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function utcDate(dateString, hour = 0) {
  const [y,m,d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,hour,0,0));
}

function decodeTextBuffer(buffer) {
  if (!buffer?.length) return '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  // NUL 바이트가 과도하면 UTF-16LE 텍스트일 가능성이 높습니다.
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nul=0; for (const b of sample) if (b===0) nul++;
  if (sample.length && nul/sample.length > 0.15) return buffer.toString('utf16le');
  return buffer.toString('utf8');
}

function htmlRows(text) {
  const $ = cheerio.load(text);
  const rows = [];
  $('tr').each((_, tr) => {
    const vals = [];
    $(tr).children('th,td').each((__, cell) => vals.push($(cell).text().replace(/\s+/g,' ').trim()));
    if (vals.length) rows.push(vals);
  });
  return rows;
}

function workbookRows(buffer) {
  const wb = XLSX.read(buffer, {type:'buffer', cellDates:true, raw:false, WTF:false, dateNF:'yyyy-mm-dd'});
  const rows=[];
  for (const name of wb.SheetNames || []) {
    const ws=wb.Sheets[name];
    if (!ws) continue;
    const part=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:'',blankrows:false,dateNF:'yyyy-mm-dd'});
    for (const r of part) if (Array.isArray(r) && r.some(v=>String(v??'').trim()!=='')) rows.push(r);
  }
  return rows;
}

function textRows(text) {
  const normalized=String(text||'').replace(/\r\n?/g,'\n');
  const lines=normalized.split('\n').filter(x=>x.trim());
  const rows=[];
  for(const line of lines){
    // 탭 우선, 그 다음 CSV. 따옴표가 있는 CSV는 SheetJS fallback에서 대부분 처리되므로 여기서는 단순 안전망입니다.
    const sep=line.includes('\t')?'\t':(line.includes(',')?',':null);
    rows.push(sep?line.split(sep).map(x=>x.trim()):[line.trim()]);
  }
  return rows;
}

function rowsFromAnyFormat(buffer) {
  const text=decodeTextBuffer(buffer);
  const head=text.slice(0,8192);
  if (/<html[\s>]|<table[\s>]|<tr[\s>]/i.test(head)) {
    return {rows:htmlRows(text),format:'html-xls'};
  }
  try {
    const rows=workbookRows(buffer);
    if (rows.length) return {rows,format:'excel-workbook'};
  } catch {}
  try {
    // CSV/TSV/텍스트를 SheetJS로 한 번 더 해석합니다.
    const wb=XLSX.read(text,{type:'string',raw:false,cellDates:true,dateNF:'yyyy-mm-dd'});
    const rows=[];
    for(const name of wb.SheetNames||[]){
      const part=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:'',blankrows:false,dateNF:'yyyy-mm-dd'});
      rows.push(...part);
    }
    if(rows.length)return{rows,format:'text-spreadsheet'};
  }catch{}
  const rows=textRows(text);
  if(rows.length)return{rows,format:'plain-text'};
  throw new Error('발전보고서에서 읽을 수 있는 표 데이터를 찾지 못했습니다.');
}

function rowsToSearchText(rows) {
  return (rows||[]).map(r=>(r||[]).map(v=>{
    if(v instanceof Date)return normalizeDateString(v)||'';
    return String(v??'').replace(/\s+/g,' ').trim();
  }).join(' ')).join('\n')
    .replace(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,'$1-$2-$3');
}

function pushHourly(out,{date,hour,inv1,inv2,total,name,modifiedTime,modifiedMs,format,nowMs}){
  date=normalizeDateString(date);hour=Number(hour);inv1=parseNumber(inv1);inv2=parseNumber(inv2);total=parseNumber(total);
  if(!date||!Number.isInteger(hour)||hour<0||hour>23||total===null)return;
  const dt=utcDate(date,hour); if(dt.getTime()>nowMs&&total===0)return;
  out.push({ts:dt.toISOString(),inv1Kwh:inv1??0,inv2Kwh:inv2??0,totalKwh:total,kwh:total,sourceFile:name,sourceModifiedTime:modifiedTime,sourceModifiedMs:modifiedMs,sourceFormat:format,precision:'hourly_exact'});
}

function pushDaily(out,{date,inv1,inv2,total,name,modifiedTime,modifiedMs,format,nowMs}){
  date=normalizeDateString(date);inv1=parseNumber(inv1);inv2=parseNumber(inv2);total=parseNumber(total);
  if(!date||total===null)return;
  const day=utcDate(date,0); if(day.getTime()>nowMs&&total===0)return;
  const inv1Each=(inv1??0)/FALLBACK_HOURS.length,inv2Each=(inv2??0)/FALLBACK_HOURS.length,totalEach=total/FALLBACK_HOURS.length;
  for(const hour of FALLBACK_HOURS)out.push({ts:utcDate(date,hour).toISOString(),inv1Kwh:inv1Each,inv2Kwh:inv2Each,totalKwh:totalEach,kwh:totalEach,sourceFile:name,sourceModifiedTime:modifiedTime,sourceModifiedMs:modifiedMs,sourceFormat:format,precision:'daily_fallback'});
}

function parseByRows(rows,isMonth,ctx){
  const out=[];
  for(const row of rows||[]){
    const vals=(row||[]).map(v=>v instanceof Date?(normalizeDateString(v)||''):String(v??'').trim());
    if(!vals.length)continue;
    // 날짜가 몇 번째 열인지 고정하지 않습니다. 앞에 번호/설명 열이 추가되어도 대응합니다.
    let dateIdx=-1,date=null,hour=null,next=0;
    for(let i=0;i<vals.length;i++){
      const d=normalizeDateString(vals[i]);
      if(d){dateIdx=i;date=d;break}
    }
    if(dateIdx<0)continue;
    const combined=String(vals[dateIdx]||'').match(/(?:19|20)\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}\s+(\d{1,2})(?::\d{2})?/);
    if(isMonth){
      if(combined){hour=+combined[1];next=dateIdx+1}
      else{
        const h=String(vals[dateIdx+1]??'').match(/^(\d{1,2})(?::\d{2})?$/);
        if(!h)continue; hour=+h[1]; next=dateIdx+2;
      }
    }else next=dateIdx+1;
    const nums=[];
    for(let i=next;i<vals.length&&nums.length<3;i++){const n=parseNumber(vals[i]);if(n!==null)nums.push(n)}
    if(nums.length<3)continue;
    if(isMonth)pushHourly(out,{date,hour,inv1:nums[0],inv2:nums[1],total:nums[2],...ctx});
    else pushDaily(out,{date,inv1:nums[0],inv2:nums[1],total:nums[2],...ctx});
  }
  return out;
}

function parseByFlatText(rows,isMonth,ctx){
  const text=rowsToSearchText(rows);
  const out=[];
  if(isMonth){
    const re=new RegExp(`(${DATE_TOKEN})\\s+(\\d{1,2})(?::\\d{2})?\\s+(${NUM_TOKEN})\\s+(${NUM_TOKEN})\\s+(${NUM_TOKEN})(?:\\s+${NUM_TOKEN})?`,'g');
    for(const m of text.matchAll(re))pushHourly(out,{date:m[1],hour:m[2],inv1:m[3],inv2:m[4],total:m[5],...ctx});
  }else{
    const re=new RegExp(`(${DATE_TOKEN})\\s+(${NUM_TOKEN})\\s+(${NUM_TOKEN})\\s+(${NUM_TOKEN})(?:\\s+${NUM_TOKEN})?`,'g');
    for(const m of text.matchAll(re))pushDaily(out,{date:m[1],inv1:m[2],inv2:m[3],total:m[4],...ctx});
  }
  return out;
}

function dedupeParsed(rows){
  const map=new Map();
  for(const r of rows||[]){
    const prev=map.get(r.ts);
    // 행 기반 파싱을 먼저 넣으므로 동일시각 중 뒤에서 나온 값은 실제 값이 더 큰 쪽을 우선합니다.
    if(!prev||Math.abs(Number(r.totalKwh||0))>Math.abs(Number(prev.totalKwh||0)))map.set(r.ts,r);
  }
  return [...map.values()].sort((a,b)=>a.ts.localeCompare(b.ts));
}

export function parseGenerationFile({name='', modifiedTime, buffer}) {
  const {rows,format}=rowsFromAnyFormat(buffer);
  const modifiedMs=Date.parse(modifiedTime||'')||0,nowMs=Date.now();
  let isMonth=/발전\s*보고서\s*-\s*월/.test(name||'');
  let isYear=/발전\s*보고서\s*-\s*년/.test(name||'');
  if(!isMonth&&!isYear){
    const t=rowsToSearchText(rows),hourHits=(t.match(new RegExp(`${DATE_TOKEN}\\s+\\d{1,2}(?::\\d{2})?\\s+${NUM_TOKEN}\\s+${NUM_TOKEN}\\s+${NUM_TOKEN}`,'g'))||[]).length;
    isMonth=hourHits>0; isYear=!isMonth;
  }
  const ctx={name,modifiedTime,modifiedMs,format,nowMs};
  let out=parseByRows(rows,isMonth,ctx);
  // Google Sheets에서 비정상적으로 한 행으로 펼쳐진 문서, 병합셀/공백이 많은 문서까지 대응합니다.
  if(out.length<2)out=[...out,...parseByFlatText(rows,isMonth,ctx)];
  out=dedupeParsed(out);
  if(!out.length)throw new Error(`발전보고서 형식은 인식했지만 날짜·발전량 행을 찾지 못했습니다. 감지형식=${format}`);
  return out;
}

export function mergeGenerationRows(rows,{prefer='daily'}={}) {
  // 파일 간 중복은 '시각'이 아니라 '날짜' 단위로 출처를 하나만 선택합니다.
  // 년 보고서는 일별 합계가 확정값이므로 일/월/분기/계절/년 집계의 기준입니다.
  // 월 보고서는 시간별 원본이므로 시간 집계에서만 우선합니다.
  const dayKey=row=>String(row?.ts||'').slice(0,10);
  const dailyDays=new Set(rows.filter(r=>r.precision==='daily_fallback').map(dayKey));
  const hourlyDays=new Set(rows.filter(r=>r.precision==='hourly_exact').map(dayKey));
  const filtered=rows.filter(row=>{
    const day=dayKey(row);
    if(prefer==='hourly'&&hourlyDays.has(day))return row.precision==='hourly_exact';
    if(prefer!=='hourly'&&dailyDays.has(day))return row.precision==='daily_fallback';
    return true;
  });
  const best=new Map();
  for(const row of filtered){
    const prev=best.get(row.ts);
    if(!prev||Number(row.sourceModifiedMs||0)>=Number(prev.sourceModifiedMs||0))best.set(row.ts,row);
  }
  return [...best.values()].sort((a,b)=>a.ts.localeCompare(b.ts));
}
