import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.alloc(50)]);

function make() {
  const images: Record<string, any> = {};
  const product: any = { id: 'p1', tenantId: 't1', hasImage: false, variants: [], category: null };
  const tx: any = {
    productImage: {
      upsert: async ({ where, create, update }: any) => { images[where.productId] = images[where.productId] ? { ...images[where.productId], ...update } : create; },
      deleteMany: async ({ where }: any) => { delete images[where.productId]; },
    },
    product: { update: async ({ data }: any) => Object.assign(product, data) },
  };
  const prisma: any = { ...tx, product: { ...tx.product, findFirst: async () => product }, $transaction: async (fn: any) => fn(tx) };
  const pending: any = { t1: { mime: 'image/png', data: PNG } };
  const barcodes: any = { takeImage: (tenant: string, tok?: string) => (tok === 'ok' ? pending[tenant] : undefined) };
  return { svc: new CatalogService(prisma, barcodes), images, product };
}

describe('foto no editar produto', () => {
  it('imageToken troca a foto e marca hasImage; removeImage apaga', async () => {
    const { svc, images, product } = make();
    await svc.updateProduct('t1', 'p1', { name: 'Novo nome', imageToken: 'ok' } as any);
    expect(images.p1.mime).toBe('image/png');
    expect(product).toMatchObject({ name: 'Novo nome', hasImage: true });
    await svc.updateProduct('t1', 'p1', { removeImage: true } as any);
    expect(images.p1).toBeUndefined();
    expect(product.hasImage).toBe(false);
  });
  it('token inválido não altera a foto', async () => {
    const { svc, images } = make();
    await svc.updateProduct('t1', 'p1', { name: 'X1', imageToken: 'nope' } as any);
    expect(images.p1).toBeUndefined();
  });
  it('upload manual valida a imagem', async () => {
    const { svc, images, product } = make();
    await svc.setImage('t1', 'p1', 'image/png', PNG.toString('base64'));
    expect(product.hasImage).toBe(true);
    expect(images.p1).toBeDefined();
    await expect(svc.setImage('t1', 'p1', 'image/svg+xml', Buffer.from('<svg/>').toString('base64'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setImage('t1', 'p1', 'image/png', Buffer.from('lixo qualquer aqui').toString('base64'))).rejects.toBeInstanceOf(BadRequestException);
  });
});
