import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { FormatsModule } from './modules/formats/formats.module';
import { LadderModule } from './modules/ladder/ladder.module';
import { MatchStoreModule } from './modules/match-store/match-store.module';
import { OpsModule } from './modules/ops/ops.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RatingModule } from './modules/rating/rating.module';
import { RiotClientModule } from './modules/riot-client/riot-client.module';
import { SeasonsModule } from './modules/seasons/seasons.module';
import { StaticDataModule } from './modules/static-data/static-data.module';
import { SyncModule } from './modules/sync/sync.module';

/**
 * Every domain module, shared by the API and the worker. A ticket fills its own
 * module; nothing here changes when one does.
 */
@Module({
  imports: [
    CoreModule,
    RiotClientModule,
    SyncModule,
    MatchStoreModule,
    FormatsModule,
    SeasonsModule,
    ProfileModule,
    RatingModule,
    LadderModule,
    StaticDataModule,
    OpsModule,
  ],
})
export class AppModule {}
