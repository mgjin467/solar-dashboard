import { listGenerationExcelFiles, downloadFile } from './drive';
import { parseGenerationFile, mergeGenerationRows } from './generation';
import { loadSmpData, getSmp } from './smp';
import { loadRegionBenchmark } from './region';
import { loadRecMarketHistory, loadRecMarket, recDeadlineForMonth, loadRecManualLedger, loadRecIssueDateOverrides } from './rec';
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
function avgDailyFullLoadHours(kwh,capacityKw,hours){if(!(capacityKw>0)||!(hours>0))return null;const days=hours/24;if(!(days>0))return null;return +(kwh/capacityKw/days).toFixed(2)}
function benchmarkStats(monthly,bucketDt,grain,start,end){const b=overlapBounds(bucketDt,grain,start,end);if(!b||!Array.isArray(monthly))return{efficiency:null,generationHours:null,avgDailyGenerationHours:null};let cur=new Date(b.start),weighted=0,knownHours=0,eqHours=0,guard=0;while(cur<b.end&&guard<24){const nextMonth=new Date(Date.UTC(cur.getUTCFullYear(),cur.getUTCMonth()+1,1));const segEnd=new Date(Math.min(nextMonth.getTime(),b.end.getTime()));const h=(segEnd-cur)/3600000;const cf=Number(monthly[cur.getUTCMonth()]);if(Number.isFinite(cf)){weighted+=cf*h;knownHours+=h;eqHours+=h*cf/100}cur=segEnd;guard++}return{efficiency:knownHours?+(weighted/knownHours).toFixed(2):null,generationHours:knownHours?+eqHours.toFixed(2):null,avgDailyGenerationHours:knownHours?+(eqHours/(knownHours/24)).toFixed(2):null}}

