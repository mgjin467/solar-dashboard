import * as XLSX from 'xlsx';
import { listRecIssuanceExcelFiles, downloadFile } from './drive';

function clean(v){return String(v??'').replace(/\s+/g,' ').trim()}
function norm(v){return clean(v).replace(/\s+/g,'').replace(/[()\[\]{}]/g,'').toLowerCase()}
function num(v){const m=clean(v).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
function monthValue(v){
  if(v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}`;
  if(typeof v==='number' && v>30000){try{const d=XLSX.SSF.parse_date_code(v);if(d?.y&&d?.m)return `${d.y}-${String(d.m).padStart(2,'0')}`}catch{}}
  const s=clean(v);
  let m=s.match(/(20\d{2})\D*(0?[1-9]|1[0-2])/);if(m)return `${m[1]}-${String(Number(m[2])).padStart(2,'0')}`;
  m=s.match(/^(0?[1-9]|1[0-2])\D*(20\d{2})$/);if(m)return `${m[2]}-${String(Number(m[1])).padStart(2,'0')}`;
  return null;
}
function dateValue(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  if(typeof v==='number'&&v>30000){try{const d=XLSX.SSF.parse_date_code(v);if(d?.y&&d?.m&&d?.d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}catch{}}
  const s=clean(v);const m=s.match(/(20\d{2})\D*(0?[1-9]|1[0-2])\D*(0?[1-9]|[12]\d|3[01])/);return m?`${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`:null;
}
function headerIndex(row,aliases){const nr=row.map(norm);for(const a of aliases){const na=norm(a);const i=nr.findIndex(x=>x===na||x.includes(na)||na.includes(x));if(i>=0)return i}return-1}

export function parseRecIssuanceFile({name,modifiedTime,buffer}){
  let wb;try{wb=XLSX.read(buffer,{type:'buffer',cellDates:true})}catch{return[]}
  const out=[];
  for(const sheetName of wb.SheetNames){
    const ws=wb.Sheets[sheetName];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    let h=-1,cols=null;
    for(let i=0;i<Math.min(rows.length,40);i++){
      const r=rows[i]||[];
      const month=headerIndex(r,['발전년월','발전월','년월']);
      const supply=headerIndex(r,['공급전력량','공급량','전력거래량']);
      if(month>=0&&supply>=0){
        h=i;cols={month,supply,
          issued:headerIndex(r,['REC발급량','발급량','공급인증서발급량']),
          deadline:headerIndex(r,['신청기한','발급신청기한']),
          facility:headerIndex(r,['설비코드','발전소코드']),
          status:headerIndex(r,['진행정보','신청상태','상태']),
          issueDate:headerIndex(r,['REC발급일','공급인증서발급일','인증서발급일','발급일자','발급일'])};break;
      }
    }
    if(h<0||!cols)continue;
    for(let i=h+1;i<rows.length;i++){
      const r=rows[i]||[];const month=monthValue(r[cols.month]);const supply=num(r[cols.supply]);if(!month||supply==null)continue;
      out.push({month,supplyKwh:supply,issuedRec:cols.issued>=0?num(r[cols.issued]):null,deadline:cols.deadline>=0?dateValue(r[cols.deadline]):null,issueDate:cols.issueDate>=0?dateValue(r[cols.issueDate]):null,facilityCode:cols.facility>=0?clean(r[cols.facility]):'',status:cols.status>=0?clean(r[cols.status]):'',sourceFile:name,sourceModifiedTime:modifiedTime||'',sourceModifiedMs:Date.parse(modifiedTime||'')||0});
    }
  }
  return out;
}

export async function loadRecIssuanceData(){
  const files=await listRecIssuanceExcelFiles();const parsed=[];const errors=[];
  for(let i=0;i<files.length;i+=5){
    const batch=await Promise.all(files.slice(i,i+5).map(async f=>{try{return{ok:true,file:f,rows:parseRecIssuanceFile({name:f.name,modifiedTime:f.modifiedTime,buffer:await downloadFile(f.id)})}}catch(e){return{ok:false,file:f,error:e?.message||String(e)}}}));
    for(const r of batch){if(r.ok&&r.rows.length)parsed.push(...r.rows);else if(!r.ok)errors.push({file:r.file?.name,error:r.error})}
  }
  // 같은 월/설비코드는 가장 최신 파일만 사용합니다. 여러 설비코드가 있으면 월별 합산합니다.
  const best=new Map();
  for(const r of parsed){
    const key=`${r.month}|${r.facilityCode||'default'}`,p=best.get(key);
    const rank=r.issuedRec!=null?2:1,prevRank=p?.issuedRec!=null?2:1;
    if(!p||rank>prevRank||(rank===prevRank&&r.sourceModifiedMs>=p.sourceModifiedMs))best.set(key,r);
  }
  const monthly=new Map();
  for(const r of best.values()){
    if(!monthly.has(r.month))monthly.set(r.month,{month:r.month,supplyKwh:0,issuedRec:0,hasIssued:false,deadline:null,issueDates:[],facilities:[],files:[],statuses:[]});
    const g=monthly.get(r.month);g.supplyKwh+=Number(r.supplyKwh||0);if(r.issuedRec!=null){g.issuedRec+=Number(r.issuedRec);g.hasIssued=true}if(r.deadline&&(!g.deadline||r.deadline>g.deadline))g.deadline=r.deadline;if(r.issueDate)g.issueDates.push(r.issueDate);if(r.facilityCode)g.facilities.push(r.facilityCode);if(r.sourceFile)g.files.push(r.sourceFile);if(r.status)g.statuses.push(r.status);
  }
  const map=new Map([...monthly].map(([k,v])=>{const issueDates=[...new Set(v.issueDates)].sort();return[k,{...v,supplyKwh:+v.supplyKwh.toFixed(3),issuedRec:v.hasIssued?+v.issuedRec.toFixed(3):null,issueDate:issueDates.length===1?issueDates[0]:null,issueDates,facilities:[...new Set(v.facilities)],files:[...new Set(v.files)],statuses:[...new Set(v.statuses)]}]}));
  return{map,files,errors,rows:[...map.values()].sort((a,b)=>a.month.localeCompare(b.month)),rawRows:[...best.values()].sort((a,b)=>String(a.issueDate||a.month).localeCompare(String(b.issueDate||b.month))),latestMonth:[...map.keys()].sort().at(-1)||null};
}
