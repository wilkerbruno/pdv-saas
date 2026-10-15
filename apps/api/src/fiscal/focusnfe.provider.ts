import { Injectable } from '@nestjs/common';
import { CancelResult, FiscalCredentials, FiscalProvider, FiscalResult } from './types';
import { FiscalStatusName } from '../common/types';

// Focus NFe — NFC-e. Doc: https://doc.focusnfe.com.br/reference/emitir_nfce (emissão SÍNCRONA: autoriza ou rejeita na mesma chamada).
//   POST   /v2/nfce?ref=REF       emitir          GET /v2/nfce/REF  consultar
//   DELETE /v2/nfce/REF           cancelar (justificativa 15–255 caracteres; até 30 min após a emissão)
// Autenticação: HTTP Basic, token da empresa como usuário e senha vazia.
// ⚠ Ainda não executado contra a API real: valide em HOMOLOGAÇÃO antes de produção.

const HOSTS = {
  HOMOLOGACAO: 'https://homologacao.focusnfe.com.br',
  PRODUCAO: 'https://api.focusnfe.com.br',
} as const;

const STATUS: Record<string, FiscalStatusName> = {
  autorizado: 'AUTHORIZED',
  erro_autorizacao: 'REJECTED',
  denegado: 'DENIED',
  cancelado: 'CANCELED',
  processando_autorizacao: 'PROCESSING',
};

/** Os caminhos de DANFE/XML vêm relativos ao host do ambiente. */
export function absoluteUrl(host: string, path?: string | null): string | undefined {
  if (!path) return undefined;
  return /^https?:\/\//i.test(path) ? path : `${host}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function mapFocusBody(body: any, host: string): FiscalResult {
  const status = STATUS[String(body?.status ?? '')] ?? 'PROCESSING';
  return {
    status,
    sefazStatus: body?.status_sefaz != null ? String(body.status_sefaz) : undefined,
    message: body?.mensagem_sefaz ?? body?.mensagem ?? undefined,
    number: body?.numero != null ? String(body.numero) : undefined,
    series: body?.serie != null ? String(body.serie) : undefined,
    accessKey: body?.chave_nfe ?? undefined,
    danfeUrl: absoluteUrl(host, body?.caminho_danfe),
    xmlUrl: absoluteUrl(host, body?.caminho_xml_nota_fiscal),
    qrCodeUrl: body?.qrcode_url ?? undefined,
    consultUrl: body?.url_consulta_nf ?? undefined,
    raw: body,
  };
}

interface Http {
  status: number;
  body: any;
}

@Injectable()
export class FocusNfeProvider implements FiscalProvider {
  readonly code = 'FOCUSNFE';

  private async call(creds: FiscalCredentials, method: string, path: string, body?: unknown): Promise<Http> {
    const res = await fetch(`${HOSTS[creds.environment]}/v2${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.token}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000), // a emissão é síncrona e pode demorar
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { mensagem: text };
    }
    return { status: res.status, body: parsed };
  }

  async emitNfce(creds: FiscalCredentials, ref: string, payload: unknown): Promise<FiscalResult> {
    const host = HOSTS[creds.environment];
    const r = await this.call(creds, 'POST', `/nfce?ref=${encodeURIComponent(ref)}`, payload);

    if (r.status === 200 || r.status === 201) return mapFocusBody(r.body, host);

    // Já enviada antes (ex.: resposta perdida por timeout): reconcilia consultando.
    if (r.status === 422 && ['already_processed', 'pending_operation'].includes(r.body?.codigo)) {
      const current = await this.getNfce(creds, ref);
      if (current) return current;
    }
    if (r.status === 401 || r.status === 403) {
      return { status: 'ERROR', message: 'Token do provedor fiscal inválido ou sem permissão para este CNPJ.', raw: r.body };
    }
    if (r.status >= 400 && r.status < 500) {
      // Erro de validação/configuração: corrija e reenvie.
      return { status: 'REJECTED', message: `${r.body?.codigo ? `[${r.body.codigo}] ` : ''}${r.body?.mensagem ?? 'Requisição recusada pelo provedor'}`, raw: r.body };
    }
    throw new Error(`Provedor fiscal indisponível (HTTP ${r.status})`);
  }

  async getNfce(creds: FiscalCredentials, ref: string): Promise<FiscalResult | null> {
    const r = await this.call(creds, 'GET', `/nfce/${encodeURIComponent(ref)}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`Falha ao consultar a NFC-e (HTTP ${r.status})`);
    const res = mapFocusBody(r.body, HOSTS[creds.environment]);
    return res;
  }

  async cancelNfce(creds: FiscalCredentials, ref: string, justification: string): Promise<CancelResult> {
    const host = HOSTS[creds.environment];
    const r = await this.call(creds, 'DELETE', `/nfce/${encodeURIComponent(ref)}`, { justificativa: justification });
    if (r.status === 200 && r.body?.status === 'cancelado') {
      return {
        canceled: true,
        sefazStatus: r.body.status_sefaz != null ? String(r.body.status_sefaz) : undefined,
        message: r.body.mensagem_sefaz,
        cancelXmlUrl: absoluteUrl(host, r.body.caminho_xml_cancelamento),
        raw: r.body,
      };
    }
    return {
      canceled: false,
      message: r.body?.mensagem_sefaz ?? r.body?.mensagem ?? `Cancelamento não concluído (HTTP ${r.status})`,
      sefazStatus: r.body?.status_sefaz != null ? String(r.body.status_sefaz) : undefined,
      raw: r.body,
    };
  }
}
