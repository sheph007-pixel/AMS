import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // NOTE: Carrier exclusions are managed via CarrierSetting.excluded (UI toggle).
  // ExclusionRule is only for non-carrier rules (planType, planName patterns).
  // No carrier-level ExclusionRule entries should be seeded — they conflict with
  // the user's CarrierSetting choices.

  // Clean up legacy carrier exclusion rules that conflict with CarrierSetting
  await prisma.exclusionRule.deleteMany({
    where: { field: "carrier" },
  });

  // Seed default carrier settings
  const defaultCarrierSettings = [
    { carrierName: "EBPA", incomeMethod: "PEPM", rate: 20 },
    { carrierName: "HealthEZ", incomeMethod: "PEPM", rate: 20 },
    { carrierName: "Guardian", incomeMethod: "PERCENT_PREMIUM", rate: 10 },
    { carrierName: "VSP", incomeMethod: "PERCENT_PREMIUM", rate: 10 },
  ];

  for (const cs of defaultCarrierSettings) {
    await prisma.carrierSetting.upsert({
      where: { carrierName: cs.carrierName },
      update: {},
      create: cs,
    });
  }

  console.log("Seed complete: default exclusion rules and carrier settings applied.");

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
