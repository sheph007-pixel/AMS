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
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
