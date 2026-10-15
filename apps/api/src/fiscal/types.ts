import { FiscalStatusName } from '../common/types';

export interface FiscalCredentials {
  token: string;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
}

export interface FiscalResult {
  status: FiscalStatusName;
  sefazStatus?: string;
  message?: string;
  number?: string;
  series?: string;
  accessKey?: string;
  danfeUrl?: string;
  xmlUrl?: string;
  qrCodeUrl?: string;
  consultUrl?: string;
  raw?: unknown;
}

export interface CancelResult {
  canceled: boolean;
  message?: string;
  sefazStatus?: string;
  cancelXmlUrl?: string;
  raw?: unknown;
}

/** Contrato dos provedores de emissão fiscal (Focus NFe, NFe.io, Tecnospeed…). */
export interface FiscalProvider {
  readonly code: string;
  emitNfce(creds: FiscalCredentials, ref: string, payload: unknown): Promise<FiscalResult>;
  /** null quando a referência não existe no provedor. */
  getNfce(creds: FiscalCredentials, ref: string): Promise<FiscalResult | null>;
  cancelNfce(creds: FiscalCredentials, ref: string, justification: string): Promise<CancelResult>;
}
