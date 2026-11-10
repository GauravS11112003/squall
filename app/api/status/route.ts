import { NextResponse } from 'next/server';
import { hasKey } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Tells the browser what this server can do. Never returns the key. */
export async function GET() {
  return NextResponse.json({
    live: hasKey(),
    sim: !hasKey() && process.env.SQUALL_SIM === '1',
    needsCode: Boolean(process.env.SQUALL_ACCESS_CODE?.trim()),
  });
}
