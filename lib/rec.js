const REALTIME_API='https://apis.data.go.kr/B552115/RecMarketInfo2/getRecMarketInfo2';

function n(v){const x=Number(String(v??'').replace(/,/g,''));return Number.isFinite(x)?x:null}
function findValue(obj,keys){for(const k of keys){if(obj&&obj[k]!=null){const x=n(obj[k]);if(x!=null)return x}}return null}
function toArray(x){if(Array.isArray(x))return x;if(x==null)return[];return[x]}
function ymdKst(offsetDays=0){const now=new Date(Date.now()+9*3600_000);now.setUTCDate(now.getUTCDate()-offsetDays);return`${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}`}
function normalizeKey(key){try{return /%[0-9A-Fa-f]{2}/.test(key)?decodeURIComponent(key):key}catch{return key}}

async function fetchDate(base,key,bzDd){
  const url=new URL(base||REALTIME_API);url.searchParams.set('serviceKey',normalizeKey(key));url.searchParams.set('pageNo','1');url.searchParams.set('numOfRows','50');url.searchParams.set('dataType','json');url.searchParams.set('bzDd',bzDd);
  const r=await fetch(url,{cache:'no-store'});const txt=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${txt.slice(0,180)}`);
  let j;try{j=JSON.parse(txt)}catch{throw new Error(`JSON 응답이 아닙니다: ${txt.slice(0,160)}`)}
  const resultCode=String(j?.response?.header?.resultCode??j?.header?.resultCode??'00');if(resultCode!=='00'&&resultCode!=='0')throw new Error(j?.response?.header?.resultMsg||j?.header?.resultMsg||`API 오류 ${resultCode}`);
  return toArray(j?.response?.body?.items?.item??j?.body?.items?.item??j?.items?.item??j?.data??j?.items);
}

export async function loadRecMarket({force=false}={}){
  const key=process.env.REC_MARKET_SERVICE_KEY||process.env.DATA_GO_KR_SERVICE_KEY||'';const custom=process.env.REC_MARKET_API_URL||'';
  if(!key)return{ok:false,source:'공공데이터포털 REC 현물시장 API(15099762)',message:'REC_MARKET_SERVICE_KEY가 없습니다. 공공데이터포털 15099762 활용신청 후 일반 인증키를 Vercel 환경변수에 넣어주세요.',fetchedAt:new Date().toISOString()};
  try{
    let items=[],usedDate='';
    for(let d=0;d<15;d++){const bzDd=ymdKst(d);try{items=await fetchDate(custom,key,bzDd)}catch(e){if(d===14)throw e;continue}if(items.length){usedDate=bzDd;break}}
    if(!items.length)throw new Error('최근 15일 이내 REC 현물시장 거래 데이터를 찾지 못했습니다.');
    const sorted=[...items].sort((a,b)=>String(b.bzDd??'').localeCompare(String(a.bzDd??'')));const x=sorted[0];
    const date=String(x.bzDd??usedDate);const avg=findValue(x,['landAvgPrc','landAvgPrice','avgPrc','avgPrice','육지 평균가(원)','육지평균가']);const high=findValue(x,['landHgPrc','landMaxPrc','landHighPrice','maxPrc']);const low=findValue(x,['landLwPrc','landLwLmtPrc','landMinPrc','landLowPrice','minPrc']);const volume=findValue(x,['landtrdRecValue','landTrdRecValue','landTrdVol','landVolume']);const close=findValue(x,['clsPrc','closePrc','closingPrice']);const count=findValue(x,['landTrdCnt']);
    return{ok:true,source:'한국전력거래소 REC 현물시장 OpenAPI(15099762)',date,avg,high,low,volume,close,count,fetchedAt:new Date().toISOString()};
  }catch(e){return{ok:false,source:'공공데이터포털 REC 현물시장 API(15099762)',message:e.message||String(e),fetchedAt:new Date().toISOString()}}
}

export function recDeadlineForMonth(ym){
  const m=String(ym||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;
  const y=+m[1],mo=+m[2];const monthEnd=new Date(Date.UTC(y,mo,0));const deadline=new Date(monthEnd);deadline.setUTCDate(deadline.getUTCDate()+90);
  const iso=deadline.toISOString().slice(0,10);const now=new Date(Date.now()+9*3600_000);const td=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const days=Math.ceil((deadline-td)/86400000);
  return{date:iso,daysRemaining:days,status:days<0?'기한 경과':days===0?'오늘 마감':days<=30?`D-${days}`:'여유'};
}
