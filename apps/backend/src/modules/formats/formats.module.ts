import { Module } from '@nestjs/common';
import { FormatsController } from './formats.controller';

@Module({
  controllers: [FormatsController],
})
export class FormatsModule {}
