import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET — List all business validation rules.
 * POST — Create or update a validation rule.
 */
export async function GET() {
  try {
    const rules = await prisma.validationRule.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(rules);
  } catch (error) {
    console.error("Validation rules GET error:", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, category, expression, severity, enabled, description } = body;

    if (!name || !category || !expression) {
      return NextResponse.json({ error: "name, category, and expression are required" }, { status: 400 });
    }

    const rule = await prisma.validationRule.upsert({
      where: { name },
      update: { category, expression, severity: severity || "warning", enabled: enabled ?? true, description },
      create: { name, category, expression, severity: severity || "warning", enabled: enabled ?? true, description },
    });

    return NextResponse.json(rule);
  } catch (error) {
    console.error("Validation rules POST error:", error);
    return NextResponse.json({ error: "Failed to save rule" }, { status: 500 });
  }
}
