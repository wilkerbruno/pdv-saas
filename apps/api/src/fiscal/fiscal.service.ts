import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { decrypt, encrypt } from '../common/crypto';
import { FiscalStatusName } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { isValidCnpj, onlyDigits } from './documents';
import { FocusNfeProvider } from './focusnfe.provider';
import { buildNfcePayload, FiscalItemInput, NfceInput, SUPPORTED_CSOSN, validateNfceInput } from './nfce-builder';
import { FiscalCredentials, FiscalResult } from './types';

export interface FiscalSettingsUpdate {
  enabled?: boolean;
  environment?: 'HOMOLOGACAO' | 'PRODUCAO';
  cnpj?: string;
  providerToken?: string;
  defaultCfop?: string;
  defaultTaxCode?: string;
  autoEmit?: boolean;
}

@Injectable()
export class FiscalService {
  private readonly log = new Logger(FiscalService.name);

  constructor(private prisma: PrismaService, private focus: FocusNfeProvider) {}

  // ───────────────────────── configurações ─────────────────────────

  async settings(tenantId: string) {
    const [tenant, s] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } }),
      this.prisma.fiscalSettings.findUnique({ where: { tenantId } }),
    ]);
    if (!tenant) throw new NotFoundException();
    return {
      enabled: tenant.fiscalEnabled,
      planAllows: tenant.plan.fiscalEnabled,
      provider: s?.provider ?? 'FOCUSNFE',
      environment: s?.environment ?? 'HOMOLOGACAO',
      cnpj: s?.cnpj ?? null,
      hasToken: !!s?.providerToken, // o token nunca volta para o cliente
      defaultCfop: s?.defaultCfop ?? '5102',
      defaultTaxCode: s?.defaultTaxCode ?? '102',
      autoEmit: s?.autoEmit ?? true,
      supportedTaxCodes: SUPPORTED_CSOSN,
    };
  }

  async updateSettings(tenantId: string, dto: FiscalSettingsUpdate) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!tenant) throw new NotFoundException();
    const current = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });

    const cnpj = dto.cnpj !== undefined ? onlyDigits(dto.cnpj) : current?.cnpj ?? null;
    if (dto.cnpj !== undefined && dto.cnpj !== '' && !isValidCnpj(cnpj ?? '')) throw new BadRequestException('CNPJ inválido');
    if (dto.defaultTaxCode && !(SUPPORTED_CSOSN as readonly string[]).includes(dto.defaultTaxCode)) {
      throw new BadRequestException(`CSOSN não suportado. Use um destes: ${SUPPORTED_CSOSN.join(', ')}`);
    }

    const data: Record<string, unknown> = {};
    if (dto.environment) data.environment = dto.environment;
    if (dto.cnpj !== undefined) data.cnpj = cnpj || null;
    if (dto.providerToken) data.providerToken = encrypt(dto.providerToken.trim()); // vazio = mantém o atual
    if (dto.defaultCfop) data.defaultCfop = dto.defaultCfop;
    if (dto.defaultTaxCode) data.defaultTaxCode = dto.defaultTaxCode;
    if (dto.autoEmit !== undefined) data.autoEmit = dto.autoEmit;
    await this.prisma.fiscalSettings.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });

    if (dto.enabled !== undefined) {
      if (dto.enabled) {
        if (!tenant.plan.fiscalEnabled) throw new ConflictException('Seu plano não inclui emissão fiscal. Faça upgrade para o plano Pro.');
        const merged = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
        if (!merged?.cnpj || !merged.providerToken) throw new ConflictException('Informe o CNPJ e o token do provedor fiscal antes de ativar.');
      }
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { fiscalEnabled: dto.enabled } });
    }
    return this.settings(tenantId);
  }

  // ───────────────────────── documentos ─────────────────────────

  async getBySale(tenantId: string, saleId: string) {
    return this.prisma.fiscalDocument.findFirst({ where: { tenantId, saleId } });
  }

  /** Emissão automática ao pagar a venda: nunca lança erro (a venda já está concluída). */
  async autoEmit(tenantId: string, saleId: string): Promise<void> {
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { fiscalEnabled: true } });
      if (!tenant?.fiscalEnabled) return;
      const s = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
      if (!s?.autoEmit) return;
      await this.emit(tenantId, saleId);
    } catch (e) {
      this.log.error(`Emissão automática falhou (venda ${saleId}): ${(e as Error).message}`);
    }
  }

  /** Emite (ou reenvia) a NFC-e de uma venda paga. Idempotente: nota já autorizada não é emitida de novo. */
  async emit(tenantId: string, saleId: string) {
    const { creds, settings } = await this.requireReady(tenantId);

    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      include: { items: { include: { variant: { include: { product: true } } } }, payments: true },
    });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    if (sale.status !== 'PAID') throw new ConflictException('Só é possível emitir nota de venda paga');

    const existing = await this.prisma.fiscalDocument.findFirst({ where: { tenantId, saleId } });
    if (existing && ['AUTHORIZED', 'CANCELED', 'DENIED'].includes(existing.status)) return existing;
    if (existing?.status === 'PROCESSING') return this.refresh(tenantId, saleId);

    const input: NfceInput = {
      cnpj: settings.cnpj!,
      defaultCfop: settings.defaultCfop,
      defaultTaxCode: settings.defaultTaxCode,
      saleDiscountCents: sale.discountCents,
      consumerDocument: sale.consumerDocument,
      issuedAt: new Date(),
      items: sale.items.map((i: any): FiscalItemInput => ({
        variantId: i.variantId,
        code: i.variant.sku || i.variant.barcode || i.variantId,
        description: i.description,
        qty: i.qty,
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        unit: (i.variant.product.unit || 'UN').toUpperCase(),
        ncm: i.variant.product.ncm,
        cfop: i.variant.product.cfop,
        taxCode: i.variant.product.taxCode,
        origin: i.variant.product.origin ?? 0,
      })),
      payments: sale.payments
        .filter((p: any) => p.status === 'APPROVED')
        .map((p: any) => ({ method: p.method, principalCents: p.principalCents, brand: p.brand })),
    };

    const base = { tenantId, saleId, environment: settings.environment };
    const problems = validateNfceInput(input);
    if (problems.length > 0) {
      return this.save(existing?.id, { ...base, ref: sale.id }, { status: 'REJECTED', message: problems.join(' • ') });
    }

    // Registra a tentativa ANTES de chamar o provedor, para nunca perder o vínculo com a referência.
    const doc = await this.save(existing?.id, { ...base, ref: sale.id }, { status: 'PROCESSING', message: undefined });

    let result: FiscalResult;
    try {
      result = await this.focus.emitNfce(creds, doc.ref, buildNfcePayload(input));
    } catch (e) {
      result = { status: 'ERROR', message: `Falha ao comunicar com o provedor fiscal: ${(e as Error).message}` };
    }
    return this.save(doc.id, { ...base, ref: doc.ref }, result);
  }

  /** Consulta o provedor e atualiza o status (notas em processamento ou após erro de comunicação). */
  async refresh(tenantId: string, saleId: string) {
    const { creds } = await this.requireReady(tenantId);
    const doc = await this.prisma.fiscalDocument.findFirst({ where: { tenantId, saleId } });
    if (!doc) throw new NotFoundException('Esta venda não tem nota fiscal');

    let result: FiscalResult | null;
    try {
      result = await this.focus.getNfce(creds, doc.ref);
    } catch (e) {
      return this.save(doc.id, { tenantId, saleId, environment: doc.environment, ref: doc.ref }, { status: 'ERROR', message: (e as Error).message });
    }
    if (!result) {
      // O provedor não conhece a referência: a emissão nunca chegou lá. Libera o reenvio.
      return this.save(doc.id, { tenantId, saleId, environment: doc.environment, ref: doc.ref }, { status: 'ERROR', message: 'Nota não localizada no provedor. Reenvie a emissão.' });
    }
    return this.save(doc.id, { tenantId, saleId, environment: doc.environment, ref: doc.ref }, result);
  }

  async cancel(tenantId: string, saleId: string, justification: string) {
    const text = (justification ?? '').trim();
    if (text.length < 15 || text.length > 255) throw new BadRequestException('A justificativa deve ter de 15 a 255 caracteres');
    const { creds } = await this.requireReady(tenantId);
    const doc = await this.prisma.fiscalDocument.findFirst({ where: { tenantId, saleId } });
    if (!doc) throw new NotFoundException('Esta venda não tem nota fiscal');
    if (doc.status !== 'AUTHORIZED') throw new ConflictException('Só é possível cancelar nota autorizada');

    const r = await this.focus.cancelNfce(creds, doc.ref, text);
    if (!r.canceled) {
      // Fora do prazo (30 min) ou recusa da SEFAZ: a nota segue autorizada.
      throw new ConflictException(r.message ?? 'A SEFAZ não aceitou o cancelamento');
    }
    return this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: { status: 'CANCELED', cancelReason: text, cancelXmlUrl: r.cancelXmlUrl, message: r.message, sefazStatus: r.sefazStatus },
    });
  }

  // ───────────────────────── internos ─────────────────────────

  private async requireReady(tenantId: string): Promise<{ creds: FiscalCredentials; settings: any }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { fiscalEnabled: true } });
    const settings = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
    if (!tenant?.fiscalEnabled || !settings?.providerToken || !settings.cnpj) {
      throw new ConflictException('A emissão fiscal não está ativada para esta loja.');
    }
    return {
      creds: { token: decrypt(settings.providerToken), environment: settings.environment as 'HOMOLOGACAO' | 'PRODUCAO' },
      settings,
    };
  }

  private save(
    id: string | undefined,
    key: { tenantId: string; saleId: string; environment: string; ref: string },
    r: Partial<FiscalResult> & { status: FiscalStatusName },
  ) {
    const fields = {
      status: r.status,
      sefazStatus: r.sefazStatus ?? null,
      message: r.message ?? null,
      number: r.number ?? null,
      series: r.series ?? null,
      accessKey: r.accessKey ?? null,
      danfeUrl: r.danfeUrl ?? null,
      xmlUrl: r.xmlUrl ?? null,
      qrCodeUrl: r.qrCodeUrl ?? null,
      consultUrl: r.consultUrl ?? null,
      raw: (r.raw ?? undefined) as any,
    };
    return id
      ? this.prisma.fiscalDocument.update({ where: { id }, data: fields })
      : this.prisma.fiscalDocument.create({ data: { ...key, ...fields } });
  }
}
