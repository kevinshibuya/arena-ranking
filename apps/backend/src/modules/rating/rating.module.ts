import { Module } from '@nestjs/common';
import { SeasonsModule } from '../seasons/seasons.module';
import { RatingController } from './rating.controller';
import { RatingHealthContributor } from './rating.health';
import { RatingReplayHandler } from './rating-replay.handler';
import { Ratings } from './ratings';
import { ReplayRunner } from './replay-runner';
import { ReplaySchedule } from './replay-schedule';

@Module({
  imports: [SeasonsModule],
  controllers: [RatingController],
  providers: [Ratings, ReplayRunner, ReplaySchedule, RatingReplayHandler, RatingHealthContributor],
  exports: [Ratings, ReplaySchedule],
})
export class RatingModule {}
