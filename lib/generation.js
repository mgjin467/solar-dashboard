import * as cheerio from 'cheerio';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2})$/;
const FALLBACK_HOURS = Array.from({length:17}, (_,i) => i + 5); // 05~21시

function parseNumber(v) {
  const n = Number(String(v ?? '').replace(/,/g,'').trim());
  return Number.isFinite(n) ? n : null;
}

function utcDate(dateString, hour = 0) {
  const [y,m,d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,hour,0,0));
}

function tableRowsFromHtml(buffer) {
  const text = buffer.toString('utf8');
  if (!/<html[\s>]/i.test(text) && !/<table[\s>]/i.test(text)) {
    throw new Error('현재 파서는 공급사 HTML 형식 .xls 파일을 대상으로 합니다.');
  }
  const $ = cheerio.load(text);
  const rows = [];
  $('tr').each((_, tr) => {
    const vals = [];
    $(tr).children('th,td').each((__, cell) => vals.push($(cell).text().replace(/\s+/g,' ').trim()));
    if (vals.length) rows.push(vals);
  });
  return rows;
}

export function parseGenerationFile({name, modifiedTime, buffer}) {
  const rows = tableRowsFromHtml(buffer);
  const isMonth = name.includes('발전 보고서 - 월');
  const modifiedMs = Date.parse(modifiedTime || '') || 0;
  const nowMs = Date.now();
  const out = [];

  if (isMonth) {
    for (const r of rows) {
      if (r.length < 4) continue;
      const m = String(r[0]).match(HOUR_RE);
      if (!m) continue;
      const hour = Number(m[2]);
      const inv1 = parseNumber(r[1]);
      const inv2 = parseNumber(r[2]);
      const total = parseNumber(r[3]);
      if (total === null || hour < 0 || hour > 23) continue;
      const dt = utcDate(m[1], hour);
      if (dt.getTime() > nowMs && total === 0) continue;
      out.push({
        ts: dt.toISOString(),
        inv1Kwh: inv1 ?? 0,
        inv2Kwh: inv2 ?? 0,
        totalKwh: total,
        kwh: total,
        sourceFile: name,
        sourceModifiedTime: modifiedTime,
        sourceModifiedMs: modifiedMs,
        precision: 'hourly_exact'
      });
    }
  } else {
    for (const r of rows) {
      if (r.length < 4 || !DATE_RE.test(String(r[0]))) continue;
      const inv1 = parseNumber(r[1]);
      const inv2 = parseNumber(r[2]);
      const total = parseNumber(r[3]);
      if (total === null) continue;
      const day = utcDate(r[0], 0);
      if (day.getTime() > nowMs && total === 0) continue;
      const inv1Each = (inv1 ?? 0) / FALLBACK_HOURS.length;
      const inv2Each = (inv2 ?? 0) / FALLBACK_HOURS.length;
      const totalEach = total / FALLBACK_HOURS.length;
      for (const hour of FALLBACK_HOURS) {
        out.push({
          ts: utcDate(r[0], hour).toISOString(),
          inv1Kwh: inv1Each,
          inv2Kwh: inv2Each,
          totalKwh: totalEach,
          kwh: totalEach,
          sourceFile: name,
          sourceModifiedTime: modifiedTime,
          sourceModifiedMs: modifiedMs,
          precision: 'daily_fallback'
        });
      }
    }
  }
  return out;
}

export function mergeGenerationRows(rows,{prefer='daily'}={}) {
  // 파일 간 중복은 '시각'이 아니라 '날짜' 단위로 출처를 하나만 선택합니다.
  // 년 보고서는 일별 합계가 확정값이므로 일/월/분기/계절/년 집계의 기준입니다.
  // 월 보고서는 시간별 원본이므로 시간 집계에서만 우선합니다.
  // 기존처럼 05~21시 daily_fallback과 그 밖의 hourly_exact가 섞이면 하루 합계가 부풀 수 있어
  // 같은 날짜에 우선 출처가 존재하면 다른 출처의 그 날짜 행 전체를 제외합니다.
  const dayKey=row=>String(row?.ts||'').slice(0,10);
  const dailyDays=new Set(rows.filter(r=>r.precision==='daily_fallback').map(dayKey));
  const hourlyDays=new Set(rows.filter(r=>r.precision==='hourly_exact').map(dayKey));
  const filtered=rows.filter(row=>{
    const day=dayKey(row);
    if(prefer==='hourly'&&hourlyDays.has(day))return row.precision==='hourly_exact';
    if(prefer!=='hourly'&&dailyDays.has(day))return row.precision==='daily_fallback';
    return true;
  });
  const best=new Map();
  for(const row of filtered){
    const prev=best.get(row.ts);
    if(!prev||Number(row.sourceModifiedMs||0)>=Number(prev.sourceModifiedMs||0))best.set(row.ts,row);
  }
  return [...best.values()].sort((a,b)=>a.ts.localeCompare(b.ts));
}
