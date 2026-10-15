import { isValidGtin, parseCosmos, parseOpenFacts } from './barcode-lookup';

describe('isValidGtin', () => {
  it('aceita EANs válidos e rejeita dígito errado/tamanho/não numérico', () => {
    expect(isValidGtin('7891000100103')).toBe(true);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('7891000100104')).toBe(false);
    expect(isValidGtin('123')).toBe(false);
    expect(isValidGtin('78910001001a3')).toBe(false);
  });
});

describe('parseCosmos', () => {
  it('extrai nome, marca, NCM, imagem e preço médio', () => {
    const r = parseCosmos('7891000100103', { description: 'LEITE CONDENSADO MOCA 395G', brand: { name: 'Nestlé' }, ncm: { code: '0402.99.00' }, thumbnail: 'https://x/y.jpg', avg_price: 6.49 });
    expect(r).toMatchObject({ found: true, source: 'cosmos', name: 'Leite Condensado Moca 395g', brand: 'Nestlé', ncm: '04029900', avgPriceCents: 649 });
  });
  it('descarta NCM malformado e retorna não encontrado sem descrição', () => {
    expect(parseCosmos('1', { description: 'X Y', ncm: { code: '123' } }).ncm).toBeUndefined();
    expect(parseCosmos('1', {}).found).toBe(false);
  });
});

describe('parseOpenFacts', () => {
  it('monta o nome com marca e quantidade sem duplicar', () => {
    const r = parseOpenFacts('1', 'openfoodfacts', { status: 1, product: { product_name: 'Biscoito Recheado', brands: 'Bauducco, Outra', quantity: '140 g' } });
    expect(r).toMatchObject({ found: true, name: 'Biscoito Recheado Bauducco 140 g', brand: 'Bauducco' });
    expect(parseOpenFacts('1', 'openfoodfacts', { status: 1, product: { product_name: 'Bauducco Wafer 140 g', brands: 'Bauducco', quantity: '140 g' } }).name).toBe('Bauducco Wafer 140 g');
  });
  it('status 0 ou sem nome = não encontrado', () => {
    expect(parseOpenFacts('1', 'openfoodfacts', { status: 0 }).found).toBe(false);
    expect(parseOpenFacts('1', 'openfoodfacts', { status: 1, product: { brands: 'X' } }).found).toBe(false);
  });
});
