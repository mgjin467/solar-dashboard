import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';

// SMP Excel을 Drive에 영구 캐시하려면 write 권한이 필요합니다.
// 서비스계정을 대상 폴더에 '편집자'로 공유하세요.
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SPREADSHEET_EXT_RE = /\.(?:xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|ods|csv|tsv|txt|html?|xml)$/i;
const SPREADSHEET_MIME_RE = /(?:excel|spreadsheet|csv|tab-separated-values|opendocument\.spreadsheet|html|xml|text\/plain)/i;
export const SMP_CACHE_FOLDER_NAME = '_KPX_SMP_CACHE';
export const REC_CACHE_FOLDER_NAME = '_REC_MARKET_CACHE';
export const REC_CACHE_FILE_NAME = 'REC_현물시장_월별캐시.xlsx';
export const REC_DAILY_CACHE_FILE_NAME = 'REC_현물시장_일별캐시.xlsx';
export const REC_MANUAL_FILE_NAME = 'REC_수익화_수기입력.xlsx';
export const REC_ISSUE_DATE_FILE_NAME = 'REC_발급일_수기입력.xlsx';
export const PROJECT_DATA_FOLDER_NAME = '_PROJECT_FINANCE';
export const PROJECT_MAINTENANCE_FILE_NAME = 'JCPC_태양광_유지보수비_수기입력.xlsx';

export function serviceAccountInfo() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const info = JSON.parse(raw);
      if (info.private_key) info.private_key = info.private_key.replace(/\\n/g, '\n');
      return info;
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON이 올바른 JSON 형식이 아닙니다.');
    }
  }
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const candidates = [configured, './service_account.json'].filter(Boolean);
  for (const candidate of candidates) {
    const full = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(full)) {
      try {
        const info = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (info.private_key) info.private_key = info.private_key.replace(/\\n/g, '\n');
        return info;
      } catch (e) {
        throw new Error(`서비스계정 파일을 읽지 못했습니다: ${full} (${e?.message || e})`);
      }
    }
  }
  throw new Error('Google 서비스계정 설정이 없습니다. Vercel에서는 GOOGLE_SERVICE_ACCOUNT_JSON, 로컬에서는 GOOGLE_SERVICE_ACCOUNT_FILE=./service_account.json 을 설정하세요.');
}

let authClientPromise=null;
async function accessToken() {
  if(!authClientPromise){
    authClientPromise=(async()=>{
      const auth = new GoogleAuth({ credentials: serviceAccountInfo(), scopes: [SCOPE] });
      return await auth.getClient();
    })().catch(e=>{authClientPromise=null;throw e});
  }
  const client = await authClientPromise;
  const token = await client.getAccessToken();
  if (!token?.token) throw new Error('Google Drive 액세스 토큰 발급에 실패했습니다.');
  return token.token;
}

async function driveFetch(url, init = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive API 오류 ${res.status}: ${body.slice(0, 500)}`);
  }
  return res;
}

function folderId() {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error('GOOGLE_DRIVE_FOLDER_ID 환경변수가 없습니다.');
  return id.trim();
}

export async function getFolderInfo() {
  const id = folderId();
  const params = new URLSearchParams({ fields: 'id,name,mimeType,driveId,parents,trashed,capabilities(canListChildren,canAddChildren)' });
  params.set('supportsAllDrives', 'true');
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params}`);
  return await res.json();
}

