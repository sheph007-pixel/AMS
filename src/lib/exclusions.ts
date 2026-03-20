import { prisma } from "./db";

interface ExclusionRule {
  field: string;
  value: string;
}

let cachedRules: ExclusionRule[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Load exclusion rules from DB with a short TTL cache to avoid repeated queries.
 */
export async function getExclusionRules(): Promise<ExclusionRule[]> {
  const now = Date.now();
  if (cachedRules && now - cacheTime < CACHE_TTL) return cachedRules;
  cachedRules = await prisma.exclusionRule.findMany({
    select: { field: true, value: true },
  });
  cacheTime = now;
  return cachedRules;
}

/**
 * Check if a record should be excluded based on rules.
 * Matching is case-insensitive and uses partial "contains" matching.
 */
export function isExcluded(
  fields: Record<string, string | null | undefined>,
  rules: ExclusionRule[]
): boolean {
  for (const rule of rules) {
    const fieldValue = fields[rule.field];
    if (
      fieldValue &&
      fieldValue.toLowerCase().includes(rule.value.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Filter an array of benefit plans, removing any that match exclusion rules.
 */
export function filterBenefitPlans<
  T extends { carrier: string | null; planName: string | null; planType: string }
>(plans: T[], rules: ExclusionRule[]): T[] {
  return plans.filter(
    (plan) =>
      !isExcluded(
        { carrier: plan.carrier, planName: plan.planName, planType: plan.planType },
        rules
      )
  );
}
