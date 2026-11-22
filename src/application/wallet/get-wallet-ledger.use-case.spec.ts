import { describe, expect, it, vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';
import { GetWalletLedgerUseCase } from './get-wallet-ledger.use-case.js';

describe('GetWalletLedgerUseCase - paginação', () => {
  it('não deve repetir nem perder lançamentos com o mesmo createdAt', async () => {
    const walletId = '11111111-1111-4111-8111-111111111111';
    const createdAt = new Date('2026-11-22T10:30:00.000Z');

    const entries = [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        transactionId: '22222222-2222-4222-8222-222222222222',
        direction: 'CREDIT',
        amount: '20.00',
        currency: 'BRL',
        balanceBefore: '100.00',
        balanceAfter: '120.00',
        createdAt,
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        transactionId: '33333333-3333-4333-8333-333333333333',
        direction: 'CREDIT',
        amount: '10.00',
        currency: 'BRL',
        balanceBefore: '90.00',
        balanceAfter: '100.00',
        createdAt,
      },
    ];

    let cursorParams: unknown[] | undefined;

    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockImplementation((_sql, params) => {
        cursorParams = params;
        return qb;
      }),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getResultList: vi.fn().mockImplementation(async () => {
        // Simula a aplicação do cursor no PostgreSQL.
        const filtered = cursorParams
          ? entries.filter(
              (entry) =>
                entry.createdAt.toISOString() < String(cursorParams![0]) ||
                (entry.createdAt.toISOString() === String(cursorParams![1]) &&
                  entry.id < String(cursorParams![2])),
            )
          : entries;

        return filtered.slice(0, 2);
      }),
    };

    const em = {
      findOne: vi.fn().mockResolvedValue({ id: walletId }),
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    const useCase = new GetWalletLedgerUseCase(em);

    const firstPage = await useCase.execute({
      walletId,
      limit: 1,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    // Reinicia os parâmetros antes de consultar a segunda página.
    cursorParams = undefined;

    const secondPage = await useCase.execute({
      walletId,
      limit: 1,
      cursor: firstPage.nextCursor!,
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    // Os dois lançamentos devem aparecer exatamente uma vez.
    const returnedIds = [...firstPage.items, ...secondPage.items].map(
      (entry) => entry.id,
    );

    expect(new Set(returnedIds).size).toBe(2);
    expect(returnedIds).toEqual(entries.map((entry) => entry.id));

    // Confirma que o desempate usa o ID do último lançamento.
    expect(cursorParams?.[2]).toBe(entries[0]!.id);
  });
});
