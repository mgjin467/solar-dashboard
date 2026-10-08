import * as XLSX from 'xlsx';
import { downloadRecMarketCacheFile, upsertRecMarketCacheFile, downloadRecDailyCacheFile, upsertRecDailyCacheFile, downloadRecManualFile, upsertRecManualFile } from './drive';

const REALTIME_API='https://apis.data.go.kr/B552115/RecMarketInfo2/getRecMarketInfo2';
const memoryCache=new Map();

function n(v){const x=Number(String(v??'').replace(/,/g,''));return Number.isFinite(x)?x:null}
function findValue(obj,keys){for(const k of keys){if(obj&&obj[k]!=null){const x=n(obj[k]);if(x!=null)return x}}return null}
function toArray(x){if(Array.isArray(x))return x;if(x==null)return[];return[x]}
function normalizeKey(key){try{return /%[0-9A-Fa-f]{2}/.test(key)?decodeURIComponent(key):key}catch{return key}}
function ymd(d){return`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`}
function todayKstUtc(){const k=new Date(Date.now()+9*3600_000);return new Date(Date.UTC(k.getUTCFullYear(),k.getUTCMonth(),k.getUTCDate()))}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function parseYm(ym){const m=String(ym||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;return{y:+m[1],m:+m[2]}}
function monthEnd(ym){const p=parseYm(ym);return p?new Date(Date.UTC(p.y,p.m,0)):null}
function monthsBetween(start,end){const a=String(start||'').slice(0,7),b=String(end||'').slice(0,7),pa=parseYm(a),pb=parseYm(b);if(!pa||!pb)return[];const out=[];let y=pa.y,m=pa.m;while(y<pb.y||(y===pb.y&&m<=pb.m)){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m===13){m=1;y++}if(out.length>120)break}return out}
function currentYm(){const d=todayKstUtc();return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}

async function fetchDate(base,key,bzDd){
  const url=new URL(base||REALTIME_API);
  url.searchParams.set('serviceKey',normalizeKey(key));
  url.searchParams.set('pageNo','1');
  url.searchParams.set('numOfRows','30');
  url.searchParams.set('dataType','json');
  url.searchParams.set('bzDd',bzDd);
  const r=await fetch(url,{cache:'no-store'});
  const txt=await r.text();
  if(!r.ok)throw new Error(`HTTP ${r.status}: ${txt.slice(0,180)}`);
  let j;try{j=JSON.parse(txt)}catch{throw new Error(`JSON 응답이 아닙니다: ${txt.slice(0,160)}`)}
  const h=j?.response?.header??j?.header??{};
  const resultCode=String(h.resultCode??'00');
  if(resultCode!=='00'&&resultCode!=='0')throw new Error(`${h.resultMsg||`API 오류 ${resultCode}`}${h.returnAuthMsg?` · ${h.returnAuthMsg}`:''}`);
  return toArray(j?.response?.body?.items?.item??j?.body?.items?.item??j?.items?.item??j?.data??j?.items);
}

function normalizeItem(x,fallbackDate=''){
  const date=String(x?.bzDd??x?.baseDate??fallbackDate);
  return{
    date,
    avg:findValue(x,['landAvgPrc','landAvgPrice','avgPrc','avgPrice','landAvg','avg','육지평균가','육지 평균가(원)']),
    high:findValue(x,['landHgPrc','landMaxPrc','landHighPrice','maxPrc','highPrc']),
    low:findValue(x,['landLwPrc','landLwLmtPrc','landMinPrc','landLowPrice','minPrc','lowPrc']),
    close:findValue(x,['clsPrc','closePrc','closingPrice','endPrc']),
    volume:findValue(x,['landtrdRecValue','landTrdRecValue','landTrdVol','landVolume','trdVol']),
    count:findValue(x,['landTrdCnt','trdCnt'])
  }
}

