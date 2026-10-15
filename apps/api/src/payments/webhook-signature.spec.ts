import { createHmac } from 'crypto';
import { verifyMercadoPagoSignature } from './webhook-signature';
import { mapMpOrderStatus, mapMpPaymentStatus } from './providers/mp-status';

// Teste de consistência do algoritmo (o vetor é gerado aqui com o mesmo manifesto documentado).
describe('assinatura do webhook Mercado Pago', () => {
  const secret = 'segredo-de-teste';
  const sign = (dataId: string, reqId: string, ts: string) =>
    createHmac('sha256', secret).update(`id:${dataId.toLowerCase()};request-id:${reqId};ts:${ts};`).digest('hex');

  it('aceita assinatura válida (id em maiúsculas é normalizado)', () => {
    const v1 = sign('ORD01ABC', 'req-1', '1742505638683');
    expect(
      verifyMercadoPagoSignature({ secret, xSignature: `ts=1742505638683,v1=${v1}`, xRequestId: 'req-1', dataId: 'ORD01ABC' }),
    ).toBe(true);
  });

  it('rejeita assinatura adulterada, secret errado ou header ausente', () => {
    const v1 = sign('123', 'req-1', '1');
    expect(verifyMercadoPagoSignature({ secret, xSignature: `ts=1,v1=${v1}`, xRequestId: 'req-2', dataId: '123' })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret: 'outro', xSignature: `ts=1,v1=${v1}`, xRequestId: 'req-1', dataId: '123' })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, xRequestId: 'req-1', dataId: '123' })).toBe(false);
  });
});

describe('status do Mercado Pago', () => {
  it('mapeia orders', () => {
    expect(mapMpOrderStatus('processed')).toBe('APPROVED');
    expect(mapMpOrderStatus('failed')).toBe('DECLINED');
    expect(mapMpOrderStatus('canceled')).toBe('CANCELED');
    expect(mapMpOrderStatus('at_terminal')).toBe('PENDING');
    expect(mapMpOrderStatus(undefined)).toBe('PENDING');
  });
  it('mapeia payments', () => {
    expect(mapMpPaymentStatus('approved')).toBe('APPROVED');
    expect(mapMpPaymentStatus('rejected')).toBe('DECLINED');
    expect(mapMpPaymentStatus('cancelled')).toBe('CANCELED');
    expect(mapMpPaymentStatus('pending')).toBe('PENDING');
  });
});