async function listChildren(parentId) {
  const files = [];
  let pageToken = '';
  do {
    const q = `'${parentId.replace(/'/g, "\\'")}' in parents and trashed=false`;
    const params = new URLSearchParams({
      q, pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents,driveId,webViewLink,shortcutDetails(targetId,targetMimeType))',
      orderBy: 'modifiedTime asc', spaces: 'drive', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    const json = await res.json();
    files.push(...(json.files || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return files;
}

// 대시보드 원본 발전/SMP 파일은 지정 Drive 폴더 바로 아래 파일만 사용합니다.
// 하위 백업/문서 폴더까지 재귀 탐색하면 중복 집계와 불필요한 대용량 다운로드가 발생합니다.
const ROOT_CHILDREN_CACHE_TTL_MS=Number(process.env.DRIVE_ROOT_LIST_CACHE_SECONDS||300)*1000;
let rootChildrenCache={rootId:'',ts:0,value:null};
let rootChildrenInFlight=null;
export function invalidateRootChildrenCache(){rootChildrenCache={rootId:'',ts:0,value:null};rootChildrenInFlight=null}
export async function listRootChildren({force=false}={}){
  const rootId=folderId(),now=Date.now();
  if(!force&&rootChildrenCache.value&&rootChildrenCache.rootId===rootId&&now-rootChildrenCache.ts<ROOT_CHILDREN_CACHE_TTL_MS)return rootChildrenCache.value;
  if(!force&&rootChildrenInFlight?.rootId===rootId)return await rootChildrenInFlight.promise;
  const promise=listChildren(rootId).then(value=>{rootChildrenCache={rootId,ts:Date.now(),value};return value});
  rootChildrenInFlight={rootId,promise};
  try{return await promise}finally{if(rootChildrenInFlight?.promise===promise)rootChildrenInFlight=null}
}

const DRIVE_TREE_CACHE_TTL_MS=60_000;
let driveTreeCache={key:'',ts:0,value:null};
let driveTreeInFlight=null;
export function invalidateDriveListingCache(){driveTreeCache={key:'',ts:0,value:null};driveTreeInFlight=null;invalidateRootChildrenCache()}
export async function listAllEntriesRecursive({ maxDepth = 8, force = false } = {}) {
  const rootId = folderId(),key=`${rootId}:${maxDepth}`,now=Date.now();
  if(!force&&driveTreeCache.value&&driveTreeCache.key===key&&now-driveTreeCache.ts<DRIVE_TREE_CACHE_TTL_MS)return driveTreeCache.value;
  if(!force&&driveTreeInFlight?.key===key)return await driveTreeInFlight.promise;
  const promise=(async()=>{
    const out = [];
    const queue = [{ id: rootId, path: '', depth: 0 }];
    const visited = new Set([rootId]);
    let qi=0;
    while (qi<queue.length) {
      const current = queue[qi++];
      const children = await listChildren(current.id);
      for (const f of children) {
        const itemPath = current.path ? `${current.path}/${f.name}` : f.name;
        out.push({ ...f, path: itemPath, depth: current.depth });
        if (f.mimeType === FOLDER_MIME && current.depth < maxDepth && !visited.has(f.id)) {
          visited.add(f.id); queue.push({ id: f.id, path: itemPath, depth: current.depth + 1 });
        }
      }
    }
    driveTreeCache={key,ts:Date.now(),value:out};
    return out;
  })();
  driveTreeInFlight={key,promise};
  try{return await promise}finally{if(driveTreeInFlight?.promise===promise)driveTreeInFlight=null}
}

export async function listExcelFiles() {
  const entries = await listAllEntriesRecursive();
  const excel = [];
  for (const f of entries) {
    const spreadsheetLike = f.mimeType === GSHEET_MIME || SPREADSHEET_EXT_RE.test(f.name || '') || SPREADSHEET_MIME_RE.test(f.mimeType || '');
    if (f.mimeType === SHORTCUT_MIME && f.shortcutDetails?.targetId) {
      const targetMime=f.shortcutDetails?.targetMimeType||'';
      if(SPREADSHEET_EXT_RE.test(f.name||'')||targetMime===GSHEET_MIME||SPREADSHEET_MIME_RE.test(targetMime))excel.push({ ...f, id:f.shortcutDetails.targetId, downloadId:f.shortcutDetails.targetId, shortcutId:f.id, mimeType:targetMime||f.mimeType });
      continue;
    }
    if (spreadsheetLike) excel.push({ ...f, downloadId: f.id });
  }
  return excel;
}


export async function getDriveSpreadsheetById(id){
  const fileId=String(id||'').trim();
  if(!fileId)return null;
  const params=new URLSearchParams({fields:'id,name,mimeType,modifiedTime,size,parents,driveId,webViewLink'});
  params.set('supportsAllDrives','true');
  try{
    const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`);
    const file=await res.json();
    if(file?.mimeType===GSHEET_MIME||SPREADSHEET_EXT_RE.test(file?.name||'')||SPREADSHEET_MIME_RE.test(file?.mimeType||''))return file;
  }catch{}
  return null;
}

export async function findNamedSpreadsheet(names=['계산서 발행 및 입출금 내역']) {
  const wanted=new Set((Array.isArray(names)?names:[names]).map(x=>String(x||'').trim()).filter(Boolean));
  const match=entries=>entries.filter(f=>{
    const base=String(f.name||'').replace(SPREADSHEET_EXT_RE,'').trim();
    return wanted.has(String(f.name||'').trim())||wanted.has(base);
  }).filter(f=>f.mimeType===GSHEET_MIME||SPREADSHEET_EXT_RE.test(f.name||'')||SPREADSHEET_MIME_RE.test(f.mimeType||''));
  let candidates=match(await listRootChildren());
  if(!candidates.length&&process.env.DRIVE_NAMED_FILE_RECURSIVE==='1')candidates=match(await listAllEntriesRecursive());
  candidates.sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')));
  return candidates[0]||null;
}

export async function downloadSpreadsheetAsXlsx(file){
  if(!file?.id)throw new Error('스프레드시트 파일 ID가 없습니다.');
  if(file.mimeType===GSHEET_MIME){
    const params=new URLSearchParams({mimeType:XLSX_MIME});
    const res=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?${params}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return await downloadFile(file.downloadId||file.id);
}

function asDownloadableSpreadsheet(f){
  if(f.mimeType===SHORTCUT_MIME&&f.shortcutDetails?.targetId)return{...f,id:f.shortcutDetails.targetId,downloadId:f.shortcutDetails.targetId,shortcutId:f.id,mimeType:f.shortcutDetails.targetMimeType||f.mimeType};
  return{...f,downloadId:f.id};
}
function generationReportKey(name=''){
  const s=String(name).replace(/\s+/g,' ');
  const type=(s.match(/발전\s*보고서\s*-\s*(년|월)/)||[])[1]||'';
  const dates=[...s.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(m=>m[0]);
  return `${type}|${dates[0]||''}|${dates[1]||''}`;
}
export async function listGenerationExcelFiles({force=false}={}) {
  const entries=await listRootChildren({force});
  const best=new Map();
  for(const raw of entries){
    if(!/발전\s*보고서\s*-\s*(년|월)/.test(raw.name||''))continue;
    if(raw.mimeType===FOLDER_MIME)continue;
    const f=asDownloadableSpreadsheet(raw),key=generationReportKey(f.name)||f.id;
    const prev=best.get(key);
    if(!prev||String(f.modifiedTime||'')>String(prev.modifiedTime||''))best.set(key,f);
  }
  return [...best.values()].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
}

export async function listSmpExcelFiles({force=false}={}) {
  const files=(await listRootChildren({force})).filter(f=>f.mimeType!==FOLDER_MIME).map(asDownloadableSpreadsheet);
  return files.filter(f => /smp.*20\d{2}|20\d{2}.*smp/i.test(f.name || ''));
}

export async function listRecIssuanceExcelFiles({force=false}={}) {
  const files=(await listRootChildren({force})).filter(f=>f.mimeType!==FOLDER_MIME).map(asDownloadableSpreadsheet);
  const explicitId=String(process.env.REC_ISSUANCE_FILE_ID||'').trim();
  if(explicitId){const exact=files.filter(f=>f.id===explicitId||f.downloadId===explicitId);if(exact.length)return exact}
  return files.filter(f => {
    const name=f.name||'';
    if (/발전\s*보고서\s*-\s*(년|월)/.test(name)) return false;
    if (/smp.*20\d{2}|20\d{2}.*smp/i.test(name)) return false;
    if (/REC_현물시장_|REC_수익화_|REC_발급일_|_REC_MARKET_CACHE/i.test(name)) return false;
    return /(RPS|REC.*(?:발급|공급|실적)|(?:발급|공급).*REC|공급인증서|공급전력량)/i.test(name);
  });
}

export async function downloadFile(fileId) {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`);
  return Buffer.from(await res.arrayBuffer());
}

async function createFolder(name, parentId) {
  const metadata = { name, mimeType: FOLDER_MIME, parents: [parentId] };
  const res = await driveFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata)
  });
  return await res.json();
}

export async function ensureSmpCacheFolder() {
  const root = folderId();
  const children = await listRootChildren();
  const existing = children.find(f => f.mimeType === FOLDER_MIME && f.name === SMP_CACHE_FOLDER_NAME);
  if (existing) return existing;
  return await createFolder(SMP_CACHE_FOLDER_NAME, root);
}

async function findFileInFolder(parentId, name) {
  const children = await listChildren(parentId);
  return children.find(f => f.name === name) || null;
}

export async function upsertSmpCacheFile(year, buffer) {
  const cacheFolder = await ensureSmpCacheFolder();
  const name = `smpDataRt_${year}.xlsx`;
  const existing = await findFileInFolder(cacheFolder.id, name);
  if (existing) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: buffer
    });
    return { id: existing.id, name, action: 'updated', folderId: cacheFolder.id };
  }
  const boundary = `solar_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, mimeType: XLSX_MIME, parents: [cacheFolder.id] });
  const pre = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`);
  const post = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([pre, buffer, post]);
  const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  const json = await res.json();
  return { ...json, action: 'created', folderId: cacheFolder.id };
}