function cacheRowToItem(r){
  const month=String(r.month??r['월']??'').slice(0,7);
  if(!/^20\d{2}-\d{2}$/.test(month))return null;
  return{
    ok:true, month,
    date:String(r.date??r['가격기준일']??''),
    avg:n(r.avg??r['육지평균가']), high:n(r.high??r['육지고가']), low:n(r.low??r['육지저가']),
    close:n(r.close??r['종가']), volume:n(r.volume??r['거래량']), count:n(r.count??r['거래건수']),
    cachedAt:String(r.cachedAt??r['캐시저장시각']??''), source:'drive-cache'
  };
}

async function readDriveCache(){
  try{
    const got=await downloadRecMarketCacheFile();
    if(!got)return{map:new Map(),file:null,error:''};
    const wb=XLSX.read(got.buffer,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
    const map=new Map();for(const r of rows){const x=cacheRowToItem(r);if(x)map.set(x.month,x)}
    return{map,file:got.file,error:''};
  }catch(e){return{map:new Map(),file:null,error:e?.message||String(e)}}
}

function cacheWorkbook(map){
  const rows=[...map.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({
    월:x.month, 가격기준일:x.date, 육지평균가:x.avg, 육지고가:x.high, 육지저가:x.low, 종가:x.close,
    거래량:x.volume, 거래건수:x.count, 캐시저장시각:x.cachedAt||new Date().toISOString()
  }));
  const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:11},{wch:12},{wch:13},{wch:12},{wch:12},{wch:12},{wch:14},{wch:12},{wch:24}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'REC 월별가격');
  return XLSX.write(wb,{bookType:'xlsx',type:'buffer'});
}

async function fetchMonthRepresentative({ym,key,base}){
  const end=monthEnd(ym),today=todayKstUtc();if(!end)return null;
  let cursor=end>today?today:end;
  if(cursor.getUTCFullYear()!==end.getUTCFullYear()||cursor.getUTCMonth()!==end.getUTCMonth())return null;
  let lastError='';const candidates=[];let probe=new Date(cursor),guard=0;
  while(candidates.length<4&&guard<18&&probe.getUTCMonth()===end.getUTCMonth()){
    const dow=probe.getUTCDay();if(dow===2||dow===4)candidates.push(new Date(probe));probe=addDays(probe,-1);guard++;
  }
  let calls=0;
  for(const candidate of candidates){
    const day=ymd(candidate);calls++;
    try{
      const items=await fetchDate(base,key,day);
      if(items.length){const rows=items.map(x=>normalizeItem(x,day));const row=rows.find(x=>x.avg!=null)||rows[0];return{ok:true,month:ym,...row,calls}}
    }catch(e){lastError=e.message||String(e)}
  }
  return{ok:false,month:ym,message:lastError||'해당 월의 최근 REC 현물시장 거래일 데이터를 찾지 못했습니다.',calls};
}

