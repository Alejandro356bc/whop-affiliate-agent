/**
 * User records, kept in users.json.
 *
 * A JSON file is fine for one process at this size; swap this module for a real
 * database when you outgrow it and nothing else has to change. Every read and
 * write goes through here so the shape stays in one place.
 *
 * A record:
 *   {
 *     username,      // Whop handle: signs you in AND earns the commission
 *     email,         // the address newsletters are sent from
 *     passwordHash,  // this app's account password
 *     firstLoginTime, loginTime, loginCount,
 *     mailbox: { host, port, secure, user, fromName, passEnc, connectedAt }
 *   }
 *
 * username is validated to contain no "@", so it can never be an email by
 * mistake - that was how affiliate links used to end up untaggable.
 *
 * mailbox.passEnc is AES-encrypted. It is never returned to the browser.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { encryptSecret, decryptSecret } from "./secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "users.json");

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(DB_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function writeAll(users) {
  await fs.writeFile(DB_PATH, JSON.stringify(users, null, 2));
}

const norm = (u) => String(u || "").trim().toLowerCase();

export async function findUser(username) {
  const users = await readAll();
  return users.find((u) => norm(u.username) === norm(username)) || null;
}

/**
 * True when a record predates authentication: it has a username but no password.
 * Those were created when typing a username was the whole login, so they carry
 * no security value and may be claimed by whoever registers that name first.
 */
export function isLegacy(user) {
  return !!user && !user.passwordHash;
}

export async function createUser(username, passwordHash, email = "") {
  const users = await readAll();
  const now = new Date().toISOString();
  const i = users.findIndex((u) => norm(u.username) === norm(username));

  if (i >= 0) {
    if (!isLegacy(users[i])) return { ok: false, reason: "exists" };
    // Claim the pre-auth record, keeping its history
    users[i] = { ...users[i], passwordHash, email, loginTime: now };
  } else {
    users.push({
      username: String(username).trim(),
      email: String(email).trim(),
      passwordHash,
      firstLoginTime: now,
      loginTime: now,
      loginCount: 0,
      mailbox: null,
    });
  }

  await writeAll(users);
  return { ok: true };
}

export async function recordLogin(username) {
  const users = await readAll();
  const i = users.findIndex((u) => norm(u.username) === norm(username));
  if (i < 0) return null;

  const now = new Date().toISOString();
  users[i] = {
    ...users[i],
    firstLoginTime: users[i].firstLoginTime || now,
    loginTime: now,
    loginCount: (users[i].loginCount || 0) + 1,
  };
  await writeAll(users);
  return users[i];
}

/* ------------------------------------------------------------------ profile */

/**
 * The Whop handle affiliate links carry.
 *
 * Registration rejects an "@" in the username, so any account created since
 * then is safe to use directly. Older records made before that rule could hold
 * an email, and those stay untagged rather than carrying something Whop
 * cannot credit.
 */
export async function affiliateHandleFor(username) {
  const user = await findUser(username);
  if (!user) return "";
  const handle = user.whopUsername || user.username;
  return String(handle).includes("@") ? "" : handle;
}

/** The address this user registered with, used to prefill the mailbox form. */
export async function emailFor(username) {
  const user = await findUser(username);
  return user?.email || "";
}

/* ------------------------------------------------------------------ mailbox */

export async function saveMailbox(username, { host, port, secure, user, pass, fromName }) {
  const users = await readAll();
  const i = users.findIndex((u) => norm(u.username) === norm(username));
  if (i < 0) return { ok: false, reason: "no-user" };

  users[i].mailbox = {
    host,
    port: Number(port),
    secure: !!secure,
    user,
    fromName: fromName || "",
    passEnc: encryptSecret(pass),
    connectedAt: new Date().toISOString(),
  };

  await writeAll(users);
  return { ok: true };
}

export async function clearMailbox(username) {
  const users = await readAll();
  const i = users.findIndex((u) => norm(u.username) === norm(username));
  if (i < 0) return { ok: false };
  users[i].mailbox = null;
  await writeAll(users);
  return { ok: true };
}

/** The mailbox with its password decrypted. Server-side use only. */
export async function mailboxFor(username) {
  const user = await findUser(username);
  if (!user?.mailbox?.passEnc) return null;

  return {
    host: user.mailbox.host,
    port: user.mailbox.port,
    secure: user.mailbox.secure,
    user: user.mailbox.user,
    fromName: user.mailbox.fromName || "",
    pass: decryptSecret(user.mailbox.passEnc),
    connectedAt: user.mailbox.connectedAt,
  };
}

/** What is safe to show the browser: never the password. */
export async function mailboxSummary(username) {
  const user = await findUser(username);
  if (!user?.mailbox) return null;
  const { host, port, user: address, fromName, connectedAt } = user.mailbox;
  return { host, port, address, fromName, connectedAt };
}
