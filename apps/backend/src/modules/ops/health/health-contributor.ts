import { DiscoveryService } from '@nestjs/core';
import type { HealthResponse, HealthSectionName } from '@arena/shared';

/**
 * Marks a provider as a health contributor. Each module that reports health
 * keeps its contributor in its own `<module>.health.ts`, registers it in its own
 * module, and owns the matching section type in packages/shared/src/health/.
 */
export const HealthContributor = DiscoveryService.createDecorator<void>();

export interface HealthSectionContributor<Section extends HealthSectionName = HealthSectionName> {
  readonly section: Section;
  contribute(): Promise<HealthResponse[Section]>;
}
