import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  decryptRefreshToken,
  encryptRefreshToken,
  isCanonicalEncryptionKey,
  TokenEncryptionError,
  type TokenEncryptionContext,
} from "../../server/calendar/tokenEncryption";

// Public test vectors only, never deployment credentials.
const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const context: TokenEncryptionContext = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  connectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  keyVersion: 7,
};
const token = "1//fictional_Refresh-Token.123";
const knownEnvelope = '{"version":1,"keyVersion":7,"iv":"AAECAwQFBgcICQoL","ciphertext":"di35fayGtnLiL_bn7rsdC_Gz9FzdLzAXXQnLtC9a","tag":"paBUpaABloDW-ouroSVqGQ"}';
const purpose = "orbitos/google-calendar/refresh-token";

interface Envelope {
  version: number;
  keyVersion: number;
  iv: string;
  ciphertext: string;
  tag: string;
}

function parse(envelope: string): Envelope {
  return JSON.parse(envelope) as Envelope;
}

function changeEnvelope(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...parse(knownEnvelope), ...overrides });
}

function flipByte(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64url");
}

function failure(action: () => unknown): TokenEncryptionError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TokenEncryptionError);
    const safeError = error as TokenEncryptionError;
    expect(safeError.name).toBe("TokenEncryptionError");
    expect(safeError.message).toBe("Calendar credentials could not be secured.");
    expect(safeError.cause).toBeUndefined();
    expect(Object.keys(safeError)).toEqual(["name"]);
    return safeError;
  }
  throw new Error("Expected a sanitized token encryption failure");
}

/** Independent Node primitive use verifies the AAD protocol, not just a helper roundtrip. */
function referenceEnvelope(
  plaintext: Buffer,
  aadTuple: unknown[] = [purpose, 1, context.userId, context.connectionId, context.keyVersion],
): string {
  const iv = Buffer.from("000102030405060708090a0b", "hex");
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(aadTuple), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    version: 1, keyVersion: 7, iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"),
  });
}

describe("canonical encryption keys", () => {
  it("accepts exactly 32 decoded bytes of padded standard Base64", () => {
    expect(isCanonicalEncryptionKey(key)).toBe(true);
    expect(isCanonicalEncryptionKey(randomBytes(32).toString("base64"))).toBe(true);
    expect(isCanonicalEncryptionKey(Buffer.alloc(32, 255).toString("base64"))).toBe(true);
    // Encoding validation cannot establish entropy; deployment must use a secure RNG.
    expect(isCanonicalEncryptionKey(Buffer.alloc(32).toString("base64"))).toBe(true);
  });

  it.each([
    undefined, null, 32, {}, [], new String(key), "", "password".repeat(4),
    key.slice(0, -1), `${key}=`, ` ${key}`, `${key}\n`, `${key}\r\n`,
    `${key.slice(0, 10)} ${key.slice(10)}`, key.replace(/8=$/, "9="),
    Buffer.alloc(32, 255).toString("base64url"),
    `${Buffer.alloc(32, 255).toString("base64url")}=`,
    Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"),
    "A".repeat(64), "A".repeat(1_000_000),
  ])("rejects noncanonical/incorrectly sized key %# without throwing", (value) => {
    expect(isCanonicalEncryptionKey(value)).toBe(false);
  });
});

