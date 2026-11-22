import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remove propriedades não declaradas nos DTOs.
      forbidNonWhitelisted: true, // Retorna erro se houver propriedades não declaradas nos DTOs.
      transform: true, // Converte tipos primitivos (ex: string para number) com base nos DTOs.
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
