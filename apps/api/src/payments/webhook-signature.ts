import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Valida o header x-signature das notificações do Mercado Pago.
 * Formato: "ts=<timestamp>,v1=<hmac>"; manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * HMAC-SHA256 com a "assinatura secreta" da aplicação.
 */
export function verifyMercadoPagoSignature(p: {
  secret: string;
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
}): boolean {
  if (!p.xSignature || !p.dataId) return false;
  const parts = Object.fromEntries(
    p.xSignature.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const manifest = `id:${p.dataId.toLowerCase()};request-id:${p.xRequestId ?? ''};ts:${ts};`;
  const expected = createHmac('sha256', p.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
