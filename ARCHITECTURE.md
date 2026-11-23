# Arquitetura — Jungle Wagering

## Visão geral

O serviço usa **um deploy NestJS** com componentes independentes de API e processamento em segundo plano, compartilhando PostgreSQL para garantir consistência financeira sem a complexidade operacional de múltiplos microsserviços.

- **API HTTP:** carteiras, operações financeiras e consultas.
- **Domínio/aplicação:** `Money` com `decimal.js`, carteira, ledger, transações e casos de uso de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`.
- **Persistência:** PostgreSQL + MikroORM; constraints, transações e bloqueios por linha.
- **Entrada assíncrona:** SQS FIFO → `WagerSqsConsumer` → Inbox.
- **Processamento:** `InboxProcessor` seleciona mensagens pendentes com `FOR UPDATE SKIP LOCKED` e aciona `WageringDispatcher`.
- **Saída assíncrona:** evento financeiro persistido na Outbox → `OutboxPublisher` → fila `wager-events.fifo`.

## Fluxo de processamento

1. O consumidor lê a mensagem SQS e a registra na Inbox, com unicidade de `(source, messageId)`.
2. Após persistência, a mensagem é removida da fila de entrada.
3. O processador seleciona mensagens pendentes com bloqueio para evitar que múltiplas instâncias processem simultaneamente a mesma linha.
4. O dispatcher executa a operação financeira e registra o evento Outbox no contexto transacional do processamento.
5. O publisher publica eventos pendentes no SQS e marca os eventos como `PUBLISHED`.

**Fronteira de recuperação:** a DLQ da fila de entrada protege o estágio de ingestão. Depois que a mensagem foi gravada na Inbox e confirmada ao SQS, erros de processamento precisam ser tratados no PostgreSQL, não pela DLQ do SQS.

## Garantias e decisões

- **Valores monetários:** `decimal.js` e representação decimal em strings evitam erros de ponto flutuante binário.
- **Concorrência:** bloqueio de carteira por linha e restrições no banco protegem operações concorrentes; a Inbox usa `FOR UPDATE SKIP LOCKED`.
- **Idempotência:** chaves de requisição e unicidade `(providerId, externalTransactionId)` persistidas no banco; reentregas SQS podem ter `messageId` diferente e ainda representar a mesma operação financeira.
- **Ledger:** histórico append-only na aplicação; em produção, complementar com permissões restritivas no banco.
- **LOSS:** registra transação `PROCESSED` sem débito/crédito no saldo nem lançamento no ledger.
- **Outbox:** evita perder a intenção de publicar um evento quando a operação financeira já foi confirmada. Não oferece entrega exactly-once: em crash após o envio e antes de confirmar `PUBLISHED`, pode ocorrer republicação. Consumidores devem deduplicar por `eventId`.
- **Deploy único:** facilita a demonstração e mantém o MVP enxuto. API e workers podem ser separados futuramente para escalabilidade independente.

## Falhas e limitações conhecidas

- **Referências fora de ordem:** não há reconciliador completo para operações `PENDING_REFERENCE`.
- **Retry da Inbox:** a classificação entre falhas transitórias e permanentes ainda depende parcialmente de mensagens de erro, o que é frágil. Falhas transitórias podem permanecer `PENDING`; não existe política persistida de backoff e limite de tentativas para esse estágio.
- **Publisher:** mantém lock SQL enquanto envia ao SQS; adequado para o volume do desafio, mas reduz throughput. Evolução: claim com lease e publicação fora da transação.
- **Replay idempotente:** a resposta de uma operação antiga pode refletir o saldo **atual** da carteira, e não o saldo capturado no momento da primeira resposta.
- **Observabilidade:** faltam métricas estruturadas, tracing distribuído e health checks específicos para mensageria.
- **Segurança:** autenticação/autorização não foram implementadas neste timebox. Em produção, aplicar OIDC (por exemplo, Keycloak ou Zitadel), autorização por recurso, validação robusta dos eventos e restrições de acesso à infraestrutura.
- **Validação distribuída:** ainda não foram demonstrados testes de carga com múltiplas instâncias, recuperação após crash e indisponibilidade prolongada do SQS/PostgreSQL.

## Validação realizada

Em **22/11/2026**, no ambiente local com PostgreSQL e LocalStack:

- Build NestJS concluído com sucesso.
- **78 testes automatizados aprovados**, distribuídos em **12 arquivos**.
- Operação `LOSS` coberta por teste de integração.
- Dois eventos `WAGER_TRANSACTION_COMPLETED` registrados na Outbox com status `PUBLISHED`.
- Recebimento dos dois eventos confirmado na fila FIFO `wager-events.fifo`.

Essas verificações demonstram o caminho de sucesso testado, mas **não garantem comportamento correto em todos os cenários de falha ou produção**.
