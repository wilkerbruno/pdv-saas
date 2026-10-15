import { absoluteUrl, FocusNfeProvider, mapFocusBody } from './focusnfe.provider';

const HOMOLOG = { token: 'tok', environment: 'HOMOLOGACAO' as const };
const PROD = { token: 'tok', environment: 'PRODUCAO' as const };

function mockFetch(responses: { status: number; body?: any }[]) {
  const calls: { url: string; method: string; headers: any; body?: any }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation((async (url: string, init: any) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses.shift()!;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as any);
  return calls;
}
afterEach(() => jest.restoreAllMocks());

const authorized = {
  status: 'autorizado', status_sefaz: '100', mensagem_sefaz: 'Autorizado o uso da NF-e', chave_nfe: 'NFe4119', numero: '12', serie: '1',
  caminho_danfe: '/notas/NFe4119-danfe.html', caminho_xml_nota_fiscal: '/notas/NFe4119.xml', qrcode_url: 'http://qr', url_consulta_nf: 'http://consulta',
};

describe('FocusNfeProvider', () => {
  const p = new FocusNfeProvider();

  it('emite: Basic com token e senha vazia, ref na query, host por ambiente, URLs absolutas', async () => {
    const calls = mockFetch([{ status: 201, body: authorized }]);
    const r = await p.emitNfce(HOMOLOG, 'sale 1', { a: 1 });
    expect(calls[0].url).toBe('https://homologacao.focusnfe.com.br/v2/nfce?ref=sale%201');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('tok:').toString('base64')}`);
    expect(r).toMatchObject({ status: 'AUTHORIZED', number: '12', series: '1', accessKey: 'NFe4119', sefazStatus: '100', qrCodeUrl: 'http://qr', consultUrl: 'http://consulta' });
    expect(r.danfeUrl).toBe('https://homologacao.focusnfe.com.br/notas/NFe4119-danfe.html');

    const prod = mockFetch([{ status: 201, body: authorized }]);
    await p.emitNfce(PROD, 'x', {});
    expect(prod[0].url.startsWith('https://api.focusnfe.com.br/v2/nfce')).toBe(true);
  });

  it('rejeição da SEFAZ vira REJECTED com a mensagem', async () => {
    mockFetch([{ status: 201, body: { status: 'erro_autorizacao', status_sefaz: '704', mensagem_sefaz: 'Rejeição: data-hora atrasada' } }]);
    expect(await p.emitNfce(HOMOLOG, 'r', {})).toMatchObject({ status: 'REJECTED', sefazStatus: '704', message: 'Rejeição: data-hora atrasada' });
  });

  it('erro de validação (422) é REJECTED com o código; credencial inválida (401) é ERROR', async () => {
    mockFetch([{ status: 422, body: { codigo: 'erro_validacao_schema', mensagem: 'Campo obrigatório: data_emissao' } }]);
    const r1 = await p.emitNfce(HOMOLOG, 'r', {});
    expect(r1.status).toBe('REJECTED');
    expect(r1.message).toContain('[erro_validacao_schema]');
    mockFetch([{ status: 401, body: { mensagem: 'negado' } }]);
    expect((await p.emitNfce(HOMOLOG, 'r', {})).status).toBe('ERROR');
  });

  it('already_processed: reconcilia consultando em vez de duplicar', async () => {
    const calls = mockFetch([{ status: 422, body: { codigo: 'already_processed' } }, { status: 200, body: authorized }]);
    const r = await p.emitNfce(HOMOLOG, 'dup', {});
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']);
    expect(r.status).toBe('AUTHORIZED');
  });

  it('indisponibilidade (5xx) lança para o serviço marcar ERROR', async () => {
    mockFetch([{ status: 503 }]);
    await expect(p.emitNfce(HOMOLOG, 'r', {})).rejects.toThrow(/indisponível/);
  });

  it('consulta: 404 → null; processando; cancelada', async () => {
    mockFetch([{ status: 404, body: { codigo: 'nao_encontrado' } }]);
    expect(await p.getNfce(HOMOLOG, 'x')).toBeNull();
    mockFetch([{ status: 200, body: { status: 'processando_autorizacao' } }]);
    expect((await p.getNfce(HOMOLOG, 'x'))!.status).toBe('PROCESSING');
    mockFetch([{ status: 200, body: { status: 'cancelado' } }]);
    expect((await p.getNfce(HOMOLOG, 'x'))!.status).toBe('CANCELED');
  });

  it('cancelamento: envia justificativa por DELETE; recusa não lança', async () => {
    const calls = mockFetch([{ status: 200, body: { status: 'cancelado', status_sefaz: '135', caminho_xml_cancelamento: '/c.xml' } }]);
    const r = await p.cancelNfce(HOMOLOG, 'sale1', 'Cliente desistiu da compra');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://homologacao.focusnfe.com.br/v2/nfce/sale1', body: { justificativa: 'Cliente desistiu da compra' } });
    expect(r).toMatchObject({ canceled: true, sefazStatus: '135', cancelXmlUrl: 'https://homologacao.focusnfe.com.br/c.xml' });

    mockFetch([{ status: 422, body: { codigo: 'nfe_nao_autorizada', mensagem: 'Nota não autorizada' } }]);
    expect(await p.cancelNfce(HOMOLOG, 'sale1', 'x'.repeat(20))).toMatchObject({ canceled: false, message: 'Nota não autorizada' });
  });

  it('helpers', () => {
    expect(absoluteUrl('https://h', '/a')).toBe('https://h/a');
    expect(absoluteUrl('https://h', 'a')).toBe('https://h/a');
    expect(absoluteUrl('https://h', 'https://x/y')).toBe('https://x/y');
    expect(absoluteUrl('https://h', null)).toBeUndefined();
    expect(mapFocusBody({}, 'h').status).toBe('PROCESSING');
  });
});
