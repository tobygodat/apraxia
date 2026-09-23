import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface TokenEncryptionContext {
  readonly userId: string;
  readonly connectionId: string;
  readonly keyVersion: number;
}

/** Never attach input, parser/provider errors, or a cause to this error. */
export class TokenEncryptionError extends Error {
  constructor() {
    super("Calendar credentials could not be secured.");
    this.name = "TokenEncryptionError";
  }
}

const FORMAT_VERSION = 1;
/**
 * Distinct AAD purposes keep the long-lived refresh token and the cached access
 * token from being swapped for one another. Both names are bound into envelopes
 * already stored, so they keep their historical spelling.
 */
const PURPOSES = Object.freeze({
  refresh: "orbitos/google-calendar/refresh-token",
  access: "orbitos/google/access-token",
});
type TokenPurpose = keyof typeof PURPOSES;
const TOKEN_MAX_BYTES = 16 * 1024;
const ENVELOPE_MAX_BYTES = 24 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

interface TokenEnvelope {
  version: 1;
  keyVersion: number;
  iv: string;
  ciphertext: string;
  tag: string;
}

function decodeKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length !== 44 || !KEY_PATTERN.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 32 && bytes.toString("base64") === value) return bytes;
  bytes.fill(0);
  return null;
}

/** Checks encoding and length, not entropy; provision keys with a secure RNG. */
export function isCanonicalEncryptionKey(value: unknown): value is string {
  let bytes: Buffer | null = null;
  try {
    bytes = decodeKey(value);
    return bytes !== null;
  } catch {
    return false;
  } finally {
    bytes?.fill(0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validKeyVersion(value: unknown): value is number {
  // The persisted key version is a positive PostgreSQL integer.
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647
  );
}

function canonicalContext(value: TokenEncryptionContext): TokenEncryptionContext {
  if (!isRecord(value)) throw new TokenEncryptionError();
  const { userId, connectionId, keyVersion } = value;
  if (
    typeof userId !== "string" ||
    !UUID_PATTERN.test(userId) ||
    typeof connectionId !== "string" ||
    !UUID_PATTERN.test(connectionId) ||
    !validKeyVersion(keyVersion)
  ) {
    throw new TokenEncryptionError();
  }
  return { userId: userId.toLowerCase(), connectionId: connectionId.toLowerCase(), keyVersion };
}

function associatedData(context: TokenEncryptionContext, purpose: TokenPurpose): Buffer {
  // A fixed-order tuple prevents delimiter ambiguity and cross-purpose reuse.
  return Buffer.from(
    JSON.stringify([
      PURPOSES[purpose],
      FORMAT_VERSION,
      context.userId,
      context.connectionId,
      context.keyVersion,
    ]),
    "utf8",
  );
}

function decodeBase64url(value: unknown, minimum: number, maximum: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((maximum * 4) / 3) ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new TokenEncryptionError();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length >= minimum && bytes.length <= maximum && bytes.toString("base64url") === value) {
    return bytes;
  }
  bytes.fill(0);
  throw new TokenEncryptionError();
}

function parseEnvelope(value: unknown, keyVersion: number): TokenEnvelope {
  if (
    typeof value !== "string" ||
    value.length > ENVELOPE_MAX_BYTES ||
    Buffer.byteLength(value, "utf8") > ENVELOPE_MAX_BYTES
  ) {
    throw new TokenEncryptionError();
  }
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 5 ||
    parsed.version !== FORMAT_VERSION ||
    parsed.keyVersion !== keyVersion ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new TokenEncryptionError();
  }
  const envelope: TokenEnvelope = {
    version: FORMAT_VERSION,
    keyVersion,
    iv: parsed.iv,
    ciphertext: parsed.ciphertext,
    tag: parsed.tag,
  };
  // This is a private text envelope produced only by this helper. Canonical JSON
  // rejects duplicate keys, extra fields, alternate number forms, and escapes.
  if (JSON.stringify(envelope) !== value) throw new TokenEncryptionError();
  return envelope;
}

