/**
 * src/core/enterprise/crypto.ts
 * Enterprise-grade secret encryption module using AES-256-GCM.
 *
 * Provides:
 *   - SecretBox class for encrypting/decrypting strings with a master key
 *   - generateMasterKey() utility for creating a 32-byte random hex key
 *
 * Format: base64(iv).base64(ciphertext).base64(authTag)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32
const TAG_LENGTH = 16

/**
 * Generate a cryptographically-secure 32-byte random hex string.
 * Suitable for use as the master key for SecretBox.
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex')
}

/**
 * A symmetric encryption/decryption box backed by AES-256-GCM.
 *
 * @example
 * ```ts
 * const key = generateMasterKey()
 * const box = new SecretBox(key)
 * const encrypted = box.encrypt('hello world')
 * const decrypted = box.decrypt(encrypted) // 'hello world'
 * ```
 */
export class SecretBox {
  private readonly key: Buffer

  /**
   * @param masterKey - 32-byte hex-encoded string (64 hex chars).
   * @throws {Error} If masterKey is not exactly 64 hex characters.
   */
  constructor(masterKey: string) {
    const normalized = masterKey.toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new Error('masterKey must be a 64-character hex string')
    }
    this.key = Buffer.from(normalized, 'hex')
  }

  /**
   * Encrypt a plaintext string.
   * Returns a dot-separated payload: `base64(iv).base64(ciphertext).base64(authTag)`.
   *
   * @param plain - The plaintext string to encrypt.
   * @returns Encrypted payload in the format `iv.ciphertext.authtag` (all base64).
   */
  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const encoded = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    const parts = [iv.toString('base64'), encoded.toString('base64'), authTag.toString('base64')]
    return parts.join('.')
  }

  /**
   * Decrypt a payload previously produced by `encrypt`.
   *
   * @param payload - Dot-separated `base64(iv).base64(ciphertext).base64(authTag)`.
   * @returns The original plaintext string.
   * @throws {Error} 'invalid_secret_format' if the payload format is invalid or auth fails.
   */
  decrypt(payload: string): string {
    const parts = payload.split('.')
    if (parts.length !== 3) {
      throw new Error('invalid_secret_format')
    }

    const [ivB64, cipherB64, tagB64] = parts

    let iv: Buffer
    let ciphertext: Buffer
    let authTag: Buffer

    try {
      iv = Buffer.from(ivB64, 'base64')
      ciphertext = Buffer.from(cipherB64, 'base64')
      authTag = Buffer.from(tagB64, 'base64')
    } catch {
      throw new Error('invalid_secret_format')
    }

    if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) {
      throw new Error('invalid_secret_format')
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)

    try {
      const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return decoded.toString('utf-8')
    } catch {
      throw new Error('invalid_secret_format')
    }
  }
}
