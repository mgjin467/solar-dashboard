import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import {findNamedSpreadsheet,downloadSpreadsheetAsXlsx,getDriveSpreadsheetById} from './drive';

const FINANCE_FILE_NAMES=['계산서 발행 및 입출금 내역','계산서 발행 및 입출금 내역.xlsx'];
const DEFAULT_FINANCE_SHEET_ID='1VJHgHsekNCbhJdT64UdVFY6C4s8GW0zOqO4_rQsVegU';

function num(v){const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:0}
function isoDate(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  if(typeof v==='number'&&Number.isFinite(v)){
    const d=XLSX.SSF.parse_date_code(v);if(d?.y)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s=String(v??'').trim();const m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null;
}
function endOfSecondFollowingMonth(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
  const y=Number(m[1]),mo=Number(m[2]);
  // 계산서 발행월 기준 익익월 말일: 2월 발행 -> 4월 말일.
  return new Date(Date.UTC(y,mo+2,0)).toISOString().slice(0,10);
}
function kstTodayIso(){return new Date(Date.now()+9*3600_000).toISOString().slice(0,10)}
function parseWorkbook(buffer){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const sheetName=wb.SheetNames.find(n=>String(n).trim()==='계산서')||wb.SheetNames[0];
  const ws=wb.Sheets[sheetName];if(!ws)throw new Error('계산서 시트를 찾지 못했습니다.');
  const rows=XLSX.utils.sheet_to_json(ws,{defval:null,raw:false});
  return {sheetName,rows};
}
function invoiceGross(row){
  const total=num(row['합계금액']),supply=num(row['공급가액']),vat=num(row['세액']),sum=supply+vat;
  // 정부보조금 행은 일부 원본에서 합계금액 열이 세액만 들어가므로 공급가액+세액을 우선합니다.
  if(/정부\s*보조금/.test(String(row['품목명']||''))&&sum>0)return sum;
  if(total>0&&sum>0&&Math.abs(total-sum)<=Math.max(10,Math.abs(sum)*0.001))return total;
  return sum>0?sum:total;
}
function normalizeRows(rows,asOf){
  const all=[];
  for(const row of rows||[]){
    const item=String(row['품목명']||'').trim();
    if(!/태양광\s*구축/.test(item))continue;
    const invoiceDate=isoDate(row['작성일자']??row['품목일자']);if(!invoiceDate)continue;
    const support=/정부\s*보조금/.test(item),gross=Math.round(invoiceGross(row)),supply=Math.round(num(row['공급가액'])),vat=Math.round(num(row['세액'])),dueDate=endOfSecondFollowingMonth(invoiceDate);
    const m=item.match(/\((\d+)\s*\/\s*(\d+)회차\)/);
    all.push({invoiceDate,dueDate,isDue:Boolean(dueDate&&dueDate<=asOf),item,gross,supply,vat,support,sequence:m?Number(m[1]):null,totalSequence:m?Number(m[2]):null});
  }
  all.sort((a,b)=>a.invoiceDate.localeCompare(b.invoiceDate)||Number(a.sequence||0)-Number(b.sequence||0));
  return all;
}
export async function loadLiveProjectRepayment({contract,asOf=kstTodayIso()}={}){
  let file=null,buffer=null,source='fallback';
  try{
    // 사용자가 지정한 '계산서 발행 및 입출금 내역' 원본을 최우선으로 읽습니다.
    // 환경변수로 교체할 수 있으며, 미설정 시 현재 프로젝트에 연결된 정확한 Drive 파일 ID를 사용합니다.
    const exactId=String(process.env.PROJECT_FINANCE_SPREADSHEET_ID||DEFAULT_FINANCE_SHEET_ID).trim();
    file=exactId?await getDriveSpreadsheetById(exactId):null;
    if(!file)file=await findNamedSpreadsheet(FINANCE_FILE_NAMES);
    if(file){buffer=await downloadSpreadsheetAsXlsx(file);source='google-drive'}
  }catch(e){/* fallback below */}
  if(!buffer){
    const local=path.join(process.cwd(),'public','docs','KT-JCPC-invoice-cashflow-current.xlsx');
    if(fs.existsSync(local)){buffer=fs.readFileSync(local);file={name:'계산서 발행 및 입출금 내역.xlsx',modifiedTime:null,webViewLink:null};source='bundled-fallback'}
  }
  if(!buffer)return null;
  const parsed=parseWorkbook(buffer),items=normalizeRows(parsed.rows,asOf),supportItems=items.filter(x=>x.support),regular=items.filter(x=>!x.support),due=regular.filter(x=>x.isDue),notDue=regular.filter(x=>!x.isDue);
  const installmentCount=Number(contract?.installmentCount||60),monthly=Number(contract?.monthlyInstallmentInclVat||0),scheduledTotal=monthly*installmentCount;
  const sum=(arr,key='gross')=>arr.reduce((a,x)=>a+Number(x?.[key]||0),0);
  const duePaidInclVat=Math.round(sum(due)),invoicedInclVat=Math.round(sum(regular)),supportPassThroughInvoiceInclVat=Math.round(sum(supportItems)),remainingFinancingInclVat=Math.max(0,Math.round(scheduledTotal-duePaidInclVat));
  const byYear=new Map();
  for(const x of regular){const y=Number(String(x.dueDate||x.invoiceDate).slice(0,4));if(!byYear.has(y))byYear.set(y,{year:y,issuedInstallments:0,dueInstallments:0,invoicedInclVat:0,repaymentDueInclVat:0,futureIssuedInclVat:0});const g=byYear.get(y);g.issuedInstallments++;g.invoicedInclVat+=x.gross;if(x.isDue){g.dueInstallments++;g.repaymentDueInclVat+=x.gross}else g.futureIssuedInclVat+=x.gross}
  return {
    source,asOf,sheetName:parsed.sheetName,fileName:file?.name||file?.title||'계산서 발행 및 입출금 내역',fileModifiedTime:file?.modifiedTime||null,fileUrl:file?.webViewLink||null,
    paymentRule:'계산서 발행일 기준 익익월 말일을 실제 원리금 지급일자로 계산',
    repaymentRows:regular.length,issuedInstallments:regular.length,dueInstallments:due.length,notDueIssuedInstallments:notDue.length,remainingNotIssuedInstallments:Math.max(0,installmentCount-regular.length),remainingScheduledInstallments:Math.max(0,installmentCount-due.length),
    invoicedInclVat,duePaidInclVat,notDueIssuedInclVat:Math.round(sum(notDue)),remainingNotIssuedInclVat:Math.max(0,Math.round(scheduledTotal-invoicedInclVat)),remainingFinancingInclVat,
    scheduledTotalInclVat:scheduledTotal,completionPct:installmentCount>0?+(due.length/installmentCount*100).toFixed(2):null,invoiceProgressPct:installmentCount>0?+(regular.length/installmentCount*100).toFixed(2):null,
    supportPassThroughInvoiceInclVat,supportPassThroughSupply:Math.round(sum(supportItems,'supply')),supportPassThroughVat:Math.round(sum(supportItems,'vat')),
    yearly:[...byYear.values()].sort((a,b)=>a.year-b.year),
    recentInvoices:[...regular].sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)).slice(0,12),
    allInvoices:regular
  };
}
