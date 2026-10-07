'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import ReactECharts from 'echarts-for-react';
const nf=new Intl.NumberFormat('ko-KR');const one=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});const two=new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
function localIso(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return`${y}-${m}-${day}`}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function presets(){const now=new Date(),dow=(now.getDay()+6)%7,monday=addDays(now,-dow),prevMon=addDays(monday,-7),prevSun=addDays(monday,-1),y=now.getFullYear(),m=now.getMonth();const q=Math.floor(m/3)*3,h=m<6?0:6;return{
  today:[now,now],yesterday:[addDays(now,-1),addDays(now,-1)],thisWeek:[monday,now],lastWeek:[prevMon,prevSun],thisMonth:[new Date(y,m,1),now],lastMonth:[new Date(y,m-1,1),new Date(y,m,0)],quarter:[new Date(y,q,1),now],half:[new Date(y,h,1),now],thisYear:[new Date(y,0,1),now],lastYear:[new Date(y-1,0,1),new Date(y-1,11,31)]
}}
const presetButtons=[['today','오늘'],['yesterday','전일'],['thisWeek','금주'],['lastWeek','전주'],['thisMonth','당월'],['lastMonth','전월'],['quarter','분기'],['half','반기'],['thisYear','당해'],['lastYear','전해'],['custom','직접선택']];
export default function Dashboard(){
 const [grain,setGrain]=useState('month'),[barMetric,setBarMetric]=useState('revenue'),[periodPreset,setPeriodPreset]=useState('thisYear');const p0=presets().thisYear;const [start,setStart]=useState(localIso(p0[0])),[end,setEnd]=useState(localIso(p0[1]));const [compare,setCompare]=useState([]),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[diag,setDiag]=useState(null),[diagLoading,setDiagLoading]=useState(false);const chartRef=useRef(null);
 const applyPreset=(k)=>{setPeriodPreset(k);if(k==='custom')return;const p=presets()[k];setStart(localIso(p[0]));setEnd(localIso(p[1]));};
 const load=useCallback(async(forceRefresh=false)=>{setLoading(true);setError('');try{const q=new URLSearchParams({grain,start,end,compare:compare.join(','),ts:String(Date.now()),forceSmp:forceRefresh?'1':'0'});const r=await fetch(`/api/dashboard?${q}`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'데이터 조회 실패');setData(j)}catch(e){setError(e.message||String(e))}finally{setLoading(false)}},[grain,start,end,compare]);
 useEffect(()=>{load(false)},[load]);
 const runDiagnostics=useCallback(async()=>{setDiagLoading(true);try{const r=await fetch(`/api/diagnostics?ts=${Date.now()}`,{cache:'no-store'});setDiag(await r.json())}catch(e){setDiag({error:e.message||String(e)})}finally{setDiagLoading(false)}},[]);
 const option=useMemo(()=>{
   const base=Array.isArray(data?.series)?data.series:[];
   const x=base.map(r=>String(r.axis??''));
   if(x.length===0){
     return {
       animation:false,
       title:{text:loading?'데이터 불러오는 중…':'표시할 데이터가 없습니다',left:'center',top:'middle',textStyle:{fontSize:14,fontWeight:500,color:'#6b7280'}},
       grid:{left:50,right:50,top:35,bottom:45},
       xAxis:{type:'category',data:[]},
       yAxis:[{type:'value'},{type:'value',position:'right'}],
       series:[]
     };
   }
   const series=[];
   const currentName=barMetric==='revenue'?'현재 수익':'현재 발전량';
   series.push({name:currentName,type:'bar',data:base.map(r=>barMetric==='revenue'?Number(r.revenue||0):Number(r.kwh||0)),yAxisIndex:0,barMaxWidth:42,itemStyle:{borderRadius:[4,4,0,0]}});
   series.push({name:'현재 SMP',type:'line',data:base.map(r=>r.smp==null?null:Number(r.smp)),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false});
   for(const c of(Array.isArray(data?.comparisons)?data.comparisons:[])){
     const rows=Array.isArray(c?.series)?c.series:[];
     const map=new Map(rows.map(r=>[String(r.axis??''),r]));
     series.push({name:`${c.label} ${barMetric==='revenue'?'수익':'발전량'}`,type:'bar',data:x.map(a=>{const r=map.get(a);return r?(barMetric==='revenue'?Number(r.revenue||0):Number(r.kwh||0)):null}),yAxisIndex:0,barMaxWidth:28});
     series.push({name:`${c.label} SMP`,type:'line',data:x.map(a=>{const v=map.get(a)?.smp;return v==null?null:Number(v)}),yAxisIndex:1,smooth:true,showSymbol:false,connectNulls:false,lineStyle:{type:'dashed'}});
   }
   const zoom=x.length>2?[{type:'inside',xAxisIndex:0,filterMode:'none',zoomOnMouseWheel:true,moveOnMouseMove:true,moveOnMouseWheel:false,preventDefaultMouseMove:true},{type:'slider',xAxisIndex:0,bottom:10,height:22,filterMode:'none',showDetail:false}]:[];
   return {animation:false,legend:{type:'scroll',top:0,left:8,right:8},grid:{left:12,right:18,top:48,bottom:zoom.length?74:46,containLabel:true},tooltip:{trigger:'axis',confine:true},xAxis:{type:'category',data:x,boundaryGap:true,axisLabel:{hideOverlap:true,margin:10}},yAxis:[{type:'value',name:barMetric==='revenue'?'원':'kWh',nameGap:12,axisLabel:{formatter:v=>nf.format(v),margin:10}},{type:'value',name:'SMP',position:'right',nameGap:12,axisLabel:{formatter:v=>Number(v).toFixed(0),margin:10}}],dataZoom:zoom,series};
 },[data,barMetric,loading]);
 const chartKey=useMemo(()=>`${grain}-${barMetric}-${start}-${end}-${compare.join('-')}-${data?.series?.length||0}`,[grain,barMetric,start,end,compare,data?.series?.length]);
 const toggleCompare=n=>setCompare(v=>v.includes(n)?v.filter(x=>x!==n):[...v,n].sort());
 return <main className="shell"><header className="hero"><div><div className="eyebrow">SOLAR POWER MONITORING</div><h1>태양광 발전 · SMP 수익</h1><p>발전보고서와 SMP Excel은 모두 Google Drive 파일만 사용합니다. KPX에서 연도별 SMP Excel을 직접 내려받아 Drive에 올리면, 같은 연도 파일 중 수정일이 가장 최신인 파일을 자동 사용합니다.</p></div><div className="heroButtons"><button className="diagBtn" onClick={runDiagnostics} disabled={diagLoading}>{diagLoading?'진단 중…':'Drive 진단'}</button><button className="sync" onClick={()=>load(true)} disabled={loading}>{loading?'새로고침 중…':'↻ Drive 데이터 새로고침'}</button></div></header>
 <section className="controls card stickyControls"><div className="presetRow">{presetButtons.map(([k,t])=><button key={k} className={periodPreset===k?'preset active':'preset'} onClick={()=>applyPreset(k)}>{t}</button>)}</div><div className="controlRow"><div className="control"><label>집계</label><div className="segments">{[['hour','시간'],['day','일'],['month','월'],['year','년']].map(([v,t])=><button key={v} className={grain===v?'active':''} onClick={()=>setGrain(v)}>{t}</button>)}</div></div><div className="control"><label>막대</label><div className="segments"><button className={barMetric==='revenue'?'active':''} onClick={()=>setBarMetric('revenue')}>수익</button><button className={barMetric==='kwh'?'active':''} onClick={()=>setBarMetric('kwh')}>발전량</button></div></div><div className="control"><label>동기간 비교</label><div className="segments compareSeg">{[1,2,3].map(n=><button key={n} className={compare.includes(n)?'active':''} onClick={()=>toggleCompare(n)}>{n}년전</button>)}</div></div><div className="control dates"><label>기간</label><div><input type="date" value={start} disabled={periodPreset!=='custom'} onChange={e=>setStart(e.target.value)}/><span>~</span><input type="date" value={end} disabled={periodPreset!=='custom'} onChange={e=>setEnd(e.target.value)}/></div></div></div></section>
 {error&&<div className="error">{error}</div>}
 {diag&&<section className="card diagPanel"><div><b>서비스계정:</b> {diag.clientEmail||'-'}</div><div><b>대상 폴더:</b> {diag.folder?.name||'(접근 실패)'}</div><div><b>발전 Excel:</b> {diag.generationExcelCount??0}개 · <b>SMP Excel:</b> {diag.smpExcelCount??0}개</div><div className={diag.generationExcelCount>0?'diagOk':'smpErr'}>{diag.note}</div></section>}
 <section className="kpis"><Kpi label="총 발전량" value={data?`${one.format(data.kpi.totalGeneration)} kWh`:'-'}/><Kpi label="SMP 기준 수익" value={data?`${nf.format(data.kpi.totalRevenue)} 원`:'-'}/><Kpi label="가중 평균 SMP" value={data?.kpi.weightedSmp!=null?`${two.format(data.kpi.weightedSmp)} 원/kWh`:'공식값 없음'}/><Kpi label="실제 시간 데이터" value={data?`${nf.format(data.kpi.exactRows)} 행`:'-'}/></section>
 <section className="card chartCard"><div className="sectionTitle"><div><h2>{barMetric==='revenue'?'수익':'발전량'} + SMP 동기간 비교</h2><p>그래프 위에서 휠/두 손가락으로 확대·축소, 드래그로 이동할 수 있습니다.</p></div><span className="pill">발전파일 {data?.fileCount??0}개</span></div><div className="chartWrap"><ReactECharts key={chartKey} ref={chartRef} option={option} notMerge={true} lazyUpdate={false} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}}/></div></section>
 <section className="grid2"><div className="card tableCard"><div className="sectionTitle"><h2>동기간 요약</h2></div><div className="tableScroll"><table><thead><tr><th>구분</th><th>기간</th><th>발전량</th><th>수익</th><th>평균 SMP</th></tr></thead><tbody>{(data?.yearly||[]).map((r,i)=><tr key={i}><td>{r.label}</td><td>{r.period}</td><td>{nf.format(r.kwh)}</td><td>{nf.format(r.revenue)}</td><td>{r.avgSmp==null?'-':two.format(r.avgSmp)}</td></tr>)}</tbody></table></div></div><div className="card rules"><div className="sectionTitle"><h2>SMP 사용 규칙</h2></div><ul><li>KPX 사이트에서 연도별 SMP Excel을 직접 다운로드해 Google Drive 폴더에 올립니다.</li><li>권장 파일명: <code>smpDataRt_2024.xlsx</code>, <code>smpDataRt_2025.xlsx</code>처럼 연도를 포함합니다.</li><li>같은 연도 파일이 여러 개면 Drive <b>수정일이 가장 최신인 파일</b>을 자동 사용합니다.</li><li>올해 자료를 갱신하려면 KPX에서 다시 받은 파일을 Drive에 업로드한 뒤 <b>Drive 데이터 새로고침</b>을 누르면 됩니다.</li><li>Vercel은 Drive에 쓰지 않으므로 서비스계정 권한은 <b>뷰어</b>면 충분합니다.</li></ul></div></section>
 {data?.smpMeta&&<section className="card smpStatus"><b>SMP 상태</b><div>Drive 확인: {new Date(data.smpMeta.fetchedAt).toLocaleString('ko-KR')}</div>{(data.smpMeta.yearStatus||[]).map((s,i)=><div key={i}>{s.year}: {s.source} · {nf.format(s.rows||0)}건 {s.file?`· ${s.file}`:''}</div>)}{(data.smpMeta.errors||[]).map((e,i)=><div key={i} className="smpErr">{e}</div>)}</section>}
 {data?.errors?.length>0&&<section className="card warning"><b>읽지 못한 발전파일 {data.errors.length}개</b>{data.errors.map((e,i)=><div key={i}>{e.file}: {e.error}</div>)}</section>}
 </main>
}
function Kpi({label,value}){return <div className="card kpi"><span>{label}</span><strong>{value}</strong></div>}
