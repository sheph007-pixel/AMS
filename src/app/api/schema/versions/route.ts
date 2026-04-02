import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseXsdToFields, inferFieldsFromXml } from "@/lib/xsd-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET — List all schema versions.
 * POST — Upload new XSD or infer from XML. Parses and stores fields.
 */
export async function GET() {
  try {
    const versions = await prisma.schemaVersion.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, version: true, status: true,
        notes: true, uploadedBy: true, createdAt: true,
        _count: { select: { fields: true, mappings: true, testResults: true } },
      },
    });
    return NextResponse.json(versions);
  } catch (error) {
    console.error("Schema versions GET error:", error);
    return NextResponse.json({ error: "Failed to load schema versions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string || "Untitled Schema";
    const version = formData.get("version") as string || "1.0";
    const notes = formData.get("notes") as string || null;
    const mode = formData.get("mode") as string || "xsd"; // "xsd" or "infer"

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const content = await file.text();
    if (!content.trim()) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    // Parse fields based on mode
    let parsedFields;
    try {
      if (mode === "infer") {
        parsedFields = inferFieldsFromXml(content);
      } else {
        parsedFields = parseXsdToFields(content);
      }
    } catch (parseError: any) {
      return NextResponse.json({
        error: "Failed to parse schema file",
        detail: parseError.message,
      }, { status: 400 });
    }

    if (parsedFields.length === 0) {
      return NextResponse.json({ error: "No fields found in schema file" }, { status: 400 });
    }

    // Create schema version + fields in a transaction
    const schemaVersion = await prisma.$transaction(async (tx) => {
      const sv = await tx.schemaVersion.create({
        data: {
          name,
          version,
          status: "inactive",
          xsdContent: content,
          notes,
          uploadedBy: "admin",
        },
      });

      // Store parsed fields
      await tx.schemaField.createMany({
        data: parsedFields.map(f => ({
          schemaVersionId: sv.id,
          xmlPath: f.xmlPath,
          elementName: f.elementName,
          xmlType: f.xmlType,
          isRequired: f.isRequired,
          isRepeating: f.isRepeating,
          isNillable: f.isNillable,
          isAttribute: f.isAttribute,
          parentPath: f.parentPath,
          depth: f.depth,
          sortOrder: f.sortOrder,
        })),
      });

      return sv;
    });

    return NextResponse.json({
      id: schemaVersion.id,
      name: schemaVersion.name,
      version: schemaVersion.version,
      status: schemaVersion.status,
      fieldCount: parsedFields.length,
    }, { status: 201 });
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A schema with this name and version already exists" }, { status: 409 });
    }
    console.error("Schema upload error:", error);
    return NextResponse.json({ error: "Failed to upload schema" }, { status: 500 });
  }
}
