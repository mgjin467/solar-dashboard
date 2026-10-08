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
  const [cap1,setCap1]=useState('99.5');
  const [cap2,setCap2]=useState('99.5');
  const [recVisible,setRecVisible]=useState(10);
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
  useEffect(()=>{setRecVisible(10)},[start,end,compare]);
  const saveCapacity=(which,value)=>{
    const cleaned=value.replace(/[^0-9.]/g,'');
    if(which===1){setCap1(cleaned);try{localStorage.setItem('solar_inv1_kw',cleaned)}catch{}}
    else{setCap2(cleaned);try{localStorage.setItem('solar_inv2_kw',cleaned)}catch{}}
  };
  const c1=Number(cap1)||0,c2=Number(cap2)||0,totalCap=c1+c2;
  const applyPreset=(k)=>{setPeriodPreset(k);if(k==='custom')return;const p=presets()[k];setStart(localIso(p[0]));setEnd(localIso(p[1]));};
  const load=useCallback(async(forceRefresh=false)=>{
    setLoading(true);setError('');
    try{
      const q=new URLSearchParams({grain,start,end,compare:compare.join(','),cap1:String(c1),cap2:String(c2),ts:String(Date.now()),forceSmp:forceRefresh?'1':'0'});
      const r=await fetch(`/api/dashboard?${q}`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'데이터 조회 실패');setData(j)
    }catch(e){setError(e.message||String(e))}finally{setLoading(false)}
  },[grain,start,end,compare,c1,c2]);
  useEffect(()=>{load(false)},[load]);
  const runDiagnostics=useCallback(async()=>{setDiagLoading(true);try{const r=await fetch(`/api/diagnostics?ts=${Date.now()}`,{cache:'no-store'});setDiag(await r.json())}catch(e){setDiag({error:e.message||String(e)})}finally{setDiagLoading(false)}},[]);

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
    if(lineMetric==='efficiency'&&showRegion){
      series.push({name:`${data?.benchmark?.region||'충북'} 월별 평균 이용률`,type:'line',data:base.map(r=>r?.regionEfficiency==null?null:Number(r.regionEfficiency)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dashed',width:2}});
      series.push({name:'전국 건축물 태양광 평균 이용률',type:'line',data:base.map(r=>r?.buildingEfficiency==null?null:Number(r.buildingEfficiency)),yAxisIndex:1,smooth:true,showSymbol:false,lineStyle:{type:'dotted',width:2}});
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
    return{animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:18,right:24,top:48,bottom:zoom.length?74:46,containLabel:true},tooltip:{trigger:'axis',confine:true},xAxis:{type:'category',data:x,boundaryGap:true,axisLabel:{hideOverlap:true,margin:10}},yAxis,dataZoom:zoom,series};
  },[data,barMetric,lineMetric,inverterMode,showRegion,loading]);
  const chartKey=useMemo(()=>`${grain}-${barMetric}-${lineMetric}-${inverterMode}-${start}-${end}-${compare.join('-')}-${c1}-${c2}-${data?.series?.length||0}`,[grain,barMetric,lineMetric,inverterMode,start,end,compare,c1,c2,data?.series?.length]);
  const recOption=useMemo(()=>{
    const rows=Array.isArray(data?.rec?.series)?data.rec.series:[];
    const comps=Array.isArray(data?.rec?.comparisons)?data.rec.comparisons:[];
    const x=rows.map(r=>String(r.month||''));
    if(!x.length)return{animation:false,title:{text:'표시할 REC 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},grid:{left:18,right:24,top:45,bottom:45,containLabel:true},xAxis:{type:'category',data:[]},yAxis:[{type:'value'}],series:[]};
    const series=[];
    const addRecSeries=(sourceRows,label,isCompare=false)=>{
      const aligned=x.map((_,i)=>sourceRows?.[i]||{});
      series.push({
        name:`${label} REC 발급량`,type:'bar',yAxisIndex:0,barMaxWidth:36,
        itemStyle:isCompare?{opacity:.62}:undefined,
        data:aligned.map(r=>({value:Number(r?.estimatedRec||0),sourceMonth:r?.month||'',priceDate:r?.priceDate||''}))
      });
      series.push({
        name:`${label} REC 평균가`,type:'line',yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,
        lineStyle:isCompare?{type:'dashed',width:2}:{width:2.4},
        data:aligned.map(r=>({value:r?.price==null?null:Number(r.price),sourceMonth:r?.month||'',priceDate:r?.priceDate||''}))
      });
    };
    addRecSeries(rows,'현재',false);
    for(const c of comps)addRecSeries(Array.isArray(c?.series)?c.series:[],c?.label||`${c?.offset||''}년 전`,true);
    return{
      animation:false,
      legend:{type:'scroll',top:0,left:8,right:8},
      grid:{left:24,right:92,top:52,bottom:60,containLabel:true},
      tooltip:{trigger:'axis',confine:true,formatter:(items)=>{
        const arr=Array.isArray(items)?items:[];
        const idx=arr[0]?.dataIndex??0;
        const lines=[`<b>${x[idx]||''} 동기간 비교</b>`];
        for(const it of arr){
          const raw=it?.data?.value??it?.value;
          const sourceMonth=it?.data?.sourceMonth||'';
          const priceDate=it?.data?.priceDate||'';
          if(it.seriesName.includes('REC 발급량')) lines.push(`${it.marker} ${it.seriesName}: ${two.format(Number(raw||0))} REC${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}`);
          else if(it.seriesName.includes('REC 평균가')) lines.push(`${it.marker} ${it.seriesName}: ${raw==null?'-':`${nf.format(Number(raw))} 원/REC`}${sourceMonth?` <span style="color:#94a3b8">(${sourceMonth})</span>`:''}${priceDate?` · ${priceDate}`:''}`);
        }
        return lines.join('<br/>');
      }},
      xAxis:{type:'category',data:x,axisLabel:{hideOverlap:true,margin:10}},
      yAxis:[
        {type:'value',name:'REC',nameLocation:'end',nameGap:10,min:0,nameTextStyle:{align:'left',padding:[0,0,6,0]},axisLabel:{formatter:v=>Number(v).toFixed(0),margin:12}},
        {type:'value',name:'원/REC',nameLocation:'end',nameGap:10,position:'right',min:0,nameTextStyle:{align:'right',padding:[0,0,6,0]},axisLabel:{formatter:v=>nf.format(v),margin:12}}
      ],
      dataZoom:x.length>4?[{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'slider',xAxisIndex:0,bottom:8,height:20,filterMode:'none',showDetail:false}]:[],
      series
    };
  },[data?.rec?.series,data?.rec?.comparisons]);
  const recChartKey=useMemo(()=>`rec-${start}-${end}-${compare.join('-')}-${data?.rec?.series?.length||0}-${data?.rec?.comparisons?.length||0}-${data?.rec?.market?.date||''}`,[start,end,compare,data?.rec?.series?.length,data?.rec?.comparisons?.length,data?.rec?.market?.date]);
  const toggleCompare=n=>setCompare(v=>v.includes(n)?v.filter(x=>x!==n):[...v,n].sort());
  const selectedEfficiency=data?.kpi?.[inverterMode==='inv1'?'efficiency1':inverterMode==='inv2'?'efficiency2':'efficiency'];
  const selectedGeneration=data?.kpi?.[inverterMode==='inv1'?'totalGeneration1':inverterMode==='inv2'?'totalGeneration2':'totalGeneration'];
  const recRowsSorted=useMemo(()=>[...(data?.rec?.series||[])].sort((a,b)=>String(b?.month||'').localeCompare(String(a?.month||''))),[data?.rec?.series]);
  const recRowsVisible=recRowsSorted.slice(0,recVisible);
  const recRowsRemaining=Math.max(0,recRowsSorted.length-recVisible);

  return <main className="shell"><header className="hero"><div><div className="eyebrow">SOLAR POWER MONITORING</div><h1>태양광 발전 · SMP · REC</h1><p>인버터별 발전량·수익·설비이용률·등가 발전시간을 확인하고, 충북/건축물 평균과 REC 발급·시세까지 한 화면에서 관리합니다.</p></div><div className="heroButtons"><a className="diagBtn linkBtn" href="https://renewables.co.kr/calculator" target="_blank" rel="noreferrer">사업성 분석 ↗</a><button className="diagBtn" onClick={runDiagnostics} disabled={diagLoading}>{diagLoading?'진단 중…':'Drive 진단'}</button><button className="sync" onClick={()=>load(true)} disabled={loading}>{loading?'새로고침 중…':'↻ Drive 데이터 새로고침'}</button></div></header>

  {data&&<section className="card dataUpdateBar"><div className="updateTitle"><b>데이터 업데이트 현황</b><span>원자료 기준일과 Drive/캐시 수정시각</span></div><div className="updateGrid"><div><span>발전보고서</span><strong>{fmtDate(data.updateMeta?.generation?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.generation?.fileModifiedAt)}</small></div><div><span>SMP 데이터</span><strong>{fmtDate(data.updateMeta?.smp?.dataDate)}</strong><small>Drive 수정 {fmtDateTime(data.updateMeta?.smp?.fileModifiedAt)}</small></div><div><span>REC 시세</span><strong>{fmtDate(data.updateMeta?.rec?.dataDate)}</strong><small>캐시 수정 {fmtDateTime(data.updateMeta?.rec?.cacheUpdatedAt)}</small></div><div><span>지역 평균</span><strong>{data.updateMeta?.region?.period||'-'}</strong><small>확인 {fmtDateTime(data.updateMeta?.region?.checkedAt)}</small></div><div><span>대시보드</span><strong>{fmtDateTime(data.syncedAt)}</strong><small>마지막 새로고침</small></div></div></section>}

  <section className="card capacityCard"><div className="capacityTitle"><div><b>인버터 정격용량</b><span>설비이용률(CF)과 등가 발전시간 계산에 사용됩니다.</span></div><div className="capacityTotal">합계 <strong>{totalCap?`${one.format(totalCap)} kW`:'미설정'}</strong></div></div><div className="capacityInputs"><label>인버터 1 <input inputMode="decimal" value={cap1} onChange={e=>saveCapacity(1,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><label>인버터 2 <input inputMode="decimal" value={cap2} onChange={e=>saveCapacity(2,e.target.value)} placeholder="kW 입력"/><span>kW</span></label><div className="formula">설비이용률 = 발전량 ÷ (정격용량 × 24시간 × 일수) × 100 · 등가 발전시간 = 발전량 ÷ 정격용량</div></div></section>

  <section className="controls card stickyControls"><div className="presetRow">{presetButtons.map(([k,t])=><button key={k} className={periodPreset===k?'preset active':'preset'} onClick={()=>applyPreset(k)}>{t}</button>)}</div><div className="controlRow"><div className="control"><label>집계</label><div className="segments">{[['hour','시간'],['day','일'],['month','월'],['year','년']].map(([v,t])=><button key={v} className={grain===v?'active':''} onClick={()=>setGrain(v)}>{t}</button>)}</div></div><div className="control"><label>막대 그래프</label><div className="segments metricSeg">{[['revenue','수익'],['kwh','발전량']].map(([v,t])=><button key={v} className={barMetric===v?'active':''} onClick={()=>setBarMetric(v)}>{t}</button>)}</div></div><div className="control"><label>라인 그래프</label><div className="segments metricSeg">{[['smp','SMP'],['efficiency','설비이용률'],['generationHours','발전시간']].map(([v,t])=><button key={v} className={lineMetric===v?'active':''} onClick={()=>setLineMetric(v)}>{t}</button>)}</div></div><div className="control"><label>인버터 표시</label><div className="segments inverterSeg">{[['total','합계'],['inv1','1'],['inv2','2'],['both','1+2']].map(([v,t])=><button key={v} className={inverterMode===v?'active':''} onClick={()=>setInverterMode(v)}>{t}</button>)}</div></div><div className="control"><label>동기간 비교</label><div className="segments compareSeg">{[1,2,3].map(n=><button key={n} className={compare.includes(n)?'active':''} onClick={()=>toggleCompare(n)}>{n}년전</button>)}</div></div>{lineMetric==='efficiency'&&<div className="control"><label>지역 비교</label><div className="segments"><button className={showRegion?'active':''} onClick={()=>setShowRegion(v=>!v)}>{showRegion?'지역평균 ON':'지역평균 OFF'}</button></div></div>}<div className="control dates"><label>기간</label><div><input type="date" value={start} disabled={periodPreset!=='custom'} onChange={e=>setStart(e.target.value)}/><span>~</span><input type="date" value={end} disabled={periodPreset!=='custom'} onChange={e=>setEnd(e.target.value)}/></div></div></div></section>

  {error&&<div className="error">{error}</div>}
  {diag&&<section className="card diagPanel"><div><b>서비스계정:</b> {diag.clientEmail||'-'}</div><div><b>대상 폴더:</b> {diag.folder?.name||'(접근 실패)'}</div><div><b>발전 Excel:</b> {diag.generationExcelCount??0}개 · <b>SMP Excel:</b> {diag.smpExcelCount??0}개</div><div className={diag.generationExcelCount>0?'diagOk':'smpErr'}>{diag.note}</div></section>}

  <section className="kpis kpis6"><Kpi label={`${inverterLabels[inverterMode]} 발전량`} value={data?`${one.format(selectedGeneration||0)} kWh`:'-'}/><Kpi label="SMP 기준 수익" value={data?`${nf.format(data.kpi.totalRevenue)} 원`:'-'}/><Kpi label="월평균 SMP" value={data?.kpi.weightedSmp!=null?`${two.format(data.kpi.weightedSmp)} 원/kWh`:'공식값 없음'}/><Kpi label="설비이용률" value={selectedEfficiency!=null?`${two.format(selectedEfficiency)} %`:totalCap?'계산 불가':'용량 입력 필요'}/><Kpi label="등가 발전시간" value={data?.kpi.generationHours!=null?`${two.format(data.kpi.generationHours)} h`:'-'}/><Kpi label="일평균 등가시간" value={data?.kpi.avgDailyGenerationHours!=null?`${two.format(data.kpi.avgDailyGenerationHours)} h/일`:'-'}/></section>

  <section className="card chartCard"><div className="sectionTitle"><div><h2>{barMetricLabels[barMetric]} 막대 + {lineMetricLabels[lineMetric]} 라인 · {inverterLabels[inverterMode]}{lineMetric==='efficiency'&&showRegion?' · 지역평균 비교':''}</h2><p>그래프 위에서 휠/두 손가락으로 확대·축소, 드래그로 이동할 수 있습니다.</p></div><span className="pill">발전파일 {data?.fileCount??0}개</span></div><div className="chartWrap"><ReactECharts key={chartKey} ref={chartRef} option={option} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div></section>

  {lineMetric==='efficiency'&&data?.benchmark&&<section className="card benchmarkCard"><div><b>지역 평균 자동 비교</b><strong>{data.benchmark.rate!=null?`${two.format(data.benchmark.rate)}%`:`${two.format(data.benchmark.annualAverage)}%`}</strong></div><p><b>{data.benchmark.region}</b> 월별 평균은 {data.benchmark.year}년 공개자료를 자동 수집하며, 최신 지역 분기 평균은 {data.benchmark.period||'공개값 확인 중'} 기준입니다. 전국 최신 태양광 평균: {data.benchmark.nationalRate!=null?`${two.format(data.benchmark.nationalRate)}% (${data.benchmark.nationalPeriod||''})`:'조회 실패'} · 전국 건축물 월별 평균: {data.benchmark.buildingYear}년 자료. 새로고침 시 한국에너지공단 REcloud를 다시 확인합니다.</p>{data.benchmark.errors?.length>0&&<div className="benchmarkErr">{data.benchmark.errors.join(' / ')}</div>}</section>}

  <section className="grid2"><div className="card tableCard"><div className="sectionTitle"><h2>동기간 요약</h2></div><div className="tableScroll"><table className="mobileSummary"><thead><tr><th>구분</th><th>기간</th><th>발전량</th><th>수익</th><th>평균 SMP</th><th>이용률</th><th>등가시간</th></tr></thead><tbody>{(data?.yearly||[]).map((r,i)=><tr key={i}><td data-label="구분">{r.label}</td><td data-label="기간">{r.period}</td><td data-label="발전량">{nf.format(r.kwh)}</td><td data-label="수익">{nf.format(r.revenue)}</td><td data-label="평균 SMP">{r.avgSmp==null?'-':two.format(r.avgSmp)}</td><td data-label="이용률">{r.efficiency==null?'-':`${two.format(r.efficiency)}%`}</td><td data-label="등가시간">{r.generationHours==null?'-':`${two.format(r.generationHours)}h`}</td></tr>)}</tbody></table></div></div><div className="card rules"><div className="sectionTitle"><h2>핵심 계산식</h2></div><ul><li><b>설비이용률(CF)</b> = 발전량(kWh) ÷ [설비용량(kW) × 기간시간(h)] × 100</li><li><b>동일식</b> = 등가 발전시간(h) ÷ 기간시간(h) × 100 · 하루 기준이면 등가 발전시간 ÷ 24 × 100</li><li><b>등가 발전시간</b> = 발전량(kWh) ÷ 설비용량(kW)</li><li><b>일평균 등가 발전시간</b> = 등가 발전시간 ÷ 조회일수</li><li><b>인버터 출력효율</b> = AC 출력 ÷ DC 입력 × 100 (현재 발전보고서에 DC 입력값이 없어 공식만 표시)</li><li><b>모듈 변환효율</b> = 모듈 출력 ÷ [일사강도(1,000W/㎡) × 모듈면적] × 100</li><li><b>SMP 수익</b> = 해당 월 발전량 × 해당 월 월평균 SMP</li></ul></div></section>


  <section className="card terminologyCard"><div className="sectionTitle"><div><h2>용어 및 계산 정리</h2><p>발전량, 발전시간, 설비이용률, 변환효율은 서로 다른 개념입니다.</p></div></div><div className="termGrid"><div><b>설비용량 (kW)</b><span>발전소가 정격조건에서 낼 수 있는 최대 출력입니다. 현재 입력값 기준 인버터1 {one.format(c1)}kW + 인버터2 {one.format(c2)}kW = 합계 {one.format(totalCap)}kW입니다.</span></div><div><b>발전량 (kWh)</b><span>일정 기간 동안 실제로 생산한 전기에너지의 누적량입니다.</span></div><div><b>등가 발전시간 (h)</b><code>발전량(kWh) ÷ 설비용량(kW)</code><span>정격출력으로 몇 시간 발전한 것과 같은지를 나타냅니다. 예: 199kW 설비가 796kWh 생산 → 4.0시간.</span></div><div><b>설비이용률 (CF, %)</b><code>발전량 ÷ (설비용량 × 기간시간) × 100</code><span>또는 <b>등가 발전시간 ÷ 기간시간 × 100</b>. 하루라면 기간시간=24시간이므로 블로그 식처럼 <b>발전시간 ÷ 24 × 100</b>과 동일합니다.</span></div><div><b>일평균 등가 발전시간 (h/일)</b><code>조회기간 등가 발전시간 ÷ 조회일수</code><span>태양광 현장에서 흔히 ‘하루 발전시간’이라고 부르는 값에 가깝습니다.</span></div><div><b>인버터 변환효율 (%)</b><code>AC 출력 ÷ DC 입력 × 100</code><span>DC를 AC로 바꾸는 장치 효율로, 설비이용률과는 다른 지표입니다. DC 입력값이 있어야 계산할 수 있습니다.</span></div><div><b>모듈 변환효율 (%)</b><code>모듈 전기출력 ÷ (일사강도 × 모듈면적) × 100</code><span>태양광 모듈 자체의 광→전기 변환 성능입니다.</span></div><div><b>SMP 수익</b><code>해당 월 발전량(kWh) × 해당 월 월평균 SMP(원/kWh)</code><span>현재 대시보드 정산 추정에 사용하는 계산 기준입니다.</span></div></div><div className="termNote"><b>중요:</b> 이 대시보드의 ‘설비이용률’은 인버터 정격용량 합계를 설비용량으로 사용합니다. 실제 공식 신고 설비용량이 인버터 합계와 다르면 그 신고 용량을 입력하는 것이 정확합니다.</div></section>

  <section className="card formulaCard"><div className="sectionTitle"><div><h2>발전량 예측·효율 계산 참고식</h2><p>실측 대시보드 값과 예측식을 구분해 표시합니다.</p></div></div><div className="formulaGrid"><div><b>① 일조시간 기반</b><code>연간 발전량 = 설치용량 × 연간 일조시간 × 0.6</code><span>일조시간 대비 실제 등가발전시간을 약 60%로 보는 간이식</span></div><div><b>② 일사량 기반</b><code>일 발전량 = 일사량(kWh/㎡/일) × 모듈면적 × 모듈효율</code><span>연간값은 일 발전량 × 365</span></div><div><b>③ 신재생에너지 생산량 기반</b><code>연간 생산량 = 설치규모 × 단위 에너지생산량 × 보정계수</code><span>공공 설계·예측용 참고식</span></div></div></section>

  {data?.rec&&<section className="card recCard"><div className="sectionTitle"><div><h2>REC 발급량 · REC 단가</h2><p>예상 발급량은 발전량 × 가중치, 단가는 공공데이터포털 REC 현물시장 API의 육지 평균가를 사용합니다. 상단의 1·2·3년 전 동기간 비교 선택이 REC 그래프에도 동일하게 적용됩니다.</p></div><a className="actionLink" href="https://rps.energy.or.kr/CST_O2/O2_02_02_010_cst.do" target="_blank" rel="noreferrer">REC 발급신청 ↗</a></div><div className="recKpis"><div><span>조회기간 발전량</span><strong>{two.format(data.rec.selectedMwh)} MWh</strong></div><div><span>예상 REC</span><strong>{two.format(data.rec.estimatedRec)} REC</strong></div><div><span>최근 REC 평균가</span><strong>{data.rec.market?.ok&&data.rec.market.avg!=null?`${nf.format(data.rec.market.avg)} 원/REC`:'API 미연결'}</strong></div><div><span>REC 예상금액</span><strong>{data.rec.estimatedRevenue!=null?`${nf.format(data.rec.estimatedRevenue)} 원`:'-'}</strong></div></div><div className="recRule"><b>{data.rec.rule}</b><span>{data.rec.priceRule}</span><span>{data.rec.assumption}</span><span>REC 발급신청 기한: <b>전력공급일이 속한 달의 말일부터 90일 이내</b>.</span></div>{data.rec.marketHistory?.cache&&<div className="recCacheStatus"><b>REC API 호출 절약 캐시</b><span>Drive 누적 {nf.format(data.rec.marketHistory.cache.rows||0)}개월 · 이번 화면 캐시 재사용 {nf.format(data.rec.marketHistory.cache.hits||0)}개월 · 신규 API 호출 {nf.format(data.rec.marketHistory.cache.apiCalls||0)}회</span><span>저장파일: {data.rec.marketHistory.cache.file||'REC_현물시장_월별캐시.xlsx'}{data.rec.marketHistory.cache.saved?' · Drive 저장 완료':''}</span>{data.rec.marketHistory.cache.saveError&&<span className="smpErr">Drive 저장 실패: {data.rec.marketHistory.cache.saveError}</span>}<span>과거월은 한 번 저장되면 다시 조회하지 않고, 현재월은 <b>Drive 데이터 새로고침</b>을 눌렀을 때만 최신 거래일로 갱신합니다.</span></div>}{data.rec.market&&!data.rec.market.ok&&<div className="apiWarn">REC 시세 자동조회: {data.rec.market.message} <a href="https://www.data.go.kr/data/15099762/openapi.do" target="_blank" rel="noreferrer">OpenAPI 확인 ↗</a></div>}<div className="recChartWrap"><ReactECharts key={recChartKey} option={recOption} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div><div className="tableScroll"><table><thead><tr><th>발전월</th><th>발전량(kWh)</th><th>가중치</th><th>예상 REC</th><th>REC 평균가</th><th>가격 기준 거래일</th><th>예상 REC 금액</th><th>발급신청 마감일</th><th>유효기간 상태</th></tr></thead><tbody>{recRowsVisible.map(r=><tr key={r.month}><td>{r.month}</td><td>{nf.format(r.kwh)}</td><td>{r.weight}</td><td>{two.format(r.estimatedRec)}</td><td>{r.price==null?'-':`${nf.format(r.price)} 원`}</td><td>{r.priceDate||'-'}</td><td>{r.estimatedRevenue==null?'-':`${nf.format(r.estimatedRevenue)} 원`}</td><td>{r.deadline?.date||'-'}</td><td><span className={`deadlineBadge ${r.deadline?.statusCode||''}`}>{r.deadline?.status||'-'}</span></td></tr>)}</tbody></table></div><div className="recTablePager"><span>최신순 · {Math.min(recVisible,recRowsSorted.length)} / {recRowsSorted.length}개 표시</span><div>{recVisible>10&&<button type="button" onClick={()=>setRecVisible(10)}>접기</button>}{recRowsRemaining>0&&<button type="button" className="primary" onClick={()=>setRecVisible(v=>Math.min(v+10,recRowsSorted.length))}>10개 더보기{recRowsRemaining>10?` (남은 ${recRowsRemaining}개)`:` (남은 ${recRowsRemaining}개)`}</button>}</div></div></section>}

  <section className="card linksCard"><div className="sectionTitle"><div><h2>자료 업데이트·업무 링크</h2><p>계속 갱신하는 원자료와 신청/분석 페이지를 한곳에 정리했습니다.</p></div></div><div className="tableScroll"><table className="linksTable"><thead><tr><th>자료</th><th>용도</th><th>갱신</th><th>바로가기</th></tr></thead><tbody>{(data?.links||[]).map((r,i)=><tr key={i}><td>{r.name}</td><td>{r.purpose}</td><td>{r.update}</td><td><a href={r.url} target="_blank" rel="noreferrer">열기 ↗</a></td></tr>)}</tbody></table></div></section>

  {data?.smpMeta&&<section className="card smpStatus"><b>SMP 상태</b><div><b>계산 기준:</b> {data.smpMeta.pricingRule||'월평균 SMP'}</div><div>Drive 확인: {new Date(data.smpMeta.fetchedAt).toLocaleString('ko-KR')}</div>{(data.smpMeta.yearStatus||[]).map((s,i)=><div key={i}>{s.year}: {s.source} · {nf.format(s.rows||0)}건 {s.file?`· ${s.file}`:''}</div>)}{(data.smpMeta.errors||[]).map((e,i)=><div key={i} className="smpErr">{e}</div>)}</section>}
  {data?.errors?.length>0&&<section className="card warning"><b>읽지 못한 발전파일 {data.errors.length}개</b>{data.errors.map((e,i)=><div key={i}>{e.file}: {e.error}</div>)}</section>}
  </main>
}
function Kpi({label,value}){return <div className="card kpi"><span>{label}</span><strong>{value}</strong></div>}