export async function ensureRecCacheFolder() {
  const root = folderId();
  const children = await listRootChildren();
  const existing = children.find(f => f.mimeType === FOLDER_MIME && f.name === REC_CACHE_FOLDER_NAME);
  if (existing) return existing;
  return await createFolder(REC_CACHE_FOLDER_NAME, root);
}

export async function getRecMarketCacheFile() {
  const root = folderId();
  const rootChildren = await listRootChildren();
  let cacheFolder = rootChildren.find(f => f.mimeType === FOLDER_MIME && f.name === REC_CACHE_FOLDER_NAME);
  if (!cacheFolder) return null;
  const existing = await findFileInFolder(cacheFolder.id, REC_CACHE_FILE_NAME);
  if (!existing) return null;
  return { ...existing, folderId: cacheFolder.id };
}

export async function downloadRecMarketCacheFile() {
  const file = await getRecMarketCacheFile();
  if (!file) return null;
  return { file, buffer: await downloadFile(file.id) };
}

export async function upsertRecMarketCacheFile(buffer) {
  const cacheFolder = await ensureRecCacheFolder();
  const existing = await findFileInFolder(cacheFolder.id, REC_CACHE_FILE_NAME);
  if (existing) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: buffer
    });
    return { id: existing.id, name: REC_CACHE_FILE_NAME, action: 'updated', folderId: cacheFolder.id };
  }
  const boundary = `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: REC_CACHE_FILE_NAME, mimeType: XLSX_MIME, parents: [cacheFolder.id] });
  const pre = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`);
  const post = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([pre, buffer, post]);
  const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  const json = await res.json();
  return { ...json, action: 'created', folderId: cacheFolder.id };
}


