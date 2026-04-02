import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * TEMPORARY DEBUG: Dump actual enrollment metadata structure
 * to find real field names for age bands, tiers, etc.
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET() {
  try {
    // Get a recent snapshot
    const snap = await prisma.clientSnapshot.findFirst({
      where: { year: { gte: 2025 } },
      select: { id: true, year: true, month: true, client: { select: { groupName: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!snap) return NextResponse.json({ error: "No snapshot found" });

    const emps = await prisma.employeeSnapshot.findMany({
      where: { clientSnapshotId: snap.id, status: "Active" },
      select: { firstName: true, metadata: true },
      take: 2,
    });

    const results: any[] = [];

    for (const emp of emps) {
      let meta: any;
      try { meta = JSON.parse(emp.metadata || "{}"); } catch { continue; }

      const container = meta.Enrollments || meta.enrollments;
      if (!container) continue;
      const enrollments = container.Enrollment || container.enrollment;
      const list = Array.isArray(enrollments) ? enrollments : enrollments ? [enrollments] : [];

      const enrollmentDumps: any[] = [];
      for (const e of list.slice(0, 8)) {
        const dump: any = {};
        for (const [k, v] of Object.entries(e)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            dump[k] = v;
          } else if (v && typeof v === "object") {
            // Show nested structure with one level of depth
            const sub: any = {};
            for (const [sk, sv] of Object.entries(v as Record<string, any>)) {
              if (typeof sv === "string" || typeof sv === "number") {
                sub[sk] = sv;
              } else if (Array.isArray(sv)) {
                sub[sk] = sv.slice(0, 2).map((item: any) => {
                  if (typeof item === "object" && item) {
                    const flat: any = {};
                    for (const [ik, iv] of Object.entries(item)) {
                      if (typeof iv === "string" || typeof iv === "number") flat[ik] = iv;
                      else if (iv && typeof iv === "object") flat[ik] = `{${Object.keys(iv).join(",")}}`;
                    }
                    return flat;
                  }
                  return item;
                });
              } else if (sv && typeof sv === "object") {
                sub[sk] = Object.fromEntries(
                  Object.entries(sv).filter(([, val]) => typeof val === "string" || typeof val === "number")
                );
              }
            }
            dump[k] = sub;
          }
        }
        enrollmentDumps.push(dump);
      }

      results.push({
        employee: emp.firstName,
        snapshot: `${snap.client.groupName} ${snap.year}-${snap.month}`,
        enrollmentCount: list.length,
        enrollments: enrollmentDumps,
      });
    }

    return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
