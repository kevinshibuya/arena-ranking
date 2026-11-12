import { Module } from '@nestjs/common';
import { SeasonsModule } from '../seasons/seasons.module';
import { StaticDataModule } from '../static-data/static-data.module';
import { SyncModule } from '../sync/sync.module';
import { BreakdownController } from './breakdown.controller';
import { BreakdownQuery } from './breakdown-query';
import { ProfileController } from './profile.controller';
import { ProfileQuery } from './profile-query';

@Module({
  imports: [SyncModule, SeasonsModule, StaticDataModule],
  controllers: [ProfileController, BreakdownController],
  providers: [ProfileQuery, BreakdownQuery],
})
export class ProfileModule {}
