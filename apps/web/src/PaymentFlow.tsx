import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { brl, parseMoney } from './money';
import { CartLine, InstallmentOption, METHOD_LABEL, Method, PaymentDraft, Provider, Sale } from './types';

interface Terminal { id: string; name?: string }

const PROVIDERS: Record<Method, { value: Provider; label: string; disabled?: boolean }[]> = {
  CASH: [{ value: 'MANUAL', label: 'Dinheiro' }],
  STORE_CREDIT: [{ value: 'MANUAL', label: 'Vale-troca' }],
  PIX: [
    { value: 'MERCADOPAGO_PIX', label: 'PIX QR Code (reconhecimento automático)' },
    { value: 'MANUAL', label: 'PIX já recebido (confirmar manualmente)' },
  ],
  DEBIT: [
    { value: 'MERCADOPAGO_POINT', label: 'Maquininha Mercado Pago (automático)' },
    { value: 'MANUAL', label: 'Outra maquininha — cliente já pagou' },
    { value: 'PAGARME_STONE', label: 'Pagar.me / Stone (em breve)', disabled: true },
  ],
  CREDIT: [
    { value: 'MERCADOPAGO_POINT', label: 'Maquininha Mercado Pago (automático)' },
    { value: 'MANUAL', label: 'Outra maquininha — cliente já pagou' },
    { value: 'PAGARME_STONE', label: 'Pagar.me / Stone (em breve)', disabled: true },
  ],
};

interface Props {
  cart: CartLine[];
  discountCents: number;
  dueCents: number;
  storeId: string;
  onClose: () => void;
  onFinished: (sale: Sale, receipt: string) => void;
}

