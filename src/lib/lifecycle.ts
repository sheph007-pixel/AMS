/**
 * Derives client lifecycle status from the set of years they appear in.
 *
 * Rules:
 * - "Active"   : client appears in the most recent year in the system
 * - "New"      : client first appears in the most recent year
 * - "Termed"   : client does NOT appear in the most recent year
 * - "Returned" : client was absent for 1+ years then reappeared
 */
export type LifecycleStatus = "Active" | "New" | "Termed" | "Returned";

export function deriveLifecycleStatus(
  clientYears: number[],
  allSystemYears: number[]
): LifecycleStatus {
  if (clientYears.length === 0) return "Termed";

  const sorted = [...clientYears].sort((a, b) => a - b);
  const systemMax = Math.max(...allSystemYears);
  const clientMax = Math.max(...sorted);
  const clientMin = Math.min(...sorted);

  // Client is not in the most recent system year → Termed
  if (clientMax < systemMax) return "Termed";

  // Client only appears in the latest year → New
  if (clientMin === systemMax) return "New";

  // Check for gaps (absence then return)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) return "Returned";
  }

  return "Active";
}

export function getStatusColor(status: LifecycleStatus): string {
  switch (status) {
    case "Active":
      return "bg-green-100 text-green-800";
    case "New":
      return "bg-blue-100 text-blue-800";
    case "Termed":
      return "bg-red-100 text-red-800";
    case "Returned":
      return "bg-amber-100 text-amber-800";
  }
}
