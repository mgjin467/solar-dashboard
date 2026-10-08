import * as cheerio from 'cheerio';

const MONTHLY_URL='https://recloud.energy.or.kr/rps/present/sub2_1_1.do?engy=1';
const REGION_URL='https://recloud.energy.or.kr/rps/present/sub2_2_1.do?engy=1';
const MAIN_URL='https://recloud.energy.or.kr/rps/main/main01.do';
const BUILDING_URL='https://recloud.energy.or.kr/rps/present/sub2_3_1.do';
const REGION_NAME='충북';
const FALLBACK_REGION_MONTHLY=[9.5,9.0,15.4,16.8,20.5,19.7,13.2,17.4,14.5,11.1,10.5,10.0];
const FALLBACK_BUILDING_MONTHLY=[10.32,9.61,15.78,16.63,20.6,19.33,13.78,17.83,14.72,11.64,10.79,10.37];
let cache={value:null,ts:0};

async function getText(url){
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 SolarDashboard/2.0','Accept-Language':'ko-KR,ko;q=0.9'}});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
function num(v){const n=Number(String(v??'').replace(/[% ,]/g,''));return Number.isFinite(n)?n:null}
function parsePeriod(text){const q=text.match(/(20\d{2})년도\s*([1-4])분기/);if(q)return`${q[1]}년 ${q[2]}분기`;const y=text.match(/(20\d{2})년/);return y?`${y[1]}년`:null}
function parseRegionalQuarter(html,region=REGION_NAME){
  const $=cheerio.load(html);let rate=null;
  $('table').each((_,t)=>{const rows=[];$(t).find('tr').each((__,tr)=>rows.push($(tr).find('th,td').map((___,c)=>$(c).text().replace(/\s+/g,' ').trim()).get()));
    for(let i=0;i<rows.length-1;i++){const idx=rows[i].findIndex(v=>v===region);if(idx>=0){const candidate=num(rows[i+1]?.[idx]);if(candidate!=null){rate=candidate;return false}}}
  });
  return{rate,period:parsePeriod($.text().replace(/\s+/g,' '))};
}
function parseRegionalMonthly(html,region=REGION_NAME){
  const $=cheerio.load(html);let monthly=null,annualAverage=null;
  $('table').each((_,t)=>{const rows=[];$(t).find('tr').each((__,tr)=>rows.push($(tr).find('th,td').map((___,c)=>$(c).text().replace(/\s+/g,' ').trim()).get()));
    const row=rows.find(r=>r[0]===region);
    if(row&&row.length>=13){const vals=row.slice(1,13).map(num);if(vals.every(v=>v!=null)){monthly=vals;annualAverage=num(row[13]);return false}}
  });
  const txt=$.text().replace(/\s+/g,' ');const m=txt.match(/(20\d{2})년\s*평균\s*이용률/);
  return{monthly,annualAverage,year:m?Number(m[1]):null};
}
function parseMain(html){const txt=cheerio.load(html).text().replace(/\s+/g,' ');const m=txt.match(/평균\s*태양광\s*이용률[^0-9]*([0-9.]+)%/);return{rate:m?num(m[1]):null,period:parsePeriod(txt)}}
function parseBuildingMonthly(html){
  const $=cheerio.load(html);const vals=[];
  $('table tr').each((_,tr)=>{const cells=$(tr).find('th,td').map((__,c)=>$(c).text().replace(/\s+/g,' ').trim()).get();const m=String(cells[0]||'').match(/^(\d{1,2})월$/);if(m){const v=num(cells[1]);if(v!=null)vals[+m[1]-1]=v}});
  const txt=$.text().replace(/\s+/g,' ');const ym=txt.match(/(20\d{2})년\s*태양광\s*입지별/);
  return{monthly:vals.length?Array.from({length:12},(_,i)=>vals[i]??FALLBACK_BUILDING_MONTHLY[i]):FALLBACK_BUILDING_MONTHLY,year:ym?Number(ym[1]):2024};
}

export async function loadRegionBenchmark({force=false}={}){
  const now=Date.now();if(!force&&cache.value&&now-cache.ts<6*3600_000)return cache.value;
  const out={region:REGION_NAME,monthly:FALLBACK_REGION_MONTHLY,annualAverage:14.0,year:2024,rate:null,period:null,nationalRate:null,nationalPeriod:null,buildingMonthly:FALLBACK_BUILDING_MONTHLY,buildingYear:2024,source:'한국에너지공단 재생에너지 클라우드플랫폼',fetchedAt:new Date().toISOString(),errors:[]};
  try{const p=parseRegionalMonthly(await getText(MONTHLY_URL));if(p.monthly)out.monthly=p.monthly;if(p.annualAverage!=null)out.annualAverage=p.annualAverage;if(p.year)out.year=p.year}catch(e){out.errors.push(`충북 월별 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseRegionalQuarter(await getText(REGION_URL));out.rate=p.rate;out.period=p.period;if(p.rate==null)out.errors.push('충북 최신 분기 평균 이용률을 찾지 못했습니다.')}catch(e){out.errors.push(`충북 최신 분기 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseMain(await getText(MAIN_URL));out.nationalRate=p.rate;out.nationalPeriod=p.period}catch(e){out.errors.push(`전국 최신 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseBuildingMonthly(await getText(BUILDING_URL));out.buildingMonthly=p.monthly;out.buildingYear=p.year}catch(e){out.errors.push(`건축물 월별 평균 조회 실패: ${e.message||e}`)}
  cache={value:out,ts:now};return out;
}
