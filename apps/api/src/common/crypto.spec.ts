import { decrypt, encrypt } from './crypto';

describe('crypto', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('criptografa e descriptografa', () => {
    const secret = 'APP_USR-123456-token';
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc)).toBe(secret);
  });

  it('detecta adulteração', () => {
    const enc = encrypt('abc');
    const parts = enc.split('.');
    parts[2] = Buffer.from('xxx').toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('exige chave válida', () => {
    process.env.ENCRYPTION_KEY = 'curta';
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });
});
