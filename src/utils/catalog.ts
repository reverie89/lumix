// Tier-pick scaffolding shared by the per-provider catalogs files
// (kisskh-catalogs.ts / ole-catalogs.ts): the option lists, canonical
// tier orders and row-emission rules stay in each provider's own SSOT file.

/**
 * Validate a tier's picks: "__all__" expands to every known option, unknown
 * options are dropped, duplicates removed.
 */
export const expandPicks = (
  values: string[],
  known: readonly string[],
): string[] =>
  values.includes("__all__")
    ? [...known]
    : [...new Set(values.filter((value) => known.includes(value)))];

/**
 * Normalize a config's tier order: unknown tiers dropped, missing tiers
 * appended in canonical order.
 */
export function normalizeTierOrder<T extends string>(
  order: readonly string[] | undefined,
  canonical: readonly T[],
): T[] {
  const known = canonical as readonly string[];
  const picked = [...new Set(order ?? [])].filter((tier): tier is T =>
    known.includes(tier),
  );
  return [...picked, ...canonical.filter((tier) => !picked.includes(tier))];
}
