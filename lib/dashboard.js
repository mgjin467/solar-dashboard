import { listGenerationExcelFiles, downloadFile } from './drive';
import { parseGenerationFile, mergeGenerationRows } from './generation';
import { loadSmpData, getSmp } from './smp';
import { loadRegionBenchmark } from './region';
import { loadRecMarketHistory, recDeadlineForMonth } from './rec';
import links from '@/data/links.json';

function pad(n){return String(n).padStart(2,'0')}
function keyFor(date,grain){const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${y}-${pad(m)}-${pad(d)} ${pad(h)}:00`;if(grain==='day')return`${y}-${pad(m)}-${pad(d)}`;if(grain==='year')return String(y);return`${y}-${pad(m)}`}
function alignedLabel(date,grain,offset){const y=date.getUTCFullYear()+offset,m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${pad(m)}-${pad(d)} ${pad(h)}시`;if(grain==='day')return`${pad(m)}-${pad(d)}`;if(grain==='year')return String(y);return`${pad(m)}월`}
function inRange(iso,start,end){const day=iso.slice(0,10);return(!start||day>=start)&&(!end||day<=end)}

function monthKeys(start,end){
  const a=String(start||'').slice(0,7).split('-').map(Number),b=String(end||'').slice(0,7).split('-').map(Number);if(a.length<2||b.length<2||!a[0]||!b[0])return[];
  const out=[];let y=a[0],m=a[1];while(y<b[0]||(y===b[0]&&m<=b[1])){out.push(`${y}-${pad(m)}`);m++;if(m===13){m=1;y++}if(out.length>120)break}return out;
}
function shiftYear(isoDate,offset){const [y,m,d]=isoDate.split('-').map(Number);const dt=new Date(Date.UTC(y-offset,m-1,d));if(dt.getUTCMonth()!==m-1)dt.setUTCDate(0);return`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`}

async function loadGeneration(){
  const files=await listGenerationExcelFiles();const parsed=[];const errors=[];
  for(let i=0;i<files.length;i+=5){const result=await Promise.all(files.slice(i,i+5).map(async f=>{try{const buffer=await downloadFile(f.id);return{ok:true,file:f,rows:parseGenerationFile({name:f.name,modifiedTime:f.modifiedTime,buffer})}}catch(e){return{ok:false,file:f,error:e?.message||String(e)}}}));for(const r of result){if(r.ok)parsed.push(...r.rows);else errors.push({file:r.file?.name,error:r.error})}}
  return{files,rows:mergeGenerationRows(parsed),errors};
}
function parseDateOnly(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;return new Date(Date.UTC(+m[1],+m[2]-1,+m[3],0,0,0))}
function bucketStart(dt,grain){const y=dt.getUTCFullYear(),m=dt.getUTCMonth(),d=dt.getUTCDate(),h=dt.getUTCHours();if(grain==='year')return new Date(Date.UTC(y,0,1));if(grain==='month')return new Date(Date.UTC(y,m,1));if(grain==='day')return new Date(Date.UTC(y,m,d));return new Date(Date.UTC(y,m,d,h))}
function nextBucket(dt,grain){const x=new Date(dt);if(grain==='year')x.setUTCFullYear(x.getUTCFullYear()+1);else if(grain==='month')x.setUTCMonth(x.getUTCMonth()+1);else if(grain==='day')x.setUTCDate(x.getUTCDate()+1);else x.setUTCHours(x.getUTCHours()+1);return x}
function periodBuckets(start,end,grain){const a=parseDateOnly(start),b=parseDateOnly(end);if(!a||!b||a>b)return[];let cur=bucketStart(a,grain);const last=bucketStart(grain==='hour'?new Date(b.getTime()+23*3600*1000):b,grain);const out=[];let guard=0;while(cur<=last&&guard<100000){out.push(new Date(cur));cur=nextBucket(cur,grain);guard++}return out}
function overlapHours(bucketDt,grain,start,end){const periodStart=parseDateOnly(start),periodEnd=parseDateOnly(end);if(!periodStart||!periodEnd)return 0;const inclusiveEnd=new Date(periodEnd.getTime()+24*3600*1000);const b0=bucketStart(bucketDt,grain),b1=nextBucket(b0,grain);const s=Math.max(b0.getTime(),periodStart.getTime());const e=Math.min(b1.getTime(),inclusiveEnd.getTime());return Math.max(0,(e-s)/3600000)}
function efficiency(kwh,capacityKw,hours){if(!(capacityKw>0)||!(hours>0))return null;return +(kwh/(capacityKw*hours)*100).toFixed(2)}
function fullLoadHours(kwh,capacityKw){if(!(capacityKw>0))return null;return +(kwh/capacityKw).toFixed(2)}

