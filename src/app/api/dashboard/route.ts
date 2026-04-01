import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/**
 * Dashboard API — Serves from pre-computed cache.
 */
export async function GET() {
  try {
    let data = await getCachedReport("dashboard");

    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("dashboard");
    }

    if (!data) {
      return NextResponse.json({ kpi: null, premiumTrend: [], topCarriers: [], lobBreakdown: [], yoySummary: [], totalPeriods: 0 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to generate dashboard data" }, { status: 500 });
  }
}