export async function loadRecMarketHistory({start='',end='',force=false}={}){
  const key=process.env.REC_MARKET_SERVICE_KEY||'';const custom=process.env.REC_MARKET_API_URL||'';
  const drive=await readDriveCache();const persistent=drive.map;
  // 같은 Vercel 인스턴스 내 메모리 캐시도 합칩니다.
  for(const [k,v] of memoryCache)if(!persistent.has(k))persistent.set(k,v);
  let months=monthsBetween(start,end);if(months.length>60)months=months.slice(-60);
  const nowYm=currentYm();const series=[];let apiCalls=0,cacheHits=0,newRows=0,saveError='',saved=false;
  const apiCallBudget=88; // 개발계정 일 100건 한도 보호용 여유분
  if(!key && persistent.size===0)return{ok:false,source:'한국전력거래소 REC 현물시장 OpenAPI(15099762)',message:'REC_MARKET_SERVICE_KEY가 없고 Drive REC 캐시도 없습니다.',series:[],fetchedAt:new Date().toISOString(),cache:{rows:0,hits:0,apiCalls:0,file:drive.file?.name||null,error:drive.error}};
  for(const ym of months){
    const cached=persistent.get(ym);
    // 과거월은 한 번 저장되면 영구 재사용. 현재월만 강제 새로고침 시 재조회.
    if(cached && !(force&&ym===nowYm)){series.push({...cached,ok:true,fromCache:true});cacheHits++;continue}
    if(ym>nowYm){series.push({ok:false,month:ym,message:'미래 월'});continue}
    if(!key){if(cached){series.push({...cached,ok:true,fromCache:true});cacheHits++}else series.push({ok:false,month:ym,message:'API 키 없음'});continue}
    if(apiCalls+4>apiCallBudget){series.push({ok:false,month:ym,message:`일일 호출량 보호를 위해 이번 요청은 여기서 중단했습니다. (현재 ${apiCalls}회)`});continue}
    const x=await fetchMonthRepresentative({ym,key,base:custom});apiCalls+=x?.calls||0;
    if(x?.ok){const savedRow={...x,cachedAt:new Date().toISOString(),source:'api'};persistent.set(ym,savedRow);memoryCache.set(ym,savedRow);series.push(savedRow);newRows++}
    else if(cached){series.push({...cached,ok:true,fromCache:true});cacheHits++}
    else series.push(x||{ok:false,month:ym,message:'조회 실패'});
  }
  if(newRows>0){
    try{await upsertRecMarketCacheFile(cacheWorkbook(persistent));saved=true}
    catch(e){saveError=e?.message||String(e)}
  }
  const valid=series.filter(x=>x?.ok&&x.avg!=null);const latest=valid.length?valid[valid.length-1]:null;
  return{
    ok:!!latest,source:'한국전력거래소 REC 현물시장 OpenAPI(15099762)',series,latest,
    message:latest?'':(series.find(x=>x?.message)?.message||'REC 가격 데이터를 찾지 못했습니다.'),fetchedAt:new Date().toISOString(),
    cache:{rows:persistent.size,hits:cacheHits,apiCalls,newRows,saved,file:drive.file?.name||'REC_현물시장_월별캐시.xlsx',fileModifiedTime:drive.file?.modifiedTime||null,updatedAt:saved?new Date().toISOString():(drive.file?.modifiedTime||null),readError:drive.error||'',saveError,budget:apiCallBudget}
  };
}

