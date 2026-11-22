import { beforeAll, describe, expect, test } from 'vitest';

const baseUrl = 'http://localhost:3000';

interface WalletResponse {
  id: string;
  playerId: string;
  balance: {
    amount: string;
    currency: string;
  };
  version: number;
}

interface LedgerItem {
  id: string;
  direction: string;
  money: {
    amount: string;
    currency: string;
  };
  balanceBefore: string;
  balanceAfter: string;
  createdAt: string;
}

interface LedgerResponse {
  items: LedgerItem[];
  nextCursor: string | null;
}

const get = (path: string) => fetch(`${baseUrl}${path}`);

const createPlayerId = () => crypto.randomUUID();

const createWallet = (body: unknown) =>
  fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

async function createTestWallet(amount = '100.00'): Promise<WalletResponse> {
  const response = await createWallet({
    playerId: createPlayerId(),
    initialBalance: {
      amount,
      currency: 'BRL',
    },
  });

  expect(response.status).toBe(201);

  return (await response.json()) as WalletResponse;
}

describe('Financial Queries API', () => {
  let walletId: string;

  beforeAll(async () => {
    // Cria uma carteira real para os testes GET.
    const wallet = await createTestWallet();
    walletId = wallet.id;
  });

  test('GET wallet existente retorna 200', async () => {
    const response = await get(`/wallets/${walletId}`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as WalletResponse;

    expect(body.id).toBe(walletId);
    expect(body.balance.amount).toBe('100.00');
    expect(body.balance.currency).toBe('BRL');
  });

  test('GET wallet inexistente retorna 404', async () => {
    const response = await get('/wallets/99999999-9999-4999-8999-999999999999');

    expect(response.status).toBe(404);
  });

  test('GET ledger rejeita limite inválido', async () => {
    const response = await get(`/wallets/${walletId}/ledger?limit=200`);

    expect(response.status).toBe(400);
  });

  test('GET ledger rejeita cursor inválido', async () => {
    const response = await get(`/wallets/${walletId}/ledger?cursor=invalido`);

    expect(response.status).toBe(400);
  });

  test('GET ledger retorna lançamento OPENING', async () => {
    const response = await get(`/wallets/${walletId}/ledger?limit=10`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as LedgerResponse;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.direction).toBe('CREDIT');
    expect(body.items[0]?.money.amount).toBe('100.00');
    expect(body.nextCursor).toBeNull();
  });

  test('GET ledger de carteira zerada retorna lista vazia', async () => {
    const wallet = await createTestWallet('0.00');

    const response = await get(`/wallets/${wallet.id}/ledger?limit=10`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as LedgerResponse;

    expect(body.items).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });
});

describe('POST /wallets', () => {
  test('cria carteira com saldo zero', async () => {
    const playerId = createPlayerId();

    const response = await createWallet({
      playerId,
      initialBalance: {
        amount: '0.00',
        currency: 'BRL',
      },
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as WalletResponse;

    expect(body.playerId).toBe(playerId);
    expect(body.balance.amount).toBe('0.00');
    expect(body.balance.currency).toBe('BRL');
    expect(body.version).toBe(1);
  });

  test('rejeita saldo negativo', async () => {
    const response = await createWallet({
      playerId: createPlayerId(),
      initialBalance: {
        amount: '-100.00',
        currency: 'BRL',
      },
    });

    expect(response.status).toBe(400);
  });

  test('rejeita valor monetário inválido', async () => {
    const response = await createWallet({
      playerId: createPlayerId(),
      initialBalance: {
        amount: 'abc',
        currency: 'BRL',
      },
    });

    expect(response.status).toBe(400);
  });

  test('rejeita UUID inválido', async () => {
    const response = await createWallet({
      playerId: 'jogador-invalido',
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    });

    expect(response.status).toBe(400);
  });

  test('rejeita saldo inicial ausente', async () => {
    const response = await createWallet({
      playerId: createPlayerId(),
    });

    expect(response.status).toBe(400);
  });

  test('impede carteira duplicada para o mesmo jogador', async () => {
    const playerId = createPlayerId();

    const payload = {
      playerId,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    };

    const first = await createWallet(payload);
    expect(first.status).toBe(201);

    const second = await createWallet(payload);
    expect(second.status).toBe(409);
  });

  test('cria saldo inicial e registra OPENING no ledger', async () => {
    const wallet = await createTestWallet('150.00');

    expect(wallet.balance.amount).toBe('150.00');

    const response = await get(`/wallets/${wallet.id}/ledger?limit=10`);

    expect(response.status).toBe(200);

    const ledger = (await response.json()) as LedgerResponse;

    expect(ledger.items).toHaveLength(1);
    expect(ledger.items[0]?.direction).toBe('CREDIT');
    expect(ledger.items[0]?.money.amount).toBe('150.00');
    expect(ledger.items[0]?.balanceBefore).toBe('0.00');
    expect(ledger.items[0]?.balanceAfter).toBe('150.00');
  });

  test('saldo zero não gera lançamento OPENING', async () => {
    const wallet = await createTestWallet('0.00');

    const response = await get(`/wallets/${wallet.id}/ledger?limit=10`);

    expect(response.status).toBe(200);

    const ledger = (await response.json()) as LedgerResponse;

    expect(ledger.items).toHaveLength(0);
    expect(ledger.nextCursor).toBeNull();
  });
});

describe('Financial Queries - BET e paginação real', () => {
  const providerId = 'provider-a';

  let walletId: string;
  let transactionId: string;
  let externalTransactionId: string;

  beforeAll(async () => {
    // Usa um identificador único para evitar conflitos entre execuções.
    const testId = crypto.randomUUID();

    const wallet = await createTestWallet('100.00');
    walletId = wallet.id;

    // BET exige que o jogador informado seja dono da carteira.
    // Por isso, usamos o playerId retornado pela criação.
    const betPlayerId = wallet.playerId;

    const createBet = async (suffix: string) => {
      const externalId = `bet-test-${testId}-${suffix}`;

      const response = await fetch(`${baseUrl}/wagering/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${providerId}:${externalId}`,
        },
        body: JSON.stringify({
          providerId,
          externalTransactionId: externalId,
          playerId: betPlayerId,
          walletId,
          roundId: `round-${testId}`,
          gameId: 'fortune-chimp',
          kind: 'BET',
          money: {
            amount: '25.00',
            currency: 'BRL',
          },
        }),
      });

      expect(response.status).toBe(200);

      return {
        externalId,
        body: await response.json(),
      };
    };

    const firstBet = await createBet('001');
    await createBet('002');

    externalTransactionId = firstBet.externalId;

    // Consulta a transação criada para obter seu ID interno.
    const response = await get(
      `/providers/${providerId}/wagering/transactions/${externalTransactionId}`,
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    transactionId = body.transactionId;
  });

  test('GET transação interna retorna 200', async () => {
    const response = await get(`/wagering/transactions/${transactionId}`);

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.transactionId).toBe(transactionId);
    expect(body.kind).toBe('BET');
  });

  test('GET transação externa retorna a mesma transação', async () => {
    const response = await get(
      `/providers/${providerId}/wagering/transactions/${externalTransactionId}`,
    );

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.transactionId).toBe(transactionId);
  });

  test('GET ledger pagina sem repetir registros', async () => {
    const seen = new Set<string>();

    let cursor: string | null = null;
    let pages = 0;
    let previous: LedgerItem | null = null;

    do {
      const params = new URLSearchParams({
        limit: '1',
      });

      if (cursor) {
        params.set('cursor', cursor);
      }

      const response = await get(`/wallets/${walletId}/ledger?${params}`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as LedgerResponse;

      expect(body.items.length).toBeLessThanOrEqual(1);

      for (const entry of body.items) {
        // Cada lançamento deve aparecer somente uma vez.
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);

        if (previous) {
          const previousKey = `${previous.createdAt}|${previous.id}`;
          const currentKey = `${entry.createdAt}|${entry.id}`;

          // A ordenação precisa ser decrescente.
          expect(currentKey < previousKey).toBe(true);
        }

        previous = entry;
      }

      cursor = body.nextCursor;
      pages++;

      // Evita loops infinitos em caso de cursor incorreto.
      expect(pages).toBeLessThanOrEqual(10);
    } while (cursor !== null);

    // OPENING + duas operações BET.
    expect(seen.size).toBe(3);
  });
});