async function getNamedFileInRecCache(name){
  const root=folderId();
  const rootChildren=await listChildren(root);
  const cacheFolder=rootChildren.find(f=>f.mimeType===FOLDER_MIME&&f.name===REC_CACHE_FOLDER_NAME);
  if(!cacheFolder)return null;
  const existing=await findFileInFolder(cacheFolder.id,name);
  return existing?{...existing,folderId:cacheFolder.id}:null;
}

async function downloadNamedRecCacheFile(name){
  const file=await getNamedFileInRecCache(name);
  if(!file)return null;
  return{file,buffer:await downloadFile(file.id)};
}

async function upsertNamedRecCacheFile(name,buffer){
  const cacheFolder=await ensureRecCacheFolder();
  const existing=await findFileInFolder(cacheFolder.id,name);
  if(existing){
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&supportsAllDrives=true`,{method:'PATCH',headers:{'Content-Type':XLSX_MIME},body:buffer});
    return{id:existing.id,name,action:'updated',folderId:cacheFolder.id};
  }
  const boundary=`rec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta=JSON.stringify({name,mimeType:XLSX_MIME,parents:[cacheFolder.id]});
  const pre=Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`);
  const post=Buffer.from(`\r\n--${boundary}--`);
  const body=Buffer.concat([pre,buffer,post]);
  const res=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
  const json=await res.json();return{...json,action:'created',folderId:cacheFolder.id};
}

export const downloadRecDailyCacheFile=()=>downloadNamedRecCacheFile(REC_DAILY_CACHE_FILE_NAME);
export const upsertRecDailyCacheFile=(buffer)=>upsertNamedRecCacheFile(REC_DAILY_CACHE_FILE_NAME,buffer);
export const downloadRecManualFile=()=>downloadNamedRecCacheFile(REC_MANUAL_FILE_NAME);
export const upsertRecManualFile=(buffer)=>upsertNamedRecCacheFile(REC_MANUAL_FILE_NAME,buffer);
export const downloadRecIssueDateFile=()=>downloadNamedRecCacheFile(REC_ISSUE_DATE_FILE_NAME);
export const upsertRecIssueDateFile=(buffer)=>upsertNamedRecCacheFile(REC_ISSUE_DATE_FILE_NAME,buffer);


export async function ensureProjectDataFolder(){
  const root=folderId();
  const children=await listChildren(root);
  const existing=children.find(f=>f.mimeType===FOLDER_MIME&&f.name===PROJECT_DATA_FOLDER_NAME);
  if(existing)return existing;
  return await createFolder(PROJECT_DATA_FOLDER_NAME,root);
}
async function getNamedProjectDataFile(name){
  const root=folderId(),children=await listRootChildren(),folder=children.find(f=>f.mimeType===FOLDER_MIME&&f.name===PROJECT_DATA_FOLDER_NAME);
  if(!folder)return null;
  const existing=await findFileInFolder(folder.id,name);return existing?{...existing,folderId:folder.id}:null;
}
async function downloadNamedProjectDataFile(name){const file=await getNamedProjectDataFile(name);if(!file)return null;return{file,buffer:await downloadFile(file.id)}}
async function upsertNamedProjectDataFile(name,buffer){
  const folder=await ensureProjectDataFolder(),existing=await findFileInFolder(folder.id,name);
  if(existing){await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&supportsAllDrives=true`,{method:'PATCH',headers:{'Content-Type':XLSX_MIME},body:buffer});return{id:existing.id,name,action:'updated',folderId:folder.id}}
  const boundary=`project_${Date.now()}_${Math.random().toString(36).slice(2)}`,meta=JSON.stringify({name,mimeType:XLSX_MIME,parents:[folder.id]}),pre=Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`),post=Buffer.from(`\r\n--${boundary}--`),body=Buffer.concat([pre,buffer,post]);
  const res=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});const json=await res.json();return{...json,action:'created',folderId:folder.id};
}
export const downloadProjectMaintenanceFile=()=>downloadNamedProjectDataFile(PROJECT_MAINTENANCE_FILE_NAME);
export const upsertProjectMaintenanceFile=(buffer)=>upsertNamedProjectDataFile(PROJECT_MAINTENANCE_FILE_NAME,buffer);

export async function driveDiagnostics() {
  const info = serviceAccountInfo();
  const result = { clientEmail: info.client_email || null, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null, folder: null, rootEntries:0, totalEntries: 0, excelCount: 0, generationExcelCount:0, recursiveGenerationCount:0, smpExcelCount:0, entries: [], note: '' };
  try { result.folder = await getFolderInfo(); }
  catch (e) { result.note = `폴더 자체에 접근하지 못했습니다. Drive 공유 권한/폴더 ID를 확인하세요. ${e?.message || e}`; return result; }
  const root=await listRootChildren({force:true});
  const generation=await listGenerationExcelFiles({force:true});
  const smp=await listSmpExcelFiles({force:true});
  result.rootEntries=root.length;result.generationExcelCount=generation.length;result.smpExcelCount=smp.length;
  const entries=await listAllEntriesRecursive({force:true});
  result.totalEntries=entries.length;result.recursiveGenerationCount=entries.filter(f=>/발전\s*보고서\s*-\s*(년|월)/.test(f.name||'')).length;
  result.entries=root.slice(0,150).map(f=>({name:f.name,path:f.name,mimeType:f.mimeType,modifiedTime:f.modifiedTime||null,id:f.id}));
  if (!root.length) result.note='폴더에는 접근했지만 서비스계정 기준으로 보이는 루트 파일/폴더가 0개입니다.';
  else if (!result.generationExcelCount) result.note='루트 폴더에는 발전 보고서 파일이 없습니다.';
  else result.note=`정상: 집계 원본은 루트 폴더 발전보고서 ${result.generationExcelCount}개만 사용합니다. 하위폴더 포함 재귀 검색 시 ${result.recursiveGenerationCount}개가 보이지만 백업/중복본은 집계에서 제외합니다.`;
  return result;
}