export async function loadRecMarket({force=false}={}){
  const now=todayKstUtc(),start=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-01`,end=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
  const h=await loadRecMarketHistory({start,end,force});
  return h.latest?{ok:true,source:h.source,...h.latest,fetchedAt:h.fetchedAt,cache:h.cache}:{ok:false,source:h.source,message:h.message,fetchedAt:h.fetchedAt,cache:h.cache};
}

export function recDeadlineForMonth(ym){
  const m=String(ym||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;
  const y=+m[1],mo=+m[2];const mEnd=new Date(Date.UTC(y,mo,0));const deadline=new Date(mEnd);deadline.setUTCDate(deadline.getUTCDate()+90);
  const iso=deadline.toISOString().slice(0,10);const now=todayKstUtc();const days=Math.ceil((deadline-now)/86400000);
  const status=days<0?'만료':days===0?'D-DAY · 오늘 마감':days<=30?`D-${days} · 마감 임박`:`D-${days} · 여유`;
  const statusCode=days<0?'expired':days===0?'today':days<=30?'soon':'safe';
  return{date:iso,daysRemaining:days,status,statusCode};
}


function dailyRowToItem(r){
  const requestedDate=String(r.requestedDate??r['요청일자']??'').slice(0,10);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(requestedDate))return null;
  return{requestedDate,actualDate:String(r.actualDate??r['가격기준거래일']??''),avg:n(r.avg??r['육지평균가']),high:n(r.high??r['육지고가']),low:n(r.low??r['육지저가']),close:n(r.close??r['종가']),cachedAt:String(r.cachedAt??r['캐시저장시각']??'')};
}
async function readDailyCache(){
  try{const got=await downloadRecDailyCacheFile();if(!got)return{map:new Map(),file:null,error:''};const wb=XLSX.read(got.buffer,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});const map=new Map();for(const r of rows){const x=dailyRowToItem(r);if(x)map.set(x.requestedDate,x)}return{map,file:got.file,error:''}}catch(e){return{map:new Map(),file:null,error:e?.message||String(e)}}
}
function dailyWorkbook(map){const rows=[...map.values()].sort((a,b)=>a.requestedDate.localeCompare(b.requestedDate)).map(x=>({요청일자:x.requestedDate,가격기준거래일:x.actualDate,육지평균가:x.avg,육지고가:x.high,육지저가:x.low,종가:x.close,캐시저장시각:x.cachedAt||new Date().toISOString()}));const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:12},{wch:14},{wch:13},{wch:12},{wch:12},{wch:12},{wch:24}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'REC 일별가격');return XLSX.write(wb,{bookType:'xlsx',type:'buffer'})}
function isoToUtc(date){const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null}
export async function loadRecPriceForDate({date}={}){
  const target=isoToUtc(date);if(!target)return{ok:false,message:'조회일자 형식이 올바르지 않습니다.'};
  const drive=await readDailyCache();const cached=drive.map.get(date);if(cached&&cached.avg!=null)return{ok:true,fromCache:true,...cached,cacheFile:drive.file?.name||null};
  const key=process.env.REC_MARKET_SERVICE_KEY||'';if(!key)return{ok:false,message:'REC_MARKET_SERVICE_KEY가 없습니다.',cacheError:drive.error||''};
  const base=process.env.REC_MARKET_API_URL||'';let lastError='';let calls=0;
  const candidates=[target];for(let i=1;i<=18&&candidates.length<6;i++){const d=addDays(target,-i),dow=d.getUTCDay();if(dow===2||dow===4)candidates.push(d)}
  const seen=new Set();for(const d of candidates){const day=ymd(d);if(seen.has(day))continue;seen.add(day);calls++;try{const items=await fetchDate(base,key,day);if(items.length){const rows=items.map(x=>normalizeItem(x,day));const row=rows.find(x=>x.avg!=null)||rows[0];const saved={requestedDate:date,actualDate:String(row.date||day),avg:row.avg,high:row.high,low:row.low,close:row.close,cachedAt:new Date().toISOString()};drive.map.set(date,saved);let saveError='';try{await upsertRecDailyCacheFile(dailyWorkbook(drive.map))}catch(e){saveError=e?.message||String(e)}return{ok:true,fromCache:false,...saved,calls,cacheFile:'REC_현물시장_일별캐시.xlsx',saveError}}}catch(e){lastError=e?.message||String(e)}}
  return{ok:false,message:lastError||'선택일 인근의 REC 거래가격을 찾지 못했습니다.',calls};
}

function manualRowToItem(r){const month=String(r.month??r['발전월']??'').slice(0,7);if(!/^20\d{2}-\d{2}$/.test(month))return null;return{month,monetizedQty:n(r.monetizedQty??r['수익화REC'])??0,monetizedAmount:n(r.monetizedAmount??r['수익화금액'])??0,updatedAt:String(r.updatedAt??r['수정시각']??'')}}
export async function loadRecManualLedger(){
  try{const got=await downloadRecManualFile();if(!got)return{map:new Map(),file:null,error:''};const wb=XLSX.read(got.buffer,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});const map=new Map();for(const r of rows){const x=manualRowToItem(r);if(x)map.set(x.month,x)}return{map,file:got.file,error:''}}catch(e){return{map:new Map(),file:null,error:e?.message||String(e)}}
}
function manualWorkbook(map){const rows=[...map.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({발전월:x.month,수익화REC:x.monetizedQty,수익화금액:x.monetizedAmount,수정시각:x.updatedAt||new Date().toISOString()}));const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:11},{wch:14},{wch:16},{wch:24}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'REC 수익화');return XLSX.write(wb,{bookType:'xlsx',type:'buffer'})}
export async function saveRecManualEntry({month,monetizedQty=0,monetizedAmount=0}={}){
  if(!/^20\d{2}-\d{2}$/.test(String(month||'')))throw new Error('발전월 형식이 올바르지 않습니다.');
  const qty=Math.max(0,Number(monetizedQty)||0),amount=Math.max(0,Number(monetizedAmount)||0);const ledger=await loadRecManualLedger();ledger.map.set(month,{month,monetizedQty:+qty.toFixed(3),monetizedAmount:Math.round(amount),updatedAt:new Date().toISOString()});await upsertRecManualFile(manualWorkbook(ledger.map));return ledger.map.get(month);
}
