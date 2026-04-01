import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const settings = await prisma.carrierSetting.findMany({
      orderBy: { carrierName: "asc" },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Carrier settings GET error:", error);
    return NextResponse.json({ error: "Failed to load carrier settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { carrierName, incomeMethod, rate } = body;

    if (!carrierName || !incomeMethod) {
      return NextResponse.json({ error: "carrierName and incomeMethod are required" }, { status: 400 });
    }
    if (!["PEPM", "PERCENT_PREMIUM", "NONE"].includes(incomeMethod)) {
      return NextResponse.json({ error: "incomeMethod must be PEPM, PERCENT_PREMIUM, or NONE" }, { status: 400 });
    }

    const setting = await prisma.carrierSetting.upsert({
      where: { carrierName },
      update: { incomeMethod, rate: Number(rate) || 0 },
      create: { carrierName, incomeMethod, rate: Number(rate) || 0 },
    });

    return NextResponse.json(setting);
  } catch (error) {
    console.error("Carrier settings POST error:", error);
    return NextResponse.json({ error: "Failed to save carrier setting" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await prisma.carrierSetting.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Carrier settings DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete carrier setting" }, { status: 500 });
  }
}
