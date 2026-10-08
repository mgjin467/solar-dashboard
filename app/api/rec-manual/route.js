import {NextResponse} from 'next/server';
import {saveRecManualEntry} from '@/lib/rec';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request){try{const body=await request.json();const saved=await saveRecManualEntry(body||{});return NextResponse.json({ok:true,saved},{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,message:e?.message||String(e)},{status:400,headers:{'Cache-Control':'no-store'}})}}
