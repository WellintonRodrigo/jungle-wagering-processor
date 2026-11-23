
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';

@Injectable()
export class SqsClientService implements OnModuleDestroy {
  readonly client: SQSClient;

  constructor() {
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',

      // LocalStack usa credenciais fictícias.
      endpoint: process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',

      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
