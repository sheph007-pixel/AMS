import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const rule = await prisma.validationRule.update({ where: { id }, data: body });
    return NextResponse.json(rule);
  } catch (error) {
    console.error("Validation rule PATCH error:", error);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.validationRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Validation rule DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
