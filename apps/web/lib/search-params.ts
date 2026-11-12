/** A page's query as Next hands it over. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter. */
export function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
