import { NextRequest, NextResponse } from "next/server";
import { importAnnualXml } from "@/lib/xml-import";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const yearStr = formData.get("year") as string | null;

    if (!file || !yearStr) {
      return NextResponse.json(
        { error: "Both 'file' (XML) and 'year' are required" },
        { status: 400 }
      );
    }

    const year = parseInt(yearStr, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: "Year must be a valid number between 2000 and 2100" },
        { status: 400 }
      );
    }

    const xmlContent = await file.text();
    const result = await importAnnualXml(xmlContent, year);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
