import * as cheerio from 'cheerio';

const MONTHLY_URL='https://recloud.energy.or.kr/rps/present/sub2_1_1.do?engy=1';
const REGION_URL='https://recloud.energy.or.kr/rps/present/sub2_2_1.do?engy=1';
const MAIN_URL='https://recloud.energy.or.kr/rps/main/main01.do';
const BUILDING_URL='https://recloud.energy.or.kr/rps/present/sub2_3_1.do';
export const REGION_NAMES=['서울','부산','대구','인천','광주','대전','울산','세종','경기','충북','충남','전남','경북','경남','제주','강원','전북'];
const FALLBACK_MONTHLY={
서울:[9.4,9,14.6,15.8,18.1,18.9,11.2,14.5,13,11.4,9.8,9.9],
부산:[12.1,10.1,16.3,16.2,21,17.4,14.8,18.6,15.4,11.6,11.2,12.4],
대구:[11.9,9.8,15.9,16.4,21.2,19.3,15.1,18.1,14.4,11.6,11.1,11.7],
인천:[10.1,10,16.1,17.2,19,21.1,12.5,16.8,14.2,12.4,10.5,10.6],
광주:[9.3,9.6,15.3,15.8,20.5,17.4,13.5,17.9,14.9,11.9,10.8,9.2],
대전:[9.4,9.4,15.5,16.6,20.5,19.6,12.8,17,15.2,11.1,11.1,9.6],
울산:[11.7,9,15.6,15.9,20.7,17.9,15.3,17.9,13.3,10.4,10.5,12.3],
세종:[8.8,9.1,15.5,16.5,20,19.6,13,17.2,14.6,10.7,10.7,9.7],
경기:[9.6,9.4,15.8,17.3,19.8,20.8,12.7,17,14.3,11.9,10.4,10.2],
충북:[9.5,9,15.4,16.8,20.5,19.7,13.2,17.4,14.5,11.1,10.5,10],
충남:[9.7,9.9,16.4,17.3,20.6,20.5,13.6,17.7,15.3,11.9,11.4,9.6],
전남:[10.9,10.2,15.9,16,20.7,17.1,13.7,18.7,15.7,12.2,11.4,10.5],
경북:[11.7,9.6,16.2,17,21.4,19.8,14.8,18.3,14.3,11.3,10.9,11.8],
경남:[11.9,10.1,15.9,15.4,20.6,17.5,14,18,14.4,11.9,10.9,11.5],
제주:[9.5,8.6,15.2,14.8,20.3,13.9,13.8,17.6,15.2,11.4,11.1,9.4],
강원:[10.1,9,15.4,17.6,20.2,20.2,12.7,16.9,13.1,11.4,10.3,10.8],
전북:[10.3,10.4,16.4,16.9,20.9,18.9,13.9,18.3,15.9,12.2,11.4,9.5]
};
const FALLBACK_AVG={서울:13,부산:14.7,대구:14.7,인천:14.2,광주:13.8,대전:14,울산:14.2,세종:13.8,경기:14.1,충북:14,충남:14.5,전남:14.4,경북:14.7,경남:14.3,제주:13.4,강원:14,전북:14.6};
const FALLBACK_NATIONAL_MONTHLY=[10.5,9.8,16,16.7,20.7,19.1,13.7,18,14.9,11.8,11,10.4];
const FALLBACK_BUILDING_MONTHLY=[10.32,9.61,15.78,16.63,20.6,19.33,13.78,17.83,14.72,11.64,10.79,10.37];
const FALLBACK_Q1={서울:11.06,부산:12.89,대구:12.58,인천:12.12,광주:11.46,대전:11.47,울산:12.17,세종:11.17,경기:11.68,충북:11.35,충남:12.06,전남:12.35,경북:12.54,경남:12.67,제주:11.1,강원:11.55,전북:12.41};
let cache={value:null,ts:0};

