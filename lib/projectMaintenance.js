import * as XLSX from 'xlsx';
import {downloadProjectMaintenanceFile,upsertProjectMaintenanceFile} from './drive';

function n(v){const x=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(x)?x:0}
function normalizeDate(v){const s=String(v??'').trim();const m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:''}
function rowToItem(r,index=0){
  const date=normalizeDate(r.date??r['지출일자']??r['일자']);if(!date)return null;
  const amount=Math.max(0,Math.round(n(r.amount??r['금액'])));if(!(amount>0))return null;
  const id=String(r.id??r.ID??r['ID']??'').trim()||`maint_${date.replace(/-/g,'')}_${index}`;
  return{id,date,amount,category:String(r.category??r['구분']??'유지보수').trim()||'유지보수',vendor:String(r.vendor??r['업체']??'').trim(),note:String(r.note??r['비고']??'').trim(),updatedAt:String(r.updatedAt??r['수정시각']??'').trim()};
}
export async function loadProjectMaintenanceLedger(){
  try{const got=await downloadProjectMaintenanceFile();if(!got)return{items:[],file:null,error:''};const wb=XLSX.read(got.buffer,{type:'buffer'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''}),items=rows.map((r,i)=>rowToItem(r,i)).filter(Boolean).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt)));return{items,file:got.file,error:''}}catch(e){return{items:[],file:null,error:e?.message||String(e)}}
}
function workbook(items){const rows=[...(items||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id))).map(x=>({ID:x.id,지출일자:x.date,구분:x.category||'유지보수',업체:x.vendor||'',금액:Math.round(Number(x.amount||0)),비고:x.note||'',수정시각:x.updatedAt||new Date().toISOString()}));const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:28},{wch:13},{wch:16},{wch:22},{wch:16},{wch:42},{wch:24}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'유지보수비');return XLSX.write(wb,{bookType:'xlsx',type:'buffer'})}
export async function saveProjectMaintenanceEntry({id='',date='',amount=0,category='유지보수',vendor='',note=''}={}){
  const d=normalizeDate(date);if(!d)throw new Error('지출일자를 YYYY-MM-DD 형식으로 입력하세요.');const a=Math.max(0,Math.round(n(amount)));if(!(a>0))throw new Error('유지보수 비용을 0보다 크게 입력하세요.');const current=await loadProjectMaintenanceLedger(),items=[...(current.items||[])],itemId=String(id||'').trim()||`maint_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,saved={id:itemId,date:d,amount:a,category:String(category||'유지보수').trim()||'유지보수',vendor:String(vendor||'').trim(),note:String(note||'').trim(),updatedAt:new Date().toISOString()};const idx=items.findIndex(x=>x.id===itemId);if(idx>=0)items[idx]=saved;else items.push(saved);await upsertProjectMaintenanceFile(workbook(items));return saved;
}
