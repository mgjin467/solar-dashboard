import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import {findNamedSpreadsheet,downloadSpreadsheetAsXlsx,getDriveSpreadsheetById} from './drive';

const FINANCE_FILE_NAMES=['계산서 발행 및 입출금 내역','계산서 발행 및 입출금 내역.xlsx'];
const DEFAULT_FINANCE_SHEET_ID='1VJHgHsekNCbhJdT64UdVFY6C4s8GW0zOqO4_rQsVegU';
const DEFAULT_FINANCE_WEB_URL='https://docs.google.com/spreadsheets/d/1VJHgHsekNCbhJdT64UdVFY6C4s8GW0zOqO4_rQsVegU/edit?usp=drivesdk';

function num(v){const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:0}
function isoDate(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  if(typeof v==='number'&&Number.isFinite(v)){const d=XLSX.SSF.parse_date_code(v);if(d?.y)return`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}
  const s=String(v??'').trim();const m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);return m?`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`:null;
}
function isoParts(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?{y:+m[1],m:+m[2],d:+m[3]}:null}
function addMonthsStart(iso,months){const p=isoParts(iso);if(!p)return null;return new Date(Date.UTC(p.y,p.m-1+Number(months||0),1)).toISOString().slice(0,10)}
function addDaysIso(iso,days){const p=isoParts(iso);if(!p)return null;return new Date(Date.UTC(p.y,p.m-1,p.d+Number(days||0))).toISOString().slice(0,10)}
function firstDayNextMonth(iso){return addMonthsStart(iso,1)}
function addMonthsSameDay(iso,months){const p=isoParts(iso);if(!p)return null;const base=new Date(Date.UTC(p.y,p.m-1+Number(months||0),1)),y=base.getUTCFullYear(),m=base.getUTCMonth(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(p.d,last))).toISOString().slice(0,10)}
function financeYearNoForDate(iso,financeStart){const a=isoParts(financeStart),b=isoParts(iso);if(!a||!b)return null;const diff=(b.y*12+(b.m-1))-(a.y*12+(a.m-1));return diff<0?null:Math.floor(diff/12)+1}
function endOfSecondFollowingMonth(iso){const p=isoParts(iso);if(!p)return null;return new Date(Date.UTC(p.y,p.m+2,0)).toISOString().slice(0,10)}
function financeYearPeriod(financeStart,yearNo){const start=addMonthsStart(financeStart,(Number(yearNo)-1)*12),next=addMonthsStart(start,12);return{yearNo:Number(yearNo),start,end:addDaysIso(next,-1)}}
function kstTodayIso(){return new Date(Date.now()+9*3600_000).toISOString().slice(0,10)}
function parseWorkbook(buffer){
  const wb=XLSX.read(buffer,{type:'buffer',cellDates:true}),sheetName=wb.SheetNames.find(n=>String(n).trim()==='계산서')||wb.SheetNames[0],ws=wb.Sheets[sheetName];
  if(!ws)throw new Error('계산서 시트를 찾지 못했습니다.');
  return{sheetName,rows:XLSX.utils.sheet_to_json(ws,{defval:null,raw:false})};
}
function invoiceGross(row){
  const total=num(row['합계금액']),supply=num(row['공급가액']),vat=num(row['세액']),sum=supply+vat;
  // 정부보조금 행은 일부 원본에서 합계금액 열에 세액만 들어가므로 공급가액+세액을 우선합니다.
  if(/정부\s*보조금/.test(String(row['품목명']||''))&&sum>0)return sum;
  if(total>0)return total; // 사용자가 지정한 작성일자·합계금액을 실제 원리금 계산의 최우선 기준으로 사용
  return sum>0?sum:0;
}
function normalizeRows(rows,asOf){
  const all=[];
  for(const row of rows||[]){
    const item=String(row['품목명']||'').trim();if(!/태양광\s*구축/.test(item))continue;
    const invoiceDate=isoDate(row['작성일자']??row['품목일자']);if(!invoiceDate)continue;
    const support=/정부\s*보조금/.test(item),gross=Math.round(invoiceGross(row)),supply=Math.round(num(row['공급가액'])),vat=Math.round(num(row['세액'])),dueDate=endOfSecondFollowingMonth(invoiceDate);
    const m=item.match(/\((\d+)\s*\/\s*(\d+)회차\)/);
    all.push({invoiceDate,dueDate,isDue:Boolean(dueDate&&dueDate<=asOf),item,gross,supply,vat,support,sourceSequence:m?Number(m[1]):null,sourceTotalSequence:m?Number(m[2]):null,note:String(row['비고']||'')});
  }
  all.sort((a,b)=>a.invoiceDate.localeCompare(b.invoiceDate)||Number(a.sourceSequence||0)-Number(b.sourceSequence||0));return all;
}
function solveMonthlyRate(principal,payment,n){
  principal=Number(principal)||0;payment=Number(payment)||0;n=Number(n)||0;if(!(principal>0&&payment>0&&n>0))return null;
  const pv=r=>Math.abs(r)<1e-12?payment*n:payment*(1-Math.pow(1+r,-n))/r;
  let lo=0,hi=.1;while(pv(hi)>principal&&hi<10)hi*=2;
  for(let i=0;i<120;i++){const mid=(lo+hi)/2;if(pv(mid)>principal)lo=mid;else hi=mid}return(lo+hi)/2;
}
function buildAmortization(contract){
  const n=Number(contract?.installmentCount||60),paymentSupply=Number(contract?.installmentSupplyPerMonth||0)||Math.round(Number(contract?.monthlyInstallmentInclVat||0)/1.1),principal=Number(contract?.repaymentPrincipalSchedule||contract?.ktInvestment||0),rate=solveMonthlyRate(principal,paymentSupply,n)||0;
  let balance=principal;const rows=[];
  for(let i=1;i<=n;i++){
    let interest=balance*rate,principalPaid=paymentSupply-interest;
    if(i===n){principalPaid=balance;interest=paymentSupply-principalPaid}
    balance=Math.max(0,balance-principalPaid);
    const vat=Math.round(paymentSupply*.1),gross=paymentSupply+vat;
    rows.push({installmentNo:i,planSupplyWon:paymentSupply,planPrincipalWon:Math.round(principalPaid),planInterestWon:Math.round(interest),planVatWon:vat,planGrossWon:gross,remainingPrincipalWon:Math.round(balance)});
  }
  // 정수 반올림 오차는 마지막 회차에 보정
  const pSum=rows.reduce((a,x)=>a+x.planPrincipalWon,0),iSum=rows.reduce((a,x)=>a+x.planInterestWon,0),targetInterest=paymentSupply*n-principal;
  if(rows.length){rows.at(-1).planPrincipalWon+=Math.round(principal-pSum);rows.at(-1).planInterestWon+=Math.round(targetInterest-iSum);rows.at(-1).planSupplyWon=rows.at(-1).planPrincipalWon+rows.at(-1).planInterestWon;rows.at(-1).planVatWon=Math.round(rows.at(-1).planSupplyWon*.1);rows.at(-1).planGrossWon=rows.at(-1).planSupplyWon+rows.at(-1).planVatWon}
  return{rows,principal,paymentSupply,monthlyRate:rate,nominalAnnualRate:rate*12,effectiveAnnualRate:Math.pow(1+rate,12)-1,totalInterest:targetInterest,totalSupply:paymentSupply*n,totalVat:Math.round(paymentSupply*n*.1),totalGross:Math.round(paymentSupply*n*1.1)};
}
function sum(arr,key){return(arr||[]).reduce((a,x)=>a+Number(x?.[key]||0),0)}

export async function loadLiveProjectRepayment({contract,asOf=kstTodayIso()}={}){
  let file=null,buffer=null,source='fallback';
  try{
    const exactId=String(process.env.PROJECT_FINANCE_SPREADSHEET_ID||DEFAULT_FINANCE_SHEET_ID).trim();file=exactId?await getDriveSpreadsheetById(exactId):null;if(!file)file=await findNamedSpreadsheet(FINANCE_FILE_NAMES);if(file){buffer=await downloadSpreadsheetAsXlsx(file);source='google-drive'}
  }catch(e){/* bundled fallback below */}
  if(!buffer){const local=path.join(process.cwd(),'public','docs','KT-JCPC-invoice-cashflow-current.xlsx');if(fs.existsSync(local)){buffer=fs.readFileSync(local);file={name:'계산서 발행 및 입출금 내역.xlsx',modifiedTime:null,webViewLink:null};source='bundled-fallback'}}
  if(!buffer)return null;
  const parsed=parseWorkbook(buffer),items=normalizeRows(parsed.rows,asOf),supportItems=items.filter(x=>x.support),regularBase=items.filter(x=>!x.support),amort=buildAmortization(contract),firstInvoiceDate=regularBase[0]?.invoiceDate||null,financeStart=firstInvoiceDate?addMonthsStart(firstInvoiceDate,0):'2022-02-01';
  const datedAmort=amort.rows.map(plan=>{const plannedInvoiceDate=firstInvoiceDate?addMonthsSameDay(firstInvoiceDate,Number(plan.installmentNo)-1):null,plannedDueDate=plannedInvoiceDate?endOfSecondFollowingMonth(plannedInvoiceDate):null;return{...plan,plannedInvoiceDate,plannedDueDate,financeYearNo:plannedDueDate?financeYearNoForDate(plannedDueDate,financeStart):Math.floor((Number(plan.installmentNo)-1)/12)+1}});
  const regular=regularBase.map((x,idx)=>{
    const installmentNo=idx+1,plan=datedAmort[installmentNo-1]||{},contractYearNo=Number(plan.financeYearNo||financeYearNoForDate(x.dueDate,financeStart)||1),period=financeYearPeriod(financeStart,contractYearNo),scale=plan.planSupplyWon>0?Number(x.supply||0)/plan.planSupplyWon:1;
    return{...x,installmentNo,contractYearNo,contractPeriodStart:period.start,contractPeriodEnd:period.end,plannedInvoiceDate:plan.plannedInvoiceDate||null,plannedDueDate:plan.plannedDueDate||null,plannedPrincipalWon:Number(plan.planPrincipalWon||0),plannedInterestWon:Number(plan.planInterestWon||0),plannedVatWon:Number(plan.planVatWon||0),actualPrincipalWon:Math.round(Number(plan.planPrincipalWon||0)*scale),actualInterestWon:Math.round(Number(plan.planInterestWon||0)*scale),actualVatWon:Number(x.vat||0),actualSupplyWon:Number(x.supply||0),remainingPrincipalWon:Number(plan.remainingPrincipalWon||0)};
  });
  const due=regular.filter(x=>x.isDue),notDue=regular.filter(x=>!x.isDue),installmentCount=Number(contract?.installmentCount||60),scheduledTotal=Number(contract?.financingRepaymentInclVat||amort.totalGross||0)||Number(contract?.monthlyInstallmentInclVat||0)*installmentCount;
  const duePaidInclVat=Math.round(sum(due,'gross')),invoicedInclVat=Math.round(sum(regular,'gross')),supportPassThroughInvoiceInclVat=Math.round(sum(supportItems,'gross'));
  const maxCycle=Math.max(1,...datedAmort.map(x=>Number(x.financeYearNo||1))),cycleRows=[];for(let y=1;y<=maxCycle;y++){
    const p=financeYearPeriod(financeStart,y),issued=regular.filter(x=>x.invoiceDate>=p.start&&x.invoiceDate<=p.end),dueRows=regular.filter(x=>x.dueDate>=p.start&&x.dueDate<=p.end&&x.isDue),futureDueIssued=regular.filter(x=>x.dueDate>=p.start&&x.dueDate<=p.end&&!x.isDue),plans=datedAmort.filter(x=>x.plannedDueDate>=p.start&&x.plannedDueDate<=p.end),nums=plans.map(x=>Number(x.installmentNo)).filter(Number.isFinite);
    cycleRows.push({yearNo:y,periodStart:p.start,periodEnd:p.end,installmentStart:nums.length?Math.min(...nums):null,installmentEnd:nums.length?Math.max(...nums):null,issuedInstallments:issued.length,dueInstallments:dueRows.length,invoicedInclVat:Math.round(sum(issued,'gross')),repaymentDueInclVat:Math.round(sum(dueRows,'gross')),futureIssuedInclVat:Math.round(sum(futureDueIssued,'gross')),actualPrincipalDueWon:Math.round(sum(dueRows,'actualPrincipalWon')),actualInterestDueWon:Math.round(sum(dueRows,'actualInterestWon')),actualVatDueWon:Math.round(sum(dueRows,'actualVatWon')),planPrincipalWon:Math.round(sum(plans,'planPrincipalWon')),planInterestWon:Math.round(sum(plans,'planInterestWon')),planVatWon:Math.round(sum(plans,'planVatWon')),planGrossWon:Math.round(sum(plans,'planGrossWon'))});
  }
  return{
    source,asOf,sheetName:parsed.sheetName,fileName:file?.name||file?.title||'계산서 발행 및 입출금 내역',fileModifiedTime:file?.modifiedTime||null,fileUrl:file?.webViewLink||DEFAULT_FINANCE_WEB_URL,
    paymentRule:'계산서 시트의 작성일자·합계금액을 기준으로 하며, 지급일은 작성일자가 속한 달의 익익월 말일로 계산',firstInvoiceDate,financeStart,financeYearRule:`첫 일반 원리금 계산서 ${firstInvoiceDate||'-'}가 속한 달의 1일(${financeStart})부터 12개월씩 금융연차를 구분`,repaymentRows:regular.length,issuedInstallments:regular.length,dueInstallments:due.length,notDueIssuedInstallments:notDue.length,remainingNotIssuedInstallments:Math.max(0,installmentCount-regular.length),remainingScheduledInstallments:Math.max(0,installmentCount-due.length),
    invoicedInclVat,duePaidInclVat,notDueIssuedInclVat:Math.round(sum(notDue,'gross')),remainingNotIssuedInclVat:Math.max(0,Math.round(scheduledTotal-invoicedInclVat)),remainingFinancingInclVat:Math.max(0,Math.round(scheduledTotal-duePaidInclVat)),scheduledTotalInclVat:scheduledTotal,completionPct:installmentCount>0?+(due.length/installmentCount*100).toFixed(2):null,invoiceProgressPct:installmentCount>0?+(regular.length/installmentCount*100).toFixed(2):null,
    actualPrincipalPaidWon:Math.round(sum(due,'actualPrincipalWon')),actualInterestPaidWon:Math.round(sum(due,'actualInterestWon')),actualVatPaidWon:Math.round(sum(due,'actualVatWon')),
    supportPassThroughInvoiceInclVat,supportPassThroughSupply:Math.round(sum(supportItems,'supply')),supportPassThroughVat:Math.round(sum(supportItems,'vat')),
    financing:{principalWon:Math.round(amort.principal),interestWon:Math.round(amort.totalInterest),supplyTotalWon:Math.round(amort.totalSupply),vatWon:Math.round(amort.totalVat),grossWon:Math.round(amort.totalGross),monthlySupplyWon:Math.round(amort.paymentSupply),monthlyGrossWon:Math.round(amort.paymentSupply*1.1),monthlyRatePct:+(amort.monthlyRate*100).toFixed(4),nominalAnnualRatePct:+(amort.nominalAnnualRate*100).toFixed(3),effectiveAnnualRatePct:+(amort.effectiveAnnualRate*100).toFixed(3),totalInterestPctOfPrincipal:amort.principal>0?+(amort.totalInterest/amort.principal*100).toFixed(2):null,principalVsKtInvestmentDifferenceWon:Math.round(amort.principal-Number(contract?.ktInvestment||0))},
    yearly:cycleRows,amortization:datedAmort,recentInvoices:[...regular].sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate)).slice(0,12),allInvoices:regular
  };
}
