import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';

// SMP Excel을 Drive에 영구 캐시하려면 write 권한이 필요합니다.
// 서비스계정을 대상 폴더에 '편집자'로 공유하세요.
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SMP_CACHE_FOLDER_NAME = '_KPX_SMP_CACHE';
export const REC_CACHE_FOLDER_NAME = '_REC_MARKET_CACHE';
export const REC_CACHE_FILE_NAME = 'REC_현물시장_월별캐시.xlsx';
export const REC_DAILY_CACHE_FILE_NAME = 'REC_현물시장_일별캐시.xlsx';
export const REC_MANUAL_FILE_NAME = 'REC_수익화_수기입력.xlsx';

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

async function accessToken() {
  const auth = new GoogleAuth({ credentials: serviceAccountInfo(), scopes: [SCOPE] });
  const client = await auth.getClient();
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
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents,driveId,shortcutDetails(targetId,targetMimeType))',
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

export async function listAllEntriesRecursive({ maxDepth = 8 } = {}) {
  const rootId = folderId();
  const out = [];
  const queue = [{ id: rootId, path: '', depth: 0 }];
  const visited = new Set([rootId]);
  while (queue.length) {
    const current = queue.shift();
    const children = await listChildren(current.id);
    for (const f of children) {
      const itemPath = current.path ? `${current.path}/${f.name}` : f.name;
      out.push({ ...f, path: itemPath, depth: current.depth });
      if (f.mimeType === FOLDER_MIME && current.depth < maxDepth && !visited.has(f.id)) {
        visited.add(f.id); queue.push({ id: f.id, path: itemPath, depth: current.depth + 1 });
      }
    }
  }
  return out;
}

export async function listExcelFiles() {
  const entries = await listAllEntriesRecursive();
  const excel = [];
  for (const f of entries) {
    if (/\.(xls|xlsx)$/i.test(f.name || '')) { excel.push({ ...f, downloadId: f.id }); continue; }
    if (f.mimeType === SHORTCUT_MIME && /\.(xls|xlsx)$/i.test(f.name || '') && f.shortcutDetails?.targetId) {
      excel.push({ ...f, id: f.shortcutDetails.targetId, downloadId: f.shortcutDetails.targetId, shortcutId: f.id });
    }
  }
  return excel;
}

export async function listGenerationExcelFiles() {
  const files = await listExcelFiles();
  return files.filter(f => /발전\s*보고서\s*-\s*(년|월)/.test(f.name || ''));
}

export async function listSmpExcelFiles() {
  const files = await listExcelFiles();
  return files.filter(f => /smp.*20\d{2}|20\d{2}.*smp/i.test(f.name || ''));
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
  const children = await listChildren(root);
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
  const children = await listChildren(root);
  const existing = children.find(f => f.mimeType === FOLDER_MIME && f.name === REC_CACHE_FOLDER_NAME);
  if (existing) return existing;
  return await createFolder(REC_CACHE_FOLDER_NAME, root);
}

export async function getRecMarketCacheFile() {
  const root = folderId();
  const rootChildren = await listChildren(root);
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

export async function driveDiagnostics() {
  const info = serviceAccountInfo();
  const result = { clientEmail: info.client_email || null, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null, folder: null, totalEntries: 0, excelCount: 0, generationExcelCount:0, smpExcelCount:0, entries: [], note: '' };
  try { result.folder = await getFolderInfo(); }
  catch (e) { result.note = `폴더 자체에 접근하지 못했습니다. Drive 공유 권한/폴더 ID를 확인하세요. ${e?.message || e}`; return result; }
  const entries = await listAllEntriesRecursive();
  const excels = await listExcelFiles();
  result.totalEntries = entries.length; result.excelCount = excels.length;
  result.generationExcelCount = excels.filter(f=>/발전\s*보고서\s*-\s*(년|월)/.test(f.name||'')).length;
  result.smpExcelCount = excels.filter(f=>/smp.*20\d{2}|20\d{2}.*smp/i.test(f.name||'')).length;
  result.entries = entries.slice(0,150).map(f=>({name:f.name,path:f.path,mimeType:f.mimeType,modifiedTime:f.modifiedTime||null,id:f.id}));
  if (!entries.length) result.note='폴더에는 접근했지만 서비스계정 기준으로 보이는 자식 파일/폴더가 0개입니다.';
  else if (!result.generationExcelCount) result.note='폴더에는 접근되지만 발전 보고서 Excel이 없습니다.';
  else result.note=`정상: 발전보고서 ${result.generationExcelCount}개, SMP Excel ${result.smpExcelCount}개를 찾았습니다. SMP 자동 캐시 저장을 사용하려면 서비스계정 권한을 편집자로 공유하세요.`;
  return result;
}
