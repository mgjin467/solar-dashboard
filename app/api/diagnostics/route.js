import { NextResponse } from 'next/server';
import { driveDiagnostics } from '@/lib/drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await driveDiagnostics();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
