// Where the API process listens, as the web server sees it. The browser never
// uses this: it calls /api/* on the web app, which forwards here.
export function apiInternalUrl(): string {
  return process.env.API_INTERNAL_URL || 'http://localhost:3001';
}
