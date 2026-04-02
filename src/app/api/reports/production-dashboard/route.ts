import { NextResponse } from "next/server";
import { getCachedReport, rebuildAllCaches } from "@/lib/report-cache";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Production Dashboard — Serves tier-level detail from pre-computed cache.
 * Cache stores compact keys to reduce JSON size. This endpoint expands them.
 */
export async function GET() {
  try {
    let data = await getCachedReport("production-dashboard");

    if (!data) {
      await rebuildAllCaches();
      data = await getCachedReport("production-dashboard");
    }

    if (!data) {
      return NextResponse.json({ rows: [], summary: null, filters: null, carrierSettings: [] });
    }

    // Expand compact row keys to full names for the frontend
    const rows = (data.rows || []).map((r: any) => ({
      month: r.m, year: r.y, monthNum: r.mn,
      clientName: r.cn, clientCode: r.cc,
      carrier: r.ca, policyNumber: r.pn, planName: r.pl,
      grouping: r.g, rate: r.r, lives: r.l, benefitAmount: r.ba,
      monthlyPremium: r.mp, incomeMethod: r.im, feeRate: r.fr,
      feeRateDisplay: r.im === "PEPM" ? `$${r.fr}` : r.im === "PERCENT_PREMIUM" ? `${r.fr}%` : "",
      income: r.i, coverageType: r.ct,
      transactionDate: `${r.y}-${String(r.mn).padStart(2, "0")}-01`,
      lineOfBusiness: r.ct, sourceMonth: r.m,
    }));

    return NextResponse.json({
      rows,
      summary: data.summary,
      filters: data.filters,
      carrierSettings: data.carrierSettings,
    }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    console.error("Production dashboard error:", error);
    return NextResponse.json({ error: "Failed to generate production dashboard" }, { status: 500 });
  }
}
