import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed default exclusion rules
  await prisma.exclusionRule.upsert({
    where: { field_value: { field: "carrier", value: "Blue Cross Blue Shield of Alabama" } },
    update: {},
    create: {
      field: "carrier",
      value: "Blue Cross Blue Shield of Alabama",
      description: "Excluded carrier — do not include in any imports",
    },
  });

  console.log("Seed complete: default exclusion rules applied.");

  // Warm report cache on startup
  try {
    const { rebuildAllCaches } = await import("../src/lib/report-cache");
    console.log("Building report caches...");
    const t0 = Date.now();
    const result = await rebuildAllCaches();
    console.log(`Report caches built in ${Date.now() - t0}ms`, result.timings);
  } catch (e) {
    console.log("Cache warmup skipped (may run on first request):", (e as Error).message);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