function aggregate(rows,smpData,benchmark,{grain,start,end,offset=0,cap1=0,cap2=0}){
  const merged=rows.filter(r=>inRange(r.ts,start,end));const groups=new Map();let totalGeneration=0,totalGeneration1=0,totalGeneration2=0,totalRevenue=0,totalRevenue1=0,totalRevenue2=0,knownKwh=0,exactRows=0;
  for(const row of merged){const dt=new Date(row.ts),key=keyFor(dt,grain),s=getSmp(dt,smpData,'mainland').value;const k1=Number(row.inv1Kwh||0),k2=Number(row.inv2Kwh||0),kt=Number(row.totalKwh??row.kwh??(k1+k2));const r1=s==null?0:k1*s,r2=s==null?0:k2*s,rt=s==null?0:kt*s;if(!groups.has(key))groups.set(key,{dt:bucketStart(dt,grain),inv1Kwh:0,inv2Kwh:0,totalKwh:0,revenue1:0,revenue2:0,revenue:0,knownKwh:0,smpNum:0});const g=groups.get(key);g.inv1Kwh+=k1;g.inv2Kwh+=k2;g.totalKwh+=kt;g.revenue1+=r1;g.revenue2+=r2;g.revenue+=rt;if(s!=null){g.knownKwh+=kt;g.smpNum+=kt*s;knownKwh+=kt}totalGeneration1+=k1;totalGeneration2+=k2;totalGeneration+=kt;totalRevenue1+=r1;totalRevenue2+=r2;totalRevenue+=rt;if(row.precision==='hourly_exact')exactRows++}
  const series=periodBuckets(start,end,grain).map(dt=>{const key=keyFor(dt,grain),g=groups.get(key);let smp=null;if(g?.knownKwh)smp=+(g.smpNum/g.knownKwh).toFixed(2);else{const lookup=getSmp(dt,smpData,'mainland').value;if(lookup!=null)smp=+Number(lookup).toFixed(2)}const jejuLookup=getSmp(dt,smpData,'jeju').value,jejuSmp=jejuLookup==null?null:+Number(jejuLookup).toFixed(2);const hours=overlapHours(dt,grain,start,end),k1=Number(g?.inv1Kwh||0),k2=Number(g?.inv2Kwh||0),kt=Number(g?.totalKwh||0);const national=benchmarkStats(benchmark?.nationalMonthly,dt,grain,start,end),building=benchmarkStats(benchmark?.buildingMonthly,dt,grain,start,end),regions={};for(const name of (benchmark?.regionNames||[])){regions[name]=benchmarkStats(benchmark?.regions?.[name]?.monthly,dt,grain,start,end)}const legacy=regions.충북||benchmarkStats(benchmark?.monthly,dt,grain,start,end);return{axis:alignedLabel(dt,grain,offset),actual:key,alignedActual:alignedKey(dt,grain,offset),inv1Kwh:+k1.toFixed(3),inv2Kwh:+k2.toFixed(3),kwh:+kt.toFixed(3),revenue1:Math.round(g?.revenue1||0),revenue2:Math.round(g?.revenue2||0),revenue:Math.round(g?.revenue||0),efficiency1:efficiency(k1,cap1,hours),efficiency2:efficiency(k2,cap2,hours),efficiency:efficiency(kt,cap1+cap2,hours),generationHours1:fullLoadHours(k1,cap1),generationHours2:fullLoadHours(k2,cap2),generationHours:fullLoadHours(kt,cap1+cap2),avgDailyGenerationHours1:avgDailyFullLoadHours(k1,cap1,hours),avgDailyGenerationHours2:avgDailyFullLoadHours(k2,cap2,hours),avgDailyGenerationHours:avgDailyFullLoadHours(kt,cap1+cap2,hours),regions,regionEfficiency:legacy.efficiency,nationalEfficiency:national.efficiency,buildingEfficiency:building.efficiency,regionGenerationHours:legacy.generationHours,nationalGenerationHours:national.generationHours,buildingGenerationHours:building.generationHours,regionAvgDailyGenerationHours:legacy.avgDailyGenerationHours,nationalAvgDailyGenerationHours:national.avgDailyGenerationHours,buildingAvgDailyGenerationHours:building.avgDailyGenerationHours,smp,jejuSmp}});
  const totalHours=((parseDateOnly(end)?.getTime()??0)-(parseDateOnly(start)?.getTime()??0))/3600000+24,days=totalHours/24;
  return{series,kpi:{totalGeneration:+totalGeneration.toFixed(1),totalGeneration1:+totalGeneration1.toFixed(1),totalGeneration2:+totalGeneration2.toFixed(1),totalRevenue:Math.round(totalRevenue),totalRevenue1:Math.round(totalRevenue1),totalRevenue2:Math.round(totalRevenue2),weightedSmp:knownKwh?+(totalRevenue/knownKwh).toFixed(2):null,exactRows,efficiency:efficiency(totalGeneration,cap1+cap2,totalHours),efficiency1:efficiency(totalGeneration1,cap1,totalHours),efficiency2:efficiency(totalGeneration2,cap2,totalHours),generationHours:fullLoadHours(totalGeneration,cap1+cap2),generationHours1:fullLoadHours(totalGeneration1,cap1),generationHours2:fullLoadHours(totalGeneration2,cap2),avgDailyGenerationHours:(cap1+cap2)>0&&days>0?+(totalGeneration/(cap1+cap2)/days).toFixed(2):null,avgDailyGenerationHours1:cap1>0&&days>0?+(totalGeneration1/cap1/days).toFixed(2):null,avgDailyGenerationHours2:cap2>0&&days>0?+(totalGeneration2/cap2/days).toFixed(2):null}}
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
      rpsIssueDate:rps?.issueDate||null,rpsIssueDates:rps?.issueDates||[],
      deadline:recDeadlineForMonth(month)
    };
  })
}


