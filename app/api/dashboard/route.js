import { NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/dashboard';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request){
  try{const {searchParams}=new URL(request.url);const grain=['hour','day','month','season','quarter','year'].includes(searchParams.get('grain'))?searchParams.get('grain'):'month';const start=searchParams.get('start')||'',end=searchParams.get('end')||'',forceSmp=searchParams.get('forceSmp')==='1';const compareOffsets=(searchParams.get('compare')||'').split(',').map(Number).filter(n=>[1,2,3].includes(n));const cap1=Number(searchParams.get('cap1')||0),cap2=Number(searchParams.get('cap2')||0),recWeight=Number(searchParams.get('recWeight')||1.5),recSupplyRatio=Number(searchParams.get('recSupplyRatio')||0.5);const data=await buildDashboard({grain,start,end,forceSmp,compareOffsets,cap1,cap2,recWeight,recSupplyRatio});return NextResponse.json(data,{headers:{'Cache-Control':'no-store, max-age=0'}})}catch(e){return NextResponse.json({error:e?.message||String(e)},{status:500,headers:{'Cache-Control':'no-store'}})}
}
