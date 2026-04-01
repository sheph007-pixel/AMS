import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/**
 * Production Dashboard — Serves tier-level detail from pre-computed cache.
 * Cache is rebuilt after each XML import (includes employee enrollment processing).
 */
export async function GET() {
  try {
    let data = await getCachedReport("production-dashboard");

    // If no cache exists, build it now (first-time only)
    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("production-dashboard");
    }

    if (!data) {
      return NextResponse.json({
        rows: [], summary: null, filters: null, carrierSettings: [],
      });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    console.error("Production dashboard error:", error);
    return NextResponse.json({ error: "Failed to generate production dashboard" }, { status: 500 });
  }
}
