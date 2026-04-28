import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGETS = [
  "Taziki",
  "Johnson Storage",
  "Park 7",
  "Garrison",
  "Henderson Electric",
  "Spartan Value",
  "Tech Providers",
  "Ingram Equipment",
  "Forestry",
  "Lewis Commun",
];

const CURRENT_YEAR = new Date().getFullYear();

function bucket(years: number): string {
  if (years >= 5) return "5+ years";
  if (years >= 3) return "3+ years";
  if (years >= 1) return "1+ years";
  return "<1 year";
}

async function main() {
  const rows = await prisma.clientSnapshot.groupBy({
    by: ["groupName"],
    _min: { year: true },
    _max: { year: true },
  });

  for (const target of TARGETS) {
    const matches = rows.filter((r) =>
      r.groupName.toLowerCase().includes(target.toLowerCase())
    );
    if (matches.length === 0) {
      console.log(`${target.padEnd(22)}  NOT FOUND`);
      continue;
    }
    for (const m of matches) {
      const first = m._min.year ?? CURRENT_YEAR;
      const last = m._max.year ?? CURRENT_YEAR;
      const tenure = CURRENT_YEAR - first;
      console.log(
        `${target.padEnd(22)}  ${m.groupName.padEnd(40)}  first=${first}  last=${last}  tenure=${tenure}y  ${bucket(tenure)}`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
