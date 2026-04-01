import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/**
 * Income Report — Serves from pre-computed cache.
 */
export async function GET() {
  try {
    let data = await getCachedReport("income");

    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("income");
    }

    if (!data) {
      return NextResponse.json({ rows: [], totals: null, dataPeriod: null, lastUpload: null, audit: null });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Income report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
