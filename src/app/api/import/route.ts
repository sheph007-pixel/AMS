import { NextRequest, NextResponse } from "next/server";
import { importAnnualXml } from "@/lib/xml-import";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const yearStr = formData.get("year") as string | null;
    const monthStr = formData.get("month") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "An XML file is required" },
        { status: 400 }
      );
    }

    const year = yearStr ? parseInt(yearStr, 10) : undefined;
    const month = monthStr ? parseInt(monthStr, 10) : undefined;

    if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
      return NextResponse.json(
        { error: "Year must be a valid number between 2000 and 2100" },
        { status: 400 }
      );
    }

    const xmlContent = await file.text();
    const result = await importAnnualXml(xmlContent, year, month);

    // Rebuild report caches in the background (don't block response)
    import("@/lib/report-cache").then(({ rebuildAllCaches }) => {
      rebuildAllCaches().catch((e) => console.error("Cache rebuild after import failed:", e));
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
