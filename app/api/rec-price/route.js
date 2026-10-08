import {NextResponse} from 'next/server';
import {loadRecPriceForDate} from '@/lib/rec';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request){try{const {searchParams}=new URL(request.url);const date=searchParams.get('date')||'';const data=await loadRecPriceForDate({date});return NextResponse.json(data,{status:data.ok?200:400,headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,message:e?.message||String(e)},{status:500,headers:{'Cache-Control':'no-store'}})}}
