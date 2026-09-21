/**
 * Password hashing and credential encryption.
 *
 * Passwords are hashed with scrypt (never decryptable). Mailbox passwords must
 * be given back to nodemailer verbatim, so those are *encrypted* with AES-256-GCM
 * rather than hashed - a different problem needing a different tool.
 *
 * Both use node's built-in crypto, so there is no extra dependency to trust.
 */

import crypto from "crypto";

/* ------------------------------------------------------------------ passwords */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");

  // Lengths must match before timingSafeEqual, which throws otherwise
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/* ------------------------------------------------------------------ mailbox credentials */

/**
 * The key that protects every stored mailbox password.
 *
 * Losing or changing it makes existing stored credentials unreadable - users
 * would simply have to reconnect their mailbox. Keep it out of version control.
 */
function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      "and put it in backend/.env as ENCRYPTION_KEY=<value>"
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes as 64 hex characters.");
  }
  return key;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`;
}

export function decryptSecret(blob) {
  const [version, ivHex, tagHex, dataHex] = String(blob).split(".");
  if (version !== "v1") throw new Error("Unrecognised secret format");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ sessions */

/**
 * Sessions live in memory only, so a server restart signs everyone out and
 * nothing sensitive is written to disk. That also matches the product rule that
 * every visit starts at the login screen.
 */
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

export function sessionUser(token) {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return entry.username;
}

export function destroySession(token) {
  sessions.delete(token);
}
