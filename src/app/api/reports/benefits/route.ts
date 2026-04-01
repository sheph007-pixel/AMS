import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/**
 * Benefits Report — Serves from pre-computed cache.
 * Cache is rebuilt after each XML import.
 */
export async function GET() {
  try {
    let data = await getCachedReport("benefits");

    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("benefits");
    }

    if (!data) {
      return NextResponse.json({
        rows: [],
        totals: { eligible: 0, enrolled: 0, monthlyPremium: 0 },
        reconciliation: null,
        lastUpload: null,
        dataPeriod: null,
        companyPlanTypes: {},
      });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    console.error("Benefits report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
