import type { OpsHealthSection } from './health/ops';
import type { ProcessHealthSection } from './health/process';
import type { RatingHealthSection } from './health/rating';
import type { StaticDataHealthSection } from './health/static-data';

// The health response is the union of every contributor's section. Each
// contributor owns one file under health/; this file only assembles them.
export type HealthResponse = ProcessHealthSection & OpsHealthSection & RatingHealthSection & StaticDataHealthSection;

export type HealthSectionName = keyof HealthResponse;

export type * from './health/ops';
export type * from './health/process';
export type * from './health/rating';
export type * from './health/static-data';
