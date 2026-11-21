import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import mikroOrmConfig from './database/mikroOrmConfig.js';
import { MikroOrmModule } from '@mikro-orm/nestjs/mikro-orm.module.js';
import { ProcessBetUseCase } from './application/wagering/process-bet.use-case.js';
import { WageringModule } from './application/wagering/wagering.module.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    WageringModule,

  ],
  controllers: [AppController],
  providers: 
  [
    AppService,
    ProcessBetUseCase,
  ],
  
})
export class AppModule {}
