import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Criptografia dos tokens dos adquirentes guardados no banco (AES-256-GCM).
// ENCRYPTION_KEY: 64 caracteres hexadecimais (32 bytes). Gere com: openssl rand -hex 32

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY inválida: use 64 caracteres hexadecimais (openssl rand -hex 32)');
  }
  if (process.env.NODE_ENV === 'production' && /^0+$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY de exemplo (só zeros) não pode ser usada em produção');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