function aggregate(rows,smpData,benchmark,{grain,start,end,offset=0,cap1=0,cap2=0}){
  const merged=rows.filter(r=>inRange(r.ts,start,end));const groups=new Map();
  let totalGeneration=0,totalGeneration1=0,totalGeneration2=0,totalRevenue=0,totalRevenue1=0,totalRevenue2=0,knownKwh=0,exactRows=0;
  for(const row of merged){
    const dt=new Date(row.ts),key=keyFor(dt,grain),s=getSmp(dt,smpData).value;
    const k1=Number(row.inv1Kwh||0),k2=Number(row.inv2Kwh||0),kt=Number(row.totalKwh??row.kwh??(k1+k2));
    const r1=s==null?0:k1*s,r2=s==null?0:k2*s,rt=s==null?0:kt*s;
    if(!groups.has(key))groups.set(key,{dt:bucketStart(dt,grain),inv1Kwh:0,inv2Kwh:0,totalKwh:0,revenue1:0,revenue2:0,revenue:0,knownKwh:0,smpNum:0});
    const g=groups.get(key);g.inv1Kwh+=k1;g.inv2Kwh+=k2;g.totalKwh+=kt;g.revenue1+=r1;g.revenue2+=r2;g.revenue+=rt;if(s!=null){g.knownKwh+=kt;g.smpNum+=kt*s;knownKwh+=kt}
    totalGeneration1+=k1;totalGeneration2+=k2;totalGeneration+=kt;totalRevenue1+=r1;totalRevenue2+=r2;totalRevenue+=rt;if(row.precision==='hourly_exact')exactRows++;
  }
  const liveRate=benchmark?.rate??null;
  const series=periodBuckets(start,end,grain).map(dt=>{
    const key=keyFor(dt,grain),g=groups.get(key);let smp=null;if(g?.knownKwh)smp=+(g.smpNum/g.knownKwh).toFixed(2);else{const lookup=getSmp(dt,smpData).value;if(lookup!=null)smp=+Number(lookup).toFixed(2)}
    const hours=overlapHours(dt,grain,start,end),k1=Number(g?.inv1Kwh||0),k2=Number(g?.inv2Kwh||0),kt=Number(g?.totalKwh||0);
    const monthlyRegion=benchmark?.monthly?.[dt.getUTCMonth()]??liveRate??null;
    const monthlyBuilding=benchmark?.buildingMonthly?.[dt.getUTCMonth()]??null;
    return{axis:alignedLabel(dt,grain,offset),actual:key,inv1Kwh:+k1.toFixed(3),inv2Kwh:+k2.toFixed(3),kwh:+kt.toFixed(3),revenue1:Math.round(g?.revenue1||0),revenue2:Math.round(g?.revenue2||0),revenue:Math.round(g?.revenue||0),efficiency1:efficiency(k1,cap1,hours),efficiency2:efficiency(k2,cap2,hours),efficiency:efficiency(kt,cap1+cap2,hours),generationHours1:fullLoadHours(k1,cap1),generationHours2:fullLoadHours(k2,cap2),generationHours:fullLoadHours(kt,cap1+cap2),regionEfficiency:monthlyRegion,buildingEfficiency:monthlyBuilding,smp};
  });
  const totalHours=((parseDateOnly(end)?.getTime()??0)-(parseDateOnly(start)?.getTime()??0))/3600000+24;
  const days=totalHours/24;
  return{series,kpi:{totalGeneration:+totalGeneration.toFixed(1),totalGeneration1:+totalGeneration1.toFixed(1),totalGeneration2:+totalGeneration2.toFixed(1),totalRevenue:Math.round(totalRevenue),totalRevenue1:Math.round(totalRevenue1),totalRevenue2:Math.round(totalRevenue2),weightedSmp:knownKwh?+(totalRevenue/knownKwh).toFixed(2):null,exactRows,efficiency:efficiency(totalGeneration,cap1+cap2,totalHours),efficiency1:efficiency(totalGeneration1,cap1,totalHours),efficiency2:efficiency(totalGeneration2,cap2,totalHours),generationHours:fullLoadHours(totalGeneration,cap1+cap2),generationHours1:fullLoadHours(totalGeneration1,cap1),generationHours2:fullLoadHours(totalGeneration2,cap2),avgDailyGenerationHours:(cap1+cap2)>0&&days>0?+(totalGeneration/(cap1+cap2)/days).toFixed(2):null}};
}

function recMonthlySummary(rows,weight=1.5){
  const map=new Map();for(const r of rows){const ym=String(r.ts||'').slice(0,7);if(!/^20\d{2}-\d{2}$/.test(ym))continue;const kt=Number(r.totalKwh??r.kwh??0);map.set(ym,(map.get(ym)||0)+kt)}
  return[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,kwh])=>{const mwh=kwh/1000,estimated=mwh*weight;return{month,kwh:+kwh.toFixed(1),mwh:+mwh.toFixed(3),weight,estimatedRec:+estimated.toFixed(3),deadline:recDeadlineForMonth(month)}})
}

