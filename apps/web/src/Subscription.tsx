import { useEffect, useState } from 'react';
import { api } from './api';
import { brl } from './money';
import { Me } from './types';

interface Checkout { invoiceId: string; amountCents: number; copyPaste: string | null; qrBase64: string | null; expiresAt: string }

/** Pagamento da mensalidade por PIX. Funciona também com a conta bloqueada (só o dono). */
export function Subscription({ me, onPaid }: { me: Me; onPaid: () => void }) {
  const [ch, setCh] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isOwner = me.user.role === 'OWNER';
  const end = me.tenant.currentPeriodEnd ? new Date(me.tenant.currentPeriodEnd).toLocaleDateString('pt-BR') : null;

  const generate = async () => {
    setBusy(true); setErr('');
    try { setCh(await api<Checkout>('/billing/checkout', { method: 'POST' })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Enquanto o PIX está aberto, confere a cada 4 s se foi pago.
  useEffect(() => {
    if (!ch) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await api<{ status: string }>(`/billing/invoices/${ch.invoiceId}`);
        if (!stop && r.status === 'PAID') { clearInterval(t); setCh(null); onPaid(); }
      } catch { /* tenta de novo */ }
    }, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [ch, onPaid]);

  return (
    <section className="card">
      <div className="row between">
        <h2>Assinatura</h2>
        <span className={me.tenant.access === 'FULL' ? 'pill ok' : 'pill bad'}>
          {me.tenant.status === 'TRIAL' ? 'Teste grátis' : me.tenant.access === 'FULL' ? 'Em dia' : 'Pendente'}
        </span>
      </div>
      <p className="muted small">
        Plano {me.tenant.plan.name}{end ? ` · pago até ${end}` : ''}. Pagamento por PIX; o acesso é liberado assim que o pagamento é confirmado.
      </p>
      {!isOwner && <p className="muted small">Somente o dono da conta pode pagar a mensalidade.</p>}
      {isOwner && !ch && <button className="primary" disabled={busy} onClick={generate}>Pagar mensalidade com PIX</button>}
      {ch && (
        <div className="pix">
          <strong>{brl(ch.amountCents)}</strong>
          {ch.qrBase64 && <img alt="QR Code PIX" src={`data:image/png;base64,${ch.qrBase64}`} />}
          {ch.copyPaste && (
            <>
              <textarea readOnly value={ch.copyPaste} rows={3} />
              <button onClick={() => navigator.clipboard?.writeText(ch.copyPaste!)}>Copiar PIX copia e cola</button>
            </>
          )}
          <p className="muted small">Aguardando pagamento… vale até {new Date(ch.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  );
}
