'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import ReactECharts from 'echarts-for-react';

const nf=new Intl.NumberFormat('ko-KR');
async function readJsonResponse(response,label='요청'){
  const raw=await response.text();
  if(!raw)return{};
  try{return JSON.parse(raw)}catch{
    const excerpt=raw.replace(/\s+/g,' ').trim().slice(0,180);
    const status=response.status?` HTTP ${response.status}`:'';
    throw new Error(`${label} 서버 응답 오류${status}: ${excerpt||'빈 응답'}${raw.length>180?'…':''}`);
  }
}
async function fetchDashboardResponse(url,{signal}={}){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{cache:'no-store',signal});
      const json=await readJsonResponse(response,'대시보드');
      if(!response.ok)throw new Error(json?.error||json?.message||`데이터 조회 실패 (HTTP ${response.status})`);
      return json;
    }catch(e){
      if(e?.name==='AbortError')throw e;
      lastError=e;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  throw lastError||new Error('대시보드 데이터를 불러오지 못했습니다.');
}

const one=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const two=new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
const three=new Intl.NumberFormat('ko-KR',{minimumFractionDigits:3,maximumFractionDigits:3});
function localIso(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function presets(){const now=new Date(),dow=(now.getDay()+6)%7,monday=addDays(now,-dow),prevMon=addDays(monday,-7),prevSun=addDays(monday,-1),y=now.getFullYear(),m=now.getMonth();const q=Math.floor(m/3)*3,h=m<6?0:6;return{
  all:[new Date(2022,1,1),now],
  today:[now,now],
  yesterday:[addDays(now,-1),addDays(now,-1)],
  thisWeek:[monday,now],
  lastWeek:[prevMon,prevSun],
  thisMonth:[new Date(y,m,1),now],
  lastMonth:[new Date(y,m-1,1),new Date(y,m,0)],
  quarter:[new Date(y,q,1),now],
  half:[new Date(y,h,1),now],
  thisYear:[new Date(y,0,1),now],
  thisSeasonYear:[new Date(y,2,1),new Date(y+1,2,0)],
  lastYear:[new Date(y-1,0,1),new Date(y-1,11,31)],
  lastSeasonYear:[new Date(y-1,2,1),new Date(y,2,0)]
}}
const presetButtons=[['today','오늘'],['yesterday','전일'],['thisWeek','금주'],['lastWeek','전주'],['thisMonth','당월'],['lastMonth','전월'],['quarter','분기'],['half','반기'],['thisYear','당해'],['thisSeasonYear','당해(계절)'],['lastYear','전해'],['lastSeasonYear','전해(계절)'],['all','전체'],['custom','직접선택']];
const barMetricLabels={revenue:'수익',kwh:'발전량'};
const lineMetricLabels={smp:'SMP',efficiency:'설비이용률',generationHours:'발전시간',avgDailyGenerationHours:'일평균 등가시간'};
const inverterLabels={total:'합계',inv1:'인버터1',inv2:'인버터2',both:'인버터1+2'};
const grainLabels={hour:'시간',day:'일',month:'월',season:'계절',quarter:'분기',year:'년'};
const sectionNavItems=[['equipment-docs','설비 문서'],['overview','개요·설정'],['main-chart','발전 그래프'],['year-summary','한해 요약'],['project-analysis','KT 사업성'],['compare-summary','비교·계산'],['rec-section','REC'],['links-section','자료 링크'],['status-section','상태']];
const equipmentDocs=[
  {key:'application',title:'설비확인 신청서_JCPC.pdf',subtitle:'공급인증서 발급대상 설비확인 신청서',path:'/docs/equipment-confirmation-application-JCPC.pdf'},
  {key:'confirmation',title:'설비확인서_JCPC.pdf',subtitle:'공급인증서 발급대상 설비 확인서',path:'/docs/equipment-confirmation-JCPC.pdf'},
  {key:'kt-contract',title:'태양광 계약서_KT_진천피씨_2021.07.10.pdf',subtitle:'JCPC(진천피씨) ↔ KT 지역 에너지신산업 활성화 지원사업 계약서',path:'/docs/solar-contract-KT-JCPC-2021-07-10.pdf'}
];
const weekdayNames=['일','월','화','수','목','금','토'];
const annualMetricOptions=[['generation','발전량'],['revenue','수익'],['generationHours','등가 발전시간'],['efficiency','이용효율'],['avgDailyGenerationHours','일평균 등가시간'],['recQty','REC 발급량'],['recRevenue','REC 평가수익']];
const annualSumEligible=new Set(['generation','revenue','generationHours','recQty','recRevenue']);
const projectChartMetricLabels={generation:'발전량',revenue:'수익·단가',expense:'지출·원금·이자',cashflow:'현금흐름'};

function fmtDate(v){if(!v)return'-';const s=String(v);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}.${m[2]}.${m[3]}`:s}
function fmtDateTime(v){if(!v)return'-';try{return new Date(v).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}catch{return String(v)}}
function formatPeriodLabel(v,grain){
  const s=String(v||'');
  if(grain==='hour'){const m=s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);return m?`${m[1]}년 ${m[2]}월 ${m[3]}일 ${m[4]}시`:s}
  if(grain==='day'){const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m){const dt=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return `${m[1]}년 ${m[2]}월 ${m[3]}일 (${weekdayNames[dt.getDay()]})`}return s}
  if(grain==='month'){const m=s.match(/^(\d{4})-(\d{2})/);return m?`${m[1]}년 ${m[2]}월`:s}
  if(grain==='quarter'){const m=s.match(/^(\d{4})-Q([1-4])/);return m?`${m[1]}년 ${m[2]}분기`:s.replace(' Q','년 ')+'분기'}
  if(grain==='season'){const m=s.match(/^(\d{4})-S-(spring|summer|autumn|winter)$/);if(m){const names={spring:'봄',summer:'여름',autumn:'가을',winter:'겨울'};return `${m[1]}년 ${names[m[2]]}`}const m2=s.match(/^(\d{4})\s+(봄|여름|가을|겨울)$/);return m2?`${m2[1]}년 ${m2[2]}`:s}
  if(grain==='year'){const m=s.match(/^(\d{4})/);return m?`${m[1]}년`:s}
  return s;
}
function formatRecPeriodLabel(v,mode){const s=String(v||'');if(mode==='hour'){const m=s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);if(m){const dt=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return`${m[1]}.${m[2]}.${m[3]}(${weekdayNames[dt.getDay()]}) ${m[4]}시`}return s}if(mode==='day'){const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m){const dt=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));return`${m[1]}.${m[2]}.${m[3]}(${weekdayNames[dt.getDay()]})`}return s}if(mode==='year')return /^\d{4}$/.test(s)?`${s}년`:s;if(mode==='quarter'){const m=s.match(/^(\d{4}) Q([1-4])$/);return m?`${m[1]}년 ${m[2]}분기`:s}if(mode==='season'){const m=s.match(/^(\d{4}) (봄|여름|가을|겨울)$/);return m?`${m[1]}년 ${m[2]}`:s}const m=s.match(/^(\d{4})-(\d{2})$/);return m?`${m[1]}년 ${m[2]}월`:s}

function formatExtremaValue(v,name=''){
  const n=Number(v);if(!Number.isFinite(n))return'-';
  if(/수익|금액/.test(name))return`${nf.format(Math.round(n))}원`;
  if(/발전량/.test(name))return`${one.format(n)}kWh`;
  if(/REC 발급량/.test(name))return`${two.format(n)} REC`;
  if(/이용률/.test(name))return`${two.format(n)}%`;
  if(/일평균/.test(name))return`${two.format(n)}h/일`;
  if(/발전시간|등가시간/.test(name))return`${two.format(n)}h`;
  if(/SMP/.test(name))return`${two.format(n)}원/kWh`;
  if(/REC 평균가|REC 단가/.test(name))return`${nf.format(Math.round(n))}원/REC`;
  return nf.format(n);
}
function formatSummaryMetric(v,key){if(v==null||!Number.isFinite(Number(v)))return'-';const n=Number(v);if(key==='generation')return`${nf.format(Math.round(n))} kWh`;if(key==='revenue'||key==='recRevenue')return`${nf.format(Math.round(n))} 원`;if(key==='generationHours')return`${two.format(n)} h`;if(key==='efficiency')return`${two.format(n)} %`;if(key==='avgDailyGenerationHours')return`${two.format(n)} h/일`;if(key==='recQty')return`${two.format(n)} REC`;return nf.format(n)}
const EXTREMA_X_SYMBOL='path://M-8,-10 L10,8 L8,10 L-10,-8 Z M8,-10 L10,-8 L-8,10 L-10,8 Z';
function applyExtremaMarkers(series,x,showMax,showMin){
  if(!showMax&&!showMin)return series;
  return series.map(s=>{
    const pts=(Array.isArray(s.data)?s.data:[]).map((item,i)=>{const raw=item&&typeof item==='object'&&'value'in item?item.value:item;return{i,v:Number(raw)}}).filter(p=>Number.isFinite(p.v)&&p.v!==0);
    if(!pts.length)return s;
    const marks=[];
    if(showMax){const p=pts.reduce((a,b)=>b.v>a.v?b:a);marks.push({name:'최고점',coord:[p.i,p.v],value:p.v,period:x[p.i],seriesLabel:s.name,itemStyle:{color:'#dc2626'}})}
    if(showMin){const p=pts.reduce((a,b)=>b.v<a.v?b:a);marks.push({name:'최저점',coord:[p.i,p.v],value:p.v,period:x[p.i],seriesLabel:s.name,itemStyle:{color:'#2563eb'}})}
    return{...s,markPoint:{
      silent:false,
      symbol:EXTREMA_X_SYMBOL,
      symbolSize:18,
      label:{show:false},
      tooltip:{
        trigger:'item',
        confine:true,
        formatter:(p)=>{
          const d=p?.data||{};
          const title=d.name||p?.name||'';
          const seriesName=d.seriesLabel||s.name||'';
          const period=d.period||'';
          const value=d.value??p?.value;
          return `<b>${title}</b><br/>${seriesName}${period?`<br/>구간: ${period}`:''}<br/>값: ${formatExtremaValue(value,seriesName)}`;
        }
      },
      data:marks
    }};
  });
}
function recChartGrain(grain){return ['hour','day','month','season','quarter','year'].includes(grain)?grain:'month'}
function recPeriodKey(value,mode){const s=String(value||'');if(mode==='hour')return s.slice(0,16);if(mode==='day')return s.slice(0,10);const m=s.match(/^(\d{4})-(\d{2})/);if(!m)return s;const y=Number(m[1]),mo=Number(m[2]);if(mode==='year')return String(y);if(mode==='quarter')return`${y} Q${Math.floor((mo-1)/3)+1}`;if(mode==='season'){if(mo>=3&&mo<=5)return`${y} 봄`;if(mo>=6&&mo<=8)return`${y} 여름`;if(mo>=9&&mo<=11)return`${y} 가을`;if(mo===12)return`${y+1} 겨울`;return`${y} 겨울`}return`${y}-${String(mo).padStart(2,'0')}`}
function aggregateRecChartRows(rows,mode){
  const groups=new Map();
  for(const r of(Array.isArray(rows)?rows:[])){
    const key=recPeriodKey(r?.month,mode);
    if(!groups.has(key))groups.set(key,{period:key,estimatedRec:0,issuedRec:0,calcRec:0,kwh:0,supplyKwh:0,realizedQty:0,realizedAmount:0,valuationQty:0,forecastQty:0,priceSum:0,priceCount:0,priceDate:null,months:[]});
    const g=groups.get(key);g.estimatedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);g.issuedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);g.calcRec+=Number(r?.calcRec ?? r?.estimatedRec ?? 0);g.kwh+=Number(r?.kwh||0);g.supplyKwh+=Number(r?.supplyKwh||0);g.realizedQty+=Number(r?.realizedQty||0);g.realizedAmount+=Number(r?.realizedAmount||0);g.valuationQty+=Number(r?.valuationQty ?? r?.issuedRec ?? r?.estimatedRec ?? 0);g.forecastQty+=Number(r?.forecastQty||0);g.months.push(r?.month||'');
    if(r?.price!=null&&Number.isFinite(Number(r.price))){g.priceSum+=Number(r.price);g.priceCount++}
    if(r?.priceDate&&(!g.priceDate||String(r.priceDate)>String(g.priceDate)))g.priceDate=r.priceDate;
  }
  return[...groups.values()].map(g=>({period:g.period,estimatedRec:+g.estimatedRec.toFixed(3),issuedRec:+g.issuedRec.toFixed(3),calcRec:+g.calcRec.toFixed(3),kwh:+g.kwh.toFixed(1),supplyKwh:+g.supplyKwh.toFixed(1),realizedQty:+g.realizedQty.toFixed(3),realizedAmount:Math.round(g.realizedAmount),valuationQty:+g.valuationQty.toFixed(3),forecastQty:+g.forecastQty.toFixed(3),price:g.priceCount?Math.round(g.priceSum/g.priceCount):null,priceDate:g.priceDate,sourcePeriod:g.period,months:g.months}));
}
function aggregateRecTableRows(rows,mode){
  const groups=new Map();
  for(const r of(Array.isArray(rows)?rows:[])){
    const key=recPeriodKey(r?.month,mode);
    if(!groups.has(key))groups.set(key,{period:key,kwh:0,supplyKwh:0,calcRec:0,issuedRec:0,realizedQty:0,realizedAmount:0,valuationQty:0,forecastQty:0,estimatedRevenue:0,revenueKnown:false,priceSum:0,priceCount:0,priceDate:null,sources:new Set(),first:null,last:null});
    const g=groups.get(key);g.kwh+=Number(r?.kwh||0);g.supplyKwh+=Number(r?.supplyKwh||0);g.calcRec+=Number(r?.calcRec ?? 0);g.issuedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);g.realizedQty+=Number(r?.realizedQty||0);g.realizedAmount+=Number(r?.realizedAmount||0);g.valuationQty+=Number(r?.valuationQty ?? r?.issuedRec ?? r?.estimatedRec ?? 0);g.forecastQty+=Number(r?.forecastQty||0);if(r?.estimatedRevenue!=null){g.estimatedRevenue+=Number(r.estimatedRevenue);g.revenueKnown=true}if(r?.price!=null&&Number.isFinite(Number(r.price))){g.priceSum+=Number(r.price);g.priceCount++}if(r?.priceDate&&(!g.priceDate||String(r.priceDate)>String(g.priceDate)))g.priceDate=r.priceDate;if(r?.source)g.sources.add(r.source);if(!g.first||String(r.month)<String(g.first.month))g.first=r;if(!g.last||String(r.month)>String(g.last.month))g.last=r;
  }
  return[...groups.values()].map(g=>{const first=g.first||{},last=g.last||{};const ratio=g.kwh>0?g.supplyKwh/g.kwh:null;return{period:g.period,month:g.period,kwh:+g.kwh.toFixed(1),supplyKwh:+g.supplyKwh.toFixed(1),supplyRatio:ratio==null?null:+ratio.toFixed(4),weight:last.weight??1.5,calcRec:+g.calcRec.toFixed(3),carryIn:first.carryIn==null?null:+Number(first.carryIn).toFixed(3),carryOut:last.carryOut==null?null:+Number(last.carryOut).toFixed(3),issuedRec:+g.issuedRec.toFixed(3),estimatedRec:+g.issuedRec.toFixed(3),realizedQty:+g.realizedQty.toFixed(3),realizedAmount:Math.round(g.realizedAmount),valuationQty:+g.valuationQty.toFixed(3),forecastQty:+g.forecastQty.toFixed(3),source:g.sources.size===1?[...g.sources][0]:g.sources.size>1?'혼합':'-',price:g.priceCount?Math.round(g.priceSum/g.priceCount):null,priceDate:g.priceDate,estimatedRevenue:g.revenueKnown?Math.round(g.estimatedRevenue):null,cumulativeRec:last.cumulativeRec??null,cumulativeMonetized:last.cumulativeMonetized??null,cumulativeMonetizedAmount:last.cumulativeMonetizedAmount??null,cumulativeDisposed:last.cumulativeDisposed??null,remainingRec:last.remainingRec??null,lifecycleRemaining:mode==='month'?last.lifecycleRemaining:null,issueDate:mode==='month'?last.issueDate:null,issueDateSource:mode==='month'?last.issueDateSource:null,expiryDate:mode==='month'?last.expiryDate:null,expiryStatus:mode==='month'?last.expiryStatus:null,expiryStatusCode:mode==='month'?last.expiryStatusCode:null,deadline:mode==='month'?last.deadline:null};});
}

function buildFineRecRows(generationRows,monthlyRows,mode,recSupplyRatio=0.5){
  if(!['hour','day'].includes(mode))return null;
  const monthlyMap=new Map((monthlyRows||[]).map(r=>[String(r.month||r.period||'').slice(0,7),r]));
  const configuredRatio=Number(recSupplyRatio),ratio=Number.isFinite(configuredRatio)&&configuredRatio>=0?configuredRatio:0.5;
  return(generationRows||[]).map(g=>{
    const raw=String(g?.actual||''),period=mode==='hour'?raw.slice(0,16):raw.slice(0,10),sourceMonth=raw.slice(0,7),m=monthlyMap.get(sourceMonth)||{},kwh=Number(g?.kwh||0),weight=Number(m.weight||1.5),supplyKwh=kwh*ratio,calcRec=Math.trunc((supplyKwh/1000*weight+1e-10)*1000)/1000;
    return{...m,period,month:period,sourceMonth,fineGrain:true,kwh:+kwh.toFixed(3),supplyKwh:+supplyKwh.toFixed(3),supplyRatio:ratio,weight,calcRec:+calcRec.toFixed(3),issuedRec:+calcRec.toFixed(3),estimatedRec:+calcRec.toFixed(3),realizedQty:0,realizedAmount:0,valuationQty:+calcRec.toFixed(3),forecastQty:+calcRec.toFixed(3),estimatedRevenue:m.price==null?null:Math.round(calcRec*Number(m.price)),source:`${mode==='hour'?'시간':'일'} 추정 ${Math.round(ratio*100)}%`,carryIn:null,carryOut:null,issueDate:null,expiryDate:null,expiryStatus:'월 발급 전 추정',expiryStatusCode:'unknown',deadline:null};
  });
}

export default function Dashboard(){
  const [grain,setGrain]=useState('day');
  const [barMetric,setBarMetric]=useState('kwh');
  const [lineMetric,setLineMetric]=useState('smp');
  const [inverterMode,setInverterMode]=useState('total');
  const [periodPreset,setPeriodPreset]=useState('thisWeek');
  const p0=presets().thisWeek;
  const [start,setStart]=useState(localIso(p0[0]));
  const [end,setEnd]=useState(localIso(p0[1]));
  const [compare,setCompare]=useState([]);
  const [showRegion,setShowRegion]=useState(true);
  const [benchmarkBarMetric,setBenchmarkBarMetric]=useState('off');
  const [selectedRegions,setSelectedRegions]=useState(['충북']);
  const [summaryKey,setSummaryKey]=useState(String(new Date().getFullYear()));
  const [annualMonthFocus,setAnnualMonthFocus]=useState('average');
  const [annualDetailEntityKey,setAnnualDetailEntityKey]=useState('current');
  const [annualDetailMetric,setAnnualDetailMetric]=useState('generation');
  const [annualDetailMode,setAnnualDetailMode]=useState('sum');
  const [showMaxPoint,setShowMaxPoint]=useState(false);
  const [showMinPoint,setShowMinPoint]=useState(false);
  const [cap1,setCap1]=useState('99.5');
  const [cap2,setCap2]=useState('99.5');
  const [recVisible,setRecVisible]=useState(10);
  const [recSupplyRatioPct,setRecSupplyRatioPct]=useState('50');
  const [recBarMetric,setRecBarMetric]=useState('issuance');
  const [recPriceMode,setRecPriceMode]=useState('current');
  const [recPriceDate,setRecPriceDate]=useState(localIso());
  const [recManualPrice,setRecManualPrice]=useState('');
  const [recVatMode,setRecVatMode]=useState('net');
  const [recPriceAxisMode,setRecPriceAxisMode]=useState('auto');
  const [recPriceAxisMin,setRecPriceAxisMin]=useState('');
  const [recPriceAxisMax,setRecPriceAxisMax]=useState('');
  const [recPriceLookup,setRecPriceLookup]=useState(null);
  const [recPriceLoading,setRecPriceLoading]=useState(false);
  const [recTxnForm,setRecTxnForm]=useState({id:'',type:'monetized',date:localIso(),qty:'',amount:'',note:''});
  const [recTxnSaving,setRecTxnSaving]=useState(false);
  const [recTxnMessage,setRecTxnMessage]=useState('');
  const [recIssueForm,setRecIssueForm]=useState({month:'',issueDate:'',note:''});
  const [recIssueSaving,setRecIssueSaving]=useState(false);
  const [recIssueMessage,setRecIssueMessage]=useState('');
  const [projectChartGrain,setProjectChartGrain]=useState('year');
  const [projectChartMetric,setProjectChartMetric]=useState('revenue');
  const [projectChartView,setProjectChartView]=useState('both');
  const [projectChartStart,setProjectChartStart]=useState('');
  const [projectChartEnd,setProjectChartEnd]=useState('');
  const [projectDiscountRatePct,setProjectDiscountRatePct]=useState('5');
  const [maintenanceForm,setMaintenanceForm]=useState({id:'',date:localIso(),amount:'',category:'유지보수',vendor:'',note:''});
  const [maintenanceSaving,setMaintenanceSaving]=useState(false);
  const [maintenanceMessage,setMaintenanceMessage]=useState('');
  const [docModal,setDocModal]=useState(null);
  const [docCopyMessage,setDocCopyMessage]=useState('');
  const [lifecyclePopup,setLifecyclePopup]=useState(null);
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[diag,setDiag]=useState(null),[diagLoading,setDiagLoading]=useState(false);
  const chartRef=useRef(null);
  const dashboardRequestCacheRef=useRef(new Map());
  const dashboardAbortRef=useRef(null);
  const dashboardLoadSeqRef=useRef(0);
  const recChartRef=useRef(null);
  const projectChartRef=useRef(null);
  const regionPickerRef=useRef(null);

  useEffect(()=>{
    try{
      const a=localStorage.getItem('solar_inv1_kw');
      const b=localStorage.getItem('solar_inv2_kw');
      if(a!==null)setCap1(a);else setCap1(process.env.NEXT_PUBLIC_INVERTER1_KW||'99.5');
      if(b!==null)setCap2(b);else setCap2(process.env.NEXT_PUBLIC_INVERTER2_KW||'99.5');
    }catch{}
  },[]);
  useEffect(()=>{try{const r=localStorage.getItem('solar_rec_supply_ratio_pct');if(r!==null)setRecSupplyRatioPct(r)}catch{}},[]);
  useEffect(()=>{try{const v=localStorage.getItem('solar_rec_manual_price');if(v!==null)setRecManualPrice(v);const m=localStorage.getItem('solar_rec_vat_mode');if(m==='gross'||m==='net')setRecVatMode(m)}catch{}},[]);
  useEffect(()=>{try{const raw=localStorage.getItem('solar_selected_regions');if(raw){const a=JSON.parse(raw);if(Array.isArray(a)&&a.length)setSelectedRegions(a)}}catch{}},[]);
  useEffect(()=>{try{const v=localStorage.getItem('solar_project_discount_rate_pct');if(v!==null&&v!=='')setProjectDiscountRatePct(v)}catch{}},[]);
  useEffect(()=>{
    try{
      const mode=localStorage.getItem('solar_rec_axis_mode');
      const mn=localStorage.getItem('solar_rec_axis_min');
      const mx=localStorage.getItem('solar_rec_axis_max');
      if(mode==='manual'||mode==='auto')setRecPriceAxisMode(mode);
      if(mn!==null)setRecPriceAxisMin(mn);
      if(mx!==null)setRecPriceAxisMax(mx);
    }catch{}
  },[]);
  useEffect(()=>{setRecVisible(10)},[start,end,compare,grain]);
  useEffect(()=>{
    if(recPriceMode!=='date'){setRecPriceLookup(null);return}
    let cancelled=false;setRecPriceLoading(true);
    fetch(`/api/rec-price?date=${encodeURIComponent(recPriceDate)}&ts=${Date.now()}`,{cache:'no-store'}).then(async r=>{const j=await readJsonResponse(r,'REC 시세');if(!cancelled)setRecPriceLookup(j)}).catch(e=>{if(!cancelled)setRecPriceLookup({ok:false,message:e.message||String(e)})}).finally(()=>{if(!cancelled)setRecPriceLoading(false)});
    return()=>{cancelled=true};
  },[recPriceMode,recPriceDate]);
  useEffect(()=>{
    if(!docModal&&!lifecyclePopup)return;
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onKeyDown=e=>{if(e.key==='Escape'){setDocModal(null);setLifecyclePopup(null)}};
    window.addEventListener('keydown',onKeyDown);
    return()=>{document.body.style.overflow=prevOverflow;window.removeEventListener('keydown',onKeyDown)};
  },[docModal,lifecyclePopup]);
  const openEquipmentDoc=doc=>{setDocModal(doc);setDocCopyMessage('')};
  const copyEquipmentDocLink=async doc=>{
    const url=typeof window!=='undefined'?new URL(doc.path,window.location.origin).href:doc.path;
    try{await navigator.clipboard.writeText(url);setDocCopyMessage(`${doc.title} 링크를 복사했습니다.`)}
    catch{if(typeof window!=='undefined')window.prompt('아래 링크를 복사하세요.',url)}
  };

  const saveCapacity=(which,value)=>{
    const cleaned=value.replace(/[^0-9.]/g,'');
    if(which===1){setCap1(cleaned);try{localStorage.setItem('solar_inv1_kw',cleaned)}catch{}}
    else{setCap2(cleaned);try{localStorage.setItem('solar_inv2_kw',cleaned)}catch{}}
  };
  const c1=Number(cap1)||0,c2=Number(cap2)||0,totalCap=c1+c2;
  const recSupplyRatio=Math.max(0,(Number(recSupplyRatioPct)||0)/100);
  const saveRecSupplyRatio=(v)=>{const c=v.replace(/[^0-9.]/g,'');setRecSupplyRatioPct(c);try{localStorage.setItem('solar_rec_supply_ratio_pct',c)}catch{}};
  const applyPreset=(k)=>{setPeriodPreset(k);if(k==='custom')return;if(k==='all'&&data?.generationRange?.start){setStart(data.generationRange.start);setEnd(data.generationRange.end||localIso());return}const p=presets()[k];setStart(localIso(p[0]));setEnd(localIso(p[1]));};
  const load=useCallback(async(forceRefresh=false)=>{
    const discountRate=Math.max(0,Number(projectDiscountRatePct)||0)/100;
    const recApiPrice=recPriceMode==='manual'?Number(recManualPrice):(recPriceMode==='date'&&recPriceLookup?.ok?Number(recPriceLookup.avg??recPriceLookup.close??0):0);const baseParams={grain,start,end,compare:compare.join(','),cap1:String(c1),cap2:String(c2),recSupplyRatio:String(recSupplyRatio),summaryKey,discountRate:String(discountRate),...(Number.isFinite(recApiPrice)&&recApiPrice>0?{recValuationPriceOverride:String(recApiPrice)}:{})};
    const cacheKey=new URLSearchParams(baseParams).toString();
    if(!forceRefresh&&dashboardRequestCacheRef.current.has(cacheKey)){
      setData(dashboardRequestCacheRef.current.get(cacheKey));setError('');setLoading(false);return;
    }
    dashboardAbortRef.current?.abort();
    const controller=new AbortController();dashboardAbortRef.current=controller;
    const seq=++dashboardLoadSeqRef.current;
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({...baseParams,ts:String(Date.now()),forceSmp:forceRefresh?'1':'0'});
      const j=await fetchDashboardResponse(`/api/dashboard?${q}`,{signal:controller.signal});
      if(seq!==dashboardLoadSeqRef.current)return;
      dashboardRequestCacheRef.current.set(cacheKey,j);
      while(dashboardRequestCacheRef.current.size>12)dashboardRequestCacheRef.current.delete(dashboardRequestCacheRef.current.keys().next().value);
      if(forceRefresh){const keep=j;dashboardRequestCacheRef.current.clear();dashboardRequestCacheRef.current.set(cacheKey,keep)}
      setData(j);
    }catch(e){if(e?.name!=='AbortError'&&seq===dashboardLoadSeqRef.current)setError(e.message||String(e))}finally{if(seq===dashboardLoadSeqRef.current)setLoading(false)}
  },[grain,start,end,compare,c1,c2,recSupplyRatio,summaryKey,projectDiscountRatePct,recPriceMode,recManualPrice,recPriceLookup?.ok,recPriceLookup?.avg,recPriceLookup?.close]);
  useEffect(()=>{const timer=setTimeout(()=>load(false),180);return()=>clearTimeout(timer)},[load]);
  useEffect(()=>()=>dashboardAbortRef.current?.abort(),[]);
  const runDiagnostics=useCallback(async()=>{setDiagLoading(true);try{const r=await fetch(`/api/diagnostics?ts=${Date.now()}`,{cache:'no-store'});setDiag(await readJsonResponse(r,'진단'))}catch(e){setDiag({error:e.message||String(e)})}finally{setDiagLoading(false)}},[]);
  const saveRecTransaction=useCallback(async()=>{
    setRecTxnSaving(true);setRecTxnMessage('');
    try{
      const body={id:recTxnForm.id||'',type:recTxnForm.type||'monetized',date:recTxnForm.date,qty:Number(recTxnForm.qty)||0,amount:recTxnForm.type==='monetized'?(Number(String(recTxnForm.amount||'').replace(/,/g,''))||0):0,note:recTxnForm.note||''};
      const r=await fetch('/api/rec-manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await readJsonResponse(r,'REC 저장');if(!r.ok)throw new Error(j.message||'저장 실패');
      setRecTxnMessage(recTxnForm.id?'수정되었습니다.':'저장되었습니다.');
      setRecTxnForm({id:'',type:'monetized',date:localIso(),qty:'',amount:'',note:''});
      dashboardRequestCacheRef.current.clear();await load(false);
    }catch(e){setRecTxnMessage(e.message||String(e))}finally{setRecTxnSaving(false)}
  },[recTxnForm,load]);
  const editRecTransaction=useCallback((t)=>{setRecTxnForm({id:t.id||'',type:t.type==='issued'?'issued':t.type==='disposed'?'disposed':'monetized',date:t.date||localIso(),qty:String(t.qty??t.issuedQty??t.monetizedQty??t.disposedQty??''),amount:t.type==='monetized'?String(t.amount??t.monetizedAmount??''):'',note:t.note||''});setRecTxnMessage('');},[]);
  const cancelRecTransactionEdit=useCallback(()=>{setRecTxnForm({id:'',type:'monetized',date:localIso(),qty:'',amount:'',note:''});setRecTxnMessage('');},[]);
  const deleteRecTransaction=useCallback(async(t)=>{if(!t?.id)return;if(typeof window!=='undefined'&&!window.confirm(`${t.type==='issued'?'발급':t.type==='disposed'?'폐기':'수익화'} ${two.format(Number(t.qty??t.issuedQty??t.monetizedQty??t.disposedQty??0))} REC 내역을 삭제하시겠습니까?`))return;setRecTxnSaving(true);setRecTxnMessage('');try{const r=await fetch('/api/rec-manual',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:t.id})});const j=await readJsonResponse(r,'REC 삭제');if(!r.ok)throw new Error(j.message||'삭제 실패');if(recTxnForm.id===t.id)setRecTxnForm({id:'',type:'monetized',date:localIso(),qty:'',amount:'',note:''});setRecTxnMessage('삭제되었습니다.');dashboardRequestCacheRef.current.clear();await load(false)}catch(e){setRecTxnMessage(e.message||String(e))}finally{setRecTxnSaving(false)}},[load,recTxnForm.id]);
  const saveRecIssueDate=useCallback(async()=>{
    setRecIssueSaving(true);setRecIssueMessage('');
    try{
      const r=await fetch('/api/rec-issue-date',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recIssueForm)});
      const j=await readJsonResponse(r,'REC 발급일 저장');if(!r.ok)throw new Error(j.message||'발급일 저장 실패');
      setRecIssueMessage('발급일 수정값이 저장되었습니다.');
      dashboardRequestCacheRef.current.clear();await load(false);
    }catch(e){setRecIssueMessage(e.message||String(e))}finally{setRecIssueSaving(false)}
  },[recIssueForm,load]);
  const editRecIssueDate=useCallback((lot)=>{setRecIssueForm({month:lot.month||'',issueDate:lot.issueDate||'',note:''});setRecIssueMessage('');},[]);
  const saveMaintenance=useCallback(async()=>{setMaintenanceSaving(true);setMaintenanceMessage('');try{const body={...maintenanceForm,amount:Number(String(maintenanceForm.amount||'').replace(/,/g,''))||0};const r=await fetch('/api/project-maintenance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await readJsonResponse(r,'유지보수비 저장');if(!r.ok)throw new Error(j.message||'유지보수비 저장 실패');setMaintenanceMessage(maintenanceForm.id?'수정되었습니다.':'저장되었습니다.');setMaintenanceForm({id:'',date:localIso(),amount:'',category:'유지보수',vendor:'',note:''});await load(false)}catch(e){setMaintenanceMessage(e.message||String(e))}finally{setMaintenanceSaving(false)}},[maintenanceForm,load]);
  const editMaintenance=useCallback((x)=>{setMaintenanceForm({id:x.id||'',date:x.date||localIso(),amount:String(x.amount||''),category:x.category||'유지보수',vendor:x.vendor||'',note:x.note||''});setMaintenanceMessage('')},[]);
  const cancelMaintenanceEdit=useCallback(()=>{setMaintenanceForm({id:'',date:localIso(),amount:'',category:'유지보수',vendor:'',note:''});setMaintenanceMessage('')},[]);

  const option=useMemo(()=>{
    const base=Array.isArray(data?.series)?data.series:[];
    const x=base.map(r=>formatPeriodLabel(r?.actual,grain));
    if(x.length===0)return{animation:false,title:{text:loading?'데이터 불러오는 중…':'표시할 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},grid:{left:70,right:70,top:35,bottom:45,containLabel:true},xAxis:{type:'category',data:[]},yAxis:[{type:'value'}],series:[]};
    const series=[];
    const barKey=mode=>barMetric==='kwh'?(mode==='inv1'?'inv1Kwh':mode==='inv2'?'inv2Kwh':'kwh'):(mode==='inv1'?'revenue1':mode==='inv2'?'revenue2':'revenue');
    const lineKey=mode=>lineMetric==='efficiency'?(mode==='inv1'?'efficiency1':mode==='inv2'?'efficiency2':'efficiency'):(lineMetric==='generationHours'?(mode==='inv1'?'generationHours1':mode==='inv2'?'generationHours2':'generationHours'):(lineMetric==='avgDailyGenerationHours'?(mode==='inv1'?'avgDailyGenerationHours1':mode==='inv2'?'avgDailyGenerationHours2':'avgDailyGenerationHours'):'smp'));
    const addRows=(rows,labelPrefix,isCompare=false)=>{
      const lineStyle=isCompare?{type:'dashed'}:undefined;
      if(inverterMode==='both'){
        const b1=barMetric==='kwh'?'inv1Kwh':'revenue1', b2=barMetric==='kwh'?'inv2Kwh':'revenue2';
        series.push({name:`${labelPrefix} 인버터1 ${barMetricLabels[barMetric]}`,type:'bar',data:rows.map(r=>Number(r?.[b1]||0)),yAxisIndex:0,barMaxWidth:28});
        series.push({name:`${labelPrefix} 인버터2 ${barMetricLabels[barMetric]}`,type:'bar',data:rows.map(r=>Number(r?.[b2]||0)),yAxisIndex:0,barMaxWidth:28});
        if(lineMetric!=='smp'){
          const l1=lineKey('inv1'),l2=lineKey('inv2');
          series.push({name:`${labelPrefix} 인버터1 ${lineMetricLabels[lineMetric]}`,type:'line',data:rows.map(r=>r?.[l1]==null?null:Number(r[l1])),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
          series.push({name:`${labelPrefix} 인버터2 ${lineMetricLabels[lineMetric]}`,type:'line',data:rows.map(r=>r?.[l2]==null?null:Number(r[l2])),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
        }else{
          series.push({name:`${labelPrefix} 육지 SMP`,type:'line',data:rows.map(r=>r?.smp==null?null:Number(r.smp)),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
        }
      }else{
        const bk=barKey(inverterMode), lk=lineKey(inverterMode);
        series.push({name:`${labelPrefix} ${inverterLabels[inverterMode]} ${barMetricLabels[barMetric]}`,type:'bar',data:rows.map(r=>Number(r?.[bk]||0)),yAxisIndex:0,barMaxWidth:42});
        series.push({name:`${labelPrefix} ${lineMetric==='smp'?'육지 SMP':`${inverterLabels[inverterMode]} ${lineMetricLabels[lineMetric]}`}`,type:'line',data:rows.map(r=>r?.[lk]==null?null:Number(r[lk])),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
      }
    };
    addRows(base,'현재',false);
    for(const c of(Array.isArray(data?.comparisons)?data.comparisons:[])){
      const rows=Array.isArray(c?.series)?c.series:[];
      const map=new Map(rows.map(r=>[String(r.alignedActual??r.actual??''),r]));
      addRows(base.map(b=>map.get(String(b?.actual??''))||{}),c.label,true);
    }
    if(showRegion){
      if(lineMetric==='smp'){
        if(selectedRegions.includes('제주'))series.push({name:'제주 SMP',type:'line',data:base.map(r=>r?.jejuSmp==null?null:Number(r.jejuSmp)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dashed',width:2.3}});
      }else{
        const metricField=lineMetric==='efficiency'?'efficiency':lineMetric==='generationHours'?'generationHours':lineMetric==='avgDailyGenerationHours'?'avgDailyGenerationHours':null;
        if(metricField){for(const name of selectedRegions){series.push({name:`${name} 평균 ${lineMetricLabels[lineMetric]}`,type:'line',data:base.map(r=>r?.regions?.[name]?.[metricField]==null?null:Number(r.regions[name][metricField])),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dashed',width:2.1}})}const nationalField=metricField==='efficiency'?'nationalEfficiency':metricField==='generationHours'?'nationalGenerationHours':'nationalAvgDailyGenerationHours';series.push({name:`전국 평균 ${lineMetricLabels[lineMetric]}`,type:'line',data:base.map(r=>r?.[nationalField]==null?null:Number(r[nationalField])),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dotted',width:2.3}})}
      }
    }
    if(benchmarkBarMetric!=='off'){
      const cap=inverterMode==='inv1'?c1:inverterMode==='inv2'?c2:totalCap;
      const benchmarkValue=(r,hours,regionName)=>{if(!(cap>0)||hours==null)return null;const kwh=Number(hours)*cap;if(!Number.isFinite(kwh))return null;if(benchmarkBarMetric==='revenue'){const smp=Number(regionName==='제주'?r?.jejuSmp:r?.smp);return Number.isFinite(smp)?Math.round(kwh*smp):null}return Math.round(kwh)};
      const suffix=benchmarkBarMetric==='revenue'?'평균 수익':'평균 발전량';
      for(const name of selectedRegions){series.push({name:`${name} ${suffix}`,type:'bar',data:base.map(r=>benchmarkValue(r,r?.regions?.[name]?.generationHours,name)),yAxisIndex:0,barMaxWidth:28,barGap:'8%'})}
      series.push({name:`전국 ${suffix}`,type:'bar',data:base.map(r=>benchmarkValue(r,r?.nationalGenerationHours,'전국')),yAxisIndex:0,barMaxWidth:28,barGap:'8%'});
    }
    const zoom=x.length>2?[{type:'inside',xAxisIndex:0,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true,moveOnMouseWheel:false,preventDefaultMouseMove:true},{type:'slider',xAxisIndex:0,bottom:10,height:22,filterMode:'none',showDetail:false}]:[];
    const rightAxis=lineMetric==='efficiency'
      ?{type:'value',name:'설비이용률(%)',position:'right',min:0,nameGap:14,axisLabel:{formatter:v=>`${v}%`,margin:12}}
      :lineMetric==='generationHours'
        ?{type:'value',name:'발전시간(h)',position:'right',min:0,nameGap:14,axisLabel:{formatter:v=>`${Number(v).toFixed(1)}h`,margin:12}}
        :lineMetric==='avgDailyGenerationHours'
          ?{type:'value',name:'일평균 등가시간(h/일)',position:'right',min:0,nameGap:14,axisLabel:{formatter:v=>`${Number(v).toFixed(1)}h`,margin:12}}
          :{type:'value',name:'SMP(원/kWh)',position:'right',nameGap:14,axisLabel:{formatter:v=>Number(v).toFixed(0),margin:12}};
    const yAxis=[
      {type:'value',name:barMetric==='revenue'?'수익(원)':'발전량(kWh)',nameGap:14,axisLabel:{formatter:v=>nf.format(v),margin:12}},
      rightAxis
    ];
    const markedSeries=applyExtremaMarkers(series,x,showMaxPoint,showMinPoint);
    return{animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:18,right:24,top:48,bottom:zoom.length?74:46,containLabel:true},tooltip:{trigger:'axis',confine:true,formatter:(items)=>{const arr=Array.isArray(items)?items:[];const idx=arr[0]?.dataIndex??0;const lines=[`<b>${x[idx]||''}</b>`];for(const it of arr){const raw=it?.data?.value??it?.value;lines.push(`${it.marker} ${it.seriesName}: ${raw==null?'-':formatExtremaValue(raw,it.seriesName)}`)}return lines.join('<br/>')}},xAxis:{type:'category',data:x,boundaryGap:true,axisLabel:{hideOverlap:true,margin:10}},yAxis,dataZoom:zoom,series:markedSeries};
  },[data,barMetric,lineMetric,inverterMode,showRegion,benchmarkBarMetric,selectedRegions,showMaxPoint,showMinPoint,loading,c1,c2,totalCap]);
  const chartKey=useMemo(()=>`${grain}-${barMetric}-${lineMetric}-${inverterMode}-${benchmarkBarMetric}-${selectedRegions.join('-')}-${start}-${end}-${compare.join('-')}-${c1}-${c2}-${data?.series?.length||0}`,[grain,barMetric,lineMetric,inverterMode,benchmarkBarMetric,selectedRegions,start,end,compare,c1,c2,data?.series?.length]);
  const recDisplayMode=recChartGrain(grain);
  const recDisplayRows=useMemo(()=>buildFineRecRows(data?.series||[],data?.rec?.series||[],recDisplayMode,recSupplyRatio)||(data?.rec?.series||[]),[data?.series,data?.rec?.series,recDisplayMode,recSupplyRatio]);
  const recDisplayComparisons=useMemo(()=>{const recComps=data?.rec?.comparisons||[],genComps=data?.comparisons||[];return recComps.map(rc=>{const gc=genComps.find(x=>Number(x.offset)===Number(rc.offset));return{...rc,series:buildFineRecRows(gc?.series||[],rc?.series||[],recDisplayMode,recSupplyRatio)||(rc?.series||[])}})},[data?.rec?.comparisons,data?.comparisons,recDisplayMode,recSupplyRatio]);
  const recCurrentPrice=data?.rec?.market?.ok?(data.rec.market.avg??data.rec.market.close??null):(data?.rec?.valuationPrice??null);
  const recValuationPrice=recPriceMode==='manual'?(Number(recManualPrice)>0?Number(recManualPrice):null):(recPriceMode==='date'?(recPriceLookup?.ok?(recPriceLookup.avg??recPriceLookup.close??null):null):recCurrentPrice);
  const recValuationDate=recPriceMode==='manual'?'직접입력':(recPriceMode==='date'?(recPriceLookup?.actualDate||recPriceDate):(data?.rec?.market?.date||null));
  const recVatFactor=recVatMode==='gross'?1.1:1;
  const recMoney=(v)=>v==null?null:Math.round(Number(v)*recVatFactor);
  const recUnitPrice=(v)=>v==null?null:Math.round(Number(v)*recVatFactor);
  const saveRecManualPrice=v=>{const c=String(v).replace(/[^0-9]/g,'');setRecManualPrice(c);try{localStorage.setItem('solar_rec_manual_price',c)}catch{}};
  const saveRecVatMode=v=>{setRecVatMode(v);try{localStorage.setItem('solar_rec_vat_mode',v)}catch{}};
  const recAutoPriceAxis=useMemo(()=>{
    const mode=recChartGrain(grain);
    const all=[];
    const collect=(rows)=>{for(const r of aggregateRecChartRows(Array.isArray(rows)?rows:[],mode)){const v=Number(r?.price);if(Number.isFinite(v)&&v>0)all.push(v*recVatFactor)}};
    collect(recDisplayRows);
    for(const c of recDisplayComparisons)collect(c?.series||[]);
    if(recValuationPrice!=null&&Number(recValuationPrice)>0)all.push(Number(recValuationPrice)*recVatFactor);
    if(!all.length)return{min:null,max:null,dataMin:null,dataMax:null};
    const dataMin=Math.min(...all),dataMax=Math.max(...all);
    // 자동축: 실제 최저/최고 단가를 먼저 1,000원 단위로 절사한 뒤
    // 최저축은 1,000원 더 낮게, 최고축은 1,000원 더 높게 잡는다.
    // 예) 68,450 -> 68,000 -> 67,000 / 71,800 -> 71,000 -> 72,000
    const minBase=Math.floor(dataMin/1000)*1000;
    const maxBase=Math.floor(dataMax/1000)*1000;
    let min=Math.max(0,minBase-1000);
    let max=maxBase+1000;
    if(max<=min)max=min+1000;
    return{min,max,dataMin,dataMax};
  },[recDisplayRows,recDisplayComparisons,grain,recVatFactor,recValuationPrice]);
  const recManualAxisValid=useMemo(()=>{
    if(String(recPriceAxisMin).trim()===''||String(recPriceAxisMax).trim()==='')return false;
    const mn=Number(recPriceAxisMin),mx=Number(recPriceAxisMax);
    return Number.isFinite(mn)&&Number.isFinite(mx)&&mn>=0&&mx>mn;
  },[recPriceAxisMin,recPriceAxisMax]);
  const recPriceAxisBounds=recPriceAxisMode==='manual'&&recManualAxisValid
    ?{min:Number(recPriceAxisMin),max:Number(recPriceAxisMax),manual:true}
    :{...recAutoPriceAxis,manual:false};
  const saveRecAxisMode=(v)=>{setRecPriceAxisMode(v);try{localStorage.setItem('solar_rec_axis_mode',v)}catch{}};
  const saveRecAxisValue=(which,v)=>{const c=String(v).replace(/[^0-9]/g,'');if(which==='min')setRecPriceAxisMin(c);else setRecPriceAxisMax(c);try{localStorage.setItem(which==='min'?'solar_rec_axis_min':'solar_rec_axis_max',c)}catch{}};
  const recOption=useMemo(()=>{
    const mode=recChartGrain(grain);
    const rows=aggregateRecChartRows(recDisplayRows||[],mode);
    const comps=(recDisplayComparisons||[]).map(c=>({...c,series:aggregateRecChartRows(c?.series||[],mode)}));
    const x=rows.map(r=>formatRecPeriodLabel(r?.period,mode));
    if(!x.length)return{animation:false,title:{text:'표시할 REC 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},grid:{left:18,right:24,top:45,bottom:45,containLabel:true},xAxis:{type:'category',data:[]},yAxis:[{type:'value'}],series:[]};
    const series=[];
    const addRecSeries=(sourceRows,label,isCompare=false)=>{
      const aligned=x.map((_,i)=>sourceRows?.[i]||{});
      const amountMode=recBarMetric==='amount';
      series.push({
        name:`${label} ${amountMode?'REC 평가금액':'REC 발급량'}`,type:'bar',yAxisIndex:0,barMaxWidth:36,
        itemStyle:isCompare?{opacity:.62}:undefined,
        data:aligned.map(r=>{const issued=Number(r?.estimatedRec||0),realizedAmount=Number(r?.realizedAmount||0),valuationQty=Number(r?.valuationQty ?? issued),portfolio=realizedAmount+(recValuationPrice==null?0:valuationQty*Number(recValuationPrice));return{value:amountMode?recMoney(portfolio):issued,sourceMonth:formatRecPeriodLabel(r?.period||r?.sourcePeriod||'',mode),priceDate:r?.priceDate||''}})
      });
      series.push({
        name:`${label} REC 적용단가`,type:'line',yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,
        lineStyle:isCompare?{type:'dashed',width:2}:{width:2.4},
        data:aligned.map(r=>{const issued=Number(r?.estimatedRec||0),realizedAmount=Number(r?.realizedAmount||0),valuationQty=Number(r?.valuationQty ?? issued),portfolio=realizedAmount+(recValuationPrice==null?0:valuationQty*Number(recValuationPrice)),effective=issued>0?portfolio/issued:recValuationPrice;return{value:effective==null?null:recUnitPrice(effective),sourceMonth:formatRecPeriodLabel(r?.period||r?.sourcePeriod||'',mode),priceDate:r?.priceDate||''}})
      });
    };
    addRecSeries(rows,'현재',false);
    for(const c of comps)addRecSeries(Array.isArray(c?.series)?c.series:[],c?.label||`${c?.offset||''}년 전`,true);
    if(benchmarkBarMetric!=='off'){
      const cap=inverterMode==='inv1'?c1:inverterMode==='inv2'?c2:totalCap,weight=Number(data?.rec?.weight||1.5);
      const benchmarkRec=(generationHours)=>{const h=Number(generationHours);if(!(cap>0)||!Number.isFinite(h))return null;const rec=h*cap*recSupplyRatio*weight/1000;return recBarMetric==='amount'?(recValuationPrice==null?null:recMoney(rec*Number(recValuationPrice))):+rec.toFixed(2)};
      for(const name of selectedRegions){series.push({name:`${name} 평균 ${recBarMetric==='amount'?'REC 평가금액':'REC 발급량(환산)'}`,type:'bar',yAxisIndex:0,barMaxWidth:28,itemStyle:{opacity:.68},data:rows.map((r,i)=>benchmarkRec(data?.series?.[i]?.regions?.[name]?.generationHours))})}
      series.push({name:`전국 평균 ${recBarMetric==='amount'?'REC 평가금액':'REC 발급량(환산)'}`,type:'bar',yAxisIndex:0,barMaxWidth:28,itemStyle:{opacity:.68},data:rows.map((r,i)=>benchmarkRec(data?.series?.[i]?.nationalGenerationHours))});
    }
    const amountMode=recBarMetric==='amount';
    return{
      animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:10,right:10,top:52,bottom:60,containLabel:true},
      tooltip:{trigger:'axis',confine:true,formatter:(items)=>{const arr=Array.isArray(items)?items:[];const idx=arr[0]?.dataIndex??0;const lines=[`<b>${x[idx]||''} 동기간 비교</b>`];for(const it of arr){const raw=it?.data?.value??it?.value,sourceMonth=it?.data?.sourceMonth||'',priceDate=it?.data?.priceDate||'';if(it.seriesName.includes('REC 발급량'))lines.push(`${it.marker} ${it.seriesName}: ${two.format(Number(raw||0))} REC${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}`);else if(it.seriesName.includes('REC 평가금액'))lines.push(`${it.marker} ${it.seriesName}: ${nf.format(Number(raw||0))} 원${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}`);else if(it.seriesName.includes('REC 적용단가'))lines.push(`${it.marker} ${it.seriesName}: ${raw==null?'-':`${nf.format(Number(raw))} 원/REC`}${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}${priceDate?` · ${priceDate}`:''}`)}return lines.join('<br/>')}},
      xAxis:{type:'category',data:x,axisLabel:{hideOverlap:true,margin:10}},
      yAxis:[{type:'value',name:amountMode?'원':'REC',nameLocation:'end',nameGap:6,min:0,nameTextStyle:{align:'left',padding:[0,0,4,0]},axisLabel:{formatter:v=>amountMode?nf.format(v):Number(v).toFixed(0),margin:8}},{type:'value',name:'원/REC',nameLocation:'end',nameGap:6,position:'right',min:recPriceAxisBounds.min??undefined,max:recPriceAxisBounds.max??undefined,nameTextStyle:{align:'right',padding:[0,0,4,0]},axisLabel:{formatter:v=>nf.format(v),margin:8}}],
      dataZoom:x.length>4?[{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'slider',xAxisIndex:0,bottom:8,height:20,filterMode:'none',showDetail:false}]:[],series:applyExtremaMarkers(series,x,showMaxPoint,showMinPoint)
    };
  },[recDisplayRows,recDisplayComparisons,data?.rec?.weight,data?.benchmark,recBarMetric,recValuationPrice,grain,benchmarkBarMetric,selectedRegions,inverterMode,c1,c2,totalCap,recSupplyRatio,showMaxPoint,showMinPoint,recPriceAxisBounds.min,recPriceAxisBounds.max,recVatFactor]);
  const recChartKey=useMemo(()=>`rec-${grain}-${start}-${end}-${compare.join('-')}-${data?.rec?.series?.length||0}-${data?.rec?.comparisons?.length||0}-${data?.rec?.market?.date||''}`,[grain,start,end,compare,data?.rec?.series?.length,data?.rec?.comparisons?.length,data?.rec?.market?.date]);
  const toggleCompare=n=>setCompare(v=>v.includes(n)?v.filter(x=>x!==n):[...v,n].sort());
  const toggleRegion=name=>setSelectedRegions(v=>{const next=v.includes(name)?v.filter(x=>x!==name):[...v,name];try{localStorage.setItem('solar_selected_regions',JSON.stringify(next))}catch{}return next});
  const selectBarMetric=v=>{setBarMetric(v);setBenchmarkBarMetric(prev=>prev==='off'||prev===v?prev:'off')};
  const selectBenchmarkBarMetric=v=>{setBenchmarkBarMetric(v);if(v!=='off')setBarMetric(v)};
  const selectedEfficiency=data?.kpi?.[inverterMode==='inv1'?'efficiency1':inverterMode==='inv2'?'efficiency2':'efficiency'];
  const selectedGeneration=data?.kpi?.[inverterMode==='inv1'?'totalGeneration1':inverterMode==='inv2'?'totalGeneration2':'totalGeneration'];
  const selectedGenerationHours=data?.kpi?.[inverterMode==='inv1'?'generationHours1':inverterMode==='inv2'?'generationHours2':'generationHours'];
  const selectedAvgDailyGenerationHours=data?.kpi?.[inverterMode==='inv1'?'avgDailyGenerationHours1':inverterMode==='inv2'?'avgDailyGenerationHours2':'avgDailyGenerationHours'];
  const regionComparable=['smp','efficiency','generationHours','avgDailyGenerationHours'].includes(lineMetric);
  const availableRegions=data?.benchmark?.regionNames||['서울','부산','대구','인천','광주','대전','울산','세종','경기','충북','충남','전남','경북','경남','제주','강원','전북'];
  const summaryEntityKeys=useMemo(()=>['current','national',...selectedRegions].filter((v,i,a)=>a.indexOf(v)===i),[selectedRegions]);
  const summaryEntities=useMemo(()=>{const e=data?.annualSummary?.entities||{};return summaryEntityKeys.map(k=>e[k]?{...e[k],key:k}:null).filter(Boolean)},[data?.annualSummary,summaryEntityKeys]);
  const summaryEntityOptions=useMemo(()=>summaryEntities.map(e=>({key:e.key,label:e.name})),[summaryEntities]);
  const annualDetailEntity=useMemo(()=>summaryEntities.find(e=>e.key===annualDetailEntityKey)||summaryEntities[0]||null,[summaryEntities,annualDetailEntityKey]);
  const annualMonthOptions=useMemo(()=>((summaryEntities[0]?.months)||[]).map(m=>({value:m.period,label:formatRecPeriodLabel(m.period,'month')})),[summaryEntities]);
  const effectiveAnnualMonthFocus=annualMonthFocus==='average'||annualMonthOptions.some(o=>o.value===annualMonthFocus)?annualMonthFocus:'average';
  const annualMonthFocusLabel=effectiveAnnualMonthFocus==='average'?'월평균':(annualMonthOptions.find(o=>o.value===effectiveAnnualMonthFocus)?.label||'선택 월');
  const annualModeAllowsSum=annualSumEligible.has(annualDetailMetric);
  const annualDisplayMetricValue=useCallback((row,metric,mode='sum')=>{if(!row)return null;const raw=Number(row?.[metric]);if(!Number.isFinite(raw))return null;if(mode==='avg'&&annualSumEligible.has(metric)){const cnt=Number(row?.monthCount||1);return cnt>0?raw/cnt:raw}return raw;},[]);
  const annualMainRows=useMemo(()=>summaryEntities.map(e=>{const monthRow=effectiveAnnualMonthFocus==='average'?(e.monthlyAverage||{}):((e.months||[]).find(m=>m.period===effectiveAnnualMonthFocus)||{});return{entity:e,rows:[{key:'whole',label:'년 전체',metricSet:e.whole||{}},{key:'month',label:annualMonthFocusLabel,metricSet:monthRow},{key:'groupAverage',label:data?.annualSummary?.groupLabel||'분기평균',metricSet:e.groupAverage||{}}]}}),[summaryEntities,effectiveAnnualMonthFocus,annualMonthFocusLabel,data?.annualSummary?.groupLabel]);
  const annualGroupRows=useMemo(()=>((annualDetailEntity?.groups)||[]).map(r=>({label:r.label||r.period,value:annualDisplayMetricValue(r,annualDetailMetric,annualDetailMode),share:r?.share?.[annualDetailMetric],row:r})),[annualDetailEntity,annualDetailMetric,annualDetailMode,annualDisplayMetricValue]);
  const annualMonthRows=useMemo(()=>((annualDetailEntity?.months)||[]).map(r=>({label:formatRecPeriodLabel(r.period,'month'),value:annualDisplayMetricValue(r,annualDetailMetric,annualDetailMode),share:r?.share?.[annualDetailMetric],row:r})),[annualDetailEntity,annualDetailMetric,annualDetailMode,annualDisplayMetricValue]);
  const annualMetricLabel=annualMetricOptions.find(([k])=>k===annualDetailMetric)?.[1]||annualDetailMetric;
  const selectedCapacity=inverterMode==='inv1'?c1:inverterMode==='inv2'?c2:totalCap;
  const regionAnnualExpectedKwh=(data?.benchmark?.annualAverage!=null&&selectedCapacity>0)?selectedCapacity*8760*Number(data.benchmark.annualAverage)/100:null;
  const nationalAnnualExpectedKwh=(data?.benchmark?.nationalAnnualAverage!=null&&selectedCapacity>0)?selectedCapacity*8760*Number(data.benchmark.nationalAnnualAverage)/100:null;
  const recTableMode=recDisplayMode;
  const recRowsSorted=useMemo(()=>{const rows=['hour','day'].includes(recTableMode)?recDisplayRows:aggregateRecTableRows(recDisplayRows||[],recTableMode);return[...(rows||[])].sort((a,b)=>String(b?.period||'').localeCompare(String(a?.period||'')))},[recDisplayRows,recTableMode]);
  const recRowsVisible=recRowsSorted.slice(0,recVisible);
  const recRowsRemaining=Math.max(0,recRowsSorted.length-recVisible);
  const recPeriodLabel=recTableMode==='hour'?'발전시간':recTableMode==='day'?'발전일':recTableMode==='year'?'발전연도':recTableMode==='quarter'?'발전분기':recTableMode==='season'?'발전계절':'발전월';
  const recTransactions=useMemo(()=>[...(data?.rec?.ledger?.transactions||[])].sort((a,b)=>String(b?.date||'').localeCompare(String(a?.date||''))||String(b?.updatedAt||'').localeCompare(String(a?.updatedAt||''))),[data?.rec?.ledger?.transactions]);
  const recSelectedValuationAmount=recValuationPrice==null?null:Math.round((data?.rec?.series||[]).reduce((a,r)=>a+Number(r?.realizedAmount||0)+Number(r?.valuationQty ?? r?.issuedRec ?? r?.estimatedRec ?? 0)*Number(recValuationPrice),0));
  const recSelectedValuationAmountDisplay=recMoney(recSelectedValuationAmount);
  const recRemainingValuationDisplay=recValuationPrice==null?null:recMoney(Number(data?.rec?.ledger?.remainingRec||0)*Number(recValuationPrice));
  const recIssueLots=data?.rec?.ledger?.issueDateLots||data?.rec?.ledger?.lots||[];
  const selectedRecIssueLot=recIssueLots.find(x=>x.month===recIssueForm.month)||null;
  const lifecycleLots=data?.rec?.ledger?.lots||[];
  const manualDisposedTransactions=recTransactions.filter(t=>t.type==='disposed'&&Number(t.qty??t.disposedQty??0)>0);
  const autoExpiredLots=lifecycleLots.filter(l=>Number(l.autoExpiredAllocated||0)>0).sort((a,b)=>String(b.expiryDate||'').localeCompare(String(a.expiryDate||'')));
  const expiringSoonLots=lifecycleLots.filter(l=>l?.status?.code==='soon'&&Number(l.remaining||0)>0).sort((a,b)=>String(a.expiryDate||'9999-12-31').localeCompare(String(b.expiryDate||'9999-12-31')));
  const project=data?.projectAnalysis||null;
  const projectYearRows=project?.yearly||[];
  const projectComparisonRows=project?.comparison20||[];
  useEffect(()=>{
    const s=project?.financeCalendar?.start,e=project?.financeCalendar?.end;if(!s||!e)return;
    setProjectChartStart(v=>v||s);setProjectChartEnd(v=>v||e);
  },[project?.financeCalendar?.start,project?.financeCalendar?.end]);
  const projectChartRows=useMemo(()=>{
    const base=projectChartGrain==='month'?(project?.timeline?.monthly||[]):(project?.timeline?.yearly||[]);
    const s=projectChartStart||project?.financeCalendar?.start||'',e=projectChartEnd||project?.financeCalendar?.end||'';
    const lastPlanDue=project?.repaymentSchedule?.amortization?.at?.(-1)?.plannedDueDate||project?.actualRepayment?.amortization?.at?.(-1)?.plannedDueDate||'';
    return base.filter(r=>{
      let inSelected=false;
      if(projectChartGrain==='month'){const m=String(r.period||'');inSelected=(!s||m>=s.slice(0,7))&&(!e||m<=e.slice(0,7));if(projectChartMetric==='expense'&&lastPlanDue&&m>lastPlanDue.slice(0,7))return false;return inSelected}
      const a=String(r.periodStart||''),b=String(r.periodEnd||'');inSelected=(!s||b>=s)&&(!e||a<=e);if(projectChartMetric==='expense'&&lastPlanDue&&a>lastPlanDue)return false;return inSelected
    });
  },[project,projectChartGrain,projectChartStart,projectChartEnd,projectChartMetric]);
  const projectChartOption=useMemo(()=>{
    const rows=projectChartRows||[],x=rows.map(r=>projectChartGrain==='month'?formatRecPeriodLabel(r.period,'month'):`${r.yearNo}년차
${String(r.periodStart||'').slice(0,7)}~${String(r.periodEnd||'').slice(0,7)}`),series=[],axes=[];
    const wonAxis={type:'value',name:'금액(원)',max:v=>v.max>0?Math.ceil(v.max*1.16):null,axisLabel:{formatter:v=>nf.format(Math.round(v))},splitLine:{show:true,lineStyle:{color:'#e5e7eb'}}};
    const baseTooltip={trigger:'axis',axisPointer:{type:'shadow'},confine:true,valueFormatter:v=>Number.isFinite(Number(v))?nf.format(Math.round(Number(v))):'-'};
    if(projectChartMetric==='generation'){
      axes.push({type:'value',name:'발전량(kWh)',axisLabel:{formatter:v=>nf.format(Math.round(v))}},{type:'value',name:'달성률(%)',min:0,axisLabel:{formatter:v=>`${v}%`},splitLine:{show:false}});
      series.push({name:'계획 발전량',type:'bar',data:rows.map(r=>Number(r.planGenerationKwh||0)),barMaxWidth:30},{name:'실제 발전량',type:'bar',data:rows.map(r=>r.actualGenerationKwh==null?null:Number(r.actualGenerationKwh)),barMaxWidth:30},{name:'발전량 달성률',type:'line',yAxisIndex:1,symbolSize:7,data:rows.map(r=>r.actualGenerationKwh==null||!Number(r.planGenerationKwh)?null:+(Number(r.actualGenerationKwh)/Number(r.planGenerationKwh)*100).toFixed(1))});
    }else if(projectChartMetric==='revenue'){
      axes.push(wonAxis,{type:'value',name:'SMP(원/kWh)',position:'right',axisLabel:{formatter:v=>nf.format(v)},splitLine:{show:false}},{type:'value',name:'REC(원/REC)',position:'right',offset:58,axisLabel:{formatter:v=>nf.format(v)},splitLine:{show:false}});
      series.push(
        {name:'계획 SMP 수익',type:'bar',stack:'planRevenue',data:rows.map(r=>Number(r.planSmpRevenueWon||0)),barMaxWidth:28},
        {name:'계획 REC 수익',type:'bar',stack:'planRevenue',data:rows.map((r,i)=>({value:Number(r.planRecRevenueWon||0),label:{show:true,position:'top',distance:5,fontWeight:'bold',fontSize:10,formatter:()=>`합계 ${nf.format(Math.round(Number(r.planSmpRevenueWon||0)+Number(r.planRecRevenueWon||0)))}원`}})),barMaxWidth:28},
        {name:'실제 SMP 수익',type:'bar',stack:'actualValue',data:rows.map(r=>r.actualSmpRevenueWon==null?null:Number(r.actualSmpRevenueWon)),barMaxWidth:28},
        {name:'실제 REC 평가금',type:'bar',stack:'actualValue',data:rows.map((r,i)=>r.actualSmpRevenueWon==null&&r.actualRecValuationWon==null?null:{value:Number(r.actualRecValuationWon||0),label:{show:true,position:'top',distance:5,fontWeight:'bold',fontSize:10,formatter:()=>`합계 ${nf.format(Math.round(Number(r.actualSmpRevenueWon||0)+Number(r.actualRecValuationWon||0)))}원`}}),barMaxWidth:28},
        {name:'REC 실현수익',type:'line',data:rows.map(r=>r.actualRecRealizedWon==null?null:Number(r.actualRecRealizedWon)),symbolSize:7},
        {name:'실제 SMP 평균단가',type:'line',yAxisIndex:1,data:rows.map(r=>r.actualSmpAvgWonPerKwh==null?null:Number(r.actualSmpAvgWonPerKwh)),symbolSize:6},
        {name:'REC 평가 평균단가',type:'line',yAxisIndex:2,data:rows.map(r=>r.actualRecAvgWonPerRec==null?null:Number(r.actualRecAvgWonPerRec)),symbolSize:6},
        {name:'REC 실현 평균단가',type:'line',yAxisIndex:2,lineStyle:{type:'dashed'},data:rows.map(r=>r.actualRecRealizedAvgWonPerRec==null?null:Number(r.actualRecRealizedAvgWonPerRec)),symbolSize:6}
      );
    }else if(projectChartMetric==='expense'){
      axes.push(wonAxis,{type:'value',name:'이자비중(%)',min:0,axisLabel:{formatter:v=>`${v}%`},splitLine:{show:false}});
      series.push(
        {name:'계획 원금',type:'bar',stack:'planExpense',data:rows.map(r=>Number(r.planPrincipalWon||0)),barMaxWidth:28},
        {name:'계획 이자',type:'bar',stack:'planExpense',data:rows.map(r=>Number(r.planInterestWon||0)),barMaxWidth:28},
        {name:'계획 VAT',type:'bar',stack:'planExpense',data:rows.map(r=>({value:Number(r.planVatWon||0),label:{show:true,position:'top',distance:5,fontWeight:'bold',fontSize:10,formatter:()=>`합계 ${nf.format(Math.round(Number(r.planPrincipalWon||0)+Number(r.planInterestWon||0)+Number(r.planVatWon||0)))}원`}})),barMaxWidth:28},
        {name:'실제 원금',type:'bar',stack:'actualExpense',data:rows.map(r=>r.actualPrincipalWon==null?null:Number(r.actualPrincipalWon)),barMaxWidth:28},
        {name:'실제 이자',type:'bar',stack:'actualExpense',data:rows.map(r=>r.actualInterestWon==null?null:Number(r.actualInterestWon)),barMaxWidth:28},
        {name:'실제 VAT',type:'bar',stack:'actualExpense',data:rows.map(r=>r.actualVatWon==null?null:Number(r.actualVatWon)),barMaxWidth:28},
        {name:'유지보수비',type:'bar',stack:'actualExpense',data:rows.map(r=>{if(r.actualPrincipalWon==null&&r.actualInterestWon==null&&r.actualVatWon==null&&r.actualMaintenanceWon==null)return null;return{value:Number(r.actualMaintenanceWon||0),label:{show:true,position:'top',distance:5,fontWeight:'bold',fontSize:10,formatter:()=>`합계 ${nf.format(Math.round(Number(r.actualPrincipalWon||0)+Number(r.actualInterestWon||0)+Number(r.actualVatWon||0)+Number(r.actualMaintenanceWon||0)))}원`}}}),barMaxWidth:28},
        {name:'실제 이자비중',type:'line',yAxisIndex:1,data:rows.map(r=>{const p=Number(r.actualPrincipalWon||0),i=Number(r.actualInterestWon||0);return p+i>0?+(i/(p+i)*100).toFixed(2):null}),symbolSize:6}
      );
    }else{
      axes.push(wonAxis,{type:'value',name:'누적 현금흐름(원)',axisLabel:{formatter:v=>nf.format(Math.round(v))},splitLine:{show:false}});
      series.push({name:'계획 순현금흐름',type:'bar',data:rows.map(r=>Number(r.planNetCashflowWon??r.planCashflowWon??0)),barMaxWidth:26},{name:'실제 현금흐름',type:'bar',data:rows.map(r=>r.actualCashflowWon==null?null:Number(r.actualCashflowWon)),barMaxWidth:26},{name:'실제 평가기준 현금흐름',type:'bar',data:rows.map(r=>r.actualValuationCashflowWon==null?null:Number(r.actualValuationCashflowWon)),barMaxWidth:26},{name:'계획 누적',type:'line',yAxisIndex:1,data:rows.map(r=>Number(r.planCumulativeWon||0)),symbol:false},{name:'실제 누적',type:'line',yAxisIndex:1,data:rows.map(r=>r.actualCumulativeWon==null?null:Number(r.actualCumulativeWon)),symbol:false});
    }
    const visibleSeries=series.filter(s=>{if(projectChartView==='both')return true;const n=String(s.name||'');if(projectChartView==='plan')return n.startsWith('계획');return n.startsWith('실제')||n.startsWith('REC 실현')||n==='유지보수비'});
    const stackedTooltip=['revenue','expense'].includes(projectChartMetric)?{trigger:'axis',axisPointer:{type:'shadow'},confine:true,formatter:(items)=>{const arr=Array.isArray(items)?items:[],idx=arr[0]?.dataIndex??0,r=rows[idx]||{},lines=[`<b>${x[idx]||''}</b>`];for(const it of arr){const raw=it?.data?.value??it?.value;if(raw==null)continue;const name=String(it.seriesName||''),num=Number(raw)||0,unit=name.includes('이자비중')?'%':name.includes('SMP 평균단가')?' 원/kWh':name.includes('REC 평가 평균단가')||name.includes('REC 실현 평균단가')?' 원/REC':' 원';lines.push(`${it.marker} ${name}: ${name.includes('이자비중')?two.format(num):nf.format(Math.round(num))}${unit}`)}if(projectChartMetric==='expense'){const pt=Number(r.planPrincipalWon||0)+Number(r.planInterestWon||0)+Number(r.planVatWon||0),at=Number(r.actualPrincipalWon||0)+Number(r.actualInterestWon||0)+Number(r.actualVatWon||0)+Number(r.actualMaintenanceWon||0);if(projectChartView!=='actual')lines.push(`<b>계획 총지출: ${nf.format(Math.round(pt))} 원</b>`);if(projectChartView!=='plan'&&[r.actualPrincipalWon,r.actualInterestWon,r.actualVatWon,r.actualMaintenanceWon].some(v=>v!=null))lines.push(`<b>실제 총지출: ${nf.format(Math.round(at))} 원</b>`)}else{const pt=Number(r.planSmpRevenueWon||0)+Number(r.planRecRevenueWon||0),at=Number(r.actualSmpRevenueWon||0)+Number(r.actualRecValuationWon||0);if(projectChartView!=='actual')lines.push(`<b>계획 총수익: ${nf.format(Math.round(pt))} 원</b>`);if(projectChartView!=='plan'&&(r.actualSmpRevenueWon!=null||r.actualRecValuationWon!=null))lines.push(`<b>실제 평가수익 합계: ${nf.format(Math.round(at))} 원</b>`)}return lines.join('<br/>')}}:baseTooltip;
    return{animation:false,tooltip:stackedTooltip,legend:{type:'scroll',top:0,left:0,right:0},grid:{left:70,right:projectChartMetric==='revenue'?135:75,top:58,bottom:rows.length>15?78:52,containLabel:true},xAxis:{type:'category',data:x,axisLabel:{interval:0,rotate:rows.length>12?35:0,fontSize:10}},yAxis:axes,series:visibleSeries,dataZoom:rows.length>15?[{type:'inside'},{type:'slider',bottom:8,height:18}]:[]};
  },[projectChartRows,projectChartGrain,projectChartMetric,projectChartView]);
  const projectPct=v=>v==null?'-':`${one.format(v)}%`;
  const daysUntil=(iso)=>{if(!iso)return null;const a=Date.parse(`${localIso()}T00:00:00Z`),b=Date.parse(`${iso}T00:00:00Z`);return Number.isFinite(a)&&Number.isFinite(b)?Math.ceil((b-a)/86400000):null};
  const createPdfReport=useCallback(()=>{
    if(typeof window==='undefined')return;
    // 보고서에 필요한 세부표만 펼칩니다. 용어/계산식/링크/설정용 세부창은 인쇄에서 제외합니다.
    const details=[...document.querySelectorAll('details.pdfReportDetail')];
    const closed=details.filter(d=>!d.open);
    closed.forEach(d=>{d.open=true});
    document.body.classList.add('pdfReportMode');
    const resizeCharts=()=>{
      try{chartRef.current?.getEchartsInstance?.().resize()}catch{}
      try{recChartRef.current?.getEchartsInstance?.().resize()}catch{}
      try{projectChartRef.current?.getEchartsInstance?.().resize()}catch{}
    };
    const restore=()=>{
      closed.forEach(d=>{d.open=false});
      document.body.classList.remove('pdfReportMode');
      requestAnimationFrame(resizeCharts);
    };
    window.addEventListener('afterprint',restore,{once:true});
    requestAnimationFrame(()=>{resizeCharts();setTimeout(()=>{resizeCharts();window.print()},500)});
  },[]);

  return <main className="shell"><header className="hero"><div><div className="eyebrow">SOLAR POWER MONITORING</div><h1>태양광 발전 · SMP · REC</h1><p>인버터별 발전량·수익·설비이용률·등가 발전시간을 확인하고, 충북/건축물 평균과 REC 발급·시세까지 한 화면에서 관리합니다.</p></div><div className="heroButtons"><button className="diagBtn reportBtn" onClick={createPdfReport}>PDF 보고서 생성</button><button className="diagBtn" onClick={runDiagnostics} disabled={diagLoading}>{diagLoading?'진단 중…':'Drive 진단'}</button><button className="sync" onClick={()=>load(true)} disabled={loading}>{loading?'새로고침 중…':'↻ Drive 데이터 새로고침'}</button></div></header>

  <section className="printOnly reportPrintHeader"><div><b>JCPC 태양광 종합 요약 보고서</b><span>화면의 현재 조회조건을 기준으로 자동 생성</span></div><dl><div><dt>조회기간</dt><dd>{start} ~ {end}</dd></div><div><dt>집계</dt><dd>{grainLabels[grain]||grain}</dd></div><div><dt>막대</dt><dd>{barMetricLabels[barMetric]}</dd></div><div><dt>라인</dt><dd>{lineMetricLabels[lineMetric]}</dd></div><div><dt>인버터</dt><dd>{inverterLabels[inverterMode]}</dd></div><div><dt>비교지역</dt><dd>{selectedRegions.length?selectedRegions.join(', '):'없음'} + 전국</dd></div></dl></section>

  {data&&<section className="card dataUpdateBar"><div className="updateTitle"><b>데이터 업데이트 현황</b><span>원자료 기준일과 Drive/캐시 수정시각</span></div><div className="updateGrid"><div><span>발전보고서</span><strong>{fmtDate(data.updateMeta?.generation?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.generation?.fileModifiedAt)}</small></div><div><span>SMP 데이터</span><strong>{fmtDate(data.updateMeta?.smp?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.smp?.fileModifiedAt)}</small></div><div><span>REC 시세</span><strong>{fmtDate(data.updateMeta?.rec?.dataDate)}</strong><small>캐시 수정 {fmtDateTime(data.updateMeta?.rec?.cacheUpdatedAt)}</small></div><div><span>지역 평균</span><strong>{data.updateMeta?.region?.period||'-'}</strong><small>확인 {fmtDateTime(data.updateMeta?.region?.checkedAt)}</small></div><div><span>대시보드</span><strong>{fmtDateTime(data.syncedAt)}</strong><small>마지막 새로고침</small></div></div></section>}

  <nav className="card sectionNavBar" aria-label="페이지 내 네비게이션">{sectionNavItems.map(([id,label])=><a key={id} href={`#${id}`} className="sectionNavLink">{label}</a>)}</nav>

  <section id="equipment-docs" className="card equipmentDocsCard navTarget">
    <div className="sectionTitle"><div><h2>설비 확인 문서</h2><p>문서를 바로 미리보거나, 배포된 대시보드의 PDF 링크를 복사해 공유할 수 있습니다.</p></div></div>
    <div className="equipmentDocGrid">{equipmentDocs.map(doc=><article className="equipmentDocItem" key={doc.key}><div className="equipmentDocIcon">PDF</div><div className="equipmentDocMeta"><b>{doc.title}</b><span>{doc.subtitle}</span></div><div className="equipmentDocActions"><button type="button" className="docPreviewBtn" onClick={()=>openEquipmentDoc(doc)}>팝업 보기</button><button type="button" className="docCopyBtn" onClick={()=>copyEquipmentDocLink(doc)}>링크 복사</button><a href={doc.path} target="_blank" rel="noreferrer">새 탭 ↗</a></div></article>)}</div>
    {docCopyMessage&&<div className="docCopyMessage">{docCopyMessage}</div>}
  </section>

  <section id="overview" className="card capacityCard navTarget"><div className="capacityTitle"><div><b>인버터 정격용량</b><span>설비이용률(CF)과 등가 발전시간 계산에 사용됩니다.</span></div><div className="capacityTotal">합계 <strong>{totalCap?`${one.format(totalCap)} kW`:'미설정'}</strong></div></div><div className="capacityInputs"><label>인버터 1 <input inputMode="decimal" value={cap1} onChange={e=>saveCapacity(1,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><label>인버터 2 <input inputMode="decimal" value={cap2} onChange={e=>saveCapacity(2,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><div className="formula">설비이용률 = 발전량 ÷ (정격용량 × 24시간 × 일수) × 100 · 등가 발전시간 = 발전량 ÷ 정격용량</div></div></section>

  <section className="controls card stickyControls"><div className="presetRow">{presetButtons.map(([k,t])=><button key={k} className={periodPreset===k?'preset active':'preset'} onClick={()=>applyPreset(k)}>{t}</button>)}</div><div className="controlRow"><div className="control"><label>집계</label><div className="segments">{[['hour','시간'],['day','일'],['month','월'],['season','계절'],['quarter','분기'],['year','년']].map(([v,t])=><button key={v} className={grain===v?'active':''} onClick={()=>setGrain(v)}>{t}</button>)}</div></div><div className="control"><label>막대 그래프</label><div className="segments metricSeg">{[['kwh','발전량'],['revenue','수익']].map(([v,t])=><button key={v} className={barMetric===v?'active':''} onClick={()=>selectBarMetric(v)}>{t}</button>)}</div></div><div className="control benchmarkBarControl"><label>전국·지역 막대 비교</label><div className="segments benchmarkCompareSeg">{[['off','OFF'],['kwh','발전량'],['revenue','수익']].map(([v,t])=><button key={v} className={benchmarkBarMetric===v?'active':''} onClick={()=>selectBenchmarkBarMetric(v)}>{t}</button>)}</div></div><div className="control regionSelectControl"><label>비교 지역 선택</label><details ref={regionPickerRef} className="regionPicker"><summary>{selectedRegions.length?`${selectedRegions.join(', ')} (${selectedRegions.length})`:'지역 선택'}</summary><div className="regionPickerPanel"><div className="regionPickerActions"><button type="button" onClick={()=>{setSelectedRegions([]);try{localStorage.setItem('solar_selected_regions','[]')}catch{}}}>전체 해제</button><button type="button" onClick={()=>{setSelectedRegions(availableRegions);try{localStorage.setItem('solar_selected_regions',JSON.stringify(availableRegions))}catch{}}}>전체 선택</button><button type="button" className="regionCloseBtn" onClick={()=>regionPickerRef.current?.removeAttribute('open')}>닫기</button></div><div className="regionCheckGrid">{availableRegions.map(name=><label key={name}><input type="checkbox" checked={selectedRegions.includes(name)} onChange={()=>toggleRegion(name)}/><span>{name}</span></label>)}</div><small>전국 평균은 비교 ON 시 항상 함께 표시됩니다. 지역은 복수 선택할 수 있습니다.</small></div></details></div><div className="control lineMetricControl"><label>라인 그래프</label><div className="segments metricSeg">{[['smp','SMP'],['efficiency','설비이용률'],['generationHours','발전시간'],['avgDailyGenerationHours','일평균 등가시간']].map(([v,t])=><button key={v} className={lineMetric===v?'active':''} onClick={()=>setLineMetric(v)}>{t}</button>)}</div></div><div className="control"><label>인버터 표시</label><div className="segments inverterSeg">{[['total','합계'],['inv1','1'],['inv2','2'],['both','1+2']].map(([v,t])=><button key={v} className={inverterMode===v?'active':''} onClick={()=>setInverterMode(v)}>{t}</button>)}</div></div><div className="control"><label>동기간 비교</label><div className="segments compareSeg">{[1,2,3].map(n=><button key={n} className={compare.includes(n)?'active':''} onClick={()=>toggleCompare(n)}>{n}년전</button>)}</div></div>{regionComparable&&<div className="control"><label>{lineMetric==='smp'?'SMP 지역 비교':'전국·지역 라인 비교'}</label><div className="segments"><button className={showRegion?'active':''} onClick={()=>setShowRegion(v=>!v)}>{lineMetric==='smp'?(showRegion?(selectedRegions.includes('제주')?'제주 SMP 비교 ON':'육지 SMP 동일'):'SMP 비교 OFF'):(showRegion?'라인 비교 ON':'라인 비교 OFF')}</button></div></div>}<div className="control"><label>최고·최저 마커</label><div className="segments"><button className={showMaxPoint?'active':''} onClick={()=>setShowMaxPoint(v=>!v)}>최고점</button><button className={showMinPoint?'active':''} onClick={()=>setShowMinPoint(v=>!v)}>최저점</button></div></div><div className="control dates"><label>기간</label><div><input type="date" value={start} disabled={periodPreset!=='custom'} onChange={e=>setStart(e.target.value)}/><span>~</span><input type="date" value={end} disabled={periodPreset!=='custom'} onChange={e=>setEnd(e.target.value)}/></div></div></div></section>

  {error&&<div className="error">{error}</div>}
  {diag&&<section className="card diagPanel"><div><b>서비스계정:</b> {diag.clientEmail||'-'}</div><div><b>대상 폴더:</b> {diag.folder?.name||'(접근 실패)'}</div><div><b>발전 Excel:</b> {diag.generationExcelCount??0}개 · <b>SMP Excel:</b> {diag.smpExcelCount??0}개</div><div className={diag.generationExcelCount>0?'diagOk':'smpErr'}>{diag.note}</div></section>}

  <div className="zeroDayRuleNotice">평균·설비이용률·일평균 등가시간 등은 <b>발전량 0인 날을 제외</b>하여 계산합니다.</div><section className="kpis kpis6"><Kpi label={`${inverterLabels[inverterMode]} 발전량`} value={data?`${one.format(selectedGeneration||0)} kWh`:'-'}/><Kpi label="SMP 기준 수익" value={data?`${nf.format(data.kpi.totalRevenue)} 원`:'-'}/><Kpi label="평균 SMP" value={data?.kpi.weightedSmp!=null?`${two.format(data.kpi.weightedSmp)} 원/kWh`:'공식값 없음'}/><Kpi label="설비이용률" value={selectedEfficiency!=null?`${two.format(selectedEfficiency)} %`:totalCap?'계산 불가':'용량 입력 필요'}/><Kpi label="등가 발전시간" value={selectedGenerationHours!=null?`${two.format(selectedGenerationHours)} h`:'-'}/><Kpi label="일평균 등가시간" value={selectedAvgDailyGenerationHours!=null?`${two.format(selectedAvgDailyGenerationHours)} h/일`:'-'}/></section>

  <section id="main-chart" className="card chartCard navTarget"><div className="sectionTitle"><div><h2>{barMetricLabels[barMetric]} 막대 + {lineMetricLabels[lineMetric]} 라인 · {inverterLabels[inverterMode]}{regionComparable&&showRegion?' · 전국·지역 라인 비교':''}{benchmarkBarMetric!=='off'?` · 전국·지역 ${barMetricLabels[benchmarkBarMetric]} 막대 비교`:''}</h2><p>그래프 위에서 휠/두 손가락으로 확대·축소, 드래그로 이동할 수 있습니다.</p></div><span className="pill">발전파일 {data?.fileCount??0}개 · 루트 원본</span></div><div className="chartWrap"><ReactECharts key={chartKey} ref={chartRef} option={option} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div></section>

  {(regionComparable||benchmarkBarMetric!=='off')&&data?.benchmark&&<section className="card benchmarkCard"><div><b>전국·지역 평균 비교</b><strong>{selectedRegions.length?`${selectedRegions.length}개 지역 + 전국`:'전국'}</strong></div><p>REcloud 월별 이용률 기준년도는 <b>{data.benchmark.year}년</b>이며, 선택 지역은 {selectedRegions.length?selectedRegions.join(', '):'없음'}입니다. 발전량은 선택 설비용량으로 환산하고 수익은 해당 구간 SMP를 적용합니다. <b>제주 평균 수익은 제주 전용 SMP</b>, 그 외 지역과 전국은 같은 육지 SMP를 사용합니다. SMP 라인 비교도 육지는 중복 표시하지 않고 제주를 선택한 경우에만 제주 SMP를 추가합니다.</p><div className="termNote"><b>표시 기준:</b> 전국·지역 평균 발전량/수익은 소수점 반올림 후 자연수로 표시합니다. REcloud의 월별 지역 이용률 공개 기준년도와 조회 대상 연도가 다를 때에는 현재 공개 월별 프로필을 비교 기준으로 환산합니다.</div>{data.benchmark.errors?.length>0&&<div className="benchmarkErr">{data.benchmark.errors.join(' / ')}</div>}</section>}


  {data?.annualSummary&&<section id="year-summary" className="card annualSummaryCard navTarget"><div className="sectionTitle annualSummaryHead"><div><h2>한해 요약 · 전국/지역 비교</h2><p>선택 연도의 전체값, 월평균/선택월, 분기·계절 평균과 세부 분해표를 함께 확인합니다. 계절연도는 3월~다음해 2월 기준입니다.</p></div></div><div className="annualSummaryControlRow"><label className="summaryYearSelect"><span>기간 선택</span><select value={summaryKey} onChange={e=>setSummaryKey(e.target.value)}>{(data.summaryOptions||[]).map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></label><label className="summaryYearSelect"><span>월 보기</span><select value={effectiveAnnualMonthFocus} onChange={e=>setAnnualMonthFocus(e.target.value)}><option value="average">월평균</option>{annualMonthOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label className="summaryYearSelect"><span>세부 비교</span><select value={annualDetailEntity?.key||annualDetailEntityKey} onChange={e=>setAnnualDetailEntityKey(e.target.value)}>{summaryEntityOptions.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></label><label className="summaryYearSelect"><span>세부 지표</span><select value={annualDetailMetric} onChange={e=>setAnnualDetailMetric(e.target.value)}>{annualMetricOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="summaryYearSelect"><span>집계 방식</span><select value={annualModeAllowsSum?annualDetailMode:'sum'} onChange={e=>setAnnualDetailMode(e.target.value)} disabled={!annualModeAllowsSum}><option value="sum">합계 기준</option>{annualModeAllowsSum&&<option value="avg">평균 기준</option>}</select></label></div><div className="annualSummaryMeta"><span><b>조회기간</b> {data.annualSummary.start} ~ {data.annualSummary.end}</span><span><b>비교지역</b> {selectedRegions.length?selectedRegions.join(', '):'없음'} + 전국</span><span><b>REcloud 지역 이용률 기준</b> {data.annualSummary.sourceYear||'-'}년 공개 월별 프로필</span><span><b>평균 계산</b> 발전량 0인 날 제외</span></div><div className="tableScroll annualSummaryScroll"><table className="annualSummaryTable"><thead><tr><th>구분</th><th>기준</th><th>발전량</th><th>수익</th><th>등가 발전시간</th><th>이용효율</th><th>일평균 등가시간</th><th>REC 발급량</th><th>REC 평가수익</th></tr></thead><tbody>{annualMainRows.flatMap(({entity,rows})=>rows.map((row,j)=>{const m=row.metricSet||{};return <tr key={`${entity.name}-${row.key}`} className={entity.name==='현재 발전소'?'summaryCurrent':''}>{j===0?<td className="annualEntityCol" rowSpan="3"><b>{entity.name}</b>{entity.name==='제주'&&<small className="jejuSmpNote">수익: 제주 SMP</small>}</td>:null}<td className="annualBasisCol">{row.label}</td><td>{formatSummaryMetric(m.generation,'generation')}</td><td>{formatSummaryMetric(m.revenue,'revenue')}</td><td>{formatSummaryMetric(m.generationHours,'generationHours')}</td><td>{formatSummaryMetric(m.efficiency,'efficiency')}</td><td>{formatSummaryMetric(m.avgDailyGenerationHours,'avgDailyGenerationHours')}</td><td>{formatSummaryMetric(m.recQty,'recQty')}</td><td>{formatSummaryMetric(m.recRevenue,'recRevenue')}</td></tr>}))}</tbody></table></div><div className="annualSummaryCards">{annualMainRows.map(({entity,rows})=><article key={entity.key} className={`annualSummaryCardItem ${entity.name==='현재 발전소'?'summaryCurrent':''}`}><div className="annualSummaryCardTitle"><b>{entity.name}</b>{entity.name==='제주'&&<small className="jejuSmpNote">수익: 제주 SMP</small>}</div><div className="annualSummaryCardRows">{rows.map(row=>{const m=row.metricSet||{};return <div key={row.key} className="annualSummaryMiniRow"><h4>{row.label}</h4><dl><div><dt>발전량</dt><dd>{formatSummaryMetric(m.generation,'generation')}</dd></div><div><dt>수익</dt><dd>{formatSummaryMetric(m.revenue,'revenue')}</dd></div><div><dt>등가 발전시간</dt><dd>{formatSummaryMetric(m.generationHours,'generationHours')}</dd></div><div><dt>이용효율</dt><dd>{formatSummaryMetric(m.efficiency,'efficiency')}</dd></div><div><dt>일평균 등가시간</dt><dd>{formatSummaryMetric(m.avgDailyGenerationHours,'avgDailyGenerationHours')}</dd></div><div><dt>REC 발급량</dt><dd>{formatSummaryMetric(m.recQty,'recQty')}</dd></div><div><dt>REC 평가수익</dt><dd>{formatSummaryMetric(m.recRevenue,'recRevenue')}</dd></div></dl></div>})}</div></article>)}</div><div className="annualBreakdownGrid"><details className="annualDetailCard annualDetailCollapse"><summary className="annualDetailSummary"><div><h3>{annualDetailEntity?.name||'-'} {data.annualSummary.groupLabel} 세부</h3><p>{annualMetricLabel} · {annualModeAllowsSum&&annualDetailMode==='avg'?'평균 기준':'합계 기준'} · 전체 대비 비중</p></div><span className="annualDetailToggle" aria-hidden="true">▾</span></summary><div className="annualDetailBody"><div className="tableScroll"><table className="annualDetailTable"><thead><tr><th>{data.annualSummary.groupLabel.replace('평균','')}</th><th>{annualMetricLabel}</th><th>전체 대비</th></tr></thead><tbody>{annualGroupRows.map((item,idx)=><tr key={`${item.label}-${idx}`}><td>{item.label}</td><td>{formatSummaryMetric(item.value,annualDetailMetric)}</td><td>{item.share==null?'-':`${two.format(item.share)} %`}</td></tr>)}</tbody></table></div></div></details><details className="annualDetailCard annualDetailCollapse"><summary className="annualDetailSummary"><div><h3>{annualDetailEntity?.name||'-'} 월별 세부</h3><p>{annualMetricLabel} · {annualModeAllowsSum&&annualDetailMode==='avg'?'월평균 기준':'월 값'} · 전체 대비 비중</p></div><span className="annualDetailToggle" aria-hidden="true">▾</span></summary><div className="annualDetailBody"><div className="tableScroll"><table className="annualDetailTable"><thead><tr><th>월</th><th>{annualMetricLabel}</th><th>전체 대비</th></tr></thead><tbody>{annualMonthRows.map((item,idx)=><tr key={`${item.label}-${idx}`} className={effectiveAnnualMonthFocus!=='average'&&item.row?.period===effectiveAnnualMonthFocus?'annualDetailHighlight':''}><td>{item.label}</td><td>{formatSummaryMetric(item.value,annualDetailMetric)}</td><td>{item.share==null?'-':`${two.format(item.share)} %`}</td></tr>)}</tbody></table></div></div></details></div><div className="annualSummaryNote">* 현재 발전소 REC는 RPS 실제 발급실적이 있으면 실제값을 우선합니다. 전국·지역 REC는 선택 설비용량, 지역 이용률, REC 공급량 추정비율 및 가중치로 환산한 비교값입니다. 제주 평균 수익은 제주 전용 SMP 파일을 사용합니다.</div></section>}

  {project&&<section id="project-analysis" className="card projectAnalysisCard navTarget">
    <div className="sectionTitle projectHead">
      <div><h2>KT × JCPC 태양광 사업성 · 원리금 상환 분석</h2><p>계약 계획과 실제 발전·SMP·REC·원리금·유지보수비를 동일한 금융연차 기준으로 비교합니다.</p></div>
      <div className="projectSourceLinks noPrint"><a href={project.source?.contractPath||'/docs/solar-contract-KT-JCPC-2021-07-10.pdf'} target="_blank" rel="noreferrer">계약서 PDF ↗</a>{project.source?.repaymentUrl&&<a href={project.source.repaymentUrl} target="_blank" rel="noreferrer">계산서 발행 및 입출금 내역 ↗</a>}</div>
    </div>
    <div className="projectFinancePeriodBanner"><b>금융연차 기준</b><span>{project.financeCalendar?.rule||'-'}</span><strong>1년차 {project.financeCalendar?.start||'-'} ~ {projectComparisonRows[0]?.periodEnd||'-'}</strong></div>
    <div className="projectFinancePeriodBanner projectPlanBasisBanner"><b>계약 경제성 분석표 1년차 발전계획</b><span>{project.contract?.planFirstYearGenerationBasis||'계약 경제성 분석표의 연차별 발전량 표기값을 그대로 사용'}</span><strong>{nf.format(project.contract?.planFirstYearGenerationKwh||project.planYears?.[0]?.generationKwh||0)} kWh</strong></div>
    <div className="projectKpis projectStatusKpis">
      <div><span>20년 계획수익</span><strong>{nf.format(project.contract?.planTotalRevenue20Years||0)} 원</strong><small>계약 경제성 분석표 기준</small></div>
      <div><span>실적반영 20년 전망수익</span><strong>{nf.format(project.investmentMetrics?.forecastRevenue20YearsWon||0)} 원</strong><small>{project.investmentMetrics?.forecastThrough||'-'}까지 실적 + 잔여기간 계획</small></div>
      <div><span>누적 실제 발전량</span><strong>{nf.format(Math.round(project.actual?.generationKwh||0))} kWh</strong><small>가동일 기준 계획대비 {projectPct(project.achievement?.generationPct)}</small></div>
      <div><span>누적 SMP 수익</span><strong>{nf.format(project.actual?.smpRevenueWon||0)} 원</strong><small>발전량 × 실제 육지 SMP</small></div>
      <div><span>누적 REC 평가금</span><strong>{nf.format(project.actual?.recValuationWon||0)} 원</strong><small>보유·발급 REC를 해당 시점 시장단가로 평가</small></div>
      <div><span>누적 REC 실현수익</span><strong>{nf.format(project.actual?.recRealizedWon||0)} 원</strong><small>실제로 수익화 처리한 현금 금액</small></div>
      <div><span>누적 유지보수비</span><strong>{nf.format(project.actual?.maintenanceWon||0)} 원</strong><small>수기 저장된 실제 지출</small></div>
      <div><span>기일도래 원리금</span><strong>{nf.format(project.actualRepayment?.paidInclVat||0)} 원</strong><small>{project.actualRepayment?.dueInstallments||0}/{project.contract?.installmentCount||60}회 · 계산서 작성일 + 익익월 말일</small></div>
    </div>

    <div className="projectDiscountControl noPrint"><label><span>요구수익률 / NPV 할인율</span><div className="inputUnit compactInput"><input inputMode="decimal" value={projectDiscountRatePct} onChange={e=>{const v=e.target.value.replace(/[^0-9.]/g,'');setProjectDiscountRatePct(v);try{localStorage.setItem('solar_project_discount_rate_pct',v)}catch{}}}/><em>%</em></div></label><small>NPV·IRR 대비 초과수익률(스프레드)·민감도 NPV가 즉시 재계산됩니다. <b>IRR 자체는 할인율과 무관한 지표</b>라 값은 바뀌지 않고, ‘IRR − 요구수익률’이 바뀝니다.</small></div>
    <div className="projectMetricCompareGrid">
      <div className="projectMetricCompareCard"><span>Project IRR</span><div><em>계획</em><b>{project.investmentMetrics?.projectIrrPct==null?'-':`${two.format(project.investmentMetrics.projectIrrPct)}%`}</b><small>요구수익률 대비 {project.investmentMetrics?.projectIrrSpreadPct==null?'-':`${project.investmentMetrics.projectIrrSpreadPct>=0?'+':''}${two.format(project.investmentMetrics.projectIrrSpreadPct)}%p`}</small></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastProjectIrrPct==null?'-':`${two.format(project.investmentMetrics.forecastProjectIrrPct)}%`}</b><small>요구수익률 대비 {project.investmentMetrics?.forecastProjectIrrSpreadPct==null?'-':`${project.investmentMetrics.forecastProjectIrrSpreadPct>=0?'+':''}${two.format(project.investmentMetrics.forecastProjectIrrSpreadPct)}%p`}</small></div></div>
      <div className="projectMetricCompareCard"><span>NPV ({one.format(project.investmentMetrics?.discountRatePct??5)}%)</span><div><em>계획</em><b>{project.investmentMetrics?.projectNpvWon==null?'-':`${nf.format(project.investmentMetrics.projectNpvWon)} 원`}</b></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastProjectNpvWon==null?'-':`${nf.format(project.investmentMetrics.forecastProjectNpvWon)} 원`}</b></div></div>
      <div className="projectMetricCompareCard"><span>투자 회수기간</span><div><em>계획</em><b>{project.investmentMetrics?.projectPaybackYears==null?'-':`${two.format(project.investmentMetrics.projectPaybackYears)}년`}</b></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastProjectPaybackYears==null?'-':`${two.format(project.investmentMetrics.forecastProjectPaybackYears)}년`}</b></div></div>
      <div className="projectMetricCompareCard"><span>단순 ROI</span><div><em>계획</em><b>{project.investmentMetrics?.projectSimpleRoiPct==null?'-':`${one.format(project.investmentMetrics.projectSimpleRoiPct)}%`}</b></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastProjectSimpleRoiPct==null?'-':`${one.format(project.investmentMetrics.forecastProjectSimpleRoiPct)}%`}</b></div></div>
      <div className="projectMetricCompareCard"><span>JCPC 현금흐름 IRR</span><div><em>계획</em><b>{project.investmentMetrics?.equityIrrPct==null?'-':`${two.format(project.investmentMetrics.equityIrrPct)}%`}</b></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastEquityIrrPct==null?'-':`${two.format(project.investmentMetrics.forecastEquityIrrPct)}%`}</b></div></div>
      <div className="projectMetricCompareCard"><span>JCPC NPV</span><div><em>계획</em><b>{project.investmentMetrics?.equityNpvWon==null?'-':`${nf.format(project.investmentMetrics.equityNpvWon)} 원`}</b></div><div><em>실적반영 전망</em><b>{project.investmentMetrics?.forecastEquityNpvWon==null?'-':`${nf.format(project.investmentMetrics.forecastEquityNpvWon)} 원`}</b></div></div>
    </div>

    <div className="projectProgressGrid">
      <div><div><span>발전량 계획 달성</span><b>{projectPct(project.achievement?.generationPct)}</b></div><progress max="100" value={Math.min(100,Math.max(0,Number(project.achievement?.generationPct||0)))}/></div>
      <div><div><span>평가수익 계획 달성</span><b>{projectPct(project.achievement?.revenuePct)}</b></div><progress max="100" value={Math.min(100,Math.max(0,Number(project.achievement?.revenuePct||0)))}/></div>
      <div><div><span>원리금 지급기일 도래</span><b>{projectPct(project.achievement?.repaymentPct)}</b></div><progress max="100" value={Math.min(100,Math.max(0,Number(project.achievement?.repaymentPct||0)))}/></div>
    </div>

    <div className="projectBusinessChart">
      <div className="projectBusinessChartHead"><div><b>계획 vs 실제 사업현황 그래프</b><span>금융연차 기준 · 계획만 / 실제만 / 둘 다 선택해서 비교할 수 있습니다.</span></div><div className="projectChartControls noPrint"><label>보기<select value={projectChartView} onChange={e=>setProjectChartView(e.target.value)}><option value="both">계획 + 실제</option><option value="plan">계획만</option><option value="actual">실제만</option></select></label><label>집계<select value={projectChartGrain} onChange={e=>setProjectChartGrain(e.target.value)}><option value="year">연도</option><option value="month">월</option></select></label><label>항목<select value={projectChartMetric} onChange={e=>setProjectChartMetric(e.target.value)}>{Object.entries(projectChartMetricLabels).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label>시작<input type="date" value={projectChartStart} onChange={e=>setProjectChartStart(e.target.value)}/></label><label>종료<input type="date" value={projectChartEnd} onChange={e=>setProjectChartEnd(e.target.value)}/></label></div></div>
      <div className="projectChartWrap"><ReactECharts ref={projectChartRef} option={projectChartOption} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div>
      <small className="projectFootnote">수익 그래프: 계획은 SMP+REC 계획수익, 실제는 SMP 수익+REC 평가금이며 REC 실현수익을 별도 표시합니다. 지출 그래프: 원금·이자·VAT와 수기 유지보수비를 구분합니다. 월 계획값은 계약 연차 계획을 12개월로 균등 배분한 비교용 값입니다.</small>
    </div>

    <details className="projectMetricExplain projectDetail">
      <summary><div><b>사업성·현금흐름 계산 의미와 데이터·수식</b><span>수익·지출·IRR·NPV·전망치가 무엇을 뜻하는지 상세 보기</span></div><span>▾</span></summary>
      <div className="projectDetailBody projectMetricGuide">
        <div><b>실제 SMP 수익</b><span>각 발전일의 발전량(kWh) × 해당 일 육지 SMP 평균단가를 합산합니다. 발전량 0인 날은 평균단가·계획대비 가동일 계산에서 제외합니다.</span></div><div><b>계획 SMP·REC 수익 분리</b><span>계약 연차별 총 계획수익을 그대로 유지한 상태에서 계획 SMP 수익 = 계획 발전량 × {nf.format(project.investmentMetrics?.planSmpWonPerKwh||0)}원/kWh로 계산하고, 나머지를 REC 계획수익으로 둡니다. 20년 계획 전체의 환산 매출단가는 {project.investmentMetrics?.planBlendedRevenueWonPerKwh==null?'-':two.format(project.investmentMetrics.planBlendedRevenueWonPerKwh)}원/kWh, 그중 REC 기여분은 {project.investmentMetrics?.planImpliedRecRevenueWonPerKwh==null?'-':two.format(project.investmentMetrics.planImpliedRecRevenueWonPerKwh)}원/kWh입니다. 민감도도 이 분해 기준을 사용합니다.</span></div>
        <div><b>REC 평가금</b><span>발급·산정된 REC를 해당 월의 시장 평가단가로 환산한 가치입니다. 아직 팔지 않은 REC도 포함하므로 <b>현금수입이 아닙니다.</b></span></div>
        <div><b>REC 실현수익·단가</b><span>REC 거래내역에서 ‘수익화’로 직접 기록한 금액과 수량만 집계합니다. 실현단가 = 실현금액 ÷ 수익화 REC 수량입니다. 평가금·평가단가와 실제 현금수익·실현단가는 서로 다른 값이며 연차별·누적 변화를 각각 표시합니다.</span></div>
        <div><b>실제 평가수익 / 실제 현금수익</b><span>평가수익 = SMP 수익 + REC 평가금. 현금수익 = SMP 수익 + REC 실현수익. 사업성 전망은 보유 REC의 경제적 가치까지 반영하기 위해 평가수익을 사용하고, 실제 현금흐름은 실현수익을 사용합니다.</span></div>
        <div><b>실제 원리금 지급</b><span>Google Drive ‘계산서’ 시트의 <b>작성일자와 합계금액</b>을 원본으로 사용합니다. 지급일은 사용자가 지정한 규칙대로 <b>작성일자가 속한 달의 익익월 말일</b>로 계산하고, 그 날짜가 기준일을 지났을 때 실제 지출로 반영합니다.</span></div>
        <div><b>원금·이자 구분</b><span>계산서에는 매월 공급가액과 VAT만 있고 원금/이자 구분이 없으므로, 계약 상환표의 원금 총액과 60회 균등 공급가 지급액으로 역산한 상환스케줄을 사용해 각 회차 공급가액을 원금과 이자로 분해합니다. 실제 계산서 공급가액이 계획과 다르면 해당 회차의 원금·이자를 같은 비율로 조정합니다.</span></div>
        <div><b>유지보수비</b><span>아래 수기 입력 내역을 실제 지출일 기준으로 현금흐름에서 차감합니다. 계약서에 장래 유지보수비 계획값이 없으므로 미래 유지보수비는 임의 추정하지 않고 0으로 두며, 입력된 실제비용만 실적·전망에 반영합니다.</span></div>
        <div><b>금융연차</b><span>첫 일반 원리금 계산서 발행일이 속한 달의 1일부터 12개월씩 구분합니다. 현재 기준 1년차는 <b>{project.financeCalendar?.start||'-'} ~ {projectComparisonRows[0]?.periodEnd||'-'}</b>입니다. 2022년 2월 청구 시작부터 원리금 계획·실적을 같은 축에서 비교합니다.</span></div>
        <div><b>Project IRR</b><span>공사비(VAT 별도)를 최초 투자금(-)으로 두고 20년 사업수익(+)의 NPV가 0이 되는 할인율입니다. 실적반영 전망은 이미 발생한 실제 평가수익과 실제 유지보수비를 고정하고 남은 기간에 계약 계획수익을 적용합니다.</span></div>
        <div><b>NPV</b><span>사용자가 지정한 요구수익률 {one.format(project.investmentMetrics?.discountRatePct??5)}%로 각 연차 현금흐름을 현재가치로 할인한 합계입니다. 요구수익률을 바꾸면 NPV와 민감도 NPV가 다시 계산됩니다. IRR은 현금흐름 자체의 내부수익률이므로 요구수익률을 바꿔도 값 자체는 변하지 않고, IRR과 요구수익률의 차이(초과수익률)가 변합니다.</span></div>
        <div><b>회수기간</b><span>누적 현금흐름이 0 이상으로 전환되는 시점입니다. 연도 중 회수되는 경우 해당 연차 현금흐름을 기준으로 선형 보간합니다.</span></div>
        <div><b>단순 ROI</b><span>계획은 (20년 계획수익 − 공사비) ÷ 공사비 × 100. 실적반영 전망은 실제 유지보수비까지 차감한 전망수익을 사용합니다. 시간가치는 반영하지 않습니다.</span></div>
        <div><b>JCPC IRR/NPV</b><span>JCPC가 실제로 부담하는 지원금 관련 VAT·원리금 지급과 사업수익을 기준으로 계산합니다. 실적구간에는 실제 유지보수비도 차감합니다. 세금·부가세 환급 등 확정 입력자료가 없는 항목은 포함하지 않습니다.</span></div>
        <div><b>계획달성률</b><span>발전량 달성률 = 실제 발전량 ÷ 같은 가동일수만큼 일할 환산한 계획 발전량 × 100. 평가수익 달성률 = 실제 SMP+REC 평가수익 ÷ 같은 가동일수만큼 일할 환산한 계획수익 × 100입니다.</span></div><div><b>원리금 진행률</b><span>기준일 현재 지급기일이 도래한 일반 금융원리금 회차 ÷ 전체 60회 × 100입니다. 단순 ‘세금계산서 발행률’과 구분합니다.</span></div><div><b>실적반영 20년 전망수익</b><span>완료된 금융연차는 실제 SMP+REC 평가수익, 현재 금융연차는 현재까지 실제 평가수익 + 남은 기간 계획수익, 미래 금융연차는 계약 계획수익을 합산합니다.</span></div><div><b>실적반영 Project/JCPC 지표</b><span>Project 전망에는 실적구간의 실제 유지보수비를 비용으로 차감합니다. JCPC 전망에는 여기에 실제/예정 원리금까지 함께 반영합니다. 미래 유지보수비는 계획자료가 없어 0으로 둡니다.</span></div><div><b>실적반영 전망의 한계</b><span>미래 SMP·REC 가격과 미래 유지보수비를 확정할 수 없으므로 남은 기간은 계약 계획수익을 기준으로 합니다. 따라서 ‘확정 수익률’이 아니라 현재 실적을 반영한 전망치입니다.</span></div>
      </div>
    </details>

    <details className="projectDetail projectFinanceStructureDetail">
      <summary><div><b>원금·이자·VAT와 ‘총 지급예정액’ 구성</b><span>사진의 총상환액이 무엇인지 구분해서 보기</span></div><span>▾</span></summary>
      <div className="projectDetailBody">
        <div className="projectMiniGrid projectFinanceGrid">
          <div><span>KT 투자분</span><b>{nf.format(project.contract?.ktInvestment||0)}원</b></div>
          <div><span>상환표 기준 원금</span><b>{nf.format(project.actualRepayment?.financing?.principalWon||project.contract?.repaymentPrincipalSchedule||0)}원</b></div>
          <div><span>금융이자</span><b>{nf.format(project.actualRepayment?.financing?.interestWon||project.contract?.financingInterest||0)}원</b></div>
          <div><span>원금+이자 공급가</span><b>{nf.format(project.actualRepayment?.financing?.supplyTotalWon||project.contract?.installmentSupplyTotal||0)}원</b></div>
          <div><span>원리금 VAT</span><b>{nf.format(project.actualRepayment?.financing?.vatWon||0)}원</b></div>
          <div><span>금융 원리금 VAT 포함</span><b>{nf.format(project.actualRepayment?.financing?.grossWon||project.contract?.installmentRepaymentInclVat||0)}원</b></div>
          <div><span>지원금 관련 VAT 일시납</span><b>{nf.format(project.contract?.supportVatOneTime||0)}원</b></div>
          <div><span>JCPC 계약상 총 지급예정액</span><b>{nf.format(project.contract?.clientTotalRepaymentInclVat||0)}원</b></div>
        </div>
        <div className="projectFinanceFormula"><b>총 지급예정액은 ‘이자’만을 뜻하지 않습니다.</b><span>금융 원리금 VAT포함 {nf.format(project.actualRepayment?.financing?.grossWon||project.contract?.installmentRepaymentInclVat||0)}원 + 지원금 관련 VAT {nf.format(project.contract?.supportVatOneTime||0)}원 = {nf.format(project.contract?.clientTotalRepaymentInclVat||0)}원</span></div>
        <div className="projectRateGrid"><div><span>총 이자 ÷ 상환표 원금</span><b>{project.actualRepayment?.financing?.totalInterestPctOfPrincipal==null?'-':`${two.format(project.actualRepayment.financing.totalInterestPctOfPrincipal)}%`}</b></div><div><span>역산 월 이율</span><b>{project.actualRepayment?.financing?.monthlyRatePct==null?'-':`${project.actualRepayment.financing.monthlyRatePct}%`}</b></div><div><span>역산 명목 연이율</span><b>{project.actualRepayment?.financing?.nominalAnnualRatePct==null?'-':`${project.actualRepayment.financing.nominalAnnualRatePct}%`}</b></div><div><span>역산 유효 연이율</span><b>{project.actualRepayment?.financing?.effectiveAnnualRatePct==null?'-':`${project.actualRepayment.financing.effectiveAnnualRatePct}%`}</b></div></div>
        <small className="projectFootnote">금리는 계약서에 별도 APR로 적힌 값을 임의로 가정한 것이 아니라, 상환표 원금과 매월 균등 공급가액을 기준으로 역산한 비교용 금리입니다. KT 투자분과 상환표 기준 원금의 차이는 {nf.format(project.actualRepayment?.financing?.principalVsKtInvestmentDifferenceWon||0)}원으로 별도 표시하며 숨기지 않습니다.</small>
      </div>
    </details>

    <div className="projectDetailsGrid projectDetailsUnified">
      <details className="projectDetail pdfReportDetail projectUnifiedDetail">
        <summary><div><b>20년 계획 · 실제 · 수익·지출·현금흐름 통합 비교</b><span>첫 원리금 계산서 기준 12개월 금융연차 · 계획/실제를 같은 표에서 비교</span></div><span>▾</span></summary>
        <div className="projectDetailBody">
          <div className="tableScroll"><table className="projectTable projectComparisonTable projectComparisonWide"><thead><tr><th>연차·기간</th><th>구분</th><th>발전량</th><th>SMP 수익</th><th>REC 평가/계획</th><th>REC 실현</th><th>총수익</th><th>원금</th><th>이자</th><th>VAT</th><th>유지보수</th><th>순현금흐름</th><th>누적현금흐름</th><th>달성률·비고</th></tr></thead>{projectComparisonRows.map(r=><tbody key={r.yearNo} className="projectYearPair"><tr className="projectPlanRow"><td rowSpan="2"><b>{r.yearNo}년차</b><small>{r.periodStart} ~ {r.periodEnd}</small><small>계약표 {r.referenceYear}년</small></td><td><span className="planActualBadge plan">계획</span></td><td>{nf.format(Math.round(r.planGenerationKwh||0))} kWh</td><td>{nf.format(r.planSmpRevenueWon||0)} 원</td><td>{nf.format(r.planRecRevenueWon||0)} 원</td><td>-</td><td><b>{nf.format(r.planRevenueWon||0)} 원</b></td><td>{nf.format(r.planPrincipalWon||0)} 원</td><td>{nf.format(r.planInterestWon||0)} 원</td><td>{nf.format(r.planVatWon||0)} 원</td><td>0 원<small>계획자료 없음</small></td><td>{nf.format(r.planCashflowWon||0)} 원</td><td>{nf.format(r.planCumulativeWon||0)} 원</td><td>계약 연차 계획</td></tr><tr className="projectActualRow"><td><span className="planActualBadge actual">실제</span></td><td>{r.actualGenerationKwh==null?'-':`${nf.format(Math.round(r.actualGenerationKwh))} kWh`}</td><td>{r.actualSmpRevenueWon==null?'-':<><b>{nf.format(r.actualSmpRevenueWon)} 원</b><small>누적 {nf.format(r.cumulativeSmpRevenueWon||0)}원</small></>}</td><td>{r.actualRecValuationWon==null?'-':<><b>{nf.format(r.actualRecValuationWon)} 원</b><small>평가단가 {r.actualRecAvgWonPerRec==null?'-':`${nf.format(r.actualRecAvgWonPerRec)}원/REC`} · 누적 {nf.format(r.cumulativeRecValuationWon||0)}원</small></>}</td><td>{r.actualRecRealizedWon==null?'-':<><b>{nf.format(r.actualRecRealizedWon)} 원</b><small>실현단가 {r.actualRecRealizedAvgWonPerRec==null?'-':`${nf.format(r.actualRecRealizedAvgWonPerRec)}원/REC`} · 누적 {nf.format(r.cumulativeRecRealizedWon||0)}원</small></>}</td><td>{r.actualValuationRevenueWon==null?'-':<><b>{nf.format(r.actualValuationRevenueWon)} 원</b><small>현금수익 {nf.format(r.actualCashRevenueWon||0)}원</small></>}</td><td>{r.actualPrincipalWon==null?'-':`${nf.format(r.actualPrincipalWon)} 원`}</td><td>{r.actualInterestWon==null?'-':`${nf.format(r.actualInterestWon)} 원`}</td><td>{r.actualVatWon==null?'-':`${nf.format(r.actualVatWon)} 원`}</td><td>{r.actualMaintenanceWon==null?'-':<><b>{nf.format(r.actualMaintenanceWon)} 원</b><small>누적 {nf.format(r.cumulativeMaintenanceWon||0)}원</small></>}</td><td>{r.actualCashflowWon==null?'-':<><b>{nf.format(r.actualCashflowWon)} 원</b><small>평가기준 {nf.format(r.actualValuationCashflowWon||0)}원</small></>}</td><td>{r.actualCumulativeWon==null?'-':`${nf.format(r.actualCumulativeWon)} 원`}</td><td>{r.actualGenerationKwh==null&&r.actualRepaymentWon==null?'미도래':<><span>발전 {projectPct(r.generationAchievementPct)}</span><small>평가수익 {projectPct(r.revenueAchievementPct)} · 가동 {nf.format(r.activeDays||0)}일</small></>}</td></tr></tbody>)}</table></div>
          <div className="printOnly projectComparisonPrintWrap"><table className="projectTable projectComparisonPrint"><thead><tr><th>연차·기간</th><th>구분</th><th>발전량</th><th>수익 구성</th><th>지출 구성</th><th>순현금흐름</th><th>누적현금흐름</th></tr></thead><tbody>{projectComparisonRows.flatMap(r=>[<tr key={`${r.yearNo}-plan`}><td rowSpan="2"><b>{r.yearNo}년차</b><small>{r.periodStart}<br/>~ {r.periodEnd}</small></td><td>계획</td><td>{nf.format(Math.round(r.planGenerationKwh||0))} kWh</td><td><b>{nf.format(r.planRevenueWon||0)}원</b><small>SMP {nf.format(r.planSmpRevenueWon||0)} · REC {nf.format(r.planRecRevenueWon||0)}</small></td><td><b>{nf.format(r.scheduledRepaymentWon||0)}원</b><small>원금 {nf.format(r.planPrincipalWon||0)} · 이자 {nf.format(r.planInterestWon||0)} · VAT {nf.format(r.planVatWon||0)}</small></td><td>{nf.format(r.planCashflowWon||0)}원</td><td>{nf.format(r.planCumulativeWon||0)}원</td></tr>,<tr key={`${r.yearNo}-actual`}><td>실제</td><td>{r.actualGenerationKwh==null?'-':`${nf.format(Math.round(r.actualGenerationKwh))} kWh`}</td><td>{r.actualValuationRevenueWon==null?'-':<><b>{nf.format(r.actualValuationRevenueWon)}원</b><small>SMP {nf.format(r.actualSmpRevenueWon||0)} · REC평가 {nf.format(r.actualRecValuationWon||0)} · REC실현 {nf.format(r.actualRecRealizedWon||0)}</small></>}</td><td>{r.actualRepaymentWon==null&&r.actualMaintenanceWon==null?'-':<><b>{nf.format(Number(r.actualRepaymentWon||0)+Number(r.actualMaintenanceWon||0))}원</b><small>원금 {nf.format(r.actualPrincipalWon||0)} · 이자 {nf.format(r.actualInterestWon||0)} · VAT {nf.format(r.actualVatWon||0)} · 유지 {nf.format(r.actualMaintenanceWon||0)}</small></>}</td><td>{r.actualCashflowWon==null?'-':`${nf.format(r.actualCashflowWon)}원`}</td><td>{r.actualCumulativeWon==null?'-':`${nf.format(r.actualCumulativeWon)}원`}</td></tr>])}</tbody></table></div>
          <small className="projectFootnote">실제 총수익의 굵은 값은 SMP + REC 평가금이며, 작은 글씨의 현금수익은 SMP + REC 실현수익입니다. 실제 순현금흐름 = 현금수익 − 기일도래 원금 − 기일도래 이자 − VAT − 수기 유지보수비.</small>
        </div>
      </details>

      <details className="projectDetail pdfReportDetail projectSensitivityDetail">
        <summary><div><b>투자지표 · 민감도 계획 vs 실적반영 전망</b><span>SMP·REC·CAPEX 시나리오별 IRR·NPV·회수기간 비교</span></div><span>▾</span></summary>
        <div className="projectDetailBody"><div className="tableScroll"><table className="projectTable projectSensitivityTable"><thead><tr><th>시나리오</th><th>가정<br/>SMP·REC·CAPEX</th><th>계획 IRR</th><th>실적반영 IRR</th><th>계획 NPV<br/>({one.format(project.investmentMetrics?.discountRatePct??5)}%)</th><th>실적반영 NPV<br/>({one.format(project.investmentMetrics?.discountRatePct??5)}%)</th><th>회수기간<br/>계획 → 실적반영</th></tr></thead><tbody>{(project.sensitivity||[]).map(r=><tr key={r.label} className={r.label==='현재'?'projectCurrentScenario':''}><td>{r.label}</td><td>{one.format(r.smpPct)}% · {one.format(r.recPct)}% · {one.format(r.capexPct)}%</td><td>{r.projectIrrPct==null?'-':`${two.format(r.projectIrrPct)}%`}</td><td>{r.forecastIrrPct==null?'-':`${two.format(r.forecastIrrPct)}%`}</td><td>{nf.format(r.npvWon||0)} 원</td><td>{nf.format(r.forecastNpvWon||0)} 원</td><td>{r.paybackYears==null?'-':two.format(r.paybackYears)}년 → {r.forecastPaybackYears==null?'-':two.format(r.forecastPaybackYears)}년</td></tr>)}</tbody></table></div><small className="projectFootnote">‘실적반영’은 이미 발생한 실제 평가수익·유지보수비를 고정하고 현재연차 잔여기간과 미래연차에 시나리오를 적용합니다. REC 민감도는 계약 총 계획수익에서 계획 SMP 수익을 뺀 REC 매출 기여분에 적용합니다. NPV는 현재 설정한 요구수익률을 사용하며, IRR은 요구수익률과 독립적으로 현금흐름 자체에서 계산됩니다.</small></div>
      </details>

      <details className="projectDetail pdfReportDetail projectMaintenanceDetail"><summary><div><b>유지보수·운영 비용 수기 입력·내역</b><span>저장한 실제 지출은 현금흐름·실적반영 전망에 자동 반영</span></div><span>▾</span></summary><div className="projectDetailBody"><div className="maintenanceForm noPrint"><label>지출일자<input type="date" value={maintenanceForm.date} onChange={e=>setMaintenanceForm(v=>({...v,date:e.target.value}))}/></label><label>구분<select value={maintenanceForm.category} onChange={e=>setMaintenanceForm(v=>({...v,category:e.target.value}))}><option>유지보수</option><option>모니터링</option><option>보험</option><option>점검</option><option>수리</option><option>기타</option></select></label><label>업체<input value={maintenanceForm.vendor} onChange={e=>setMaintenanceForm(v=>({...v,vendor:e.target.value}))} placeholder="업체명"/></label><label>금액<input inputMode="numeric" value={maintenanceForm.amount} onChange={e=>setMaintenanceForm(v=>({...v,amount:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="예: 550000"/></label><label className="maintenanceNote">비고<input value={maintenanceForm.note} onChange={e=>setMaintenanceForm(v=>({...v,note:e.target.value}))} placeholder="수리 내용·증빙 메모 등"/></label><div className="maintenanceButtons"><button type="button" onClick={saveMaintenance} disabled={maintenanceSaving}>{maintenanceSaving?'저장 중…':maintenanceForm.id?'수정 저장':'비용 추가'}</button>{maintenanceForm.id&&<button type="button" className="ghost" onClick={cancelMaintenanceEdit}>취소</button>}</div></div>{maintenanceMessage&&<div className="projectSaveMessage noPrint">{maintenanceMessage}</div>}<div className="projectMiniGrid"><div><span>누적 유지보수비</span><b>{nf.format(project.maintenance?.totalWon||0)}원</b></div><div><span>저장 파일</span><b>{project.maintenance?.file||'JCPC_태양광_유지보수비_수기입력.xlsx'}</b></div></div>{project.maintenance?.error&&<div className="projectWarning">{project.maintenance.error}</div>}<div className="tableScroll"><table className="projectTable maintenanceTable"><thead><tr><th>지출일자</th><th>구분</th><th>업체</th><th>금액</th><th>비고</th><th className="noPrint">관리</th></tr></thead><tbody>{(project.maintenance?.items||[]).length?(project.maintenance.items||[]).map(x=><tr key={x.id}><td>{x.date}</td><td>{x.category}</td><td>{x.vendor||'-'}</td><td>{nf.format(x.amount||0)} 원</td><td>{x.note||'-'}</td><td className="noPrint"><button type="button" onClick={()=>editMaintenance(x)}>수정</button></td></tr>):<tr><td colSpan="6">입력된 유지보수 비용이 없습니다.</td></tr>}</tbody></table></div></div></details>

      <details className="projectDetail pdfReportDetail projectCostDetail"><summary><div><b>총 사업비 · 비용 상세구분</b><span>계약 공사원가계산서 기준</span></div><span>▾</span></summary><div className="projectDetailBody"><div className="projectMiniGrid"><div><span>공사비(VAT 별도)</span><b>{nf.format(project.contract?.constructionCostExVat||0)}원</b></div><div><span>VAT</span><b>{nf.format(project.contract?.constructionVat||0)}원</b></div><div><span>공사비(VAT 포함)</span><b>{nf.format(project.contract?.constructionCostInclVat||0)}원</b></div><div><span>금융이자(계약 상환표)</span><b>{nf.format(project.contract?.financingInterest||0)}원</b></div></div><div className="tableScroll"><table className="projectTable projectCostTable"><thead><tr><th>비용 항목</th><th>금액</th><th>공사비 대비</th></tr></thead><tbody>{(project.costBreakdown||[]).map(r=><tr key={r.key}><td>{r.label}</td><td>{nf.format(r.value)} 원</td><td>{project.contract?.constructionCostExVat?`${two.format(r.value/project.contract.constructionCostExVat*100)}%`:'-'}</td></tr>)}</tbody></table></div></div></details>

      <details className="projectDetail pdfReportDetail projectRepaymentDetail"><summary><div><b>계산서 발행 · 원리금 지급 스케줄</b><span>{project.source?.repaymentSource==='google-drive'?'Google Drive 실시간 원본':'내장 백업본'} · 기준일 {project.source?.repaymentAsOf||'-'}</span></div><span>▾</span></summary><div className="projectDetailBody"><div className="projectSourceLinks noPrint"><a href={project.source?.contractPath||'/docs/solar-contract-KT-JCPC-2021-07-10.pdf'} target="_blank" rel="noreferrer">KT 계약서 ↗</a>{project.source?.repaymentUrl&&<a href={project.source.repaymentUrl} target="_blank" rel="noreferrer">계산서 발행 및 입출금 내역 ↗</a>}</div><div className="projectMiniGrid"><div><span>첫 일반 계산서</span><b>{project.financeCalendar?.firstInvoiceDate||'-'}</b></div><div><span>발행 회차</span><b>{project.actualRepayment?.issuedInstallments||0}/{project.contract?.installmentCount||60}회</b></div><div><span>기일 도래 회차</span><b>{project.actualRepayment?.dueInstallments||0}회</b></div><div><span>발행했으나 미도래</span><b>{project.actualRepayment?.notDueIssuedInstallments||0}회 · {nf.format(project.actualRepayment?.notDueIssuedInclVat||0)}원</b></div><div><span>기일 도래 누계</span><b>{nf.format(project.actualRepayment?.paidInclVat||0)}원</b></div><div><span>전체 금융원리금 잔여</span><b>{nf.format(project.actualRepayment?.remainingInclVat||0)}원</b></div><div><span>실제 원금 누계</span><b>{nf.format(project.actualRepayment?.actualPrincipalPaidWon||0)}원</b></div><div><span>실제 이자 누계</span><b>{nf.format(project.actualRepayment?.actualInterestPaidWon||0)}원</b></div><div><span>실제 VAT 누계</span><b>{nf.format(project.actualRepayment?.actualVatPaidWon||0)}원</b></div></div><div className="tableScroll"><table className="projectTable projectRepaymentTable"><thead><tr><th>금융연차·기간</th><th>회차</th><th>발행</th><th>기일도래</th><th>계획 원금</th><th>계획 이자</th><th>계획 VAT</th><th>실제지급 원금</th><th>실제지급 이자</th><th>실제 VAT</th><th>기일도래 총액</th><th>발행 미도래</th></tr></thead><tbody>{(project.actualRepayment?.yearly||[]).map(r=><tr key={r.yearNo}><td><b>{r.yearNo}년차</b><small>{r.periodStart} ~ {r.periodEnd}</small></td><td>{r.installmentStart}~{r.installmentEnd}회</td><td>{r.issuedInstallments||0}회</td><td>{r.dueInstallments||0}회</td><td>{nf.format(r.planPrincipalWon||0)} 원</td><td>{nf.format(r.planInterestWon||0)} 원</td><td>{nf.format(r.planVatWon||0)} 원</td><td>{nf.format(r.actualPrincipalDueWon||0)} 원</td><td>{nf.format(r.actualInterestDueWon||0)} 원</td><td>{nf.format(r.actualVatDueWon||0)} 원</td><td>{nf.format(r.repaymentDueInclVat||0)} 원</td><td>{nf.format(r.futureIssuedInclVat||0)} 원</td></tr>)}</tbody></table></div><div className="projectInvoiceSubhead"><b>최근 원리금 계산서</b><span>작성일자·합계금액 → 계산 지급일(익익월 말일)</span></div><div className="tableScroll"><table className="projectTable projectInvoiceTable"><thead><tr><th>회차</th><th>작성일자</th><th>계산 지급일</th><th>합계금액</th><th>공급가액</th><th>VAT</th><th>원금 배분</th><th>이자 배분</th><th>상태</th></tr></thead><tbody>{(project.actualRepayment?.recentInvoices||[]).map(r=><tr key={`${r.installmentNo}-${r.invoiceDate}`}><td>{r.installmentNo}회</td><td>{r.invoiceDate}</td><td>{r.dueDate}</td><td><b>{nf.format(r.gross||0)} 원</b></td><td>{nf.format(r.supply||0)} 원</td><td>{nf.format(r.vat||0)} 원</td><td>{nf.format(r.actualPrincipalWon||0)} 원</td><td>{nf.format(r.actualInterestWon||0)} 원</td><td>{r.isDue?'기일 도래':'미도래'}</td></tr>)}</tbody></table></div><small className="projectFootnote"><b>원본 기준:</b> 계산서 시트의 작성일자·합계금액을 지속적으로 읽습니다. {project.repaymentSchedule?.paymentRule||'지급일은 계산서 작성일 기준 익익월 말일로 계산합니다.'} 정부보조금 표기 행은 일반 60회 금융원리금 회차에서 제외합니다.</small></div></details>
    </div>
  </section>}


  <section id="compare-summary" className="grid2 navTarget"><div className="card tableCard"><div className="sectionTitle"><h2>동기간 요약</h2></div><div className="tableScroll"><table className="mobileSummary compactSummary"><thead><tr><th>구분</th><th>기간</th><th>발전량</th><th>수익</th><th>평균 SMP</th><th>이용률</th><th>등가시간</th><th>일평균 등가시간</th></tr></thead><tbody>{(data?.yearly||[]).map((r,i)=><tr key={i}><td data-label="구분">{r.label}</td><td data-label="기간">{r.period}</td><td data-label="발전량">{nf.format(r.kwh)}</td><td data-label="수익">{nf.format(r.revenue)}</td><td data-label="평균 SMP">{r.avgSmp==null?'-':two.format(r.avgSmp)}</td><td data-label="이용률">{r.efficiency==null?'-':`${two.format(r.efficiency)}%`}</td><td data-label="등가시간">{r.generationHours==null?'-':`${two.format(r.generationHours)}h`}</td><td data-label="일평균 등가시간">{r.avgDailyGenerationHours==null?'-':`${two.format(r.avgDailyGenerationHours)}h/일`}</td></tr>)}</tbody></table></div></div><details className="card rules collapsibleCard"><summary className="collapseSummary"><div><h2>핵심 계산식</h2><span>계산 기준 보기</span></div><b className="collapseChevron">▾</b></summary><div className="collapseBody"><ul><li><b>설비이용률(CF)</b> = 발전량(kWh) ÷ [설비용량(kW) × 기간시간(h)] × 100</li><li><b>동일식</b> = 등가 발전시간(h) ÷ 기간시간(h) × 100 · 하루 기준이면 등가 발전시간 ÷ 24 × 100</li><li><b>등가 발전시간</b> = 발전량(kWh) ÷ 설비용량(kW)</li><li><b>일평균 등가 발전시간</b> = 등가 발전시간 ÷ 조회일수</li><li><b>인버터 출력효율</b> = AC 출력 ÷ DC 입력 × 100 (현재 발전보고서에 DC 입력값이 없어 공식만 표시)</li><li><b>모듈 변환효율</b> = 모듈 출력 ÷ [일사강도(1,000W/㎡) × 모듈면적] × 100</li><li><b>SMP 수익</b> = 시간자료는 시간별 발전량 × 시간별 SMP, 일 이상은 일 발전량 × 해당 일 1h~24h 평균 SMP를 합산</li></ul></div></details></section>


  <details id="terms" className="card terminologyCard collapsibleCard navTarget"><summary className="collapseSummary"><div><h2>용어 및 계산 정리</h2><span>발전량·발전시간·설비이용률·변환효율 개념 보기</span></div><b className="collapseChevron">▾</b></summary><div className="collapseBody"><div className="termGrid"><div><b>설비용량 (kW)</b><span>발전소가 정격조건에서 낼 수 있는 최대 출력입니다. 현재 입력값 기준 인버터1 {one.format(c1)}kW + 인버터2 {one.format(c2)}kW = 합계 {one.format(totalCap)}kW입니다.</span></div><div><b>발전량 (kWh)</b><span>일정 기간 동안 실제로 생산한 전기에너지의 누적량입니다.</span></div><div><b>등가 발전시간 (h)</b><code>발전량(kWh) ÷ 설비용량(kW)</code><span>정격출력으로 몇 시간 발전한 것과 같은지를 나타냅니다. 예: 199kW 설비가 796kWh 생산 → 4.0시간.</span></div><div><b>설비이용률 (CF, %)</b><code>발전량 ÷ (설비용량 × 기간시간) × 100</code><span>또는 <b>등가 발전시간 ÷ 기간시간 × 100</b>. 하루라면 기간시간=24시간이므로 블로그 식처럼 <b>발전시간 ÷ 24 × 100</b>과 동일합니다.</span></div><div><b>일평균 등가 발전시간 (h/일)</b><code>조회기간 등가 발전시간 ÷ 조회일수</code><span>태양광 현장에서 흔히 ‘하루 발전시간’이라고 부르는 값에 가깝습니다.</span></div><div><b>인버터 변환효율 (%)</b><code>AC 출력 ÷ DC 입력 × 100</code><span>DC를 AC로 바꾸는 장치 효율로, 설비이용률과는 다른 지표입니다. DC 입력값이 있어야 계산할 수 있습니다.</span></div><div><b>모듈 변환효율 (%)</b><code>모듈 전기출력 ÷ (일사강도 × 모듈면적) × 100</code><span>태양광 모듈 자체의 광→전기 변환 성능입니다.</span></div><div><b>SMP 수익</b><code>시간별 발전량 × 시간별 SMP / 일 발전량 × 일평균 SMP</code><span>일 이상 집계는 각 날짜의 1h~24h 평균 SMP를 적용해 일별 수익을 계산한 뒤 합산합니다. 기간 평균 SMP는 발전량 0인 날을 제외한 일평균 SMP의 산술평균입니다.</span></div><div><b>REC 소수점·이월 규칙</b><code>당월 산정 REC = 공급전력량(kWh) ÷ 1,000 × 가중치</code><span>산정값은 <b>소수점 셋째 자리까지 보유</b>하고 <b>넷째 자리 이하는 절사</b>합니다. 전월에서 이월된 소수 REC를 더한 뒤 정수 부분만 발급하고, 1 REC 미만 소수부는 다음 달로 자동 이월합니다.</span></div></div><div className="termNote"><b>중요:</b> 이 대시보드의 ‘설비이용률’은 인버터 정격용량 합계를 설비용량으로 사용합니다. 실제 공식 신고 설비용량이 인버터 합계와 다르면 그 신고 용량을 입력하는 것이 정확합니다.</div></div></details>

  <details id="formula" className="card formulaCard collapsibleCard navTarget"><summary className="collapseSummary"><div><h2>발전량 예측·효율 계산 참고식</h2><span>일조시간·일사량·생산량 기반 참고식 보기</span></div><b className="collapseChevron">▾</b></summary><div className="collapseBody"><div className="formulaGrid"><div><b>① 일조시간 기반</b><code>연간 발전량 = 설치용량 × 연간 일조시간 × 0.6</code><span>일조시간 대비 실제 등가발전시간을 약 60%로 보는 간이식</span></div><div><b>② 일사량 기반</b><code>일 발전량 = 일사량(kWh/㎡/일) × 모듈면적 × 모듈효율</code><span>연간값은 일 발전량 × 365</span></div><div><b>③ 신재생에너지 생산량 기반</b><code>연간 생산량 = 설치규모 × 단위 에너지생산량 × 보정계수</code><span>공공 설계·예측용 참고식</span></div></div></div></details>

  {data?.rec&&<section id="rec-section" className="card recCard navTarget">
    <div className="sectionTitle"><div><h2>REC 발급량 · 단가 · 유효기간 · 수익화/폐기 관리</h2><p>발급량과 시세뿐 아니라 실제 발급일 기준 3년 유효기간, 6개월 이내 만료 임박, 수익화·폐기·유효 잔량까지 함께 관리합니다.</p></div><a className="actionLink" href="https://rps.energy.or.kr/login.do" target="_blank" rel="noreferrer">REC 발급신청 ↗</a></div>
    <div className="recKpis recKpis6">
      <div><span>조회기간 실제+예상 REC</span><strong>{nf.format(data.rec.estimatedRec)} REC</strong><small>실제 {nf.format(data.rec.selectedActualIssuedRec||0)} + 미발급 예상 {nf.format(data.rec.selectedForecastRec||0)}</small></div>
      <div><span>다음달 이월 REC</span><strong>{three.format(data.rec.carryBalance||0)} REC</strong></div>
      <div><span>실제 누적 발급 REC</span><strong>{nf.format(data.rec.ledger?.cumulativeRec||0)} REC</strong><small>실제 발급현황 + 수기 발급</small></div>
      <div><span>누적 수익화 REC</span><strong>{two.format(data.rec.ledger?.cumulativeMonetized||0)} REC</strong><small>수기 입력 거래량 기준</small></div>
      <div><span>남은 실제 발급 REC</span><strong>{two.format(data.rec.ledger?.remainingRec||0)} REC</strong></div>
      <div><span>누적 수익화 금액</span><strong>{nf.format(recMoney(data.rec.ledger?.cumulativeMonetizedAmount||0))} 원</strong><small>{recVatMode==='gross'?'VAT 포함 표시':'공급가 표시'}</small></div>
      <div><span>남은 REC 평가금</span><strong>{recRemainingValuationDisplay==null?'-':`${nf.format(recRemainingValuationDisplay)} 원`}</strong><small>{recValuationPrice==null?'단가 없음':`${nf.format(recUnitPrice(recValuationPrice))}원/REC 적용`}</small></div>
      <div><span>조회기간 REC 가치</span><strong>{recSelectedValuationAmountDisplay==null?'-':`${nf.format(recSelectedValuationAmountDisplay)} 원`}</strong><small>수익화분 실제단가 + 미수익화분 선택단가</small></div>
    </div>
    <div className="recValueRuleNote"><b>실제 발급량과 예상 발급량 구분</b><span><b>실제 누적 발급 REC</b>는 첨부 REC 발급현황 2022~2026과 수기 발급만 합산합니다. <b>조회기간 실제+예상 REC</b>는 실제 발급월은 실제값을 쓰고, 아직 미발급인 월만 발전량×기본 공급비율로 예상하므로 두 값은 정상적으로 다를 수 있습니다.</span></div>
    <div className="recSettingGrid">
      <div className="recSettingCard">
        <div className="recSettingHead"><b>그래프 설정</b><span>REC 막대와 금액 산정 기준을 선택합니다.</span></div>
        <div className="recControlGroup"><label>막대 그래프</label><div className="segments"><button className={recBarMetric==='issuance'?'active':''} onClick={()=>setRecBarMetric('issuance')}>발급량</button><button className={recBarMetric==='amount'?'active':''} onClick={()=>setRecBarMetric('amount')}>금액</button></div></div>
        <div className="recControlGroup"><label>금액 표시 기준</label><div className="segments"><button className={recVatMode==='net'?'active':''} onClick={()=>saveRecVatMode('net')}>공급가</button><button className={recVatMode==='gross'?'active':''} onClick={()=>saveRecVatMode('gross')}>VAT 포함</button></div><span className="controlHint">수기 입력·저장은 항상 공급가 기준이며 표시만 전환됩니다.</span></div>
        {<div className="recControlGroup"><label>미수익화 REC 평가단가</label><div className="segments"><button className={recPriceMode==='current'?'active':''} onClick={()=>setRecPriceMode('current')}>현재 REC 단가</button><button className={recPriceMode==='date'?'active':''} onClick={()=>setRecPriceMode('date')}>특정 일자</button><button className={recPriceMode==='manual'?'active':''} onClick={()=>setRecPriceMode('manual')}>직접 입력</button></div></div>}
        {recPriceMode==='date'&&<div className="recControlGroup recDatePrice"><label>기준 일자</label><input type="date" value={recPriceDate} onChange={e=>setRecPriceDate(e.target.value)}/></div>}
        {recPriceMode==='manual'&&<div className="recControlGroup recDatePrice"><label>직접 평가단가</label><div className="inputUnit compactInput"><input inputMode="numeric" value={recManualPrice} onChange={e=>saveRecManualPrice(e.target.value)} placeholder={recCurrentPrice==null?'예: 70000':String(Math.round(recCurrentPrice))}/><em>원/REC</em></div><span className="controlHint">공급가 기준으로 입력합니다.</span></div>}
        {<div className="recPriceStatus"><b>{recPriceLoading?'가격 조회 중…':recValuationPrice==null?'기준 단가 없음':`${nf.format(recUnitPrice(recValuationPrice))} 원/REC`}</b><span>{recVatMode==='gross'?'VAT 포함 표시 · ': '공급가 표시 · '}{recValuationDate&&recValuationDate!=='직접입력'?`가격 기준 거래일 ${String(recValuationDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')}`:recValuationDate==='직접입력'?'사용자 직접 입력 단가':''}{recPriceMode==='date'&&recPriceLookup?.fromCache?' · Drive 일별 캐시 사용':''}</span>{recPriceLookup&&!recPriceLookup.ok&&<span className="smpErr">{recPriceLookup.message}</span>}</div>}
      </div>
      <div className="recSettingCard">
        <div className="recSettingHead"><b>REC 산정 기준</b><span>실제 공급전력량이 없을 때 적용하는 추정 비율입니다.</span></div>
        <div className="recControlGroup recSupplyRatioControl"><label>REC 공급량 추정비율</label><div className="inputUnit compactInput"><input inputMode="decimal" value={recSupplyRatioPct} onChange={e=>saveRecSupplyRatio(e.target.value)} /><em>%</em></div><span className="controlHint">RPS 발급내역 Excel이 있으면 실제 공급전력량을 우선 사용합니다.</span></div>
        <div className="recInlineInfo"><span>현재 적용비율</span><b>{one.format((Number(recSupplyRatioPct)||0))}%</b></div>
      </div>
      <div className="recSettingCard">
        <div className="recSettingHead"><b>REC 단가축</b><span>자동 또는 직접 입력으로 오른쪽 축 범위를 조정합니다.</span></div>
        <div className="recControlGroup recAxisControl"><label>축 설정 방식</label><div className="segments"><button className={recPriceAxisMode==='auto'?'active':''} onClick={()=>saveRecAxisMode('auto')}>자동</button><button className={recPriceAxisMode==='manual'?'active':''} onClick={()=>saveRecAxisMode('manual')}>직접 설정</button></div><span className="controlHint">자동: 최저·최고 REC 단가를 1,000원 단위로 내린 뒤 최소축은 -1,000원, 최대축은 +1,000원 적용</span></div>
        {recPriceAxisMode==='manual'&&<div className="recControlGroup recAxisFields"><label>축 최소 / 최대</label><div className="axisFieldRow"><div className="inputUnit compactInput"><input inputMode="numeric" value={recPriceAxisMin} onChange={e=>saveRecAxisValue('min',e.target.value)} placeholder={recAutoPriceAxis.min==null?'최소':String(recAutoPriceAxis.min)}/><em>원</em></div><span>~</span><div className="inputUnit compactInput"><input inputMode="numeric" value={recPriceAxisMax} onChange={e=>saveRecAxisValue('max',e.target.value)} placeholder={recAutoPriceAxis.max==null?'최대':String(recAutoPriceAxis.max)}/><em>원</em></div></div>{!recManualAxisValid&&<span className="controlHint axisWarn">최대값은 최소값보다 크게 입력하세요. 잘못된 경우 자동축을 사용합니다.</span>}</div>}
        {recPriceAxisMode==='auto'&&recAutoPriceAxis.min!=null&&<div className="recPriceStatus recAxisStatus"><b>{nf.format(recAutoPriceAxis.min)} ~ {nf.format(recAutoPriceAxis.max)} 원/REC</b><span>조회 단가 {nf.format(Math.round(recAutoPriceAxis.dataMin))} ~ {nf.format(Math.round(recAutoPriceAxis.dataMax))}원 기준 자동축</span></div>}
      </div>
    </div>
    <details className="recInfoDetails collapsibleCard"><summary className="collapseSummary compact"><div><h3>REC 산정 · 데이터 기준</h3><span>산정식·캐시·공급전력량·비교 기준 보기</span></div><b className="collapseChevron">▾</b></summary><div className="collapseBody recInfoBody">    <div className="recRule"><b>{data.rec.rule}</b><span><b>소수점 처리:</b> 소수점 넷째 자리 이하는 절사하고 셋째 자리까지 관리합니다. 전월 이월 REC + 당월 산정 REC 중 <b>정수 부분만 발급</b>하며 남은 소수부는 다음 달로 이월합니다.</span><span><b>유효기간:</b> {data.rec.validityRule}</span><span><b>발급신청 기한:</b> 전력공급일이 속한 달의 말일부터 90일 이내입니다. 이 90일 기한과 발급 후 3년 유효기간은 서로 다른 기준입니다.</span><span><b>중요:</b> REC는 발전보고서 전체 발전량이 아니라 RPS가 인정한 <b>공급전력량</b>을 기준으로 계산합니다.</span><span>{data.rec.priceRule}</span><span>{data.rec.assumption}</span><span><b>평가 원칙:</b> 이미 수익화된 REC는 실제 수익화 금액/단가를 그대로 사용하고, 아직 수익화되지 않은 REC만 현재가·특정일·직접입력 단가로 평가합니다. VAT 포함 보기는 저장값을 바꾸지 않고 표시값만 10% 가산합니다.</span></div>
    {data.rec.marketHistory?.cache&&<div className="recCacheStatus"><b>REC API 호출 절약 캐시</b><span>Drive 누적 {nf.format(data.rec.marketHistory.cache.rows||0)}개월 · 이번 화면 캐시 재사용 {nf.format(data.rec.marketHistory.cache.hits||0)}개월 · 신규 API 호출 {nf.format(data.rec.marketHistory.cache.apiCalls||0)}회</span><span>월별 가격: {data.rec.marketHistory.cache.file||'REC_현물시장_월별캐시.xlsx'} · 특정일 가격은 REC_현물시장_일별캐시.xlsx에 누적됩니다.</span><span>수익화·폐기 거래내역: {data.rec.ledger?.file||'REC_수익화_수기입력.xlsx'} · 발급일 보정: {data.rec.ledger?.issueDateFile||'REC_발급일_수기입력.xlsx'} · 저장/수정하려면 서비스계정을 Drive 폴더에 편집자로 공유해야 합니다.</span>{data.rec.marketHistory.cache.saveError&&<span className="smpErr">Drive 저장 실패: {data.rec.marketHistory.cache.saveError}</span>}{data.rec.ledger?.error&&<span className="smpErr">수익화 파일 읽기 실패: {data.rec.ledger.error}</span>}</div>}
    <div className="recCacheStatus rpsSupplyStatus"><b>REC 공급전력량 기준</b><span>{data.rec.rpsIssuance?.hasActual?`첨부 REC 발급현황 2022~2026의 실제 발급월 ${nf.format(data.rec.rpsIssuance.actualMonthCount||0)}개월(실제 발급 ${nf.format(data.rec.rpsIssuance.actualIssuedTotal||0)} REC)을 우선 적용합니다. Drive에 더 최신 RPS/REC 실적 파일이 있으면 같은 월을 최신 자료로 덮어씁니다.`:`실제 발급실적이 없어 발전보고서 발전량의 ${nf.format(Math.round((data.rec.supplyRatio||0)*1000)/10)}%를 공급전력량으로 추정 중입니다.`}</span><span>아직 발급되지 않은 월은 발전량 × <b>{one.format((data.rec.supplyRatio||0)*100)}%</b>로 계산합니다.</span><span>조회기간 REC 기준 공급전력량: <b>{nf.format(Math.round((data.rec.selectedSupplyMwh||0)*1000))} kWh</b></span>{data.rec.rpsIssuance?.latestMonth&&<span>실제 발급 최신월: {data.rec.rpsIssuance.latestMonth}</span>}</div>
    {data.rec.market&&!data.rec.market.ok&&<div className="apiWarn">REC 시세 자동조회: {data.rec.market.message} <a href="https://www.data.go.kr/data/15099762/openapi.do" target="_blank" rel="noreferrer">OpenAPI 확인 ↗</a></div>}
    {benchmarkBarMetric!=='off'&&<div className="benchmarkRecNotice">전국·지역 막대 비교가 ON입니다. REC 그래프에도 선택 지역과 전국의 평균 발전량을 기준으로 환산한 REC 발급량/평가금액 막대가 함께 표시됩니다.</div>}
    </div></details>
    <div className="recChartWrap"><ReactECharts ref={recChartRef} key={`${recChartKey}-${recBarMetric}-${recPriceMode}-${recValuationPrice??'na'}-${recVatMode}`} option={recOption} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div>
    {!!data.rec.issuanceWarnings?.length&&<div className="recIssuanceWarning"><b>REC 실적 이상치 자동 보정</b><span>{data.rec.issuanceWarnings.slice(-3).map(x=>`${x.month}: ${x.message}`).join(' · ')}</span></div>}
    <div className="printOnly recPrintSnapshot"><div className="recPrintSnapshotHead"><b>REC 조회기간 요약</b><span>현재 화면 집계기준 · 최신 {Math.min(12,recRowsSorted.length)}개 구간</span></div><table><thead><tr><th>{recPeriodLabel}</th><th>발전량</th><th>REC 공급전력량</th><th>산정 REC</th><th>발급량</th><th>REC 평균가</th><th>예상금액</th></tr></thead><tbody>{recRowsSorted.slice(0,12).map(r=><tr key={`print-${r.period}`}><td>{formatRecPeriodLabel(r.period,recTableMode)}</td><td>{nf.format(Math.round(Number(r.kwh||0)))} kWh</td><td>{nf.format(Math.round(Number(r.supplyKwh||0)))} kWh</td><td>{three.format(r.calcRec||0)}</td><td>{nf.format(r.issuedRec||0)} REC</td><td>{r.price==null?'-':`${nf.format(recUnitPrice(r.price))} 원`}</td><td>{r.estimatedRevenue==null?'-':`${nf.format(recMoney(r.estimatedRevenue))} 원`}</td></tr>)}</tbody></table></div>

    <details className="recLifecycleBox recLifecycleDetails collapsibleCard pdfReportDetail"><summary className="collapseSummary recLifecycleSummary"><div><b>REC 유효기간 · 잔량 관리</b><span>기본 발급일은 <b>발전월 말일 + 90일</b>, 기본 만료일은 <b>그 발급일 + 3년</b>으로 계산합니다. 실제 발급일이 다를 때만 아래에서 직접 수정하면 됩니다.</span></div><div className="recLifecycleAsOf">기준일 <b>{localIso()}</b></div><b className="collapseChevron">▾</b></summary><div className="collapseBody recLifecycleBody">      <div className="recLifecycleKpis recLifecycleKpis5">
        <div><span>총 발급 REC</span><strong>{two.format(data.rec.ledger?.cumulativeRec||0)} REC</strong></div>
        <div><span>총 잔여 REC</span><strong>{two.format(data.rec.ledger?.remainingRec||0)} REC</strong></div>
        <div><span>총 수익화 REC</span><strong>{two.format(data.rec.ledger?.cumulativeMonetized||0)} REC</strong><small>소유권이전完</small></div>
        <button type="button" className={`recLifecycleKpiButton ${Number(data.rec.ledger?.totalDisposed||0)>0?'danger':''}`} onClick={()=>setLifecyclePopup('disposed')}><span>총 폐기된 REC</span><strong>{two.format(data.rec.ledger?.totalDisposed||0)} REC</strong><small>직접 폐기 + 유효기간 만료 · 목록 보기</small></button>
        <button type="button" className={`recLifecycleKpiButton ${Number(data.rec.ledger?.expiringSoon||0)>0?'warn':''}`} onClick={()=>setLifecyclePopup('expiring')}><span>총 폐기예정 REC</span><strong>{two.format(data.rec.ledger?.expiringSoon||0)} REC</strong><small>유효기간 6개월 이내 · 목록 보기</small></button>
      </div>
      {(Number(data.rec.ledger?.unallocatedMonetized||0)>0||Number(data.rec.ledger?.unallocatedDisposed||0)>0)&&<div className="recLifecycleWarn">입력된 거래/폐기 수량이 대시보드에서 확인된 발급 REC보다 큽니다. 미배정 수량: 수익화 {two.format(data.rec.ledger?.unallocatedMonetized||0)} REC · 폐기 {two.format(data.rec.ledger?.unallocatedDisposed||0)} REC. 과거 발급실적을 추가 확인하세요.</div>}
      <details className="recIssueDateManager recIssueDateDetails">
        <summary><b>발급일 직접 수정</b><span>필요한 경우에만 사용</span></summary>
        <div className="recIssueDateTitle"><span>기본값은 발전월 말일 + 90일입니다. RPS 실제 발급일이 있으면 그 날짜를 우선하고, 여기서 저장한 수기 수정값은 가장 높은 우선순위로 적용합니다.</span></div>
        <div className="recIssueDateForm">
          <label><span>발전월</span><select value={recIssueForm.month} onChange={e=>{const month=e.target.value;const lot=recIssueLots.find(x=>x.month===month);setRecIssueForm({month,issueDate:lot?.issueDate||'',note:''});setRecIssueMessage('')}}><option value="">선택</option>{[...recIssueLots].sort((a,b)=>String(b.month).localeCompare(String(a.month))).map(l=><option key={l.month} value={l.month}>{l.month} · {two.format(l.qty||0)} REC</option>)}</select></label>
          <label><span>적용 발급일</span><input type="date" value={recIssueForm.issueDate} onChange={e=>setRecIssueForm(v=>({...v,issueDate:e.target.value}))}/></label>
          <label className="recIssueNote"><span>비고</span><input value={recIssueForm.note} onChange={e=>setRecIssueForm(v=>({...v,note:e.target.value}))} placeholder="실제 발급일 확인 메모 등"/></label>
          <button className="saveLedgerBtn" disabled={recIssueSaving||!recIssueForm.month||!recIssueForm.issueDate} onClick={saveRecIssueDate}>{recIssueSaving?'저장중':'발급일 수정 저장'}</button>
        </div>
        {selectedRecIssueLot&&<div className="recIssuePreview"><span>기본 발급일 <b>{selectedRecIssueLot.defaultIssueDate||'-'}</b></span><span>현재 적용 <b>{selectedRecIssueLot.issueDate||'-'}</b> · {selectedRecIssueLot.issueDateSource||'-'}</span><span>현재 만료일 <b>{selectedRecIssueLot.expiryDate||'-'}</b></span></div>}
        {recIssueMessage&&<div className={/저장/.test(recIssueMessage)?'txnMessage saveOk':'txnMessage saveErr'}>{recIssueMessage}</div>}
      </details>
    </div></details>

    <div className="recMonetizationBox">
      <div className="recMonetizationHead"><div><b>REC 발급 · 수익화 · 폐기 거래내역</b><span>실제 발급량이 자동 데이터에 없을 때 수기로 추가하고, 수익화와 별도 폐기도 일자별로 기록합니다. 수기 발급 REC도 발급일로부터 3년 유효기간을 적용합니다.</span></div><div className="recMonetizationSummary"><span>수기 발급 <b>{two.format(data.rec.ledger?.manualIssued||0)} REC</b></span><span>누적 수익화 <b>{two.format(data.rec.ledger?.cumulativeMonetized||0)} REC</b></span><span>직접 폐기 <b>{two.format(data.rec.ledger?.manualDisposed||0)} REC</b></span><span>만료 폐기 <b>{two.format(data.rec.ledger?.autoExpired||0)} REC</b></span><span>유효 잔여 <b>{two.format(data.rec.ledger?.remainingRec||0)} REC</b></span></div></div>
      <div className="recTxnType"><span>처리 유형</span><div className="segments"><button className={recTxnForm.type==='issued'?'active':''} onClick={()=>setRecTxnForm(v=>({...v,type:'issued',amount:''}))}>발급량 추가</button><button className={recTxnForm.type==='monetized'?'active':''} onClick={()=>setRecTxnForm(v=>({...v,type:'monetized'}))}>수익화 (소유권이전完)</button><button className={recTxnForm.type==='disposed'?'active':''} onClick={()=>setRecTxnForm(v=>({...v,type:'disposed',amount:''}))}>폐기</button></div></div>
      <div className="recTxnForm">
        <label><span>{recTxnForm.type==='issued'?'발급 일자':'처리 일자'}</span><input type="date" value={recTxnForm.date} onChange={e=>setRecTxnForm(v=>({...v,date:e.target.value}))}/></label>
        <label><span>{recTxnForm.type==='issued'?'발급 REC':recTxnForm.type==='disposed'?'폐기 REC':'수익화 REC'}</span><div className="inputUnit"><input inputMode="decimal" value={recTxnForm.qty} onChange={e=>setRecTxnForm(v=>({...v,qty:e.target.value.replace(/[^0-9.]/g,'')}))} placeholder="예: 50"/><em>REC</em></div></label>
        <label><span>{recTxnForm.type==='monetized'?'수익화 금액 (공급가)':'금액'}</span><div className="inputUnit"><input inputMode="numeric" disabled={recTxnForm.type!=='monetized'} value={recTxnForm.type==='monetized'?recTxnForm.amount:''} onChange={e=>setRecTxnForm(v=>({...v,amount:e.target.value.replace(/[^0-9]/g,'')}))} placeholder={recTxnForm.type==='issued'?'발급은 금액 없음':recTxnForm.type==='disposed'?'폐기는 금액 없음':'예: 3500000'}/><em>원</em></div></label>
        <label className="recTxnNote"><span>비고</span><input value={recTxnForm.note} onChange={e=>setRecTxnForm(v=>({...v,note:e.target.value}))} placeholder={recTxnForm.type==='issued'?'발급내역·확인 메모 등':recTxnForm.type==='disposed'?'폐기사유 등':'거래처·정산 메모 등'}/></label>
        <div className="recTxnActions"><button className="saveLedgerBtn" disabled={recTxnSaving} onClick={saveRecTransaction}>{recTxnSaving?'저장중':recTxnForm.id?'수정 저장':recTxnForm.type==='issued'?'발급량 추가':recTxnForm.type==='disposed'?'폐기내역 추가':'수익화내역 추가'}</button>{recTxnForm.id&&<button className="cancelLedgerBtn" onClick={cancelRecTransactionEdit}>수정 취소</button>}</div>
      </div>
      {recTxnMessage&&<div className={/저장|수정/.test(recTxnMessage)?'txnMessage saveOk':'txnMessage saveErr'}>{recTxnMessage}</div>}
      <div className="tableScroll"><table className="recTxnTable"><thead><tr><th>유형</th><th>처리 일자</th><th>수량</th><th>금액 ({recVatMode==='gross'?'VAT 포함':'공급가'})</th><th>실현 단가 ({recVatMode==='gross'?'VAT 포함':'공급가'})</th><th>비고</th><th>수정시각</th><th>관리</th></tr></thead><tbody>{recTransactions.length?recTransactions.map(t=>{const qty=Number(t.qty??t.issuedQty??t.monetizedQty??t.disposedQty??0),amount=Number(t.amount??t.monetizedAmount??0),unit=t.type!=='monetized'||qty<=0?null:amount/qty;const typeLabel=t.type==='issued'?'발급':t.type==='disposed'?'폐기':'수익화';return <tr key={t.id}><td><span className={`txnTypeBadge ${t.type==='issued'?'issued':t.type==='disposed'?'disposed':'monetized'}`}>{typeLabel}</span></td><td>{t.date||'-'}</td><td>{two.format(qty)} REC</td><td>{t.type==='monetized'?`${nf.format(recMoney(amount))} 원`:'-'}</td><td>{unit==null?'-':`${nf.format(recUnitPrice(unit))} 원/REC`}</td><td className="txnNoteCell">{t.note||'-'}</td><td>{fmtDateTime(t.updatedAt)}</td><td><div className="ledgerManageBtns"><button className="editLedgerBtn" onClick={()=>editRecTransaction(t)}>수정</button><button className="deleteLedgerBtn" disabled={recTxnSaving} onClick={()=>deleteRecTransaction(t)}>삭제</button></div></td></tr>}):<tr><td colSpan="8" className="emptyTxn">저장된 발급·수익화·폐기 내역이 없습니다.</td></tr>}</tbody></table></div>
    </div>

    {['hour','day'].includes(recTableMode)&&<div className="fineRecNotice"><b>시간·일 REC는 조회용 환산값</b><span>해당 월의 실제/추정 REC 발급량과 공급전력량을 각 시간·일 발전량 비중으로 배분합니다. 실제 발급일·만료일·이월 관리는 월 기준입니다.</span></div>}
    <div className="tableScroll"><table className="recLedgerTable recMonthlyTable"><thead><tr><th>{recPeriodLabel}</th><th>발전량(kWh)</th><th><span>REC 기준<br/>공급전력량(kWh)</span></th><th>공급비율</th><th>가중치</th><th>산정 REC</th><th>기초 이월 REC</th><th>발급량</th><th>기말 이월 REC</th><th>적용 발급일</th><th>REC 만료일</th><th>만료 상태</th><th>REC 평균가</th><th>예상금액</th><th>누적 REC</th><th>누적 수익화 REC</th><th>누적 폐기 REC</th><th>누적 수익화 금액</th><th>유효 잔여 REC</th><th>발급신청 마감</th><th>발급신청 상태</th></tr></thead><tbody>{recRowsVisible.map(r=><tr key={r.period}><td>{formatRecPeriodLabel(r.period,recTableMode)}</td><td>{nf.format(Math.round(Number(r.kwh||0)))}</td><td>{one.format(Number(r.supplyKwh||0))}</td><td>{r.supplyRatio==null?'-':`${one.format(r.supplyRatio*100)}%`}</td><td>{r.weight}</td><td>{three.format(r.calcRec||0)}</td><td>{r.carryIn==null?'-':three.format(r.carryIn)}</td><td><b>{nf.format(r.issuedRec||0)}</b></td><td>{r.carryOut==null?'-':three.format(r.carryOut)}</td><td>{['hour','day'].includes(recTableMode)?'월 기준':recTableMode==='month'?(r.issueDate||'-'):'월별 개별'}</td><td>{['hour','day'].includes(recTableMode)?'월 기준':recTableMode==='month'?(r.expiryDate||'-'):'월별 개별'}</td><td>{['hour','day'].includes(recTableMode)?'월 기준':recTableMode==='month'?<span className={`expiryBadge ${r.expiryStatusCode||'unknown'}`}>{r.expiryStatus||'-'}</span>:'월별 확인'}</td><td>{r.price==null?'-':`${nf.format(recUnitPrice(r.price))} 원`}</td><td>{r.estimatedRevenue==null?'-':`${nf.format(recMoney(r.estimatedRevenue))} 원`}</td><td>{r.cumulativeRec==null?'-':nf.format(r.cumulativeRec)}</td><td>{r.cumulativeMonetized==null?'-':two.format(r.cumulativeMonetized)}</td><td>{r.cumulativeDisposed==null?'-':two.format(r.cumulativeDisposed)}</td><td>{r.cumulativeMonetizedAmount==null?'-':`${nf.format(recMoney(r.cumulativeMonetizedAmount))} 원`}</td><td>{r.remainingRec==null?'-':two.format(r.remainingRec)}</td><td>{['hour','day'].includes(recTableMode)?'월 기준':recTableMode==='month'?(r.deadline?.date||'-'):'월별 개별'}</td><td>{['hour','day'].includes(recTableMode)?'월 기준':recTableMode==='month'?<span className={`deadlineBadge ${r.deadline?.statusCode||''}`}>{r.deadline?.status||'-'}</span>:'월별 확인'}</td></tr>)}</tbody></table></div>
    <div className="recTablePager"><span>최신순 · {Math.min(recVisible,recRowsSorted.length)} / {recRowsSorted.length}개 표시</span><div>{recVisible>10&&<button type="button" onClick={()=>setRecVisible(10)}>접기</button>}{recRowsRemaining>0&&<button type="button" className="primary" onClick={()=>setRecVisible(v=>Math.min(v+10,recRowsSorted.length))}>10개 더보기 (남은 {recRowsRemaining}개)</button>}</div></div>
  </section>}

  <details id="links-section" className="card linksCard collapsibleCard navTarget"><summary className="collapseSummary"><div><h2>자료 업데이트·업무 링크</h2><span>원자료·신청·분석 링크 보기</span></div><b className="collapseChevron">▾</b></summary><div className="collapseBody"><div className="tableScroll"><table className="linksTable"><thead><tr><th>자료</th><th>용도</th><th>갱신</th><th>바로가기</th></tr></thead><tbody>{(data?.links||[]).map((r,i)=><tr key={i}><td>{r.name}</td><td>{r.purpose}</td><td>{r.update}</td><td><a href={r.url} target="_blank" rel="noreferrer">열기 ↗</a></td></tr>)}</tbody></table></div></div></details>

  <div id="status-section" className="navTarget"></div>{data?.smpMeta&&<section className="card smpStatus"><b>SMP 상태</b><div><b>계산 기준:</b> {data.smpMeta.pricingRule||'월평균 SMP'}</div><div>Drive 확인: {new Date(data.smpMeta.fetchedAt).toLocaleString('ko-KR')}</div>{(data.smpMeta.yearStatus||[]).map((s,i)=><div key={i}>{s.year}: {s.source} · {nf.format(s.rows||0)}건 {s.file?`· ${s.file}`:''}</div>)}{(data.smpMeta.jejuYearStatus||[]).map((s,i)=><div key={`jeju-${i}`}><b>제주 {s.year}</b>: {s.source} · {nf.format(s.rows||0)}건 {s.file?`· ${s.file}`:''}</div>)}{(data.smpMeta.errors||[]).map((e,i)=><div key={i} className="smpErr">{e}</div>)}</section>}
  {data?.errors?.length>0&&<section className="card warning"><b>읽지 못한 발전파일 {data.errors.length}개</b>{data.errors.map((e,i)=><div key={i}>{e.file}: {e.error}</div>)}</section>}

  {lifecyclePopup&&<div className="recLifecycleModalBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setLifecyclePopup(null)}}><div className="recLifecycleModalPanel" role="dialog" aria-modal="true" aria-label={lifecyclePopup==='disposed'?'폐기된 REC 목록':'폐기예정 REC 목록'}><div className="recLifecycleModalHeader"><div><b>{lifecyclePopup==='disposed'?'폐기된 REC 상세':'폐기예정 REC 상세'}</b><span>{lifecyclePopup==='disposed'?'직접 폐기와 유효기간 만료 자동폐기를 구분해서 보여줍니다.':'유효기간이 6개월 이내 남은 보유 REC입니다.'}</span></div><button type="button" onClick={()=>setLifecyclePopup(null)}>닫기 ✕</button></div><div className="recLifecycleModalBody">{lifecyclePopup==='disposed'?<><div className="recLifecycleModalTotals"><div><span>직접 폐기</span><b>{two.format(data.rec.ledger?.manualDisposed||0)} REC</b></div><div><span>만료 자동폐기</span><b>{two.format(data.rec.ledger?.autoExpired||0)} REC</b></div><div><span>총 폐기</span><b>{two.format(data.rec.ledger?.totalDisposed||0)} REC</b></div></div><section className="recLifecycleListSection"><div className="recLifecycleListHead"><b>직접 폐기 처리 내역</b><span>사용자가 ‘폐기’로 저장한 거래내역</span></div><div className="tableScroll"><table className="recLifecyclePopupTable"><thead><tr><th>처리일자</th><th>폐기량</th><th>비고</th></tr></thead><tbody>{manualDisposedTransactions.length?manualDisposedTransactions.map(t=><tr key={t.id}><td>{t.date||'-'}</td><td><b>{two.format(Number(t.qty??t.disposedQty??0))} REC</b></td><td>{t.note||'-'}</td></tr>):<tr><td colSpan="3" className="emptyTxn">직접 폐기 처리 내역이 없습니다.</td></tr>}</tbody></table></div></section><section className="recLifecycleListSection"><div className="recLifecycleListHead"><b>유효기간 만료 자동폐기</b><span>만료일까지 수익화·폐기되지 않아 자동 폐기된 잔량</span></div><div className="tableScroll"><table className="recLifecyclePopupTable"><thead><tr><th>발전월</th><th>적용 발급일</th><th>만료일</th><th>자동폐기량</th></tr></thead><tbody>{autoExpiredLots.length?autoExpiredLots.map(l=><tr key={l.id||l.month}><td>{l.month||'-'}</td><td>{l.issueDate||'-'}</td><td>{l.expiryDate||'-'}</td><td><b>{two.format(l.autoExpiredAllocated||0)} REC</b></td></tr>):<tr><td colSpan="4" className="emptyTxn">유효기간 만료 자동폐기 내역이 없습니다.</td></tr>}</tbody></table></div></section></>:<><div className="recLifecycleModalTotals"><div><span>6개월 이내 폐기예정</span><b>{two.format(data.rec.ledger?.expiringSoon||0)} REC</b></div><div><span>현재 총 잔여</span><b>{two.format(data.rec.ledger?.remainingRec||0)} REC</b></div></div><section className="recLifecycleListSection"><div className="recLifecycleListHead"><b>만료 임박 보유 REC</b><span>만료일이 가까운 순서</span></div><div className="tableScroll"><table className="recLifecyclePopupTable"><thead><tr><th>발전월</th><th>적용 발급일</th><th>만료일</th><th>남은 일수</th><th>현재 잔량</th></tr></thead><tbody>{expiringSoonLots.length?expiringSoonLots.map(l=>{const d=daysUntil(l.expiryDate);return <tr key={l.id||l.month}><td>{l.month||'-'}</td><td>{l.issueDate||'-'}</td><td>{l.expiryDate||'-'}</td><td><span className="expirySoonDays">{d==null?'-':d===0?'D-DAY':`D-${Math.max(0,d)}`}</span></td><td><b>{two.format(l.remaining||0)} REC</b></td></tr>}):<tr><td colSpan="5" className="emptyTxn">6개월 이내 만료 예정 REC가 없습니다.</td></tr>}</tbody></table></div></section></>}</div></div></div>}

  {docModal&&<div className="pdfModalBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDocModal(null)}}><div className="pdfModalPanel" role="dialog" aria-modal="true" aria-label={docModal.title}><div className="pdfModalHeader"><div><b>{docModal.title}</b><span>{docModal.subtitle}</span></div><div className="pdfModalActions"><button type="button" onClick={()=>copyEquipmentDocLink(docModal)}>링크 복사</button><a href={docModal.path} target="_blank" rel="noreferrer">새 탭 ↗</a><button type="button" className="pdfCloseBtn" onClick={()=>setDocModal(null)}>닫기 ✕</button></div></div><div className="pdfModalBody"><iframe src={`${docModal.path}#view=FitH`} title={docModal.title}/></div><div className="pdfModalFooter"><span>모바일에서 PDF가 보이지 않으면 ‘새 탭’으로 열어주세요.</span>{docCopyMessage&&<b>{docCopyMessage}</b>}</div></div></div>}
  </main>
}
function Kpi({label,value}){return <div className="card kpi"><span>{label}</span><strong>{value}</strong></div>}