describe("refresh-token authenticated envelope", () => {
  it("decrypts the fixed AES-256-GCM test vector", () => {
    expect(referenceEnvelope(Buffer.from(token))).toBe(knownEnvelope);
    expect(decryptRefreshToken(knownEnvelope, context, key)).toBe(token);
  });

  it("encrypts to strict versioned fields with a 12-byte IV and 16-byte tag", () => {
    const envelope = encryptRefreshToken(token, context, key);
    const fields = parse(envelope);
    expect(Object.keys(fields)).toEqual(["version", "keyVersion", "iv", "ciphertext", "tag"]);
    expect(fields.version).toBe(1);
    expect(fields.keyVersion).toBe(7);
    expect(Buffer.from(fields.iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(fields.tag, "base64url")).toHaveLength(16);
    expect(Buffer.from(fields.ciphertext, "base64url")).toHaveLength(Buffer.byteLength(token));
    for (const field of [fields.iv, fields.ciphertext, fields.tag]) {
      expect(field).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(field, "base64url").toString("base64url")).toBe(field);
    }
    expect(envelope).not.toContain(token);
    expect(envelope).not.toContain(key);
    expect(envelope).not.toContain(context.userId);
    expect(envelope).not.toContain(context.connectionId);
    const decipher = createDecipheriv(
      "aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(fields.iv, "base64url"), { authTagLength: 16 },
    );
    decipher.setAAD(Buffer.from(JSON.stringify([purpose, 1, context.userId, context.connectionId, 7])));
    decipher.setAuthTag(Buffer.from(fields.tag, "base64url"));
    expect(Buffer.concat([
      decipher.update(Buffer.from(fields.ciphertext, "base64url")), decipher.final(),
    ]).toString("utf8")).toBe(token);
  });

  it("generates a fresh secure nonce and ciphertext on every encryption", () => {
    const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Non-cryptographic randomness must never be used");
    });
    try {
      const envelopes = Array.from({ length: 32 }, () => encryptRefreshToken(token, context, key));
      expect(new Set(envelopes.map((entry) => parse(entry).iv)).size).toBe(32);
      expect(new Set(envelopes.map((entry) => parse(entry).ciphertext)).size).toBe(32);
      for (const envelope of envelopes) expect(decryptRefreshToken(envelope, context, key)).toBe(token);
      expect(mathRandom).not.toHaveBeenCalled();
    } finally {
      mathRandom.mockRestore();
    }
  });

  it.each(["x", token, "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", "x".repeat(16 * 1024)])(
    "preserves an accepted opaque token exactly (case %#)", (input) => {
      expect(decryptRefreshToken(encryptRefreshToken(input, context, key), context, key)).toBe(input);
    },
  );

  it("canonicalizes UUID case without changing the supplied context", () => {
    const upper = Object.freeze({
      userId: context.userId.toUpperCase(), connectionId: context.connectionId.toUpperCase(), keyVersion: 7,
    });
    const before = JSON.stringify(upper);
    expect(decryptRefreshToken(knownEnvelope, upper, key)).toBe(token);
    expect(decryptRefreshToken(encryptRefreshToken(token, upper, key), context, key)).toBe(token);
    expect(JSON.stringify(upper)).toBe(before);
  });

  it("supports the positive PostgreSQL integer key-version endpoints", () => {
    for (const keyVersion of [1, 2_147_483_647]) {
      const owner = { ...context, keyVersion };
      expect(decryptRefreshToken(encryptRefreshToken(token, owner, key), owner, key)).toBe(token);
    }
  });

  it.each(["iv", "ciphertext", "tag"] as const)("rejects byte tampering in %s", (field) => {
    failure(() => decryptRefreshToken(changeEnvelope({ [field]: flipByte(parse(knownEnvelope)[field]) }), context, key));
  });

  it("rejects every altered authentication-tag byte", () => {
    const original = Buffer.from(parse(knownEnvelope).tag, "base64url");
    for (let index = 0; index < original.length; index += 1) {
      const tag = Buffer.from(original);
      tag[index] = (tag[index] ?? 0) ^ 128;
      failure(() => decryptRefreshToken(changeEnvelope({ tag: tag.toString("base64url") }), context, key));
    }
  });

  it.each([
    { ...context, userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    { ...context, connectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    { userId: context.connectionId, connectionId: context.userId, keyVersion: 7 },
    { ...context, keyVersion: 8 },
  ])("rejects moving credentials to another valid owner/connection/version %#", (owner) => {
    failure(() => decryptRefreshToken(knownEnvelope, owner, key));
  });

  it("rejects a different valid 256-bit key", () => {
    failure(() => decryptRefreshToken(knownEnvelope, context, Buffer.alloc(32, 27).toString("base64")));
  });

  it("binds keyVersion cryptographically, not just through the envelope equality check", () => {
    failure(() => decryptRefreshToken(changeEnvelope({ keyVersion: 8 }), { ...context, keyVersion: 8 }, key));
  });

  it.each([
    ["orbitos/other-purpose", 1, context.userId, context.connectionId, 7],
    [purpose, 2, context.userId, context.connectionId, 7],
    [purpose, 1, context.userId, context.connectionId],
    [purpose, 1, context.connectionId, context.userId, 7],
  ])("rejects another authenticated-data purpose or protocol %#", (...aad) => {
    failure(() => decryptRefreshToken(referenceEnvelope(Buffer.from(token), aad), context, key));
  });
});

