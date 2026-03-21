/**
 * Normalize a company/group name:
 * 1. Strip everything after the first comma
 * 2. Remove common business suffixes (LLC, Inc, Corp, etc.)
 * 3. Convert to ALL CAPS
 * 4. Trim whitespace
 */
export function normalizeCompanyName(name: string): string {
  // Strip everything after first comma
  let clean = name.split(",")[0].trim();

  // Remove common business suffixes (case-insensitive)
  // Handle with or without periods, with or without leading space
  const suffixes = [
    /\s+L\.?L\.?C\.?\s*$/i,
    /\s+L\.?L\.?P\.?\s*$/i,
    /\s+L\.?P\.?\s*$/i,
    /\s+Inc\.?\s*$/i,
    /\s+Incorporated\s*$/i,
    /\s+Corp\.?\s*$/i,
    /\s+Corporation\s*$/i,
    /\s+Co\.?\s*$/i,
    /\s+Company\s*$/i,
    /\s+Ltd\.?\s*$/i,
    /\s+Limited\s*$/i,
    /\s+P\.?C\.?\s*$/i,
    /\s+P\.?A\.?\s*$/i,
    /\s+P\.?L\.?L\.?C\.?\s*$/i,
    /\s+D\.?B\.?A\.?\s*$/i,
    /\s+S\.?C\.?\s*$/i,
  ];

  for (const suffix of suffixes) {
    clean = clean.replace(suffix, "");
  }

  // Remove trailing periods or extra whitespace
  clean = clean.replace(/[.\s]+$/, "").trim();

  return clean.toUpperCase();
}