/** Encrypts a printable opaque token exactly; it never trims or logs the token. */
export function encryptRefreshToken(
  token: string,
  context: TokenEncryptionContext,
  key: string,
): string {
  return encryptToken(token, context, key, "refresh");
}

/** Same envelope format as the refresh token under a distinct purpose, so the two cannot be swapped. */
export function encryptAccessToken(
  token: string,
  context: TokenEncryptionContext,
  key: string,
): string {
  return encryptToken(token, context, key, "access");
}

function encryptToken(
  token: string,
  context: TokenEncryptionContext,
  key: string,
  purpose: TokenPurpose,
): string {
  const buffers: Buffer[] = [];
  const retain = (buffer: Buffer) => {
    buffers.push(buffer);
    return buffer;
  };
  try {
    const owner = canonicalContext(context);
    if (
      typeof token !== "string" ||
      token.length > TOKEN_MAX_BYTES ||
      !TOKEN_PATTERN.test(token) ||
      Buffer.byteLength(token, "utf8") > TOKEN_MAX_BYTES
    ) {
      throw new TokenEncryptionError();
    }
    const keyBytes = decodeKey(key);
    if (keyBytes === null) throw new TokenEncryptionError();
    retain(keyBytes);
    const plaintext = retain(Buffer.from(token, "utf8"));
    const iv = retain(randomBytes(12));
    const aad = retain(associatedData(owner, purpose));
    const cipher = createCipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const first = retain(cipher.update(plaintext));
    const final = retain(cipher.final());
    const ciphertext = retain(Buffer.concat([first, final]));
    const tag = retain(cipher.getAuthTag());
    const envelope: TokenEnvelope = {
      version: FORMAT_VERSION,
      keyVersion: owner.keyVersion,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url"),
    };
    return JSON.stringify(envelope);
  } catch {
    throw new TokenEncryptionError();
  } finally {
    // Immutable caller strings and OpenSSL's internal copies cannot be wiped by
    // JavaScript; clear all owned key/plaintext buffers on success and failure.
    for (const buffer of buffers) buffer.fill(0);
  }
}

/** Authenticates the complete envelope before materializing a plaintext string. */
export function decryptRefreshToken(
  envelope: unknown,
  context: TokenEncryptionContext,
  key: string,
): string {
  return decryptToken(envelope, context, key, "refresh");
}

export function decryptAccessToken(
  envelope: unknown,
  context: TokenEncryptionContext,
  key: string,
): string {
  return decryptToken(envelope, context, key, "access");
}

function decryptToken(
  envelope: unknown,
  context: TokenEncryptionContext,
  key: string,
  purpose: TokenPurpose,
): string {
  const buffers: Buffer[] = [];
  const retain = (buffer: Buffer) => {
    buffers.push(buffer);
    return buffer;
  };
  try {
    const owner = canonicalContext(context);
    const parsed = parseEnvelope(envelope, owner.keyVersion);
    const keyBytes = decodeKey(key);
    if (keyBytes === null) throw new TokenEncryptionError();
    retain(keyBytes);
    const iv = retain(decodeBase64url(parsed.iv, 12, 12));
    const ciphertext = retain(decodeBase64url(parsed.ciphertext, 1, TOKEN_MAX_BYTES));
    const tag = retain(decodeBase64url(parsed.tag, 16, 16));
    const aad = retain(associatedData(owner, purpose));
    const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const first = retain(decipher.update(ciphertext));
    const final = retain(decipher.final());
    const plaintext = retain(Buffer.concat([first, final]));
    // Validate bytes before decoding so malformed UTF-8 cannot become a changed
    // token through the decoder's replacement-character behavior.
    if (plaintext.some((byte) => byte < 0x21 || byte > 0x7e)) {
      throw new TokenEncryptionError();
    }
    return plaintext.toString("utf8");
  } catch {
    throw new TokenEncryptionError();
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}
