import { listGenerationExcelFiles, downloadFile } from './drive';
import { parseGenerationFile, mergeGenerationRows } from './generation';
import { loadSmpData, getSmp } from './smp';
import { loadRegionBenchmark } from './region';
import { loadRecMarketHistory, loadRecMarket, recDeadlineForMonth, loadRecManualLedger } from './rec';
import { loadRecIssuanceData } from './recSupply';
import links from '@/data/links.json';

function pad(n){return String(n).padStart(2,'0')}
function seasonInfo(date){const y=date.getUTCFullYear(),m=date.getUTCMonth()+1;if(m>=3&&m<=5)return{year:y,code:'spring',name:'봄',startMonth:3};if(m>=6&&m<=8)return{year:y,code:'summer',name:'여름',startMonth:6};if(m>=9&&m<=11)return{year:y,code:'autumn',name:'가을',startMonth:9};if(m===12)return{year:y+1,code:'winter',name:'겨울',startMonth:12};return{year:y,code:'winter',name:'겨울',startMonth:12}}
function keyFor(date,grain){const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${y}-${pad(m)}-${pad(d)} ${pad(h)}:00`;if(grain==='day')return`${y}-${pad(m)}-${pad(d)}`;if(grain==='quarter')return`${y}-Q${Math.floor((m-1)/3)+1}`;if(grain==='season'){const s=seasonInfo(date);return`${s.year}-S-${s.code}`}if(grain==='year')return String(y);return`${y}-${pad(m)}`}
function alignedLabel(date,grain,offset){const y=date.getUTCFullYear()+offset,m=date.getUTCMonth()+1,d=date.getUTCDate(),h=date.getUTCHours();if(grain==='hour')return`${y}-${pad(m)}-${pad(d)} ${pad(h)}시`;if(grain==='day')return`${y}-${pad(m)}-${pad(d)}`;if(grain==='quarter')return`${y} Q${Math.floor((m-1)/3)+1}`;if(grain==='season'){const s=seasonInfo(date);return`${s.year+offset} ${s.name}`}if(grain==='year')return String(y);return`${y}-${pad(m)}`}
function alignedKey(date,grain,offset){const x=new Date(date);x.setUTCFullYear(x.getUTCFullYear()+offset);return keyFor(x,grain)}
function inRange(iso,start,end){const day=iso.slice(0,10);return(!start||day>=start)&&(!end||day<=end)}
function monthKeys(start,end){const a=String(start||'').slice(0,7).split('-').map(Number),b=String(end||'').slice(0,7).split('-').map(Number);if(a.length<2||b.length<2||!a[0]||!b[0])return[];const out=[];let y=a[0],m=a[1];while(y<b[0]||(y===b[0]&&m<=b[1])){out.push(`${y}-${pad(m)}`);m++;if(m===13){m=1;y++}if(out.length>120)break}return out}
function shiftYear(isoDate,offset){const [y,m,d]=isoDate.split('-').map(Number);const dt=new Date(Date.UTC(y-offset,m-1,d));if(dt.getUTCMonth()!==m-1)dt.setUTCDate(0);return`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`}

async function loadGeneration(){const files=await listGenerationExcelFiles();const parsed=[];const errors=[];for(let i=0;i<files.length;i+=5){const result=await Promise.all(files.slice(i,i+5).map(async f=>{try{const buffer=await downloadFile(f.id);return{ok:true,file:f,rows:parseGenerationFile({name:f.name,modifiedTime:f.modifiedTime,buffer})}}catch(e){return{ok:false,file:f,error:e?.message||String(e)}}}));for(const r of result){if(r.ok)parsed.push(...r.rows);else errors.push({file:r.file?.name,error:r.error})}}return{files,rows:mergeGenerationRows(parsed),errors}}
function parseDateOnly(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;return new Date(Date.UTC(+m[1],+m[2]-1,+m[3],0,0,0))}
function bucketStart(dt,grain){const y=dt.getUTCFullYear(),m=dt.getUTCMonth(),d=dt.getUTCDate(),h=dt.getUTCHours();if(grain==='year')return new Date(Date.UTC(y,0,1));if(grain==='quarter')return new Date(Date.UTC(y,Math.floor(m/3)*3,1));if(grain==='season'){if(m>=2&&m<=4)return new Date(Date.UTC(y,2,1));if(m>=5&&m<=7)return new Date(Date.UTC(y,5,1));if(m>=8&&m<=10)return new Date(Date.UTC(y,8,1));if(m===11)return new Date(Date.UTC(y,11,1));return new Date(Date.UTC(y-1,11,1))}if(grain==='month')return new Date(Date.UTC(y,m,1));if(grain==='day')return new Date(Date.UTC(y,m,d));return new Date(Date.UTC(y,m,d,h))}
function nextBucket(dt,grain){const x=new Date(dt);if(grain==='year')x.setUTCFullYear(x.getUTCFullYear()+1);else if(grain==='quarter'||grain==='season')x.setUTCMonth(x.getUTCMonth()+3);else if(grain==='month')x.setUTCMonth(x.getUTCMonth()+1);else if(grain==='day')x.setUTCDate(x.getUTCDate()+1);else x.setUTCHours(x.getUTCHours()+1);return x}
function periodBuckets(start,end,grain){const a=parseDateOnly(start),b=parseDateOnly(end);if(!a||!b||a>b)return[];let cur=bucketStart(a,grain);const last=bucketStart(grain==='hour'?new Date(b.getTime()+23*3600*1000):b,grain);const out=[];let guard=0;while(cur<=last&&guard<100000){out.push(new Date(cur));cur=nextBucket(cur,grain);guard++}return out}
function overlapBounds(bucketDt,grain,start,end){const periodStart=parseDateOnly(start),periodEnd=parseDateOnly(end);if(!periodStart||!periodEnd)return null;const inclusiveEnd=new Date(periodEnd.getTime()+24*3600*1000);const b0=bucketStart(bucketDt,grain),b1=nextBucket(b0,grain);const s=Math.max(b0.getTime(),periodStart.getTime()),e=Math.min(b1.getTime(),inclusiveEnd.getTime());return e>s?{start:new Date(s),end:new Date(e),hours:(e-s)/3600000}:null}
function overlapHours(bucketDt,grain,start,end){return overlapBounds(bucketDt,grain,start,end)?.hours||0}
function efficiency(kwh,capacityKw,hours){if(!(capacityKw>0)||!(hours>0))return null;return +(kwh/(capacityKw*hours)*100).toFixed(2)}
function fullLoadHours(kwh,capacityKw){if(!(capacityKw>0))return null;return +(kwh/capacityKw).toFixed(2)}
function benchmarkStats(monthly,bucketDt,grain,start,end){const b=overlapBounds(bucketDt,grain,start,end);if(!b||!Array.isArray(monthly))return{efficiency:null,generationHours:null};let cur=new Date(b.start),weighted=0,knownHours=0,eqHours=0,guard=0;while(cur<b.end&&guard<24){const nextMonth=new Date(Date.UTC(cur.getUTCFullYear(),cur.getUTCMonth()+1,1));const segEnd=new Date(Math.min(nextMonth.getTime(),b.end.getTime()));const h=(segEnd-cur)/3600000;const cf=Number(monthly[cur.getUTCMonth()]);if(Number.isFinite(cf)){weighted+=cf*h;knownHours+=h;eqHours+=h*cf/100}cur=segEnd;guard++}return{efficiency:knownHours?+(weighted/knownHours).toFixed(2):null,generationHours:knownHours?+eqHours.toFixed(2):null}}

function aggregate(rows,smpData,benchmark,{grain,start,end,offset=0,cap1=0,cap2=0}){
  const merged=rows.filter(r=>inRange(r.ts,start,end));const groups=new Map();let totalGeneration=0,totalGeneration1=0,totalGeneration2=0,totalRevenue=0,totalRevenue1=0,totalRevenue2=0,knownKwh=0,exactRows=0;
  for(const row of merged){const dt=new Date(row.ts),key=keyFor(dt,grain),s=getSmp(dt,smpData).value;const k1=Number(row.inv1Kwh||0),k2=Number(row.inv2Kwh||0),kt=Number(row.totalKwh??row.kwh??(k1+k2));const r1=s==null?0:k1*s,r2=s==null?0:k2*s,rt=s==null?0:kt*s;if(!groups.has(key))groups.set(key,{dt:bucketStart(dt,grain),inv1Kwh:0,inv2Kwh:0,totalKwh:0,revenue1:0,revenue2:0,revenue:0,knownKwh:0,smpNum:0});const g=groups.get(key);g.inv1Kwh+=k1;g.inv2Kwh+=k2;g.totalKwh+=kt;g.revenue1+=r1;g.revenue2+=r2;g.revenue+=rt;if(s!=null){g.knownKwh+=kt;g.smpNum+=kt*s;knownKwh+=kt}totalGeneration1+=k1;totalGeneration2+=k2;totalGeneration+=kt;totalRevenue1+=r1;totalRevenue2+=r2;totalRevenue+=rt;if(row.precision==='hourly_exact')exactRows++}
  const series=periodBuckets(start,end,grain).map(dt=>{const key=keyFor(dt,grain),g=groups.get(key);let smp=null;if(g?.knownKwh)smp=+(g.smpNum/g.knownKwh).toFixed(2);else{const lookup=getSmp(dt,smpData).value;if(lookup!=null)smp=+Number(lookup).toFixed(2)}const hours=overlapHours(dt,grain,start,end),k1=Number(g?.inv1Kwh||0),k2=Number(g?.inv2Kwh||0),kt=Number(g?.totalKwh||0);const region=benchmarkStats(benchmark?.monthly,dt,grain,start,end),national=benchmarkStats(benchmark?.nationalMonthly,dt,grain,start,end),building=benchmarkStats(benchmark?.buildingMonthly,dt,grain,start,end);return{axis:alignedLabel(dt,grain,offset),actual:key,alignedActual:alignedKey(dt,grain,offset),inv1Kwh:+k1.toFixed(3),inv2Kwh:+k2.toFixed(3),kwh:+kt.toFixed(3),revenue1:Math.round(g?.revenue1||0),revenue2:Math.round(g?.revenue2||0),revenue:Math.round(g?.revenue||0),efficiency1:efficiency(k1,cap1,hours),efficiency2:efficiency(k2,cap2,hours),efficiency:efficiency(kt,cap1+cap2,hours),generationHours1:fullLoadHours(k1,cap1),generationHours2:fullLoadHours(k2,cap2),generationHours:fullLoadHours(kt,cap1+cap2),regionEfficiency:region.efficiency,nationalEfficiency:national.efficiency,buildingEfficiency:building.efficiency,regionGenerationHours:region.generationHours,nationalGenerationHours:national.generationHours,buildingGenerationHours:building.generationHours,smp}});
  const totalHours=((parseDateOnly(end)?.getTime()??0)-(parseDateOnly(start)?.getTime()??0))/3600000+24,days=totalHours/24;
  return{series,kpi:{totalGeneration:+totalGeneration.toFixed(1),totalGeneration1:+totalGeneration1.toFixed(1),totalGeneration2:+totalGeneration2.toFixed(1),totalRevenue:Math.round(totalRevenue),totalRevenue1:Math.round(totalRevenue1),totalRevenue2:Math.round(totalRevenue2),weightedSmp:knownKwh?+(totalRevenue/knownKwh).toFixed(2):null,exactRows,efficiency:efficiency(totalGeneration,cap1+cap2,totalHours),efficiency1:efficiency(totalGeneration1,cap1,totalHours),efficiency2:efficiency(totalGeneration2,cap2,totalHours),generationHours:fullLoadHours(totalGeneration,cap1+cap2),generationHours1:fullLoadHours(totalGeneration1,cap1),generationHours2:fullLoadHours(totalGeneration2,cap2),avgDailyGenerationHours:(cap1+cap2)>0&&days>0?+(totalGeneration/(cap1+cap2)/days).toFixed(2):null}}
}

function truncRec3(v){
  const n=Number(v);if(!Number.isFinite(n)||n<=0)return 0;
  // REC 소수점 규칙: 소수점 넷째 자리 이하는 절사 → 소수점 셋째 자리까지 보유
  return Math.trunc((n+1e-10)*1000)/1000;
}
function recMonthlySummary(rows,rpsMap,weight=1.5,supplyRatio=0.5){
  const map=new Map();
  for(const r of rows){const ym=String(r.ts||'').slice(0,7);if(!/^20\d{2}-\d{2}$/.test(ym))continue;const kt=Number(r.totalKwh??r.kwh??0);map.set(ym,(map.get(ym)||0)+kt)}
  const months=[...new Set([...map.keys(),...(rpsMap?.keys?.()||[])])].sort();
  let carry=0;
  return months.map(month=>{
    const generationKwh=Number(map.get(month)||0),rps=rpsMap?.get?.(month)||null;
    const supplyKwh=rps?Number(rps.supplyKwh||0):generationKwh*Number(supplyRatio||0);
    const rawCalcRec=(supplyKwh/1000)*weight;
    const calcRec=truncRec3(rawCalcRec);
    const carryIn=truncRec3(carry);
    const availableRec=truncRec3(calcRec+carryIn);
    const estimatedIssuedRec=Math.floor(availableRec+1e-10);
    const estimatedCarryOut=truncRec3(availableRec-estimatedIssuedRec);
    const actualIssued=rps?.issuedRec==null?null:Number(rps.issuedRec);
    const issuedRec=actualIssued==null?estimatedIssuedRec:actualIssued;
    // 실제 발급량이 있으면 그것을 표시값으로 우선합니다. 이월잔량은 계산 규칙으로 연속 추적합니다.
    // 실제 발급량만으로는 과거 월에서 넘어온 소수점 잔량을 완전히 역산할 수 없으므로, 계산 이월값을 별도 표시합니다.
    carry=estimatedCarryOut;
    const supplyRatioActual=generationKwh>0?supplyKwh/generationKwh:null;
    return{
      month,kwh:+generationKwh.toFixed(1),mwh:+(generationKwh/1000).toFixed(3),
      supplyKwh:+supplyKwh.toFixed(1),supplyMwh:+(supplyKwh/1000).toFixed(3),
      supplyRatio:supplyRatioActual==null?null:+supplyRatioActual.toFixed(4),weight,
      rawCalcRec:+rawCalcRec.toFixed(6),calcRec:+calcRec.toFixed(3),carryIn:+carryIn.toFixed(3),availableRec:+availableRec.toFixed(3),
      estimatedIssuedRec:+estimatedIssuedRec.toFixed(3),carryOut:+estimatedCarryOut.toFixed(3),
      issuedRec:+issuedRec.toFixed(3),estimatedRec:+issuedRec.toFixed(3),
      actualIssuedRec:actualIssued==null?null:+actualIssued.toFixed(3),
      source:rps?(actualIssued==null?'RPS 공급실적 + 이월계산':'RPS 발급실적'):`추정 ${Math.round(Number(supplyRatio||0)*100)}% + 이월계산`,
      carrySource:'계산 이월',
      sourceFiles:rps?.files||[],facilityCodes:rps?.facilities||[],rpsStatuses:rps?.statuses||[],
      deadline:recDeadlineForMonth(month)
    };
  })
}

export async function buildDashboard({grain='month',start='',end='',forceSmp=false,compareOffsets=[],cap1=0,cap2=0,recWeight=1.5,recSupplyRatio=0.5}={}){
  cap1=Number(cap1)||0;cap2=Number(cap2)||0;recWeight=Number(recWeight)||1.5;recSupplyRatio=Number(recSupplyRatio);if(!Number.isFinite(recSupplyRatio)||recSupplyRatio<0)recSupplyRatio=0.5;
  const offsets=[0,...compareOffsets.filter(x=>[1,2,3].includes(x))],minStart=offsets.reduce((min,o)=>{const s=shiftYear(start,o);return!min||s<min?s:min},start),maxEnd=end;
  const [{files,rows,errors},smpData,benchmark,recHistory,manualLedger,rpsIssuance]=await Promise.all([loadGeneration(),loadSmpData({force:forceSmp,start:minStart,end:maxEnd}),loadRegionBenchmark({force:forceSmp}),loadRecMarketHistory({start:minStart,end:maxEnd,force:forceSmp}),loadRecManualLedger(),loadRecIssuanceData()]);
  const periods=offsets.map(offset=>{const s=shiftYear(start,offset),e=shiftYear(end,offset);return{offset,start:s,end:e,...aggregate(rows,smpData,benchmark,{grain,start:s,end:e,offset,cap1,cap2})}}),primary=periods[0];
  const yearly=periods.map(p=>({label:p.offset?`${p.offset}년 전`:'현재',period:`${p.start} ~ ${p.end}`,kwh:p.kpi.totalGeneration,revenue:p.kpi.totalRevenue,avgSmp:p.kpi.weightedSmp,efficiency:p.kpi.efficiency,generationHours:p.kpi.generationHours}));
  const selectedMwh=primary.kpi.totalGeneration/1000;
  const kstNow=new Date(Date.now()+9*3600_000),nowYm=`${kstNow.getUTCFullYear()}-${pad(kstNow.getUTCMonth()+1)}`;
  let currentMarketRow=(recHistory?.series||[]).find(x=>x?.ok&&x.month===nowYm)||null;
  if(!currentMarketRow){try{const currentMarket=await loadRecMarket({force:forceSmp});if(currentMarket?.ok)currentMarketRow=currentMarket}catch{}}
  const monthlyRaw=recMonthlySummary(rows,rpsIssuance?.map,recWeight,recSupplyRatio),priceMap=new Map((recHistory?.series||[]).filter(x=>x?.ok).map(x=>[x.month,x]));
  const transactions=[...(manualLedger.items||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.updatedAt).localeCompare(String(b.updatedAt)));
  let cumulativeRec=0;
  const monthEndIso=ym=>{const [y,m]=String(ym).split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
  const txTotalsUntil=date=>transactions.filter(t=>String(t.date)<=date).reduce((a,t)=>({qty:a.qty+Number(t.monetizedQty||0),amount:a.amount+Number(t.monetizedAmount||0)}),{qty:0,amount:0});
  const monthlyRows=monthlyRaw.map(r=>{
    cumulativeRec+=r.issuedRec;
    const tx=txTotalsUntil(monthEndIso(r.month));
    const p=priceMap.get(r.month),price=p?.avg??p?.close??null;
    return{...r,price:price==null?null:+Number(price).toFixed(0),priceDate:p?.date||null,estimatedRevenue:price==null?null:Math.round(r.issuedRec*price),cumulativeRec:+cumulativeRec.toFixed(3),cumulativeMonetized:+tx.qty.toFixed(3),cumulativeMonetizedAmount:Math.round(tx.amount),remainingRec:+(cumulativeRec-tx.qty).toFixed(3)};
  });
  const generationMap=new Map(monthlyRows.map(r=>[r.month,r]));
  const buildRecSeries=(periodStart,periodEnd)=>monthKeys(periodStart,periodEnd).map(month=>generationMap.get(month)||{month,kwh:0,mwh:0,supplyKwh:0,supplyMwh:0,supplyRatio:null,weight:recWeight,calcRec:0,issuedRec:0,estimatedRec:0,source:'데이터 없음',deadline:recDeadlineForMonth(month),price:null,priceDate:null,estimatedRevenue:null,cumulativeRec:null,cumulativeMonetized:null,cumulativeMonetizedAmount:null,remainingRec:null});
  const recSeries=buildRecSeries(start,end),recComparisons=periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:buildRecSeries(p.start,p.end)}));
  const estimatedRec=recSeries.reduce((a,r)=>a+Number(r.issuedRec??r.estimatedRec??0),0);
  const selectedSupplyKwh=recSeries.reduce((a,r)=>a+Number(r.supplyKwh||0),0);
  const latestMarket=currentMarketRow?{ok:true,source:recHistory?.source||'한국전력거래소 REC 현물시장 OpenAPI(15099762)',...currentMarketRow,fetchedAt:new Date().toISOString()}:(recHistory?.latest?{ok:true,source:recHistory.source,...recHistory.latest,fetchedAt:recHistory.fetchedAt}:{ok:false,source:recHistory?.source,message:recHistory?.message,fetchedAt:recHistory?.fetchedAt}),recPrice=latestMarket?.avg??latestMarket?.close??null,lastMonthly=monthlyRows.at(-1);
  const txTotal=transactions.reduce((a,t)=>({qty:a.qty+Number(t.monetizedQty||0),amount:a.amount+Number(t.monetizedAmount||0)}),{qty:0,amount:0});
  const rec={weight:recWeight,supplyRatio:recSupplyRatio,selectedMwh:+selectedMwh.toFixed(3),selectedSupplyMwh:+(selectedSupplyKwh/1000).toFixed(3),estimatedRec:+estimatedRec.toFixed(3),carryBalance:+Number(recSeries.at(-1)?.carryOut||0).toFixed(3),estimatedRevenue:recPrice==null?null:Math.round(estimatedRec*recPrice),market:latestMarket,marketHistory:recHistory,series:recSeries,comparisons:recComparisons,recentMonths:monthlyRows,rpsIssuance:{files:rpsIssuance?.files||[],rows:rpsIssuance?.rows||[],errors:rpsIssuance?.errors||[],latestMonth:rpsIssuance?.latestMonth||null,hasActual:(rpsIssuance?.rows||[]).length>0},ledger:{cumulativeRec:lastMonthly?.cumulativeRec||0,cumulativeMonetized:+txTotal.qty.toFixed(3),remainingRec:+((lastMonthly?.cumulativeRec||0)-txTotal.qty).toFixed(3),cumulativeMonetizedAmount:Math.round(txTotal.amount),transactions:[...transactions].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt))),file:manualLedger.file?.name||'REC_수익화_수기입력.xlsx',fileModifiedTime:manualLedger.file?.modifiedTime||null,error:manualLedger.error||''},rule:'REC 산정 = RPS 인정 공급전력량(kWh) ÷ 1,000 × 가중치 → 소수점 4째 자리 이하 절사 → 전월 이월분 합산 → 정수 REC 발급, 소수부는 다음 달 이월',priceRule:'REC 시세 라인은 각 월의 마지막 확인 가능한 현물시장 거래일 육지 평균가입니다. 금액 막대는 화면에서 선택한 현재가/특정일 기준가를 전체 발급량에 적용할 수 있습니다.',assumption:`RPS 발급내역 Excel이 있으면 실제 공급전력량/실제 발급량을 우선 사용합니다. 없으면 발전보고서 발전량의 ${Math.round(recSupplyRatio*100)}%를 공급전력량으로 추정합니다. 계산 REC는 소수점 셋째 자리까지 보유하고 넷째 자리 이하를 절사하며, 1 REC 미만 소수부는 다음 달 계산에 자동 이월합니다. 실제 RPS 발급실적이 있으면 실제 발급량이 최종 우선입니다.`};
  const maxIso=arr=>arr.filter(Boolean).sort().at(-1)||null,latestGenerationTs=maxIso(rows.map(r=>r.ts)),latestGenerationFile=maxIso(files.map(f=>f.modifiedTime)),latestSmpFile=maxIso((smpData.meta?.yearStatus||[]).map(x=>x.modifiedTime)),latestSmpKey=maxIso([...(smpData.hourly?.keys?.()||[])]),latestSmpMonth=maxIso([...(smpData.monthly?.keys?.()||[])]),recDateRaw=latestMarket?.date?String(latestMarket.date):'',recDataDate=/^\d{8}$/.test(recDateRaw)?`${recDateRaw.slice(0,4)}-${recDateRaw.slice(4,6)}-${recDateRaw.slice(6,8)}`:(recDateRaw||null);
  const updateMeta={generation:{dataDate:latestGenerationTs?String(latestGenerationTs).slice(0,10):null,fileModifiedAt:latestGenerationFile},smp:{dataDate:latestSmpKey?String(latestSmpKey).slice(0,10):(latestSmpMonth?`${latestSmpMonth}-01`:null),fileModifiedAt:latestSmpFile},rec:{dataDate:recDataDate,cacheUpdatedAt:recHistory?.cache?.updatedAt||recHistory?.cache?.fileModifiedTime||null},region:{period:benchmark?.nationalPeriod||benchmark?.period||benchmark?.year||null,checkedAt:benchmark?.fetchedAt||null}};
  return{syncedAt:new Date().toISOString(),updateMeta,fileCount:files.length,files:files.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime))),errors,smpMeta:smpData.meta,capacities:{inv1:cap1,inv2:cap2,total:cap1+cap2},benchmark,kpi:primary.kpi,series:primary.series,comparisons:periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:p.series,kpi:p.kpi})),yearly,rec,links};
}
