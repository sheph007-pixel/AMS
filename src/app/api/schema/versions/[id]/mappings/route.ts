import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET — All field mappings for a schema version.
 * POST — Bulk save/update field mappings. Keyed by xmlPath (schemaFieldId optional).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const mappings = await prisma.fieldMapping.findMany({
      where: { schemaVersionId: id },
      include: { schemaField: true },
      orderBy: { xmlPath: "asc" },
    });
    return NextResponse.json(mappings);
  } catch (error) {
    console.error("Mappings GET error:", error);
    return NextResponse.json({ error: "Failed to load mappings" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { mappings } = body as { mappings: any[] };

    if (!Array.isArray(mappings)) {
      return NextResponse.json({ error: "mappings array is required" }, { status: 400 });
    }

    const results = await prisma.$transaction(async (tx) => {
      const saved: any[] = [];

      for (const m of mappings) {
        const { xmlPath, schemaFieldId, included, targetModel, targetColumn, reportingName,
                targetType, transformRule, fallbackFields, notes, active } = m;

        if (!xmlPath) continue;

        const fbString = fallbackFields
          ? (typeof fallbackFields === "string" ? fallbackFields : JSON.stringify(fallbackFields))
          : null;

        // Upsert by schemaVersionId + xmlPath
        const existing = await tx.fieldMapping.findUnique({
          where: { schemaVersionId_xmlPath: { schemaVersionId: id, xmlPath } },
        });

        if (existing) {
          // Track changes for audit
          const changes: { field: string; old: string; new_: string }[] = [];
          if (included !== undefined && included !== existing.included)
            changes.push({ field: "included", old: String(existing.included), new_: String(included) });
          if (targetModel !== undefined && targetModel !== existing.targetModel)
            changes.push({ field: "targetModel", old: existing.targetModel || "", new_: targetModel || "" });
          if (targetColumn !== undefined && targetColumn !== existing.targetColumn)
            changes.push({ field: "targetColumn", old: existing.targetColumn || "", new_: targetColumn || "" });
          if (targetType !== undefined && targetType !== existing.targetType)
            changes.push({ field: "targetType", old: existing.targetType || "", new_: targetType || "" });

          const updated = await tx.fieldMapping.update({
            where: { id: existing.id },
            data: {
              schemaFieldId: schemaFieldId ?? existing.schemaFieldId,
              included: included ?? existing.included,
              targetModel: targetModel ?? existing.targetModel,
              targetColumn: targetColumn ?? existing.targetColumn,
              reportingName: reportingName ?? existing.reportingName,
              targetType: targetType ?? existing.targetType,
              transformRule: transformRule ?? existing.transformRule,
              fallbackFields: fbString ?? existing.fallbackFields,
              notes: notes ?? existing.notes,
              active: active ?? existing.active,
            },
          });

          for (const c of changes) {
            await tx.mappingAudit.create({
              data: {
                fieldMappingId: existing.id,
                action: "updated",
                changedField: c.field,
                oldValue: c.old,
                newValue: c.new_,
              },
            });
          }

          saved.push(updated);
        } else {
          const created = await tx.fieldMapping.create({
            data: {
              schemaVersionId: id,
              schemaFieldId: schemaFieldId || null,
              xmlPath,
              included: included ?? true,
              targetModel: targetModel || null,
              targetColumn: targetColumn || null,
              reportingName: reportingName || null,
              targetType: targetType || null,
              transformRule: transformRule || null,
              fallbackFields: fbString,
              notes: notes || null,
              active: active ?? true,
            },
          });

          await tx.mappingAudit.create({
            data: {
              fieldMappingId: created.id,
              action: "created",
              changedField: "all",
              newValue: JSON.stringify({ xmlPath, targetModel, targetColumn, targetType }),
            },
          });

          saved.push(created);
        }
      }

      return saved;
    });

    return NextResponse.json({ saved: results.length });
  } catch (error) {
    console.error("Mappings POST error:", error);
    return NextResponse.json({ error: "Failed to save mappings" }, { status: 500 });
  }
}