function kstTodayIso(){const d=new Date(Date.now()+9*3600_000);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function addYearsIso(iso,years){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const y=+m[1]+years,mo=+m[2],day=+m[3],last=new Date(Date.UTC(y,mo,0)).getUTCDate();return `${y}-${pad(mo)}-${pad(Math.min(day,last))}`}
function addMonthsIso(iso,months){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const base=new Date(Date.UTC(+m[1],+m[2]-1,1));base.setUTCMonth(base.getUTCMonth()+months);const y=base.getUTCFullYear(),mo=base.getUTCMonth()+1,day=+m[3],last=new Date(Date.UTC(y,mo,0)).getUTCDate();return `${y}-${pad(mo)}-${pad(Math.min(day,last))}`}
function lotAvailabilityDate(lot){if(lot.issueDate)return lot.issueDate;const [y,m]=String(lot.month||'').split('-').map(Number);return y&&m?new Date(Date.UTC(y,m,0)).toISOString().slice(0,10):'9999-12-31'}
function lifecycleSnapshot(baseLots,transactions,asOfIso=kstTodayIso()){
  const lots=(baseLots||[]).map(x=>({...x,remaining:+Number(x.qty||0).toFixed(3),monetizedAllocated:0,manualDisposedAllocated:0,autoExpiredAllocated:0,availabilityDate:lotAvailabilityDate(x)}));
  const txs=[...(transactions||[])].filter(t=>String(t.date||'')<=asOfIso).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
  let cumulativeMonetized=0,manualDisposed=0,autoExpired=0,unallocatedMonetized=0,unallocatedDisposed=0,monetizedAmount=0;
  const expireBefore=(date,includeSame=false)=>{for(const lot of lots){if(!(lot.remaining>0)||lot.availabilityDate>asOfIso||!lot.expiryDate)continue;const expired=includeSame?lot.expiryDate<=date:lot.expiryDate<date;if(expired){const q=lot.remaining;lot.remaining=0;lot.autoExpiredAllocated=+(lot.autoExpiredAllocated+q).toFixed(3);autoExpired+=q}}};
  const consume=(tx)=>{
    expireBefore(String(tx.date||''),false);
    let need=Math.max(0,Number(tx.qty??tx.monetizedQty??tx.disposedQty??0)||0);
    if(!(need>0))return;
    const type=tx.type==='disposed'?'disposed':'monetized';
    const candidates=lots.filter(l=>l.remaining>0&&l.availabilityDate<=String(tx.date||'')).sort((a,b)=>String(a.expiryDate||'9999-12-31').localeCompare(String(b.expiryDate||'9999-12-31'))||String(a.availabilityDate).localeCompare(String(b.availabilityDate))||String(a.month).localeCompare(String(b.month)));
    let allocated=0;
    for(const lot of candidates){if(need<=1e-9)break;const q=Math.min(lot.remaining,need);lot.remaining=+(lot.remaining-q).toFixed(3);need=+(need-q).toFixed(3);allocated+=q;if(type==='disposed')lot.manualDisposedAllocated=+(lot.manualDisposedAllocated+q).toFixed(3);else lot.monetizedAllocated=+(lot.monetizedAllocated+q).toFixed(3)}
    if(type==='disposed'){manualDisposed+=allocated;unallocatedDisposed+=Math.max(0,need)}else{cumulativeMonetized+=allocated;unallocatedMonetized+=Math.max(0,need);monetizedAmount+=Number(tx.amount??tx.monetizedAmount??0)||0}
  };
  for(const tx of txs)consume(tx);
  expireBefore(asOfIso,false);
  const sixMonthDate=addMonthsIso(asOfIso,6);
  const availableLots=lots.filter(l=>l.availabilityDate<=asOfIso);
  const totalIssued=availableLots.reduce((a,l)=>a+Number(l.qty||0),0);
  const validRemaining=availableLots.reduce((a,l)=>a+Number(l.remaining||0),0);
  const expiryScheduled=availableLots.filter(l=>l.remaining>0&&l.expiryDate&&l.expiryDate>=asOfIso).reduce((a,l)=>a+l.remaining,0);
  const expiringSoon=availableLots.filter(l=>l.remaining>0&&l.expiryDate&&l.expiryDate>=asOfIso&&l.expiryDate<sixMonthDate).reduce((a,l)=>a+l.remaining,0);
  const unknownExpiry=availableLots.filter(l=>l.remaining>0&&!l.expiryDate).reduce((a,l)=>a+l.remaining,0);
  const unconfirmed=availableLots.filter(l=>l.remaining>0&&!l.confirmed).reduce((a,l)=>a+l.remaining,0);
  return{
    asOf:asOfIso,totalIssued:+totalIssued.toFixed(3),cumulativeMonetized:+cumulativeMonetized.toFixed(3),cumulativeMonetizedAmount:Math.round(monetizedAmount),manualDisposed:+manualDisposed.toFixed(3),autoExpired:+autoExpired.toFixed(3),totalDisposed:+(manualDisposed+autoExpired).toFixed(3),remainingRec:+validRemaining.toFixed(3),expiryScheduled:+expiryScheduled.toFixed(3),expiringSoon:+expiringSoon.toFixed(3),unknownExpiry:+unknownExpiry.toFixed(3),unconfirmed:+unconfirmed.toFixed(3),unallocatedMonetized:+unallocatedMonetized.toFixed(3),unallocatedDisposed:+unallocatedDisposed.toFixed(3),lots:availableLots.map(l=>({...l,remaining:+Number(l.remaining||0).toFixed(3)}))
  };
}
function expiryStatus(lot,today=kstTodayIso()){
  if(Number(lot?.autoExpiredAllocated)>0)return{code:'expired',label:'만료·자동폐기'};
  if(!(Number(lot?.remaining)>0))return{code:'used',label:'소진'};
  if(!lot?.expiryDate)return{code:'unknown',label:'발급일 미확인'};
  if(lot.expiryDate<today)return{code:'expired',label:'만료'};
  if(lot.expiryDate<addMonthsIso(today,6))return{code:'soon',label:'6개월 이내 만료'};
  return{code:'safe',label:'유효'};
}


function summaryPeriod(summaryKey){
  const m=String(summaryKey||'').match(/^(20\d{2})(-season)?$/),y=m?Number(m[1]):new Date().getFullYear(),season=Boolean(m?.[2]);
  if(season)return{key:`${y}-season`,year:y,season:true,label:`${y}(계절)`,start:`${y}-03-01`,end:`${y+1}-02-${new Date(Date.UTC(y+1,2,0)).getUTCDate()}`};
  return{key:String(y),year:y,season:false,label:String(y),start:`${y}-01-01`,end:`${y}-12-31`};
}
function isoMin(...vals){return vals.filter(Boolean).sort()[0]||''}function isoMax(...vals){return vals.filter(Boolean).sort().at(-1)||''}
function daysBetweenInclusive(start,end){const a=parseDateOnly(start),b=parseDateOnly(end);return a&&b?Math.max(0,Math.round((b-a)/86400000)+1):0}
function safeAvg(vals){const a=vals.filter(v=>Number.isFinite(Number(v))).map(Number);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function summaryMetricFromMonthly(rows,{capacity=0,days=0}={}){const generation=Math.round(rows.reduce((a,r)=>a+Number(r.generation||0),0)),revenue=Math.round(rows.reduce((a,r)=>a+Number(r.revenue||0),0)),generationHours=rows.reduce((a,r)=>a+Number(r.generationHours||0),0),recQty=rows.reduce((a,r)=>a+Number(r.recQty||0),0),recRevenue=Math.round(rows.reduce((a,r)=>a+Number(r.recRevenue||0),0));return{generation,revenue,generationHours:+generationHours.toFixed(2),efficiency:capacity>0&&days>0?+(generation/(capacity*days*24)*100).toFixed(2):null,avgDailyGenerationHours:days>0?+(generationHours/days).toFixed(2):null,recQty:+recQty.toFixed(2),recRevenue}}
function averageMetricSets(sets){const keys=['generation','revenue','generationHours','efficiency','avgDailyGenerationHours','recQty','recRevenue'],o={};for(const k of keys){const v=safeAvg(sets.map(x=>x?.[k]));o[k]=v==null?null:(['generation','revenue','recRevenue'].includes(k)?Math.round(v):+v.toFixed(2))}return o}
function buildAnnualSummary({summaryKey,rows,smpData,benchmark,cap1,cap2,baseMonthlyRows,recSupplyRatio,recWeight}){
  const spec=summaryPeriod(summaryKey),capacity=cap1+cap2,days=daysBetweenInclusive(spec.start,spec.end),monthlyAgg=aggregate(rows,smpData,benchmark,{grain:'month',start:spec.start,end:spec.end,cap1,cap2}),groupGrain=spec.season?'season':'quarter',groupAgg=aggregate(rows,smpData,benchmark,{grain:groupGrain,start:spec.start,end:spec.end,cap1,cap2});
  const recMap=new Map((baseMonthlyRows||[]).map(r=>[r.month,r]));
  const currentMonthly=monthlyAgg.series.map(r=>{const rr=recMap.get(String(r.actual).slice(0,7));return{period:r.actual,generation:Number(r.kwh||0),revenue:Number(r.revenue||0),generationHours:Number(r.generationHours||0),efficiency:r.efficiency,avgDailyGenerationHours:r.avgDailyGenerationHours,recQty:Number(rr?.issuedRec||0),recRevenue:Number(rr?.estimatedRevenue||0)}});
  const currentWhole={...summaryMetricFromMonthly(currentMonthly,{capacity,days}),efficiency:monthlyAgg.kpi.efficiency,avgDailyGenerationHours:monthlyAgg.kpi.avgDailyGenerationHours,generationHours:monthlyAgg.kpi.generationHours,generation:Math.round(monthlyAgg.kpi.totalGeneration),revenue:Math.round(monthlyAgg.kpi.totalRevenue)};
  const groupCurrent=groupAgg.series.map(g=>{const prefix=String(g.actual||'');const months=currentMonthly.filter(r=>{const [y,m]=r.period.split('-').map(Number);if(groupGrain==='quarter')return `${y}-Q${Math.floor((m-1)/3)+1}`===prefix;const ss=seasonInfo(new Date(Date.UTC(y,m-1,1)));return `${ss.year}-S-${ss.code}`===prefix});return{generation:Math.round(g.kwh||0),revenue:Math.round(g.revenue||0),generationHours:g.generationHours,efficiency:g.efficiency,avgDailyGenerationHours:g.avgDailyGenerationHours,recQty:months.reduce((a,r)=>a+r.recQty,0),recRevenue:months.reduce((a,r)=>a+r.recRevenue,0)}});
  const entities={current:{name:'현재 발전소',whole:currentWhole,monthlyAverage:averageMetricSets(currentMonthly),groupAverage:averageMetricSets(groupCurrent)}};
  const benchmarkEntities=[['national','전국',benchmark?.nationalMonthly],...(benchmark?.regionNames||[]).map(n=>[n,n,benchmark?.regions?.[n]?.monthly])];
  for(const [key,name,profile] of benchmarkEntities){
    const bm=[];for(const r of monthlyAgg.series){const dt=parseDateOnly(`${String(r.actual).slice(0,7)}-01`),st=benchmarkStats(profile,dt,'month',spec.start,spec.end),gen=capacity>0&&st.generationHours!=null?Math.round(st.generationHours*capacity):0,smp=key==='제주'?r.jejuSmp:r.smp,revenue=smp==null?0:Math.round(gen*Number(smp)),rec=gen*Number(recSupplyRatio||0)*Number(recWeight||1.5)/1000,rr=recMap.get(String(r.actual).slice(0,7)),recPrice=rr?.price;bm.push({period:r.actual,generation:gen,revenue,generationHours:st.generationHours,efficiency:st.efficiency,avgDailyGenerationHours:st.avgDailyGenerationHours,recQty:rec,recRevenue:recPrice==null?0:rec*Number(recPrice)})}
    const whole=summaryMetricFromMonthly(bm,{capacity,days}),groups=[];for(const g of groupAgg.series){const months=bm.filter(r=>{const [y,m]=r.period.split('-').map(Number);if(groupGrain==='quarter')return `${y}-Q${Math.floor((m-1)/3)+1}`===g.actual;const ss=seasonInfo(new Date(Date.UTC(y,m-1,1)));return `${ss.year}-S-${ss.code}`===g.actual});const gg=summaryMetricFromMonthly(months,{capacity,days:months.reduce((a,r)=>a+new Date(Date.UTC(+r.period.slice(0,4),+r.period.slice(5,7),0)).getUTCDate(),0)});groups.push(gg)}
    entities[key]={name,whole,monthlyAverage:averageMetricSets(bm),groupAverage:averageMetricSets(groups)};
  }
  return{...spec,groupLabel:spec.season?'계절평균':'분기평균',sourceYear:benchmark?.year||null,entities};
}
export async function buildDashboard({grain='month',start='',end='',forceSmp=false,compareOffsets=[],cap1=0,cap2=0,recWeight=1.5,recSupplyRatio=0.5,summaryKey=''}={}){
  cap1=Number(cap1)||0;cap2=Number(cap2)||0;recWeight=Number(recWeight)||1.5;recSupplyRatio=Number(recSupplyRatio);if(!Number.isFinite(recSupplyRatio)||recSupplyRatio<0)recSupplyRatio=0.5;
  const offsets=[0,...compareOffsets.filter(x=>[1,2,3].includes(x))],mainMinStart=offsets.reduce((min,o)=>{const s=shiftYear(start,o);return!min||s<min?s:min},start),mainMaxEnd=end,summarySpec=summaryPeriod(summaryKey||String(new Date().getFullYear())),minStart=isoMin(mainMinStart,summarySpec.start),maxEnd=isoMax(mainMaxEnd,summarySpec.end);
  const [{files,rows,errors},smpData,benchmark,recHistory,manualLedger,rpsIssuance,issueDateOverrides]=await Promise.all([loadGeneration(),loadSmpData({force:forceSmp,start:minStart,end:maxEnd}),loadRegionBenchmark({force:forceSmp}),loadRecMarketHistory({start:minStart,end:isoMin(maxEnd,kstTodayIso())||maxEnd,force:forceSmp}),loadRecManualLedger(),loadRecIssuanceData(),loadRecIssueDateOverrides()]);
  const periods=offsets.map(offset=>{const s=shiftYear(start,offset),e=shiftYear(end,offset);return{offset,start:s,end:e,...aggregate(rows,smpData,benchmark,{grain,start:s,end:e,offset,cap1,cap2})}}),primary=periods[0];
  const yearly=periods.map(p=>({label:p.offset?`${p.offset}년 전`:'현재',period:`${p.start} ~ ${p.end}`,kwh:p.kpi.totalGeneration,revenue:p.kpi.totalRevenue,avgSmp:p.kpi.weightedSmp,efficiency:p.kpi.efficiency,generationHours:p.kpi.generationHours}));
  const selectedMwh=primary.kpi.totalGeneration/1000;
  const kstNow=new Date(Date.now()+9*3600_000),nowYm=`${kstNow.getUTCFullYear()}-${pad(kstNow.getUTCMonth()+1)}`;
  let currentMarketRow=(recHistory?.series||[]).find(x=>x?.ok&&x.month===nowYm)||null;
  if(!currentMarketRow){try{const currentMarket=await loadRecMarket({force:forceSmp});if(currentMarket?.ok)currentMarketRow=currentMarket}catch{}}
  const monthlyRaw=recMonthlySummary(rows,rpsIssuance?.map,recWeight,recSupplyRatio),priceMap=new Map((recHistory?.series||[]).filter(x=>x?.ok).map(x=>[x.month,x]));
  const transactions=[...(manualLedger.items||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.updatedAt).localeCompare(String(b.updatedAt)));
  const monthEndIso=ym=>{const [y,m]=String(ym).split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
  const baseMonthlyRows=monthlyRaw.map(r=>{
    const override=issueDateOverrides?.map?.get?.(r.month)||null;
    // 기본 발급일: 발전월 말일 + 90일. 실제 RPS 발급일이나 수기 보정값이 있으면 그 값을 우선합니다.
    const defaultIssueDate=recDeadlineForMonth(r.month)?.date||null;
    const issueDate=override?.issueDate||r.rpsIssueDate||defaultIssueDate;
    const issueDateSource=override?'수기 수정':(r.rpsIssueDate?'RPS 실제 발급일':'기본 계산(월말+90일)');
    const p=priceMap.get(r.month),price=p?.avg??p?.close??null;
    return{...r,defaultIssueDate,issueDate,issueDateSource,expiryDate:issueDate?addYearsIso(issueDate,3):null,price:price==null?null:+Number(price).toFixed(0),priceDate:p?.date||null,estimatedRevenue:price==null?null:Math.round(r.issuedRec*price)};
  });
  const lifecycleLots=baseMonthlyRows.filter(r=>Number(r.issuedRec||0)>0).map(r=>({id:`lot_${r.month}`,month:r.month,qty:+Number(r.issuedRec||0).toFixed(3),defaultIssueDate:r.defaultIssueDate,issueDate:r.issueDate,issueDateSource:r.issueDateSource,expiryDate:r.expiryDate,confirmed:Boolean(r.issueDate),source:r.source}));
  const todayIso=kstTodayIso();
  const lifecycle=lifecycleSnapshot(lifecycleLots,transactions,todayIso);
  const lotStateMap=new Map(lifecycle.lots.map(l=>[l.month,l]));
  let cumulativeRec=0;
  const monthlyRows=baseMonthlyRows.map(r=>{
    cumulativeRec+=r.issuedRec;
    const snap=lifecycleSnapshot(lifecycleLots,transactions,monthEndIso(r.month));
    const lot=lotStateMap.get(r.month),status=expiryStatus(lot||{...r,remaining:r.issuedRec,expiryDate:r.expiryDate},todayIso);
    return{...r,cumulativeRec:+cumulativeRec.toFixed(3),cumulativeMonetized:snap.cumulativeMonetized,cumulativeMonetizedAmount:snap.cumulativeMonetizedAmount,cumulativeDisposed:snap.totalDisposed,remainingRec:snap.remainingRec,lifecycleRemaining:lot?.remaining??null,expiryStatus:status.label,expiryStatusCode:status.code};
  });
  const generationMap=new Map(monthlyRows.map(r=>[r.month,r]));
  const buildRecSeries=(periodStart,periodEnd)=>monthKeys(periodStart,periodEnd).map(month=>generationMap.get(month)||{month,kwh:0,mwh:0,supplyKwh:0,supplyMwh:0,supplyRatio:null,weight:recWeight,calcRec:0,issuedRec:0,estimatedRec:0,source:'데이터 없음',deadline:recDeadlineForMonth(month),price:null,priceDate:null,estimatedRevenue:null,cumulativeRec:null,cumulativeMonetized:null,cumulativeMonetizedAmount:null,remainingRec:null});
  const recSeries=buildRecSeries(start,end),recComparisons=periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:buildRecSeries(p.start,p.end)}));
  const estimatedRec=recSeries.reduce((a,r)=>a+Number(r.issuedRec??r.estimatedRec??0),0);
  const selectedSupplyKwh=recSeries.reduce((a,r)=>a+Number(r.supplyKwh||0),0);
  const latestMarket=currentMarketRow?{ok:true,source:recHistory?.source||'한국전력거래소 REC 현물시장 OpenAPI(15099762)',...currentMarketRow,fetchedAt:new Date().toISOString()}:(recHistory?.latest?{ok:true,source:recHistory.source,...recHistory.latest,fetchedAt:recHistory.fetchedAt}:{ok:false,source:recHistory?.source,message:recHistory?.message,fetchedAt:recHistory?.fetchedAt}),recPrice=latestMarket?.avg??latestMarket?.close??null,lastMonthly=monthlyRows.at(-1);
  const rec={weight:recWeight,supplyRatio:recSupplyRatio,selectedMwh:+selectedMwh.toFixed(3),selectedSupplyMwh:+(selectedSupplyKwh/1000).toFixed(3),estimatedRec:+estimatedRec.toFixed(3),carryBalance:+Number(recSeries.at(-1)?.carryOut||0).toFixed(3),estimatedRevenue:recPrice==null?null:Math.round(estimatedRec*recPrice),market:latestMarket,marketHistory:recHistory,series:recSeries,comparisons:recComparisons,recentMonths:monthlyRows,rpsIssuance:{files:rpsIssuance?.files||[],rows:rpsIssuance?.rows||[],rawRows:rpsIssuance?.rawRows||[],errors:rpsIssuance?.errors||[],latestMonth:rpsIssuance?.latestMonth||null,hasActual:(rpsIssuance?.rows||[]).length>0},ledger:{cumulativeRec:lifecycle.totalIssued,cumulativeMonetized:lifecycle.cumulativeMonetized,manualDisposed:lifecycle.manualDisposed,autoExpired:lifecycle.autoExpired,totalDisposed:lifecycle.totalDisposed,remainingRec:lifecycle.remainingRec,expiryScheduled:lifecycle.expiryScheduled,expiringSoon:lifecycle.expiringSoon,unknownExpiry:lifecycle.unknownExpiry,unconfirmed:lifecycle.unconfirmed,unallocatedMonetized:lifecycle.unallocatedMonetized,unallocatedDisposed:lifecycle.unallocatedDisposed,cumulativeMonetizedAmount:lifecycle.cumulativeMonetizedAmount,transactions:[...transactions].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt))),lots:[...lifecycle.lots].sort((a,b)=>String(a.expiryDate||'9999').localeCompare(String(b.expiryDate||'9999'))||String(a.month).localeCompare(String(b.month))).map(l=>({...l,status:expiryStatus(l,todayIso)})),issueDateLots:[...lifecycleLots].sort((a,b)=>String(b.month).localeCompare(String(a.month))).map(l=>({...l,status:expiryStatus({...l,remaining:l.qty,autoExpiredAllocated:0},todayIso)})),file:manualLedger.file?.name||'REC_수익화_수기입력.xlsx',fileModifiedTime:manualLedger.file?.modifiedTime||null,error:manualLedger.error||'',issueDateFile:issueDateOverrides.file?.name||'REC_발급일_수기입력.xlsx',issueDateFileModifiedTime:issueDateOverrides.file?.modifiedTime||null,issueDateError:issueDateOverrides.error||''},rule:'REC 산정 = RPS 인정 공급전력량(kWh) ÷ 1,000 × 가중치 → 소수점 4째 자리 이하 절사 → 전월 이월분 합산 → 정수 REC 발급, 소수부는 다음 달 이월',validityRule:'기본 발급일은 발전월 말일 + 90일로 계산하고, 그 발급일로부터 3년을 유효기간 만료일로 계산합니다. RPS 실제 발급일 또는 수기 수정값이 있으면 이를 우선하며, 만료된 미수익화 잔량은 자동 폐기로 계산합니다. 만료 6개월 이내 잔량은 폐기예정 REC로 별도 표시합니다.',priceRule:'REC 시세 라인은 각 월의 마지막 확인 가능한 현물시장 거래일 육지 평균가입니다. 금액 막대는 화면에서 선택한 현재가/특정일 기준가를 전체 발급량에 적용할 수 있습니다.',assumption:`RPS 발급내역 Excel이 있으면 실제 공급전력량/실제 발급량을 우선 사용합니다. 없으면 발전보고서 발전량의 ${Math.round(recSupplyRatio*100)}%를 공급전력량으로 추정합니다. 계산 REC는 소수점 셋째 자리까지 보유하고 넷째 자리 이하를 절사하며, 1 REC 미만 소수부는 다음 달 계산에 자동 이월합니다. 실제 RPS 발급실적이 있으면 실제 발급량이 최종 우선입니다.`};
  const annualSummary=buildAnnualSummary({summaryKey:summarySpec.key,rows,smpData,benchmark,cap1,cap2,baseMonthlyRows,recSupplyRatio,recWeight});
  const genYears=[...new Set(rows.map(r=>Number(String(r.ts||'').slice(0,4))).filter(y=>y>=2020&&y<=2100))].sort((a,b)=>b-a),summaryOptions=genYears.flatMap(y=>[{key:String(y),label:String(y)},{key:`${y}-season`,label:`${y}(계절)`}]);
  const maxIso=arr=>arr.filter(Boolean).sort().at(-1)||null,latestGenerationTs=maxIso(rows.map(r=>r.ts)),latestGenerationFile=maxIso(files.map(f=>f.modifiedTime)),latestSmpFile=maxIso((smpData.meta?.yearStatus||[]).map(x=>x.modifiedTime)),latestSmpKey=maxIso([...(smpData.hourly?.keys?.()||[])]),latestSmpMonth=maxIso([...(smpData.monthly?.keys?.()||[])]),recDateRaw=latestMarket?.date?String(latestMarket.date):'',recDataDate=/^\d{8}$/.test(recDateRaw)?`${recDateRaw.slice(0,4)}-${recDateRaw.slice(4,6)}-${recDateRaw.slice(6,8)}`:(recDateRaw||null);
  const updateMeta={generation:{dataDate:latestGenerationTs?String(latestGenerationTs).slice(0,10):null,fileModifiedAt:latestGenerationFile},smp:{dataDate:latestSmpKey?String(latestSmpKey).slice(0,10):(latestSmpMonth?`${latestSmpMonth}-01`:null),fileModifiedAt:latestSmpFile},rec:{dataDate:recDataDate,cacheUpdatedAt:recHistory?.cache?.updatedAt||recHistory?.cache?.fileModifiedTime||null},region:{period:benchmark?.nationalPeriod||benchmark?.period||benchmark?.year||null,checkedAt:benchmark?.fetchedAt||null}};
  return{syncedAt:new Date().toISOString(),updateMeta,fileCount:files.length,files:files.sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime))),errors,smpMeta:smpData.meta,capacities:{inv1:cap1,inv2:cap2,total:cap1+cap2},benchmark,annualSummary,summaryOptions,kpi:primary.kpi,series:primary.series,comparisons:periods.slice(1).map(p=>({offset:p.offset,label:`${p.offset}년 전`,start:p.start,end:p.end,series:p.series,kpi:p.kpi})),yearly,rec,links};
}
