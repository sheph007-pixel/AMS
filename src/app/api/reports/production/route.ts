import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/**
 * Production Report — Serves from pre-computed cache.
 * Cache is rebuilt after each XML import.
 */
export async function GET() {
  try {
    let data = await getCachedReport("production");

    // If no cache exists, build it now (first-time only)
    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("production");
    }

    if (!data) {
      return NextResponse.json({ rows: [], summary: null, audit: null, periods: [], methodology: null });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Production report error:", error);
    return NextResponse.json({ error: "Failed to generate production report" }, { status: 500 });
  }
}