export function PaymentFlow({ cart, discountCents, dueCents, storeId, onClose, onFinished }: Props) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cpf, setCpf] = useState('');

  const finish = useCallback(async (s: Sale) => {
    const r = await api<{ text: string }>(`/sales/${s.id}/receipt`);
    onFinished(s, r.text);
  }, [onFinished]);

  const submitNew = async (payments: PaymentDraft[]) => {
    setBusy(true);
    setError('');
    try {
      const s = await api<Sale>('/sales', {
        method: 'POST',
        body: {
          storeId,
          discountCents,
          consumerDocument: cpf.replace(/\D/g, '') || undefined,
          items: cart.map((l) => ({ variantId: l.variant.id, qty: l.qty })),
          payments: payments.map(toApi),
        },
      });
      if (s.status === 'PAID') await finish(s);
      else setSale(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sale) return <Waiting sale={sale} setSale={setSale} finish={finish} onCancelled={onClose} />;

  return (
    <div className="modal"><div className="card wide">
      <div className="row between"><h2>Pagamento</h2><button className="link" onClick={onClose}>Fechar</button></div>
      <label>CPF/CNPJ na nota (opcional)<input inputMode="numeric" placeholder="Somente se o cliente pedir" value={cpf} onChange={(e) => setCpf(e.target.value)} /></label>
      <PaymentBuilder dueCents={dueCents} busy={busy} submitLabel="Finalizar venda" onSubmit={submitNew} />
      {error && <div className="error">{error}</div>}
    </div></div>
  );
}

const toApi = (p: PaymentDraft) => ({
  method: p.method,
  provider: p.provider,
  installments: p.method === 'CREDIT' ? p.installments : undefined,
  amountCents: p.amountCents,
  deviceId: p.deviceId,
});

/** Monta a lista de pagamentos até cobrir o valor. Serve para a venda nova e para repor um pagamento recusado. */
function PaymentBuilder({ dueCents, busy, submitLabel, onSubmit }: {
  dueCents: number; busy: boolean; submitLabel: string; onSubmit: (p: PaymentDraft[]) => void;
}) {
  const [drafts, setDrafts] = useState<PaymentDraft[]>([]);
  const paid = drafts.reduce((s, d) => s + d.amountCents, 0);
  const remaining = dueCents - paid;
  const interest = drafts.reduce((s, d) => s + d.interestCents, 0);

  const [method, setMethod] = useState<Method>('CASH');
  const [provider, setProvider] = useState<Provider>('MANUAL');
  const [amount, setAmount] = useState('');
  const [options, setOptions] = useState<InstallmentOption[]>([]);
  const [installments, setInstallments] = useState(1);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [err, setErr] = useState('');

  const amountCents = useMemo(() => parseMoney(amount) ?? remaining, [amount, remaining]);

  useEffect(() => { setAmount((remaining / 100).toFixed(2).replace('.', ',')); }, [remaining]);
  useEffect(() => { setProvider(PROVIDERS[method].find((p) => !p.disabled)!.value); setInstallments(1); }, [method]);

  useEffect(() => {
    if (method !== 'CREDIT' || amountCents <= 0) return setOptions([]);
    const t = setTimeout(() => {
      api<InstallmentOption[]>(`/payments/installments?amountCents=${amountCents}`).then(setOptions).catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [method, amountCents]);

  useEffect(() => {
    if (provider !== 'MERCADOPAGO_POINT') return;
    api<Terminal[]>('/integrations/mercadopago/terminals').then((t) => { setTerminals(Array.isArray(t) ? t : []); }).catch(() => setTerminals([]));
  }, [provider]);

  const chosen = options.find((o) => o.installments === installments);

  const add = () => {
    setErr('');
    if (amountCents <= 0) return setErr('Informe um valor');
    if (amountCents > remaining) return setErr('Valor maior que o restante');
    setDrafts([...drafts, {
      method, provider, installments: method === 'CREDIT' ? installments : 1, amountCents,
      interestCents: method === 'CREDIT' ? (chosen?.interestCents ?? 0) : 0,
      deviceId: provider === 'MERCADOPAGO_POINT' && deviceId ? deviceId : undefined,
    }]);
    setMethod('CASH');
  };

  return (
    <>
      <div className="due">
        <div>Restante <strong>{brl(Math.max(remaining, 0))}</strong></div>
        {interest > 0 && <div className="muted small">Juros do parcelamento: {brl(interest)} · Total cobrado: {brl(dueCents + interest)}</div>}
      </div>

      <ul className="lines">
        {drafts.map((d, i) => (
          <li key={i}>
            <div>{METHOD_LABEL[d.method]}{d.method === 'CREDIT' ? ` ${d.installments}x` : ''}
              <div className="muted small">{providerLabel(d.method, d.provider)}</div></div>
            <strong>{brl(d.amountCents + d.interestCents)}</strong>
            <button className="link" onClick={() => setDrafts(drafts.filter((_, k) => k !== i))}>remover</button>
          </li>
        ))}
      </ul>

      {remaining > 0 && (
        <div className="builder">
          <div className="chips">
            {(Object.keys(METHOD_LABEL) as Method[]).filter((m) => m !== 'STORE_CREDIT').map((m) => (
              <button key={m} className={m === method ? 'chip on' : 'chip'} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>
            ))}
          </div>
          {PROVIDERS[method].length > 1 && (
            <label>Como receber
              <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                {PROVIDERS[method].map((p) => <option key={p.value} value={p.value} disabled={p.disabled}>{p.label}</option>)}
              </select>
            </label>
          )}
          {provider === 'MERCADOPAGO_POINT' && terminals.length > 0 && (
            <label>Maquininha
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Padrão da loja</option>
                {terminals.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
              </select>
            </label>
          )}
          <label>Valor (R$)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          {method === 'CREDIT' && options.length > 0 && (
            <label>Parcelas
              <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                {options.map((o) => (
                  <option key={o.installments} value={o.installments}>
                    {o.installments}x de {brl(o.installmentValues[o.installmentValues.length - 1])}
                    {o.hasInterest ? ` (total ${brl(o.totalCents)}, com juros)` : ' sem juros'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {err && <div className="error">{err}</div>}
          <button onClick={add}>Adicionar pagamento</button>
        </div>
      )}

      <button className="primary big" disabled={busy || remaining !== 0 || drafts.length === 0} onClick={() => onSubmit(drafts)}>
        {busy ? 'Processando…' : submitLabel}
      </button>
    </>
  );
}

const providerLabel = (m: Method, p: Provider) => PROVIDERS[m].find((x) => x.value === p)?.label ?? p;

/** Aguarda pagamentos automáticos (maquininha/PIX). Consulta a API a cada 3 s; o webhook também atualiza no servidor. */
function Waiting({ sale, setSale, finish, onCancelled }: {
  sale: Sale; setSale: (s: Sale) => void; finish: (s: Sale) => Promise<void>; onCancelled: () => void;
}) {
  const [err, setErr] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sale.status !== 'PENDING') return;
    const t = setInterval(async () => {
      try {
        const s = await api<Sale>(`/sales/${sale.id}/refresh`, { method: 'POST' });
        if (s.status === 'PAID') { clearInterval(t); await finish(s); } else setSale(s);
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 3000);
    return () => clearInterval(t);
  }, [sale.id, sale.status, finish, setSale]);

  const covered = sale.payments.filter((p) => p.status === 'PENDING' || p.status === 'APPROVED').reduce((s, p) => s + p.principalCents, 0);
  const remaining = sale.subtotalCents - sale.discountCents - covered;
  const failed = sale.payments.filter((p) => p.status === 'DECLINED' || p.status === 'CANCELED');

  const replace = async (drafts: PaymentDraft[]) => {
    setBusy(true);
    setErr('');
    try {
      let s = sale;
      for (const d of drafts) s = await api<Sale>(`/sales/${sale.id}/payments`, { method: 'POST', body: toApi(d) });
      setReplacing(false);
      if (s.status === 'PAID') await finish(s); else setSale(s);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!window.confirm('Cancelar esta venda?')) return;
    try { await api(`/sales/${sale.id}/cancel`, { method: 'POST', body: {} }); onCancelled(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="modal"><div className="card wide">
      <h2>Venda #{sale.number} — aguardando pagamento</h2>
      <ul className="lines">
        {sale.payments.map((p) => (
          <li key={p.id}>
            <div>{METHOD_LABEL[p.method]}{p.installments > 1 ? ` ${p.installments}x` : ''}
              <div className="muted small">{statusLabel(p)}</div></div>
            <strong>{brl(p.totalCents)}</strong>
          </li>
        ))}
      </ul>
      {sale.payments.filter((p) => p.status === 'PENDING' && p.pixQrBase64).map((p) => (
        <div key={p.id} className="pix">
          <img alt="QR Code PIX" src={`data:image/png;base64,${p.pixQrBase64}`} />
          {p.pixCopyPaste && (
            <>
              <textarea readOnly value={p.pixCopyPaste} rows={3} />
              <button onClick={() => navigator.clipboard?.writeText(p.pixCopyPaste!)}>Copiar PIX copia e cola</button>
            </>
          )}
        </div>
      ))}
      {sale.payments.some((p) => p.status === 'PENDING' && p.provider === 'MERCADOPAGO_POINT') && (
        <p className="muted">Siga na maquininha: o cliente aproxima, insere ou passa o cartão. O PDV reconhece sozinho.</p>
      )}
      {failed.length > 0 && remaining > 0 && (
        <div className="banner warn">Um pagamento não foi concluído. Escolha outra forma para o restante ({brl(remaining)}).</div>
      )}
      {replacing && remaining > 0 && <PaymentBuilder dueCents={remaining} busy={busy} submitLabel="Cobrar" onSubmit={replace} />}
      {err && <div className="error">{err}</div>}
      <div className="row gap">
        {remaining > 0 && !replacing && <button onClick={() => setReplacing(true)}>Trocar forma de pagamento</button>}
        <button className="danger" onClick={cancel}>Cancelar venda</button>
      </div>
    </div></div>
  );
}

const statusLabel = (p: Sale['payments'][number]) =>
  ({ PENDING: p.provider === 'MANUAL' ? 'pendente' : 'aguardando o cliente…', APPROVED: 'aprovado ✅', DECLINED: 'recusado ❌', CANCELED: 'cancelado' })[p.status];
