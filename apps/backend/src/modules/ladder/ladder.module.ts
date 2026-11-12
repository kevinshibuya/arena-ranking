import { Module } from '@nestjs/common';
import { RatingModule } from '../rating/rating.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { LadderController } from './ladder.controller';
import { LadderQuery } from './ladder-query';

@Module({
  imports: [RatingModule, SeasonsModule],
  controllers: [LadderController],
  providers: [LadderQuery],
})
export class LadderModule {}
