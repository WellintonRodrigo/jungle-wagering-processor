# Jungle Wagering — Serviço financeiro distribuído

API de carteiras e transações financeiras em **NestJS, TypeScript, PostgreSQL, MikroORM e Bun**, com processamento assíncrono por **SQS FIFO (LocalStack)**, **Inbox/Outbox**, ledger e idempotência persistente.

## Pré-requisitos

- Node.js 24 (ambiente local validado), Bun 1.x, Docker e Docker Compose.
- Portas livres: **3000** (API), **5433** (PostgreSQL) e **4566** (LocalStack).
- PowerShell para os comandos abaixo.

## Configuração local

1. Copie `.env.example` para `.env` e configure `DB_PASSWORD`. **Não versione `.env`.**
2. Suba a infraestrutura e instale as dependências:

```powershell
Copy-Item .env.example .env  # Somente na primeira instalação; não sobrescreva seu .env existente
docker compose up -d
bun install --frozen-lockfile
```

> Se já existe um `.env` funcional, mantenha-o. O volume PostgreSQL pode preservar uma senha anterior: alterar `DB_PASSWORD` no Compose não redefine a senha de um banco já inicializado. Não use `docker compose down -v` se quiser preservar os dados.

3. Aplique as migrations no banco de desenvolvimento:

```powershell
$env:DB_NAME = 'jungle_wagering'
bunx --bun mikro-orm migration:up
```

4. Crie as três filas FIFO no LocalStack:

```powershell
docker exec jungle-localstack awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
docker exec jungle-localstack awslocal sqs create-queue --queue-name wager-transactions.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
docker exec jungle-localstack awslocal sqs create-queue --queue-name wager-events.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
```

5. Configure o **redrive** da fila de entrada para a DLQ após cinco recebimentos. O comando abaixo gera um arquivo JSON para evitar problemas de escape de aspas no PowerShell:

```powershell
$mainUrl = 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo'
$dlqArn = 'arn:aws:sqs:us-east-1:000000000000:wager-transactions-dlq.fifo'
$policy = @{ deadLetterTargetArn = $dlqArn; maxReceiveCount = '5' } | ConvertTo-Json -Compress
@{ RedrivePolicy = $policy } | ConvertTo-Json -Compress | Set-Content -Encoding ascii .sqs-redrive.json
docker cp .sqs-redrive.json jungle-localstack:/tmp/wager-redrive.json
docker exec jungle-localstack awslocal sqs set-queue-attributes --queue-url $mainUrl --attributes file:///tmp/wager-redrive.json
Remove-Item .sqs-redrive.json
```

6. Inicie a API (os processadores Inbox/Outbox rodam no mesmo processo):

```powershell
$env:DB_NAME = 'jungle_wagering'
bun run start:dev
```

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER` | Conexão PostgreSQL; localmente `localhost:5433`, usuário `jungle` |
| `DB_PASSWORD` | Senha do PostgreSQL, definida localmente |
| `DB_NAME` | `jungle_wagering` para desenvolvimento; `jungle_wagering_test` para testes |
| `AWS_REGION` | Região SQS (`us-east-1`) |
| `AWS_ENDPOINT_URL` | Endpoint do LocalStack (`http://localhost:4566`) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciais fictícias para LocalStack |
| `SQS_WAGER_QUEUE_URL` | Fila FIFO de entrada de operações |
| `SQS_WAGER_DLQ_URL` | Fila de mensagens que excedem o limite de recebimentos |
| `SQS_EVENTS_QUEUE_URL` | Fila FIFO de eventos publicados pela Outbox |

## API HTTP

| Método | Endpoint | Função |
|---|---|---|
| `POST` | `/wallets` | Criar carteira |
| `GET` | `/wallets/:walletId` | Consultar saldo e versão |
| `GET` | `/wallets/:walletId/ledger?limit=20&cursor=...` | Consultar ledger paginado |
| `POST` | `/wagering/transactions` | Processar `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK` |
| `GET` | `/wagering/transactions/:transactionId` | Consultar transação por ID |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consultar transação por referência externa |

### Exemplo: enviar uma BET

Crie uma carteira com `POST /wallets` e utilize os UUIDs reais de `walletId` e `playerId`. Exemplo de requisição no PowerShell:

```powershell
$body = @{
  providerId = 'provider-a'
  externalTransactionId = "bet-$(New-Guid)"
  playerId = 'UUID-REAL-DO-JOGADOR'
  walletId = 'UUID-REAL-DA-CARTEIRA'
  roundId = 'round-001'
  gameId = 'game-001'
  kind = 'BET'
  money = @{ amount = '25.00'; currency = 'BRL' }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/wagering/transactions' `
  -ContentType 'application/json' `
  -Headers @{ 'Idempotency-Key' = "bet-$(New-Guid)" } `
  -Body $body
```

O mesmo corpo JSON pode ser enviado à fila `wager-transactions.fifo`, informando `MessageGroupId` e um `MessageDeduplicationId` único. Para testar idempotência de negócio, repita o mesmo `providerId` e `externalTransactionId`.

## Testes e build

Use **um banco exclusivo para testes**. Crie-o caso não exista:

```powershell
docker exec jungle-postgres psql -U jungle -d postgres -c 'CREATE DATABASE jungle_wagering_test;'
```

Se o banco já existir, ignore o erro de duplicidade. Aplique as migrations nele:

```powershell
$env:DB_NAME = 'jungle_wagering_test'
bunx --bun mikro-orm migration:up
```

Os testes em `test/api` fazem requisições reais a `http://localhost:3000`. **Deixe a API iniciada em outro terminal, também com `DB_NAME=jungle_wagering_test`**, antes de executar:

```powershell
$env:DB_NAME = 'jungle_wagering_test'
bunx vitest run
bun run build
```

Os testes podem criar carteiras e transações. Nunca execute a suíte contra um banco com dados que precise preservar.

**Validação local registrada em 22/11/2026:** build concluído; **78 testes aprovados em 12 arquivos**; dois eventos `WAGER_TRANSACTION_COMPLETED` com status `PUBLISHED` na Outbox e recebidos em `wager-events.fifo` no LocalStack. Isso valida os cenários exercitados, não substitui testes de falhas e carga distribuída.

## Processamento assíncrono

`SQS (entrada) → Consumer → Inbox → InboxProcessor → Dispatcher → transação financeira + Outbox → OutboxPublisher → SQS (eventos)`.

A Inbox persiste a mensagem antes de confirmar seu recebimento ao SQS. A Outbox registra o evento junto à transação financeira; o publisher tenta entregá-lo posteriormente. A publicação tem semântica **at-least-once**: consumidores devem deduplicar pelo `eventId`. A DLQ da fila de entrada cobre falhas de **ingestão**, não falhas ocorridas depois que a mensagem já foi persistida na Inbox.

Veja as garantias, trade-offs e limitações em [ARCHITECTURE.md](./ARCHITECTURE.md).
