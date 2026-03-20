import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const rules = await prisma.exclusionRule.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rules);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { field, value, description } = body;

  if (!field || !value) {
    return NextResponse.json(
      { error: "field and value are required" },
      { status: 400 }
    );
  }

  const rule = await prisma.exclusionRule.create({
    data: { field, value, description },
  });

  return NextResponse.json(rule, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.exclusionRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
