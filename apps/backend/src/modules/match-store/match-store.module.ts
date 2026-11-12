import { Module } from '@nestjs/common';
import { SeasonsModule } from '../seasons/seasons.module';
import { MatchStore } from './match-store';

@Module({
  imports: [SeasonsModule],
  providers: [MatchStore],
  exports: [MatchStore],
})
export class MatchStoreModule {}
