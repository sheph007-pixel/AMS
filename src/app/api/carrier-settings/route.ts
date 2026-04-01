import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rebuildAllCaches } from "@/lib/report-cache";

/**
 * GET — returns all carrier settings, auto-creating rows for any carrier
 * found in EN XML data that doesn't have a setting yet (defaults to NONE).
 */
export async function GET() {
  try {
    // Find all distinct carriers in benefit plan data
    const distinctCarriers = await prisma.benefitPlan.findMany({
      where: { carrier: { not: null } },
      select: { carrier: true },
      distinct: ["carrier"],
    });

    // Auto-create settings for any carrier not yet in the table
    const carrierNames = distinctCarriers
      .map(r => r.carrier)
      .filter((c): c is string => !!c && c.trim() !== "");

    for (const name of carrierNames) {
      await prisma.carrierSetting.upsert({
        where: { carrierName: name },
        update: {},  // don't overwrite existing settings
        create: { carrierName: name, incomeMethod: "NONE", rate: 0, excluded: false },
      });
    }

    const settings = await prisma.carrierSetting.findMany({
      orderBy: { carrierName: "asc" },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Carrier settings GET error:", error);
    return NextResponse.json({ error: "Failed to load carrier settings" }, { status: 500 });
  }
}

/**
 * POST — upsert a carrier setting (income method, rate, excluded).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { carrierName, incomeMethod, rate, excluded } = body;

    if (!carrierName) {
      return NextResponse.json({ error: "carrierName is required" }, { status: 400 });
    }

    const method = incomeMethod || "NONE";
    if (!["PEPM", "PERCENT_PREMIUM", "NONE"].includes(method)) {
      return NextResponse.json({ error: "incomeMethod must be PEPM, PERCENT_PREMIUM, or NONE" }, { status: 400 });
    }

    const setting = await prisma.carrierSetting.upsert({
      where: { carrierName },
      update: {
        incomeMethod: method,
        rate: Number(rate) || 0,
        excluded: excluded === true,
      },
      create: {
        carrierName,
        incomeMethod: method,
        rate: Number(rate) || 0,
        excluded: excluded === true,
      },
    });

    rebuildAllCaches().catch(e => console.error("Cache rebuild after carrier setting change:", e));

    return NextResponse.json(setting);
  } catch (error) {
    console.error("Carrier settings POST error:", error);
    return NextResponse.json({ error: "Failed to save carrier setting" }, { status: 500 });
  }
}
