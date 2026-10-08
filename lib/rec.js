import * as XLSX from 'xlsx';
import { downloadRecMarketCacheFile, upsertRecMarketCacheFile } from './drive';

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
  let months=monthsBetween(start,end);if(months.length>36)months=months.slice(-36);
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
    cache:{rows:persistent.size,hits:cacheHits,apiCalls,newRows,saved,file:drive.file?.name||'REC_현물시장_월별캐시.xlsx',readError:drive.error||'',saveError,budget:apiCallBudget}
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
  return{date:iso,daysRemaining:days,status:days<0?'기한 경과':days===0?'오늘 마감':days<=30?`D-${days}`:'여유'};
}
