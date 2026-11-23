
import { Module } from '@nestjs/common';

import { SqsClientService } from './sqs-client.service.js';
import { WagerSqsConsumer } from './wager-sqs.consumer.js';
import { InboxProcessor } from './inbox.processor.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { WageringDispatcher } from '../../application/wagering/wagering.dispatcher.js';
@Module({
  providers: [
    SqsClientService,
    WagerSqsConsumer,
    InboxProcessor,
    OutboxPublisher,
    WageringDispatcher,
  ],
})
export class MessagingModule {}
