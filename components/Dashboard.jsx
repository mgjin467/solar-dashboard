'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import ReactECharts from 'echarts-for-react';

const nf=new Intl.NumberFormat('ko-KR');
const one=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
const two=new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
function localIso(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function presets(){const now=new Date(),dow=(now.getDay()+6)%7,monday=addDays(now,-dow),prevMon=addDays(monday,-7),prevSun=addDays(monday,-1),y=now.getFullYear(),m=now.getMonth();const q=Math.floor(m/3)*3,h=m<6?0:6;return{
  all:[new Date(2023,0,1),now],today:[now,now],yesterday:[addDays(now,-1),addDays(now,-1)],thisWeek:[monday,now],lastWeek:[prevMon,prevSun],thisMonth:[new Date(y,m,1),now],lastMonth:[new Date(y,m-1,1),new Date(y,m,0)],quarter:[new Date(y,q,1),now],half:[new Date(y,h,1),now],thisYear:[new Date(y,0,1),now],lastYear:[new Date(y-1,0,1),new Date(y-1,11,31)]
}}
const presetButtons=[['all','전체'],['today','오늘'],['yesterday','전일'],['thisWeek','금주'],['lastWeek','전주'],['thisMonth','당월'],['lastMonth','전월'],['quarter','분기'],['half','반기'],['thisYear','당해'],['lastYear','전해'],['custom','직접선택']];
const barMetricLabels={revenue:'수익',kwh:'발전량'};
const lineMetricLabels={smp:'SMP',efficiency:'설비이용률',generationHours:'발전시간'};
const inverterLabels={total:'합계',inv1:'인버터1',inv2:'인버터2',both:'인버터1+2'};
function fmtDate(v){if(!v)return'-';const s=String(v);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}.${m[2]}.${m[3]}`:s}
function fmtDateTime(v){if(!v)return'-';try{return new Date(v).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}catch{return String(v)}}

function formatExtremaValue(v,name=''){
  const n=Number(v);if(!Number.isFinite(n))return'-';
  if(/수익|금액/.test(name))return`${nf.format(Math.round(n))}원`;
  if(/발전량/.test(name))return`${one.format(n)}kWh`;
  if(/REC 발급량/.test(name))return`${two.format(n)} REC`;
  if(/이용률/.test(name))return`${two.format(n)}%`;
  if(/발전시간/.test(name))return`${two.format(n)}h`;
  if(/SMP/.test(name))return`${two.format(n)}원/kWh`;
  if(/REC 평균가|REC 단가/.test(name))return`${nf.format(Math.round(n))}원/REC`;
  return nf.format(n);
}
const EXTREMA_X_SYMBOL='path://M-8,-10 L10,8 L8,10 L-10,-8 Z M8,-10 L10,-8 L-8,10 L-10,8 Z';
function applyExtremaMarkers(series,x,showMax,showMin){
  if(!showMax&&!showMin)return series;
  return series.map(s=>{
    const pts=(Array.isArray(s.data)?s.data:[]).map((item,i)=>{const raw=item&&typeof item==='object'&&'value'in item?item.value:item;return{i,v:Number(raw)}}).filter(p=>Number.isFinite(p.v)&&p.v!==0);
    if(!pts.length)return s;
    const marks=[];
    if(showMax){const p=pts.reduce((a,b)=>b.v>a.v?b:a);marks.push({name:'최고점',coord:[x[p.i],p.v],value:p.v,period:x[p.i],seriesLabel:s.name,itemStyle:{color:'#dc2626'}})}
    if(showMin){const p=pts.reduce((a,b)=>b.v<a.v?b:a);marks.push({name:'최저점',coord:[x[p.i],p.v],value:p.v,period:x[p.i],seriesLabel:s.name,itemStyle:{color:'#2563eb'}})}
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
function recChartGrain(grain){return grain==='year'?'year':grain==='quarter'?'quarter':'month'}
function recPeriodKey(month,mode){const m=String(month||'').match(/^(\d{4})-(\d{2})$/);if(!m)return String(month||'');const y=Number(m[1]),mo=Number(m[2]);if(mode==='year')return String(y);if(mode==='quarter')return`${y} Q${Math.floor((mo-1)/3)+1}`;return`${y}-${String(mo).padStart(2,'0')}`}
function aggregateRecChartRows(rows,mode){
  const groups=new Map();
  for(const r of(Array.isArray(rows)?rows:[])){
    const key=recPeriodKey(r?.month,mode);
    if(!groups.has(key))groups.set(key,{period:key,estimatedRec:0,issuedRec:0,calcRec:0,kwh:0,supplyKwh:0,priceSum:0,priceCount:0,priceDate:null,months:[]});
    const g=groups.get(key);g.estimatedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);g.issuedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);g.calcRec+=Number(r?.calcRec ?? r?.estimatedRec ?? 0);g.kwh+=Number(r?.kwh||0);g.supplyKwh+=Number(r?.supplyKwh||0);g.months.push(r?.month||'');
    if(r?.price!=null&&Number.isFinite(Number(r.price))){g.priceSum+=Number(r.price);g.priceCount++}
    if(r?.priceDate&&(!g.priceDate||String(r.priceDate)>String(g.priceDate)))g.priceDate=r.priceDate;
  }
  return[...groups.values()].map(g=>({period:g.period,estimatedRec:+g.estimatedRec.toFixed(3),issuedRec:+g.issuedRec.toFixed(3),calcRec:+g.calcRec.toFixed(3),kwh:+g.kwh.toFixed(1),supplyKwh:+g.supplyKwh.toFixed(1),price:g.priceCount?Math.round(g.priceSum/g.priceCount):null,priceDate:g.priceDate,sourcePeriod:g.period,months:g.months}));
}
function aggregateRecTableRows(rows,mode){
  const groups=new Map();
  for(const r of(Array.isArray(rows)?rows:[])){
    const key=recPeriodKey(r?.month,mode);
    if(!groups.has(key))groups.set(key,{period:key,kwh:0,supplyKwh:0,calcRec:0,issuedRec:0,estimatedRevenue:0,revenueKnown:false,priceSum:0,priceCount:0,priceDate:null,sources:new Set(),last:null});
    const g=groups.get(key);g.kwh+=Number(r?.kwh||0);g.supplyKwh+=Number(r?.supplyKwh||0);g.calcRec+=Number(r?.calcRec ?? 0);g.issuedRec+=Number(r?.issuedRec ?? r?.estimatedRec ?? 0);if(r?.estimatedRevenue!=null){g.estimatedRevenue+=Number(r.estimatedRevenue);g.revenueKnown=true}if(r?.price!=null&&Number.isFinite(Number(r.price))){g.priceSum+=Number(r.price);g.priceCount++}if(r?.priceDate&&(!g.priceDate||String(r.priceDate)>String(g.priceDate)))g.priceDate=r.priceDate;if(r?.source)g.sources.add(r.source);if(!g.last||String(r.month)>String(g.last.month))g.last=r;
  }
  return[...groups.values()].map(g=>{const last=g.last||{};const ratio=g.kwh>0?g.supplyKwh/g.kwh:null;return{period:g.period,month:g.period,kwh:+g.kwh.toFixed(1),supplyKwh:+g.supplyKwh.toFixed(1),supplyRatio:ratio==null?null:+ratio.toFixed(4),weight:last.weight??1.5,calcRec:+g.calcRec.toFixed(3),issuedRec:+g.issuedRec.toFixed(3),estimatedRec:+g.issuedRec.toFixed(3),source:g.sources.size===1?[...g.sources][0]:g.sources.size>1?'혼합':'-',price:g.priceCount?Math.round(g.priceSum/g.priceCount):null,priceDate:g.priceDate,estimatedRevenue:g.revenueKnown?Math.round(g.estimatedRevenue):null,cumulativeRec:last.cumulativeRec??null,cumulativeMonetized:last.cumulativeMonetized??null,cumulativeMonetizedAmount:last.cumulativeMonetizedAmount??null,remainingRec:last.remainingRec??null,deadline:mode==='month'?last.deadline:null};});
}

export default function Dashboard(){
  const [grain,setGrain]=useState('month');
  const [barMetric,setBarMetric]=useState('revenue');
  const [lineMetric,setLineMetric]=useState('smp');
  const [inverterMode,setInverterMode]=useState('total');
  const [periodPreset,setPeriodPreset]=useState('thisYear');
  const p0=presets().thisYear;
  const [start,setStart]=useState(localIso(p0[0]));
  const [end,setEnd]=useState(localIso(p0[1]));
  const [compare,setCompare]=useState([]);
  const [showRegion,setShowRegion]=useState(true);
  const [showMaxPoint,setShowMaxPoint]=useState(false);
  const [showMinPoint,setShowMinPoint]=useState(false);
  const [cap1,setCap1]=useState('99.5');
  const [cap2,setCap2]=useState('99.5');
  const [recVisible,setRecVisible]=useState(10);
  const [recSupplyRatioPct,setRecSupplyRatioPct]=useState('50');
  const [recBarMetric,setRecBarMetric]=useState('issuance');
  const [recPriceMode,setRecPriceMode]=useState('current');
  const [recPriceDate,setRecPriceDate]=useState(localIso());
  const [recPriceLookup,setRecPriceLookup]=useState(null);
  const [recPriceLoading,setRecPriceLoading]=useState(false);
  const [recTxnForm,setRecTxnForm]=useState({id:'',date:localIso(),qty:'',amount:'',note:''});
  const [recTxnSaving,setRecTxnSaving]=useState(false);
  const [recTxnMessage,setRecTxnMessage]=useState('');
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[diag,setDiag]=useState(null),[diagLoading,setDiagLoading]=useState(false);
  const chartRef=useRef(null);

  useEffect(()=>{
    try{
      const a=localStorage.getItem('solar_inv1_kw');
      const b=localStorage.getItem('solar_inv2_kw');
      if(a!==null)setCap1(a);else setCap1(process.env.NEXT_PUBLIC_INVERTER1_KW||'99.5');
      if(b!==null)setCap2(b);else setCap2(process.env.NEXT_PUBLIC_INVERTER2_KW||'99.5');
    }catch{}
  },[]);
  useEffect(()=>{try{const r=localStorage.getItem('solar_rec_supply_ratio_pct');if(r!==null)setRecSupplyRatioPct(r)}catch{}},[]);
  useEffect(()=>{setRecVisible(10)},[start,end,compare,grain]);
  useEffect(()=>{
    if(recPriceMode!=='date'){setRecPriceLookup(null);return}
    let cancelled=false;setRecPriceLoading(true);
    fetch(`/api/rec-price?date=${encodeURIComponent(recPriceDate)}&ts=${Date.now()}`,{cache:'no-store'}).then(async r=>{const j=await r.json();if(!cancelled)setRecPriceLookup(j)}).catch(e=>{if(!cancelled)setRecPriceLookup({ok:false,message:e.message||String(e)})}).finally(()=>{if(!cancelled)setRecPriceLoading(false)});
    return()=>{cancelled=true};
  },[recPriceMode,recPriceDate]);
  const saveCapacity=(which,value)=>{
    const cleaned=value.replace(/[^0-9.]/g,'');
    if(which===1){setCap1(cleaned);try{localStorage.setItem('solar_inv1_kw',cleaned)}catch{}}
    else{setCap2(cleaned);try{localStorage.setItem('solar_inv2_kw',cleaned)}catch{}}
  };
  const c1=Number(cap1)||0,c2=Number(cap2)||0,totalCap=c1+c2;
  const recSupplyRatio=Math.max(0,(Number(recSupplyRatioPct)||0)/100);
  const saveRecSupplyRatio=(v)=>{const c=v.replace(/[^0-9.]/g,'');setRecSupplyRatioPct(c);try{localStorage.setItem('solar_rec_supply_ratio_pct',c)}catch{}};
  const applyPreset=(k)=>{setPeriodPreset(k);if(k==='custom')return;const p=presets()[k];setStart(localIso(p[0]));setEnd(localIso(p[1]));};
  const load=useCallback(async(forceRefresh=false)=>{
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({grain,start,end,compare:compare.join(','),cap1:String(c1),cap2:String(c2),recSupplyRatio:String(recSupplyRatio),ts:String(Date.now()),forceSmp:forceRefresh?'1':'0'});
      const r=await fetch(`/api/dashboard?${q}`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'데이터 조회 실패');setData(j)
    }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
  },[grain,start,end,compare,c1,c2,recSupplyRatio]);
  useEffect(()=>{load(false)},[load]);
  const runDiagnostics=useCallback(async()=>{setDiagLoading(true);try{const r=await fetch(`/api/diagnostics?ts=${Date.now()}`,{cache:'no-store'});setDiag(await r.json())}catch(e){setDiag({error:e.message||String(e)})}finally{setDiagLoading(false)}},[]);
  const saveRecTransaction=useCallback(async()=>{
    setRecTxnSaving(true);setRecTxnMessage('');
    try{
      const body={id:recTxnForm.id||'',date:recTxnForm.date,monetizedQty:Number(recTxnForm.qty)||0,monetizedAmount:Number(String(recTxnForm.amount||'').replace(/,/g,''))||0,note:recTxnForm.note||''};
      const r=await fetch('/api/rec-manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();if(!r.ok)throw new Error(j.message||'저장 실패');
      setRecTxnMessage(recTxnForm.id?'수정되었습니다.':'저장되었습니다.');
      setRecTxnForm({id:'',date:localIso(),qty:'',amount:'',note:''});
      await load(false);
    }catch(e){setRecTxnMessage(e.message||String(e))}finally{setRecTxnSaving(false)}
  },[recTxnForm,load]);
  const editRecTransaction=useCallback((t)=>{setRecTxnForm({id:t.id||'',date:t.date||localIso(),qty:String(t.monetizedQty??''),amount:String(t.monetizedAmount??''),note:t.note||''});setRecTxnMessage('');},[]);
  const cancelRecTransactionEdit=useCallback(()=>{setRecTxnForm({id:'',date:localIso(),qty:'',amount:'',note:''});setRecTxnMessage('');},[]);

  const option=useMemo(()=>{
    const base=Array.isArray(data?.series)?data.series:[];
    const x=base.map(r=>String(r.axis??''));
    if(x.length===0)return{animation:false,title:{text:loading?'데이터 불러오는 중…':'표시할 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},grid:{left:70,right:70,top:35,bottom:45,containLabel:true},xAxis:{type:'category',data:[]},yAxis:[{type:'value'}],series:[]};
    const series=[];
    const barKey=mode=>barMetric==='kwh'?(mode==='inv1'?'inv1Kwh':mode==='inv2'?'inv2Kwh':'kwh'):(mode==='inv1'?'revenue1':mode==='inv2'?'revenue2':'revenue');
    const lineKey=mode=>lineMetric==='efficiency'?(mode==='inv1'?'efficiency1':mode==='inv2'?'efficiency2':'efficiency'):(lineMetric==='generationHours'?(mode==='inv1'?'generationHours1':mode==='inv2'?'generationHours2':'generationHours'):'smp');
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
          series.push({name:`${labelPrefix} 월평균 SMP`,type:'line',data:rows.map(r=>r?.smp==null?null:Number(r.smp)),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
        }
      }else{
        const bk=barKey(inverterMode), lk=lineKey(inverterMode);
        series.push({name:`${labelPrefix} ${inverterLabels[inverterMode]} ${barMetricLabels[barMetric]}`,type:'bar',data:rows.map(r=>Number(r?.[bk]||0)),yAxisIndex:0,barMaxWidth:42});
        series.push({name:`${labelPrefix} ${lineMetric==='smp'?'월평균 SMP':`${inverterLabels[inverterMode]} ${lineMetricLabels[lineMetric]}`}`,type:'line',data:rows.map(r=>r?.[lk]==null?null:Number(r[lk])),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle});
      }
    };
    addRows(base,'현재',false);
    for(const c of(Array.isArray(data?.comparisons)?data.comparisons:[])){
      const rows=Array.isArray(c?.series)?c.series:[];
      const map=new Map(rows.map(r=>[String(r.axis??''),r]));
      addRows(x.map(a=>map.get(a)||{}),c.label,true);
    }
    if(showRegion&&(lineMetric==='efficiency'||lineMetric==='generationHours')){
      if(lineMetric==='efficiency'){
        series.push({name:`${data?.benchmark?.region||'충북'} 평균 이용률`,type:'line',data:base.map(r=>r?.regionEfficiency==null?null:Number(r.regionEfficiency)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dashed',width:2.2}});
        series.push({name:'전국 평균 이용률',type:'line',data:base.map(r=>r?.nationalEfficiency==null?null:Number(r.nationalEfficiency)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dotted',width:2.2}});
      }else{
        series.push({name:`${data?.benchmark?.region||'충북'} 평균 발전시간`,type:'line',data:base.map(r=>r?.regionGenerationHours==null?null:Number(r.regionGenerationHours)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dashed',width:2.2}});
        series.push({name:'전국 평균 발전시간',type:'line',data:base.map(r=>r?.nationalGenerationHours==null?null:Number(r.nationalGenerationHours)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dotted',width:2.2}});
      }
    }
    const zoom=x.length>2?[{type:'inside',xAxisIndex:0,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true,moveOnMouseWheel:false,preventDefaultMouseMove:true},{type:'slider',xAxisIndex:0,bottom:10,height:22,filterMode:'none',showDetail:false}]:[];
    const rightAxis=lineMetric==='efficiency'
      ?{type:'value',name:'설비이용률(%)',position:'right',min:0,nameGap:14,axisLabel:{formatter:v=>`${v}%`,margin:12}}
      :lineMetric==='generationHours'
        ?{type:'value',name:'발전시간(h)',position:'right',min:0,nameGap:14,axisLabel:{formatter:v=>`${Number(v).toFixed(1)}h`,margin:12}}
        :{type:'value',name:'SMP(원/kWh)',position:'right',nameGap:14,axisLabel:{formatter:v=>Number(v).toFixed(0),margin:12}};
    const yAxis=[
      {type:'value',name:barMetric==='revenue'?'수익(원)':'발전량(kWh)',nameGap:14,axisLabel:{formatter:v=>nf.format(v),margin:12}},
      rightAxis
    ];
    const markedSeries=applyExtremaMarkers(series,x,showMaxPoint,showMinPoint);
    return{animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:18,right:24,top:48,bottom:zoom.length?74:46,containLabel:true},tooltip:{trigger:'axis',confine:true},xAxis:{type:'category',data:x,boundaryGap:true,axisLabel:{hideOverlap:true,margin:10}},yAxis,dataZoom:zoom,series:markedSeries};
  },[data,barMetric,lineMetric,inverterMode,showRegion,showMaxPoint,showMinPoint,loading]);
  const chartKey=useMemo(()=>`${grain}-${barMetric}-${lineMetric}-${inverterMode}-${start}-${end}-${compare.join('-')}-${c1}-${c2}-${data?.series?.length||0}`,[grain,barMetric,lineMetric,inverterMode,start,end,compare,c1,c2,data?.series?.length]);
  const recCurrentPrice=data?.rec?.market?.ok?(data.rec.market.avg??data.rec.market.close??null):null;
  const recValuationPrice=recPriceMode==='date'?(recPriceLookup?.ok?(recPriceLookup.avg??recPriceLookup.close??null):null):recCurrentPrice;
  const recValuationDate=recPriceMode==='date'?(recPriceLookup?.actualDate||recPriceDate):(data?.rec?.market?.date||null);
  const recOption=useMemo(()=>{
    const mode=recChartGrain(grain);
    const rows=aggregateRecChartRows(Array.isArray(data?.rec?.series)?data.rec.series:[],mode);
    const comps=(Array.isArray(data?.rec?.comparisons)?data.rec.comparisons:[]).map(c=>({...c,series:aggregateRecChartRows(c?.series||[],mode)}));
    const x=rows.map(r=>String(r.period||''));
    if(!x.length)return{animation:false,title:{text:'표시할 REC 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},grid:{left:18,right:24,top:45,bottom:45,containLabel:true},xAxis:{type:'category',data:[]},yAxis:[{type:'value'}],series:[]};
    const series=[];
    const addRecSeries=(sourceRows,label,isCompare=false)=>{
      const aligned=x.map((_,i)=>sourceRows?.[i]||{});
      const amountMode=recBarMetric==='amount';
      series.push({
        name:`${label} ${amountMode?'REC 평가금액':'REC 발급량'}`,type:'bar',yAxisIndex:0,barMaxWidth:36,
        itemStyle:isCompare?{opacity:.62}:undefined,
        data:aligned.map(r=>({value:amountMode?(recValuationPrice==null?0:Math.round(Number(r?.estimatedRec||0)*Number(recValuationPrice))):Number(r?.estimatedRec||0),sourceMonth:r?.period||r?.sourcePeriod||'',priceDate:r?.priceDate||''}))
      });
      series.push({
        name:`${label} REC 평균가`,type:'line',yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,
        lineStyle:isCompare?{type:'dashed',width:2}:{width:2.4},
        data:aligned.map(r=>({value:r?.price==null?null:Number(r.price),sourceMonth:r?.period||r?.sourcePeriod||'',priceDate:r?.priceDate||''}))
      });
    };
    addRecSeries(rows,'현재',false);
    for(const c of comps)addRecSeries(Array.isArray(c?.series)?c.series:[],c?.label||`${c?.offset||''}년 전`,true);
    const amountMode=recBarMetric==='amount';
    return{
      animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:10,right:10,top:52,bottom:60,containLabel:true},
      tooltip:{trigger:'axis',confine:true,formatter:(items)=>{const arr=Array.isArray(items)?items:[];const idx=arr[0]?.dataIndex??0;const lines=[`<b>${x[idx]||''} 동기간 비교</b>`];for(const it of arr){const raw=it?.data?.value??it?.value,sourceMonth=it?.data?.sourceMonth||'',priceDate=it?.data?.priceDate||'';if(it.seriesName.includes('REC 발급량'))lines.push(`${it.marker} ${it.seriesName}: ${two.format(Number(raw||0))} REC${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}`);else if(it.seriesName.includes('REC 평가금액'))lines.push(`${it.marker} ${it.seriesName}: ${nf.format(Number(raw||0))} 원${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}`);else if(it.seriesName.includes('REC 평균가'))lines.push(`${it.marker} ${it.seriesName}: ${raw==null?'-':`${nf.format(Number(raw))} 원/REC`}${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}${priceDate?` · ${priceDate}`:''}`)}return lines.join('<br/>')}},
      xAxis:{type:'category',data:x,axisLabel:{hideOverlap:true,margin:10}},
      yAxis:[{type:'value',name:amountMode?'원':'REC',nameLocation:'end',nameGap:6,min:0,nameTextStyle:{align:'left',padding:[0,0,4,0]},axisLabel:{formatter:v=>amountMode?nf.format(v):Number(v).toFixed(0),margin:8}},{type:'value',name:'원/REC',nameLocation:'end',nameGap:6,position:'right',min:0,nameTextStyle:{align:'right',padding:[0,0,4,0]},axisLabel:{formatter:v=>nf.format(v),margin:8}}],
      dataZoom:x.length>4?[{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'slider',xAxisIndex:0,bottom:8,height:20,filterMode:'none',showDetail:false}]:[],series:applyExtremaMarkers(series,x,showMaxPoint,showMinPoint)
    };
  },[data?.rec?.series,data?.rec?.comparisons,recBarMetric,recValuationPrice,grain,showMaxPoint,showMinPoint]);
  const recChartKey=useMemo(()=>`rec-${grain}-${start}-${end}-${compare.join('-')}-${data?.rec?.series?.length||0}-${data?.rec?.comparisons?.length||0}-${data?.rec?.market?.date||''}`,[grain,start,end,compare,data?.rec?.series?.length,data?.rec?.comparisons?.length,data?.rec?.market?.date]);
  const toggleCompare=n=>setCompare(v=>v.includes(n)?v.filter(x=>x!==n):[...v,n].sort());
  const selectedEfficiency=data?.kpi?.[inverterMode==='inv1'?'efficiency1':inverterMode==='inv2'?'efficiency2':'efficiency'];
  const selectedGeneration=data?.kpi?.[inverterMode==='inv1'?'totalGeneration1':inverterMode==='inv2'?'totalGeneration2':'totalGeneration'];
  const recTableMode=recChartGrain(grain);
  const recRowsSorted=useMemo(()=>aggregateRecTableRows(data?.rec?.series||[],recTableMode).sort((a,b)=>String(b?.period||'').localeCompare(String(a?.period||''))),[data?.rec?.series,recTableMode]);
  const recRowsVisible=recRowsSorted.slice(0,recVisible);
  const recRowsRemaining=Math.max(0,recRowsSorted.length-recVisible);
  const recPeriodLabel=recTableMode==='year'?'발전연도':recTableMode==='quarter'?'발전분기':'발전월';
  const recTransactions=useMemo(()=>[...(data?.rec?.ledger?.transactions||[])].sort((a,b)=>String(b?.date||'').localeCompare(String(a?.date||''))||String(b?.updatedAt||'').localeCompare(String(a?.updatedAt||''))),[data?.rec?.ledger?.transactions]);
  const recSelectedValuationAmount=recValuationPrice==null?null:Math.round(Number(data?.rec?.estimatedRec||0)*Number(recValuationPrice));

  return <main className="shell"><header className="hero"><div><div className="eyebrow">SOLAR POWER MONITORING</div><h1>태양광 발전 · SMP · REC</h1><p>인버터별 발전량·수익·설비이용률·등가 발전시간을 확인하고, 충북/건축물 평균과 REC 발급·시세까지 한 화면에서 관리합니다.</p></div><div className="heroButtons"><a className="diagBtn linkBtn" href="https://renewables.co.kr/calculator" target="_blank" rel="noreferrer">사업성 분석 ↗</a><button className="diagBtn" onClick={runDiagnostics} disabled={diagLoading}>{diagLoading?'진단 중…':'Drive 진단'}</button><button className="sync" onClick={()=>load(true)} disabled={loading}>{loading?'새로고침 중…':'↻ Drive 데이터 새로고침'}</button></div></header>

  {data&&<section className="card dataUpdateBar"><div className="updateTitle"><b>데이터 업데이트 현황</b><span>원자료 기준일과 Drive/캐시 수정시각</span></div><div className="updateGrid"><div><span>발전보고서</span><strong>{fmtDate(data.updateMeta?.generation?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.generation?.fileModifiedAt)}</small></div><div><span>SMP 데이터</span><strong>{fmtDate(data.updateMeta?.smp?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.smp?.fileModifiedAt)}</small></div><div><span>REC 시세</span><strong>{fmtDate(data.updateMeta?.rec?.dataDate)}</strong><small>캐시 수정 {fmtDateTime(data.updateMeta?.rec?.cacheUpdatedAt)}</small></div><div><span>지역 평균</span><strong>{data.updateMeta?.region?.period||'-'}</strong><small>확인 {fmtDateTime(data.updateMeta?.region?.checkedAt)}</small></div><div><span>대시보드</span><strong>{fmtDateTime(data.syncedAt)}</strong><small>마지막 새로고침</small></div></div></section>}

  <section className="card capacityCard"><div className="capacityTitle"><div><b>인버터 정격용량</b><span>설비이용률(CF)과 등가 발전시간 계산에 사용됩니다.</span></div><div className="capacityTotal">합계 <strong>{totalCap?`${one.format(totalCap)} kW`:'미설정'}</strong></div></div><div className="capacityInputs"><label>인버터 1 <input inputMode="decimal" value={cap1} onChange={e=>saveCapacity(1,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><label>인버터 2 <input inputMode="decimal" value={cap2} onChange={e=>saveCapacity(2,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><div className="formula">설비이용률 = 발전량 ÷ (정격용량 × 24시간 × 일수) × 100 · 등가 발전시간 = 발전량 ÷ 정격용량</div></div></section>

  <section className="controls card stickyControls"><div className="presetRow">{presetButtons.map(([k,t])=><button key={k} className={periodPreset===k?'preset active':'preset'} onClick={()=>applyPreset(k)}>{t}</button>)}</div><div className="controlRow"><div className="control"><label>집계</label><div className="segments">{[['hour','시간'],['day','일'],['month','월'],['quarter','분기'],['year','년']].map(([v,t])=><button key={v} className={grain===v?'active':''} onClick={()=>setGrain(v)}>{t}</button>)}</div></div><div className="control"><label>막대 그래프</label><div className="segments metricSeg">{[['revenue','수익'],['kwh','발전량']].map(([v,t])=><button key={v} className={barMetric===v?'active':''} onClick={()=>setBarMetric(v)}>{t}</button>)}</div></div><div className="control"><label>라인 그래프</label><div className="segments metricSeg">{[['smp','SMP'],['efficiency','설비이용률'],['generationHours','발전시간']].map(([v,t])=><button key={v} className={lineMetric===v?'active':''} onClick={()=>setLineMetric(v)}>{t}</button>)}</div></div><div className="control"><label>인버터 표시</label><div className="segments inverterSeg">{[['total','합계'],['inv1','1'],['inv2','2'],['both','1+2']].map(([v,t])=><button key={v} className={inverterMode===v?'active':''} onClick={()=>setInverterMode(v)}>{t}</button>)}</div></div><div className="control"><label>동기간 비교</label><div className="segments compareSeg">{[1,2,3].map(n=><button key={n} className={compare.includes(n)?'active':''} onClick={()=>toggleCompare(n)}>{n}년전</button>)}</div></div>{(lineMetric==='efficiency'||lineMetric==='generationHours')&&<div className="control"><label>전국·지역 비교</label><div className="segments"><button className={showRegion?'active':''} onClick={()=>setShowRegion(v=>!v)}>{showRegion?'전국·지역 ON':'전국·지역 OFF'}</button></div></div>}<div className="control"><label>최고·최저 마커</label><div className="segments"><button className={showMaxPoint?'active':''} onClick={()=>setShowMaxPoint(v=>!v)}>최고점</button><button className={showMinPoint?'active':''} onClick={()=>setShowMinPoint(v=>!v)}>최저점</button></div></div><div className="control dates"><label>기간</label><div><input type="date" value={start} disabled={periodPreset!=='custom'} onChange={e=>setStart(e.target.value)}/><span>~</span><input type="date" value={end} disabled={periodPreset!=='custom'} onChange={e=>setEnd(e.target.value)}/></div></div></div></section>

  {error&&<div className="error">{error}</div>}
  {diag&&<section className="card diagPanel"><div><b>서비스계정:</b> {diag.clientEmail||'-'}</div><div><b>대상 폴더:</b> {diag.folder?.name||'(접근 실패)'}</div><div><b>발전 Excel:</b> {diag.generationExcelCount??0}개 · <b>SMP Excel:</b> {diag.smpExcelCount??0}개</div><div className={diag.generationExcelCount>0?'diagOk':'smpErr'}>{diag.note}</div></section>}

  <section className="kpis kpis6"><Kpi label={`${inverterLabels[inverterMode]} 발전량`} value={data?`${one.format(selectedGeneration||0)} kWh`:'-'}/><Kpi label="SMP 기준 수익" value={data?`${nf.format(data.kpi.totalRevenue)} 원`:'-'}/><Kpi label="월평균 SMP" value={data?.kpi.weightedSmp!=null?`${two.format(data.kpi.weightedSmp)} 원/kWh`:'공식값 없음'}/><Kpi label="설비이용률" value={selectedEfficiency!=null?`${two.format(selectedEfficiency)} %`:totalCap?'계산 불가':'용량 입력 필요'}/><Kpi label="등가 발전시간" value={data?.kpi.generationHours!=null?`${two.format(data.kpi.generationHours)} h`:'-'}/><Kpi label="일평균 등가시간" value={data?.kpi.avgDailyGenerationHours!=null?`${two.format(data.kpi.avgDailyGenerationHours)} h/일`:'-'}/></section>

  <section className="card chartCard"><div className="sectionTitle"><div><h2>{barMetricLabels[barMetric]} 막대 + {lineMetricLabels[lineMetric]} 라인 · {inverterLabels[inverterMode]}{(lineMetric==='efficiency'||lineMetric==='generationHours')&&showRegion?' · 전국·지역 평균 비교':''}</h2><p>그래프 위에서 휠/두 손가락으로 확대·축소, 드래그로 이동할 수 있습니다.</p></div><span className="pill">발전파일 {data?.fileCount??0}개</span></div><div className="chartWrap"><ReactECharts key={chartKey} ref={chartRef} option={option} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div></section>

  {(lineMetric==='efficiency'||lineMetric==='generationHours')&&data?.benchmark&&<section className="card benchmarkCard"><div><b>전국·지역 평균 자동 비교</b><strong>{lineMetric==='efficiency'?`${two.format(data.benchmark.annualAverage)}%`:`${two.format(data.benchmark.annualGenerationHoursPerDay)} h/일`}</strong></div><p><b>{data.benchmark.region}</b> 월별 이용률과 전국 월별 이용률은 REcloud의 최신 공개 월별 표를 새로고침 때 자동 확인합니다. 현재 월별 공개 기준: {data.benchmark.year}년 · {data.benchmark.region} 연평균 {two.format(data.benchmark.annualAverage)}% (등가 {two.format(data.benchmark.annualGenerationHoursPerDay)}h/일) · 전국 연평균 {two.format(data.benchmark.nationalAnnualAverage)}% (등가 {two.format(data.benchmark.nationalAnnualGenerationHoursPerDay)}h/일). 전국 최신 태양광 평균은 {data.benchmark.nationalRate!=null?`${two.format(data.benchmark.nationalRate)}% / ${two.format(data.benchmark.latestNationalGenerationHoursPerDay)}h/일 (${data.benchmark.nationalPeriod||''})`:'조회 실패'}입니다. 지역별 분기 공개값은 {data.benchmark.period||'확인 중'} 기준 {data.benchmark.rate!=null?`${two.format(data.benchmark.rate)}% / ${two.format(data.benchmark.latestRegionGenerationHoursPerDay)}h/일`:'조회 실패'}입니다.</p>{data.benchmark.errors?.length>0&&<div className="benchmarkErr">{data.benchmark.errors.join(' / ')}</div>}</section>}

  <section className="grid2"><div className="card tableCard"><div className="sectionTitle"><h2>동기간 요약</h2></div><div className="tableScroll"><table className="mobileSummary"><thead><tr><th>구분</th><th>기간</th><th>발전량</th><th>수익</th><th>평균 SMP</th><th>이용률</th><th>등가시간</th></tr></thead><tbody>{(data?.yearly||[]).map((r,i)=><tr key={i}><td data-label="구분">{r.label}</td><td data-label="기간">{r.period}</td><td data-label="발전량">{nf.format(r.kwh)}</td><td data-label="수익">{nf.format(r.revenue)}</td><td data-label="평균 SMP">{r.avgSmp==null?'-':two.format(r.avgSmp)}</td><td data-label="이용률">{r.efficiency==null?'-':`${two.format(r.efficiency)}%`}</td><td data-label="등가시간">{r.generationHours==null?'-':`${two.format(r.generationHours)}h`}</td></tr>)}</tbody></table></div></div><div className="card rules"><div className="sectionTitle"><h2>핵심 계산식</h2></div><ul><li><b>설비이용률(CF)</b> = 발전량(kWh) ÷ [설비용량(kW) × 기간시간(h)] × 100</li><li><b>동일식</b> = 등가 발전시간(h) ÷ 기간시간(h) × 100 · 하루 기준이면 등가 발전시간 ÷ 24 × 100</li><li><b>등가 발전시간</b> = 발전량(kWh) ÷ 설비용량(kW)</li><li><b>일평균 등가 발전시간</b> = 등가 발전시간 ÷ 조회일수</li><li><b>인버터 출력효율</b> = AC 출력 ÷ DC 입력 × 100 (현재 발전보고서에 DC 입력값이 없어 공식만 표시)</li><li><b>모듈 변환효율</b> = 모듈 출력 ÷ [일사강도(1,000W/㎡) × 모듈면적] × 100</li><li><b>SMP 수익</b> = 해당 월 발전량 × 해당 월 월평균 SMP</li></ul></div></section>


  <section className="card terminologyCard"><div className="sectionTitle"><div><h2>용어 및 계산 정리</h2><p>발전량, 발전시간, 설비이용률, 변환효율은 서로 다른 개념입니다.</p></div></div><div className="termGrid"><div><b>설비용량 (kW)</b><span>발전소가 정격조건에서 낼 수 있는 최대 출력입니다. 현재 입력값 기준 인버터1 {one.format(c1)}kW + 인버터2 {one.format(c2)}kW = 합계 {one.format(totalCap)}kW입니다.</span></div><div><b>발전량 (kWh)</b><span>일정 기간 동안 실제로 생산한 전기에너지의 누적량입니다.</span></div><div><b>등가 발전시간 (h)</b><code>발전량(kWh) ÷ 설비용량(kW)</code><span>정격출력으로 몇 시간 발전한 것과 같은지를 나타냅니다. 예: 199kW 설비가 796kWh 생산 → 4.0시간.</span></div><div><b>설비이용률 (CF, %)</b><code>발전량 ÷ (설비용량 × 기간시간) × 100</code><span>또는 <b>등가 발전시간 ÷ 기간시간 × 100</b>. 하루라면 기간시간=24시간이므로 블로그 식처럼 <b>발전시간 ÷ 24 × 100</b>과 동일합니다.</span></div><div><b>일평균 등가 발전시간 (h/일)</b><code>조회기간 등가 발전시간 ÷ 조회일수</code><span>태양광 현장에서 흔히 ‘하루 발전시간’이라고 부르는 값에 가깝습니다.</span></div><div><b>인버터 변환효율 (%)</b><code>AC 출력 ÷ DC 입력 × 100</code><span>DC를 AC로 바꾸는 장치 효율로, 설비이용률과는 다른 지표입니다. DC 입력값이 있어야 계산할 수 있습니다.</span></div><div><b>모듈 변환효율 (%)</b><code>모듈 전기출력 ÷ (일사강도 × 모듈면적) × 100</code><span>태양광 모듈 자체의 광→전기 변환 성능입니다.</span></div><div><b>SMP 수익</b><code>해당 월 발전량(kWh) × 해당 월 월평균 SMP(원/kWh)</code><span>현재 대시보드 정산 추정에 사용하는 계산 기준입니다.</span></div></div><div className="termNote"><b>중요:</b> 이 대시보드의 ‘설비이용률’은 인버터 정격용량 합계를 설비용량으로 사용합니다. 실제 공식 신고 설비용량이 인버터 합계와 다르면 그 신고 용량을 입력하는 것이 정확합니다.</div></section>

  <section className="card formulaCard"><div className="sectionTitle"><div><h2>발전량 예측·효율 계산 참고식</h2><p>실측 대시보드 값과 예측식을 구분해 표시합니다.</p></div></div><div className="formulaGrid"><div><b>① 일조시간 기반</b><code>연간 발전량 = 설치용량 × 연간 일조시간 × 0.6</code><span>일조시간 대비 실제 등가발전시간을 약 60%로 보는 간이식</span></div><div><b>② 일사량 기반</b><code>일 발전량 = 일사량(kWh/㎡/일) × 모듈면적 × 모듈효율</code><span>연간값은 일 발전량 × 365</span></div><div><b>③ 신재생에너지 생산량 기반</b><code>연간 생산량 = 설치규모 × 단위 에너지생산량 × 보정계수</code><span>공공 설계·예측용 참고식</span></div></div></section>

  {data?.rec&&<section className="card recCard">
    <div className="sectionTitle"><div><h2>REC 발급량 · REC 단가 · 수익화 관리</h2><p>REC 발급 예상량과 시세를 확인하고, 실제로 수익화한 내역은 월별 칸이 아니라 아래 <b>수익화 거래내역</b>에 일자별로 계속 누적 저장합니다.</p></div><a className="actionLink" href="https://rps.energy.or.kr/CST_O2/O2_02_02_010_cst.do" target="_blank" rel="noreferrer">REC 발급신청 ↗</a></div>
    <div className="recKpis recKpis6">
      <div><span>조회기간 예상 REC</span><strong>{two.format(data.rec.estimatedRec)} REC</strong></div>
      <div><span>전체 누적 예상 REC</span><strong>{two.format(data.rec.ledger?.cumulativeRec||0)} REC</strong></div>
      <div><span>누적 수익화 REC</span><strong>{two.format(data.rec.ledger?.cumulativeMonetized||0)} REC</strong></div>
      <div><span>남은 REC</span><strong>{two.format(data.rec.ledger?.remainingRec||0)} REC</strong></div>
      <div><span>누적 수익화 금액</span><strong>{nf.format(data.rec.ledger?.cumulativeMonetizedAmount||0)} 원</strong></div>
      <div><span>선택 기준 평가금액</span><strong>{recSelectedValuationAmount==null?'-':`${nf.format(recSelectedValuationAmount)} 원`}</strong></div>
    </div>
    <div className="recChartControls">
      <div className="recControlGroup"><label>막대 그래프</label><div className="segments"><button className={recBarMetric==='issuance'?'active':''} onClick={()=>setRecBarMetric('issuance')}>발급량</button><button className={recBarMetric==='amount'?'active':''} onClick={()=>setRecBarMetric('amount')}>금액</button></div></div>
      {recBarMetric==='amount'&&<div className="recControlGroup"><label>금액 계산 단가</label><div className="segments"><button className={recPriceMode==='current'?'active':''} onClick={()=>setRecPriceMode('current')}>현재 REC 단가</button><button className={recPriceMode==='date'?'active':''} onClick={()=>setRecPriceMode('date')}>특정 일자</button></div></div>}
      {recBarMetric==='amount'&&recPriceMode==='date'&&<div className="recControlGroup recDatePrice"><label>기준 일자</label><input type="date" value={recPriceDate} onChange={e=>setRecPriceDate(e.target.value)}/></div>}
      {recBarMetric==='amount'&&<div className="recPriceStatus"><b>{recPriceLoading?'가격 조회 중…':recValuationPrice==null?'기준 단가 없음':`${nf.format(recValuationPrice)} 원/REC`}</b><span>{recValuationDate?`가격 기준 거래일 ${String(recValuationDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')}`:''}{recPriceMode==='date'&&recPriceLookup?.fromCache?' · Drive 일별 캐시 사용':''}</span>{recPriceLookup&&!recPriceLookup.ok&&<span className="smpErr">{recPriceLookup.message}</span>}</div>}
      <div className="recControlGroup recSupplyRatioControl"><label>REC 공급량 추정비율</label><div className="inputUnit compactInput"><input inputMode="decimal" value={recSupplyRatioPct} onChange={e=>saveRecSupplyRatio(e.target.value)} /><em>%</em></div><span className="controlHint">RPS 발급내역 Excel이 있으면 실제 공급전력량을 우선 사용합니다.</span></div>
    </div>
    <div className="recRule"><b>{data.rec.rule}</b><span><b>중요:</b> REC는 발전보고서 전체 발전량이 아니라 RPS가 인정한 <b>공급전력량</b>을 기준으로 계산합니다.</span><span>{data.rec.priceRule}</span><span>{data.rec.assumption}</span><span>금액 보기에서는 <b>현재 REC 단가</b> 또는 사용자가 고른 <b>특정 일자의 최근 거래가격</b>을 모든 발급량에 동일 적용합니다.</span><span>REC 발급신청 기한: <b>전력공급일이 속한 달의 말일부터 90일 이내</b>.</span></div>
    {data.rec.marketHistory?.cache&&<div className="recCacheStatus"><b>REC API 호출 절약 캐시</b><span>Drive 누적 {nf.format(data.rec.marketHistory.cache.rows||0)}개월 · 이번 화면 캐시 재사용 {nf.format(data.rec.marketHistory.cache.hits||0)}개월 · 신규 API 호출 {nf.format(data.rec.marketHistory.cache.apiCalls||0)}회</span><span>월별 가격: {data.rec.marketHistory.cache.file||'REC_현물시장_월별캐시.xlsx'} · 특정일 가격은 REC_현물시장_일별캐시.xlsx에 누적됩니다.</span><span>수익화 거래내역: {data.rec.ledger?.file||'REC_수익화_수기입력.xlsx'} · 저장/수정하려면 서비스계정을 Drive 폴더에 편집자로 공유해야 합니다.</span>{data.rec.marketHistory.cache.saveError&&<span className="smpErr">Drive 저장 실패: {data.rec.marketHistory.cache.saveError}</span>}{data.rec.ledger?.error&&<span className="smpErr">수익화 파일 읽기 실패: {data.rec.ledger.error}</span>}</div>}
    <div className="recCacheStatus rpsSupplyStatus"><b>REC 공급전력량 기준</b><span>{data.rec.rpsIssuance?.hasActual?`Drive의 RPS 실적 Excel ${nf.format(data.rec.rpsIssuance.files?.length||0)}개를 읽어 실제 공급전력량/발급량을 우선 적용합니다.`:`RPS 실적 Excel이 없어 발전보고서 발전량의 ${nf.format(Math.round((data.rec.supplyRatio||0)*1000)/10)}%를 공급전력량으로 추정 중입니다.`}</span><span>조회기간 REC 기준 공급전력량: <b>{nf.format(Math.round((data.rec.selectedSupplyMwh||0)*1000))} kWh</b></span>{data.rec.rpsIssuance?.latestMonth&&<span>RPS 최신 실적월: {data.rec.rpsIssuance.latestMonth}</span>}</div>
    {data.rec.market&&!data.rec.market.ok&&<div className="apiWarn">REC 시세 자동조회: {data.rec.market.message} <a href="https://www.data.go.kr/data/15099762/openapi.do" target="_blank" rel="noreferrer">OpenAPI 확인 ↗</a></div>}
    <div className="recChartWrap"><ReactECharts key={`${recChartKey}-${recBarMetric}-${recPriceMode}-${recValuationPrice??'na'}`} option={recOption} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div>

    <div className="recMonetizationBox">
      <div className="recMonetizationHead"><div><b>REC 수익화 거래내역</b><span>실제 REC를 판매·정산한 날마다 한 건씩 입력합니다. 월별 발전표와는 별도로 누적 관리됩니다.</span></div><div className="recMonetizationSummary"><span>누적 수익화 <b>{two.format(data.rec.ledger?.cumulativeMonetized||0)} REC</b></span><span>누적 금액 <b>{nf.format(data.rec.ledger?.cumulativeMonetizedAmount||0)}원</b></span><span>남은 REC <b>{two.format(data.rec.ledger?.remainingRec||0)} REC</b></span></div></div>
      <div className="recTxnForm">
        <label><span>수익화 일자</span><input type="date" value={recTxnForm.date} onChange={e=>setRecTxnForm(v=>({...v,date:e.target.value}))}/></label>
        <label><span>수익화 REC</span><div className="inputUnit"><input inputMode="decimal" value={recTxnForm.qty} onChange={e=>setRecTxnForm(v=>({...v,qty:e.target.value.replace(/[^0-9.]/g,'')}))} placeholder="예: 50"/><em>REC</em></div></label>
        <label><span>수익화 금액</span><div className="inputUnit"><input inputMode="numeric" value={recTxnForm.amount} onChange={e=>setRecTxnForm(v=>({...v,amount:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="예: 3500000"/><em>원</em></div></label>
        <label className="recTxnNote"><span>비고</span><input value={recTxnForm.note} onChange={e=>setRecTxnForm(v=>({...v,note:e.target.value}))} placeholder="거래처·정산 메모 등"/></label>
        <div className="recTxnActions"><button className="saveLedgerBtn" disabled={recTxnSaving} onClick={saveRecTransaction}>{recTxnSaving?'저장중':recTxnForm.id?'수정 저장':'내역 추가'}</button>{recTxnForm.id&&<button className="cancelLedgerBtn" onClick={cancelRecTransactionEdit}>수정 취소</button>}</div>
      </div>
      {recTxnMessage&&<div className={/저장|수정/.test(recTxnMessage)?'txnMessage saveOk':'txnMessage saveErr'}>{recTxnMessage}</div>}
      <div className="tableScroll"><table className="recTxnTable"><thead><tr><th>수익화 일자</th><th>수익화 REC</th><th>수익화 금액</th><th>실현 단가</th><th>비고</th><th>수정시각</th><th>관리</th></tr></thead><tbody>{recTransactions.length?recTransactions.map(t=>{const unit=Number(t.monetizedQty)>0?Number(t.monetizedAmount||0)/Number(t.monetizedQty):null;return <tr key={t.id}><td>{t.date||'-'}</td><td>{two.format(t.monetizedQty||0)} REC</td><td>{nf.format(t.monetizedAmount||0)} 원</td><td>{unit==null?'-':`${nf.format(Math.round(unit))} 원/REC`}</td><td className="txnNoteCell">{t.note||'-'}</td><td>{fmtDateTime(t.updatedAt)}</td><td><button className="editLedgerBtn" onClick={()=>editRecTransaction(t)}>수정</button></td></tr>}):<tr><td colSpan="7" className="emptyTxn">저장된 수익화 내역이 없습니다.</td></tr>}</tbody></table></div>
    </div>

    <div className="tableScroll"><table className="recLedgerTable recMonthlyTable"><thead><tr><th>{recPeriodLabel}</th><th>발전량(kWh)</th><th>REC 기준 공급전력량(kWh)</th><th>공급비율</th><th>가중치</th><th>산정 REC</th><th>발급량</th><th>기준</th><th>REC 평균가</th><th>예상금액</th><th>누적 REC</th><th>누적 수익화 REC</th><th>누적 수익화 금액</th><th>남은 REC</th><th>발급신청 마감</th><th>유효기간</th></tr></thead><tbody>{recRowsVisible.map(r=><tr key={r.period}><td>{r.period}</td><td>{nf.format(r.kwh)}</td><td>{nf.format(r.supplyKwh)}</td><td>{r.supplyRatio==null?'-':`${one.format(r.supplyRatio*100)}%`}</td><td>{r.weight}</td><td>{two.format(r.calcRec)}</td><td><b>{two.format(r.issuedRec)}</b></td><td><span className={`recSourceBadge ${String(r.source).includes('RPS')?'actual':'estimated'}`}>{r.source}</span></td><td>{r.price==null?'-':`${nf.format(r.price)} 원`}</td><td>{r.estimatedRevenue==null?'-':`${nf.format(r.estimatedRevenue)} 원`}</td><td>{r.cumulativeRec==null?'-':two.format(r.cumulativeRec)}</td><td>{r.cumulativeMonetized==null?'-':two.format(r.cumulativeMonetized)}</td><td>{r.cumulativeMonetizedAmount==null?'-':`${nf.format(r.cumulativeMonetizedAmount)} 원`}</td><td className={Number(r.remainingRec)<0?'negative':''}>{r.remainingRec==null?'-':two.format(r.remainingRec)}</td><td>{recTableMode==='month'?(r.deadline?.date||'-'):'월별 개별'}</td><td>{recTableMode==='month'?<span className={`deadlineBadge ${r.deadline?.statusCode||''}`}>{r.deadline?.status||'-'}</span>:'월별 확인'}</td></tr>)}</tbody></table></div>
    <div className="recTablePager"><span>최신순 · {Math.min(recVisible,recRowsSorted.length)} / {recRowsSorted.length}개 표시</span><div>{recVisible>10&&<button type="button" onClick={()=>setRecVisible(10)}>접기</button>}{recRowsRemaining>0&&<button type="button" className="primary" onClick={()=>setRecVisible(v=>Math.min(v+10,recRowsSorted.length))}>10개 더보기 (남은 {recRowsRemaining}개)</button>}</div></div>
  </section>}

  <section className="card linksCard"><div className="sectionTitle"><div><h2>자료 업데이트·업무 링크</h2><p>계속 갱신하는 원자료와 신청/분석 페이지를 한곳에 정리했습니다.</p></div></div><div className="tableScroll"><table className="linksTable"><thead><tr><th>자료</th><th>용도</th><th>갱신</th><th>바로가기</th></tr></thead><tbody>{(data?.links||[]).map((r,i)=><tr key={i}><td>{r.name}</td><td>{r.purpose}</td><td>{r.update}</td><td><a href={r.url} target="_blank" rel="noreferrer">열기 ↗</a></td></tr>)}</tbody></table></div></section>

  {data?.smpMeta&&<section className="card smpStatus"><b>SMP 상태</b><div><b>계산 기준:</b> {data.smpMeta.pricingRule||'월평균 SMP'}</div><div>Drive 확인: {new Date(data.smpMeta.fetchedAt).toLocaleString('ko-KR')}</div>{(data.smpMeta.yearStatus||[]).map((s,i)=><div key={i}>{s.year}: {s.source} · {nf.format(s.rows||0)}건 {s.file?`· ${s.file}`:''}</div>)}{(data.smpMeta.errors||[]).map((e,i)=><div key={i} className="smpErr">{e}</div>)}</section>}
  {data?.errors?.length>0&&<section className="card warning"><b>읽지 못한 발전파일 {data.errors.length}개</b>{data.errors.map((e,i)=><div key={i}>{e.file}: {e.error}</div>)}</section>}
  </main>
}
function Kpi({label,value}){return <div className="card kpi"><span>{label}</span><strong>{value}</strong></div>}
