import { NextResponse } from "next/server";
import { rebuildAllCaches } from "@/lib/report-cache";

/**
 * POST /api/cache/rebuild — Triggers full cache rebuild.
 * Called automatically after XML import, or manually from admin.
 */
export async function POST() {
  try {
    const result = await rebuildAllCaches();
    return NextResponse.json({
      success: true,
      ...result,
      message: "All report caches rebuilt successfully",
    });
  } catch (error) {
    console.error("Cache rebuild error:", error);
    return NextResponse.json({ error: "Cache rebuild failed" }, { status: 500 });
  }
}