async function getText(url){const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 (compatible; SolarDashboard/5.0)','Accept':'text/html,application/xhtml+xml','Accept-Language':'ko-KR,ko;q=0.9'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}
function num(v){const n=Number(String(v??'').replace(/[% ,]/g,''));return Number.isFinite(n)?n:null}
function parsePeriod(text){const q=text.match(/(20\d{2})년도?\s*([1-4])분기/);if(q)return`${q[1]}년 ${q[2]}분기`;const y=text.match(/(20\d{2})년/);return y?`${y[1]}년`:null}
function tableRows($,t){const rows=[];$(t).find('tr').each((_,tr)=>rows.push($(tr).find('th,td').map((__,c)=>$(c).text().replace(/\s+/g,' ').trim()).get()));return rows}
function parseMonthlyAll(html){const $=cheerio.load(html),regions={},national={monthly:null,annualAverage:null};$('table').each((_,t)=>{for(const row of tableRows($,t)){const name=row?.[0];if(REGION_NAMES.includes(name)&&row.length>=13){const vals=row.slice(1,13).map(num);if(vals.every(v=>v!=null))regions[name]={monthly:vals,annualAverage:num(row[13])}}if(name==='전국'&&row.length>=13){const vals=row.slice(1,13).map(num);if(vals.every(v=>v!=null)){national.monthly=vals;national.annualAverage=num(row[13])}}}});const text=$.text().replace(/\s+/g,' '),m=text.match(/(20\d{2})년\s*평균\s*이용률/);return{regions,national,year:m?Number(m[1]):null}}
function parseQuarterAll(html){const $=cheerio.load(html),rates={};let nationalRate=null;$('table').each((_,t)=>{const rows=tableRows($,t);for(let i=0;i<rows.length-1;i++){const hdr=rows[i]||[],vals=rows[i+1]||[];for(let j=0;j<hdr.length;j++){const name=hdr[j],v=num(vals[j]);if(REGION_NAMES.includes(name)&&v!=null)rates[name]=v;if(name==='평균'&&v!=null)nationalRate=v}}});return{rates,nationalRate,period:parsePeriod($.text().replace(/\s+/g,' '))}}
function parseMain(html){const txt=cheerio.load(html).text().replace(/\s+/g,' ');const m=txt.match(/평균\s*태양광\s*이용률[^0-9]*([0-9.]+)%/);const periodMatch=txt.match(/평균\s*태양광\s*이용률[\s\S]{0,80}?\((20\d{2})년도?\s*([1-4])분기\s*기준\)/);return{rate:m?num(m[1]):null,period:periodMatch?`${periodMatch[1]}년 ${periodMatch[2]}분기`:parsePeriod(txt)}}
function parseBuildingMonthly(html){const $=cheerio.load(html);const vals=[];$('table tr').each((_,tr)=>{const cells=$(tr).find('th,td').map((__,c)=>$(c).text().replace(/\s+/g,' ').trim()).get();const m=String(cells[0]||'').match(/^(\d{1,2})월$/);if(m){const v=num(cells[1]);if(v!=null)vals[+m[1]-1]=v}});const txt=$.text().replace(/\s+/g,' ');const ym=txt.match(/(20\d{2})년\s*태양광\s*입지별/);return{monthly:vals.length?Array.from({length:12},(_,i)=>vals[i]??FALLBACK_BUILDING_MONTHLY[i]):FALLBACK_BUILDING_MONTHLY,year:ym?Number(ym[1]):2024}}
function dayHours(cf){return cf==null?null:+(Number(cf)*24/100).toFixed(2)}

export async function loadRegionBenchmark({force=false}={}){
  const now=Date.now();if(!force&&cache.value&&now-cache.ts<6*3600_000)return cache.value;
  const regions=Object.fromEntries(REGION_NAMES.map(name=>[name,{monthly:FALLBACK_MONTHLY[name],annualAverage:FALLBACK_AVG[name],quarterRate:FALLBACK_Q1[name]}]));
  const out={region:'충북',regions,regionNames:[...REGION_NAMES],monthly:FALLBACK_MONTHLY.충북,nationalMonthly:FALLBACK_NATIONAL_MONTHLY,annualAverage:FALLBACK_AVG.충북,nationalAnnualAverage:14.4,year:2024,rate:FALLBACK_Q1.충북,period:'2024년 1분기',quarterNationalRate:12.17,nationalRate:null,nationalPeriod:null,buildingMonthly:FALLBACK_BUILDING_MONTHLY,buildingYear:2024,source:'한국에너지공단 재생에너지 클라우드플랫폼(REcloud)',fetchedAt:new Date().toISOString(),errors:[]};
  try{const p=parseMonthlyAll(await getText(MONTHLY_URL));for(const [name,r] of Object.entries(p.regions||{})){out.regions[name]={...(out.regions[name]||{}),...r}}if(p.national.monthly)out.nationalMonthly=p.national.monthly;if(p.national.annualAverage!=null)out.nationalAnnualAverage=p.national.annualAverage;if(p.year)out.year=p.year}catch(e){out.errors.push(`월별 전국·지역 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseQuarterAll(await getText(REGION_URL));for(const [name,v] of Object.entries(p.rates||{})){out.regions[name]={...(out.regions[name]||{}),quarterRate:v}}if(p.nationalRate!=null)out.quarterNationalRate=p.nationalRate;if(p.period)out.period=p.period}catch(e){out.errors.push(`지역별 분기 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseMain(await getText(MAIN_URL));if(p.rate!=null)out.nationalRate=p.rate;if(p.period)out.nationalPeriod=p.period}catch(e){out.errors.push(`전국 최신 평균 조회 실패: ${e.message||e}`)}
  try{const p=parseBuildingMonthly(await getText(BUILDING_URL));out.buildingMonthly=p.monthly;out.buildingYear=p.year}catch(e){out.errors.push(`건축물 월별 평균 조회 실패: ${e.message||e}`)}
  out.regionNames=REGION_NAMES.filter(n=>Array.isArray(out.regions[n]?.monthly));
  for(const n of out.regionNames){const r=out.regions[n];r.annualGenerationHoursPerDay=dayHours(r.annualAverage);r.latestGenerationHoursPerDay=dayHours(r.quarterRate)}
  out.monthly=out.regions.충북?.monthly||FALLBACK_MONTHLY.충북;out.annualAverage=out.regions.충북?.annualAverage??14;out.rate=out.regions.충북?.quarterRate??11.35;
  out.annualGenerationHoursPerDay=dayHours(out.annualAverage);out.nationalAnnualGenerationHoursPerDay=dayHours(out.nationalAnnualAverage);out.latestRegionGenerationHoursPerDay=dayHours(out.rate);out.latestNationalGenerationHoursPerDay=dayHours(out.nationalRate);
  cache={value:out,ts:now};return out;
}
