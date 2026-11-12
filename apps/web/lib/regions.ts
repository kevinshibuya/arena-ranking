/** The regions the site serves. Brazil only for now; a region is data everywhere. */
// `timeZone` is the one the site writes times in for that region.
export const REGIONS = [{ id: 'br', label: 'Brazil', timeZone: 'America/Sao_Paulo' }] as const;

export type RegionId = (typeof REGIONS)[number]['id'];

export const DEFAULT_REGION: RegionId = 'br';

export function regionById(id: string): (typeof REGIONS)[number] | undefined {
  return REGIONS.find((region) => region.id === id);
}
