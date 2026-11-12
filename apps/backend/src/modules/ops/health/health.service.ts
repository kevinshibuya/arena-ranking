import { Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { HealthResponse } from '@arena/shared';
import { HealthContributor, type HealthSectionContributor } from './health-contributor';

/** Assembles the health response from every contributor in the application. */
@Injectable()
export class HealthService {
  constructor(private readonly discovery: DiscoveryService) {}

  private contributors(): HealthSectionContributor[] {
    return this.discovery
      .getProviders({ metadataKey: HealthContributor.KEY })
      .map((wrapper) => wrapper.instance as HealthSectionContributor);
  }

  async check(): Promise<HealthResponse> {
    const sections = await Promise.all(
      this.contributors().map(async (contributor) => [contributor.section, await contributor.contribute()] as const),
    );
    // Each contributor is typed against its own section; the whole is complete
    // as long as every section type in packages/shared has its contributor.
    return Object.fromEntries(sections) as unknown as HealthResponse;
  }
}