describe("refresh-token input boundaries", () => {
  it.each([
    undefined, null, 4, {}, [], new String(token), "", " ", "   ", "\t", "\n", "\r\n",
    " token", "token ", "to ken", "token\n", "to\0ken", "to\x1fken", "to\x7fken",
    "tökén", "😀", "\ud800", "x".repeat(16 * 1024 + 1),
  ])("rejects invalid tokens without trimming/replacing content (case %#)", (input) => {
    failure(() => encryptRefreshToken(input as string, context, key));
  });

  it.each([
    null, undefined, [], {}, { ...context, userId: null }, { ...context, connectionId: null },
    { ...context, userId: "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa" },
    { ...context, connectionId: `{${context.connectionId}}` },
    { ...context, userId: ` ${context.userId}` }, { ...context, userId: `${context.userId}\n` },
    { ...context, userId: "g".repeat(36) }, { ...context, connectionId: "" },
    { ...context, keyVersion: 0 }, { ...context, keyVersion: -1 }, { ...context, keyVersion: 1.5 },
    { ...context, keyVersion: 2_147_483_648 }, { ...context, keyVersion: Number.MAX_SAFE_INTEGER },
    { ...context, keyVersion: Infinity }, { ...context, keyVersion: NaN }, { ...context, keyVersion: "7" },
  ])("rejects invalid binding context for encryption and decryption (case %#)", (owner) => {
    failure(() => encryptRefreshToken(token, owner as TokenEncryptionContext, key));
    failure(() => decryptRefreshToken(knownEnvelope, owner as TokenEncryptionContext, key));
  });

  it.each(["not-a-key", key.slice(0, -1), `${key}\n`, key.replace(/8=$/, "9="), null, 4])(
    "uses the same safe error for invalid encryption/decryption keys (case %#)", (badKey) => {
      failure(() => encryptRefreshToken(token, context, badKey as string));
      failure(() => decryptRefreshToken(knownEnvelope, context, badKey as string));
    },
  );

  it.each([
    Buffer.from([0]), Buffer.from([0x7f]), Buffer.from([0xff]), Buffer.from(" "),
    Buffer.from("has space"), Buffer.from("é", "utf8"), Buffer.from([0xc3, 0x28]),
  ])("rejects even authenticated plaintext violating the opaque token byte contract %#", (plaintext) => {
    failure(() => decryptRefreshToken(referenceEnvelope(plaintext), context, key));
  });

  it("does not mutate an immutable context or encrypted input on failure", () => {
    const owner = Object.freeze({ ...context });
    const envelope = changeEnvelope({ tag: flipByte(parse(knownEnvelope).tag) });
    const before = JSON.stringify({ owner, envelope, key, token });
    failure(() => decryptRefreshToken(envelope, owner, key));
    expect(JSON.stringify({ owner, envelope, key, token })).toBe(before);
  });
});

