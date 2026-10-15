import { StockService } from './stock.service';

function make(variant: any) {
  const state = { stock: variant?.stockQty ?? 0, moves: [] as any[] };
  const prisma: any = {
    productVariant: {
      findFirst: async ({ where }: any) => {
        const code = where.OR[0].barcode;
        return variant && (variant.barcode === code || variant.sku === code) ? { ...variant, stockQty: state.stock } : null;
      },
      updateMany: async ({ data }: any) => { state.stock += data.stockQty.increment; return { count: 1 }; },
      findUnique: async () => ({ stockQty: state.stock }),
    },
    stockMovement: { create: async ({ data }: any) => { state.moves.push(data); return data; } },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { svc: new StockService(prisma), state };
}

describe('StockService.receiveByCode', () => {
  const v = { id: 'v1', barcode: '789', sku: null, active: true, stockQty: 5, product: { id: 'p', name: 'Camiseta' } };

  it('cada bipe do mesmo código soma 1', async () => {
    const { svc, state } = make(v);
    expect((await svc.receiveByCode('t', '789')) as any).toMatchObject({ found: true, added: 1, balance: 6 });
    expect((await svc.receiveByCode('t', ' 789 ')) as any).toMatchObject({ found: true, balance: 7 });
    expect(state.moves).toHaveLength(2);
    expect(state.moves[0]).toMatchObject({ type: 'IN', qty: 1, balance: 6 });
  });

  it('aceita quantidade manual', async () => {
    const { svc } = make(v);
    expect((await svc.receiveByCode('t', '789', 12)) as any).toMatchObject({ added: 12, balance: 17 });
  });

  it('código novo: found false, sem mexer no estoque', async () => {
    const { svc, state } = make(v);
    expect(await svc.receiveByCode('t', '000')).toEqual({ found: false });
    expect(state.moves).toHaveLength(0);
  });

  it('código vazio é recusado', async () => {
    const { svc } = make(v);
    await expect(svc.receiveByCode('t', '  ')).rejects.toThrow();
  });
});
