import { Module } from '@nestjs/common';
import { MatchStoreModule } from '../match-store/match-store.module';
import { RiotClientModule } from '../riot-client/riot-client.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { AccountByRiotIdHandler } from './account-by-riot-id.handler';
import { AccountLookup } from './account-lookup';
import { Clock } from './clock';
import { MatchIdsPageHandler } from './match-ids-page.handler';
import { MatchHandler } from './match.handler';
import { PlayerSearch } from './player-search';
import { ProfileRefresh } from './profile-refresh';
import { RefreshController } from './refresh.controller';
import { Sweep } from './sweep';
import { SyncRuns } from './sync-runs';

@Module({
  imports: [RiotClientModule, MatchStoreModule, SeasonsModule],
  controllers: [RefreshController],
  providers: [Clock, ProfileRefresh, AccountLookup, PlayerSearch, SyncRuns, AccountByRiotIdHandler, MatchIdsPageHandler, MatchHandler, Sweep],
  exports: [PlayerSearch],
})
export class SyncModule {}