describe("strict bounded refresh-token envelope parsing", () => {
  it.each([
    undefined, null, 1, {}, [], parse(knownEnvelope), new String(knownEnvelope), "", "null", "[]", "true", "1", "{}",
    "{", `${knownEnvelope}garbage`, ` ${knownEnvelope}`, `${knownEnvelope}\n`,
    JSON.stringify(parse(knownEnvelope), null, 2),
    JSON.stringify(Object.fromEntries(Object.entries(parse(knownEnvelope)).reverse())),
    knownEnvelope.replace('"version":1', '"version":1,"version":1'),
    knownEnvelope.replace('"version":1', '"version":2,"version":1'),
    knownEnvelope.replace('"version":1', '"version":1e0'),
    knownEnvelope.replace('"version":1', '"version":1.0'),
    knownEnvelope.replace('"iv"', '"i\\u0076"'),
    knownEnvelope.replace('"version":1', '"__proto__":{},"version":1'),
    "x".repeat(24 * 1024 + 1), "é".repeat(13 * 1024),
  ])("rejects invalid/noncanonical serialized JSON (case %#)", (envelope) => {
    failure(() => decryptRefreshToken(envelope, context, key));
  });

  it.each([
    { version: 0 }, { version: 2 }, { version: "1" }, { version: null },
    { keyVersion: "7" }, { keyVersion: null }, { keyVersion: 8 },
    { iv: undefined }, { iv: null }, { iv: [] }, { ciphertext: null }, { tag: {} },
    { algorithm: "aes-256-gcm" }, { token: "private-token-canary" },
    { tag: undefined },
  ])("rejects unknown versions, wrong types, missing or extra fields %#", (overrides) => {
    failure(() => decryptRefreshToken(changeEnvelope(overrides), context, key));
  });

  it.each(["iv", "ciphertext", "tag"] as const)("requires canonical unpadded Base64url for %s", (field) => {
    const value = parse(knownEnvelope)[field];
    for (const malformed of ["", `${value}=`, ` ${value}`, `${value}\n`, "AAAA+AAA", "AAAA/AAA", "!!!!", "A"]) {
      failure(() => decryptRefreshToken(changeEnvelope({ [field]: malformed }), context, key));
    }
  });

  it("rejects nonzero unused Base64url pad bits even if decoding produces the same tag", () => {
    const tag = parse(knownEnvelope).tag;
    const noncanonical = `${tag.slice(0, -1)}R`;
    expect(Buffer.from(noncanonical, "base64url")).toEqual(Buffer.from(tag, "base64url"));
    failure(() => decryptRefreshToken(changeEnvelope({ tag: noncanonical }), context, key));
  });

  it.each([
    { iv: Buffer.alloc(11).toString("base64url") },
    { iv: Buffer.alloc(13).toString("base64url") },
    { tag: Buffer.alloc(15).toString("base64url") },
    { tag: Buffer.alloc(17).toString("base64url") },
    { ciphertext: Buffer.alloc(16 * 1024 + 1).toString("base64url") },
  ])("rejects wrong IV/tag sizes or oversized decoded token before decryption %#", (overrides) => {
    failure(() => decryptRefreshToken(changeEnvelope(overrides), context, key));
  });

  it("does not disclose bodies, keys, or parser/authentication diagnostics through errors or logs", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failures = [
        failure(() => decryptRefreshToken("private-envelope-canary", context, key)),
        failure(() => encryptRefreshToken("private-token-canary\n", context, key)),
        failure(() => decryptRefreshToken(knownEnvelope, context, "private-key-canary")),
        failure(() => decryptRefreshToken(changeEnvelope({ tag: flipByte(parse(knownEnvelope).tag) }), context, key)),
        failure(() => encryptRefreshToken(token, {
          ...context, get userId(): string { throw new Error("private-getter-canary"); },
        }, key)),
      ];
      for (const value of failures) {
        expect(`${value.name} ${value.message} ${JSON.stringify(value)}`).not.toMatch(/private-|canary|authenticate|JSON|base64|ciphertext/i);
      }
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore(); warn.mockRestore(); error.mockRestore();
    }
  });
});