export async function buildDashboard({grain='month',start='',end='',forceSmp=false,compareOffsets=[],cap1=0,cap2=0,recWeight=1.5}={}){
  cap1=Number(cap1)||0;cap2=Number(cap2)||0;recWeight=Number(recWeight)||1.5;
  const offsets=[0,...compareOffsets.filter(x=>[1,2,3].includes(x))];const minStart=offsets.reduce((min,o)=>{const s=shiftYear(start,o);return!min||s<min?s:min},start),maxEnd=end;
  const [{files,rows,errors},smpData,benchmark,recHistory]=await Promise.all([loadGeneration(),loadSmpData({force:forceSmp,start:minStart,end:maxEnd}),loadRegionBenchmark({force:forceSmp}),loadRecMarketHistory({start:minStart,end:maxEnd,force:forceSmp})]);
  const periods=offsets.map(offset=>{const s=shiftYear(start,offset),e=shiftYear(end,offset);return{offset,start:s,end:e,...aggregate(rows,smpData,benchmark,{grain,start:s,end:e,offset,cap1,cap2})}});const primary=periods[0];
  const yearly=periods.map(p=>({label:p.offset?`${p.offset}년 전`:'현재',period:`${p.start} ~ ${p.end}`,kwh:p.kpi.totalGeneration,revenue:p.kpi.totalRevenue,avgSmp:p.kpi.weightedSmp,efficiency:p.kpi.efficiency,generationHours:p.kpi.generationHours}));
  const selectedMwh=primary.kpi.totalGeneration/1000,estimatedRec=selectedMwh*recWeight;
  const monthlyRows=recMonthlySummary(rows,recWeight);
  const generationMap=new Map(monthlyRows.map(r=>[r.month,r]));
  const priceMap=new Map((recHistory?.series||[]).filter(x=>x?.ok).map(x=>[x.month,x]));
  const buildRecSeries=(periodStart,periodEnd)=>monthKeys(periodStart,periodEnd).map(month=>{const r=generationMap.get(month)||{month,kwh:0,mwh:0,weight:recWeight,estimatedRec:0,deadline:recDeadlineForMonth(month)};const p=priceMap.get(month);const price=p?.avg??p?.close??null;return{...r,price:price==null?null:+Number(price).toFixed(0),priceDate:p?.date||null,estimatedRevenue:price==null?null:Math.round(r.estimatedRec*price)}});
  const recSeries=buildRecSeries(start,end);
  const recComparisons=periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:buildRecSeries(p.start,p.end)}));
  const latestMarket=recHistory?.latest?{ok:true,source:recHistory.source,...recHistory.latest,fetchedAt:recHistory.fetchedAt}:{ok:false,source:recHistory?.source,message:recHistory?.message,fetchedAt:recHistory?.fetchedAt};
  const recPrice=latestMarket?.avg??latestMarket?.close??null;
  const rec={weight:recWeight,selectedMwh:+selectedMwh.toFixed(3),estimatedRec:+estimatedRec.toFixed(3),estimatedRevenue:recPrice==null?null:Math.round(estimatedRec*recPrice),market:latestMarket,marketHistory:recHistory,series:recSeries,comparisons:recComparisons,recentMonths:recMonthlySummary(rows,recWeight),rule:'REC = 발전량(MWh) × 가중치',priceRule:'REC 단가는 각 월의 마지막 확인 가능한 현물시장 거래일 육지 평균가를 사용합니다.',assumption:'건축물 등 기존 시설물 이용 태양광, 3,000kW 이하 가중치 1.5를 기본값으로 사용합니다. 실제 설비확인서 가중치를 우선 확인하세요.'};
  const maxIso=arr=>arr.filter(Boolean).sort().at(-1)||null;
  const latestGenerationTs=maxIso(rows.map(r=>r.ts));
  const latestGenerationFile=maxIso(files.map(f=>f.modifiedTime));
  const latestSmpFile=maxIso((smpData.meta?.yearStatus||[]).map(x=>x.modifiedTime));
  const latestSmpKey=maxIso([...(smpData.hourly?.keys?.()||[])]);
  const latestSmpMonth=maxIso([...(smpData.monthly?.keys?.()||[])]);
  const recDateRaw=latestMarket?.date?String(latestMarket.date):'';
  const recDataDate=/^\d{8}$/.test(recDateRaw)?`${recDateRaw.slice(0,4)}-${recDateRaw.slice(4,6)}-${recDateRaw.slice(6,8)}`:(recDateRaw||null);
  const updateMeta={
    generation:{dataDate:latestGenerationTs?String(latestGenerationTs).slice(0,10):null,fileModifiedAt:latestGenerationFile},
    smp:{dataDate:latestSmpKey?String(latestSmpKey).slice(0,10):(latestSmpMonth?`${latestSmpMonth}-01`:null),fileModifiedAt:latestSmpFile},
    rec:{dataDate:recDataDate,cacheUpdatedAt:recHistory?.cache?.updatedAt||recHistory?.cache?.fileModifiedTime||null},
    region:{period:benchmark?.period||benchmark?.year||null,checkedAt:benchmark?.fetchedAt||null}
  };
  return{syncedAt:new Date().toISOString(),updateMeta,fileCount:files.length,files:files.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime))),errors,smpMeta:smpData.meta,capacities:{inv1:cap1,inv2:cap2,total:cap1+cap2},benchmark,kpi:primary.kpi,series:primary.series,comparisons:periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:p.series,kpi:p.kpi})),yearly,rec,links};
}
