import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import mikroOrmConfig from './database/mikroOrmConfig.js';
import { MikroOrmModule } from '@mikro-orm/nestjs/mikro-orm.module.js';
import { ProcessBetUseCase } from './application/wagering/process-bet.use-case.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
  ],
  controllers: [AppController],
  providers: 
  [
    AppService,
    ProcessBetUseCase,
  ],
  
})
export class AppModule {}
