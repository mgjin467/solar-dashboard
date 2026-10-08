import * as cheerio from 'cheerio';

const MONTHLY_URL='https://recloud.energy.or.kr/rps/present/sub2_1_1.do?engy=1';
const REGION_URL='https://recloud.energy.or.kr/rps/present/sub2_2_1.do?engy=1';
const MAIN_URL='https://recloud.energy.or.kr/rps/main/main01.do';
const BUILDING_URL='https://recloud.energy.or.kr/rps/present/sub2_3_1.do';
const REGION_NAME='충북';
const FALLBACK_REGION_MONTHLY=[9.5,9.0,15.4,16.8,20.5,19.7,13.2,17.4,14.5,11.1,10.5,10.0];
const FALLBACK_NATIONAL_MONTHLY=[10.5,9.8,16.0,16.7,20.7,19.1,13.7,18.0,14.9,11.8,11.0,10.4];
const FALLBACK_BUILDING_MONTHLY=[10.32,9.61,15.78,16.63,20.6,19.33,13.78,17.83,14.72,11.64,10.79,10.37];
let cache={value:null,ts:0};

async function getText(url){
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 (compatible; SolarDashboard/4.0)','Accept':'text/html,application/xhtml+xml','Accept-Language':'ko-KR,ko;q=0.9'}});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
function num(v){const n=Number(String(v??'').replace(/[% ,]/g,''));return Number.isFinite(n)?n:null}
function parsePeriod(text){const q=text.match(/(20\d{2})년도?\s*([1-4])분기/);if(q)return`${q[1]}년 ${q[2]}분기`;const y=text.match(/(20\d{2})년/);return y?`${y[1]}년`:null}
function tableRows($,t){const rows=[];$(t).find('tr').each((_,tr)=>rows.push($(tr).find('th,td').map((__,c)=>$(c).text().replace(/\s+/g,' ').trim()).get()));return rows}
function parseQuarterRegion(html,region=REGION_NAME){
  const $=cheerio.load(html);let rate=null,nationalRate=null;
  $('table').each((_,t)=>{const rows=tableRows($,t);for(let i=0;i<rows.length-1;i++){
    if(!rows[i].some(Boolean))continue;const values=rows[i+1]||[];
    const idx=rows[i].findIndex(v=>v===region);if(idx>=0){const v=num(values[idx]);if(v!=null)rate=v}
    const avgIdx=rows[i].findIndex(v=>v==='평균');if(avgIdx>=0){const v=num(values[avgIdx]);if(v!=null)nationalRate=v}
  }});
  const text=$.text().replace(/\s+/g,' ');return{rate,nationalRate,period:parsePeriod(text)};
}
function parseMonthly(html,region=REGION_NAME){
  const $=cheerio.load(html);let monthly=null,annualAverage=null,nationalMonthly=null,nationalAnnualAverage=null;
  $('table').each((_,t)=>{const rows=tableRows($,t);for(const row of rows){
    if(row?.[0]===region&&row.length>=13){const vals=row.slice(1,13).map(num);if(vals.every(v=>v!=null)){monthly=vals;annualAverage=num(row[13])}}
    if(row?.[0]==='전국'&&row.length>=13){const vals=row.slice(1,13).map(num);if(vals.every(v=>v!=null)){nationalMonthly=vals;nationalAnnualAverage=num(row[13])}}
  }});
  const text=$.text().replace(/\s+/g,' ');const m=text.match(/(20\d{2})년\s*평균\s*이용률/);
  return{monthly,annualAverage,nationalMonthly,nationalAnnualAverage,year:m?Number(m[1]):null};
}
function parseMain(html){
  const txt=cheerio.load(html).text().replace(/\s+/g,' ');
  const m=txt.match(/평균\s*태양광\s*이용률[^0-9]*([0-9.]+)%/);
  const periodMatch=txt.match(/평균\s*태양광\s*이용률[\s\S]{0,80}?\((20\d{2})년도?\s*([1-4])분기\s*기준\)/);
  return{rate:m?num(m[1]):null,period:periodMatch?`${periodMatch[1]}년 ${periodMatch[2]}분기`:parsePeriod(txt)};
}
function parseBuildingMonthly(html){
  const $=cheerio.load(html);const vals=[];$('table tr').each((_,tr)=>{const cells=$(tr).find('th,td').map((__,c)=>$(c).text().replace(/\s+/g,' ').trim()).get();const m=String(cells[0]||'').match(/^(\d{1,2})월$/);if(m){const v=num(cells[1]);if(v!=null)vals[+m[1]-1]=v}});
  const txt=$.text().replace(/\s+/g,' ');const ym=txt.match(/(20\d{2})년\s*태양광\s*입지별/);
  return{monthly:vals.length?Array.from({length:12},(_,i)=>vals[i]??FALLBACK_BUILDING_MONTHLY[i]):FALLBACK_BUILDING_MONTHLY,year:ym?Number(ym[1]):2024};
}
function dayHours(cf){return cf==null?null:+(Number(cf)*24/100).toFixed(2)}

export async function loadRegionBenchmark({force=false}={}){
  const now=Date.now();if(!force&&cache.value&&now-cache.ts<6*3600_000)return cache.value;
  const out={
    region:REGION_NAME,monthly:FALLBACK_REGION_MONTHLY,nationalMonthly:FALLBACK_NATIONAL_MONTHLY,
    annualAverage:14.0,nationalAnnualAverage:14.4,year:2024,
    rate:11.35,period:'2024년 1분기',quarterNationalRate:12.17,
    nationalRate:null,nationalPeriod:null,
    buildingMonthly:FALLBACK_BUILDING_MONTHLY,buildingYear:2024,
    source:'한국에너지공단 재생에너지 클라우드플랫폼(REcloud)',fetchedAt:new Date().toISOString(),errors:[]
  };
  try{const p=parseMonthly(await getText(MONTHLY_URL));if(p.monthly)out.monthly=p.monthly;if(p.nationalMonthly)out.nationalMonthly=p.nationalMonthly;if(p.annualAverage!=null)out.annualAverage=p.annualAverage;if(p.nationalAnnualAverage!=null)out.nationalAnnualAverage=p.nationalAnnualAverage;if(p.year)out.year=p.year}catch(e){out.errors.push(`월별 전국·충북 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseQuarterRegion(await getText(REGION_URL));if(p.rate!=null)out.rate=p.rate;if(p.nationalRate!=null)out.quarterNationalRate=p.nationalRate;if(p.period)out.period=p.period}catch(e){out.errors.push(`지역별 분기 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseMain(await getText(MAIN_URL));if(p.rate!=null)out.nationalRate=p.rate;if(p.period)out.nationalPeriod=p.period}catch(e){out.errors.push(`전국 최신 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseBuildingMonthly(await getText(BUILDING_URL));out.buildingMonthly=p.monthly;out.buildingYear=p.year}catch(e){out.errors.push(`건축물 월별 평균 조회 실패: ${e.message||e}`)}
  out.annualGenerationHoursPerDay=dayHours(out.annualAverage);
  out.nationalAnnualGenerationHoursPerDay=dayHours(out.nationalAnnualAverage);
  out.latestRegionGenerationHoursPerDay=dayHours(out.rate);
  out.latestNationalGenerationHoursPerDay=dayHours(out.nationalRate);
  cache={value:out,ts:now};return out;
}
