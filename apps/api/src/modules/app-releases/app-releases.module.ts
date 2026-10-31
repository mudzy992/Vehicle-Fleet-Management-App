import { Module } from '@nestjs/common';
import { AppReleasesController } from './app-releases.controller.js';
import { AppReleasesService } from './app-releases.service.js';

@Module({
  controllers: [AppReleasesController],
  providers: [AppReleasesService],
  exports: [AppReleasesService],
})
export class AppReleasesModule {}
