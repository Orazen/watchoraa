import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for user-supplied AI provider API keys. The key is
 * derived (SHA-256) from TOKEN_ENCRYPTION_SECRET, falling back to JWT_SECRET
 * so a single-secret deployment still gets real encryption. Ciphertext format:
 * base64(iv[12] || authTag[16] || encrypted). Plaintext keys NEVER leave the
 * server: the client writes a key once and can only read back a masked form.
 */
function masterKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('TOKEN_ENCRYPTION_SECRET or JWT_SECRET must be set to store AI provider keys');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 12 + 16) {
    throw new Error('Encrypted payload is truncated');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Client-safe display form: shows the last 4 characters only. */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return '••••';
  return `••••${plain.slice(-4)}`;
}
