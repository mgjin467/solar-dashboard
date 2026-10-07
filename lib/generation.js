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
      const total = parseNumber(r[3]);
      if (total === null || hour < 0 || hour > 23) continue;
      const dt = utcDate(m[1], hour);
      // 미래의 0 placeholder는 제외
      if (dt.getTime() > nowMs && total === 0) continue;
      out.push({
        ts: dt.toISOString(), kwh: total, sourceFile: name,
        sourceModifiedTime: modifiedTime, sourceModifiedMs: modifiedMs,
        precision: 'hourly_exact'
      });
    }
  } else {
    for (const r of rows) {
      if (r.length < 4 || !DATE_RE.test(String(r[0]))) continue;
      const total = parseNumber(r[3]);
      if (total === null) continue;
      const day = utcDate(r[0], 0);
      if (day.getTime() > nowMs && total === 0) continue;
      const each = total / FALLBACK_HOURS.length;
      for (const hour of FALLBACK_HOURS) {
        out.push({
          ts: utcDate(r[0], hour).toISOString(), kwh: each, sourceFile: name,
          sourceModifiedTime: modifiedTime, sourceModifiedMs: modifiedMs,
          precision: 'daily_fallback'
        });
      }
    }
  }
  return out;
}

export function mergeGenerationRows(rows) {
  const rank = { daily_fallback: 1, hourly_exact: 2 };
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.ts);
    if (!prev ||
        rank[row.precision] > rank[prev.precision] ||
        (rank[row.precision] === rank[prev.precision] && row.sourceModifiedMs >= prev.sourceModifiedMs)) {
      best.set(row.ts, row);
    }
  }
  return [...best.values()].sort((a,b) => a.ts.localeCompare(b.ts));
}
