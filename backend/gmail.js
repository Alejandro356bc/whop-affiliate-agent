/**
 * gmail.js
 *
 * Supports 3 flexible methods for newsletter delivery:
 * 1. Gmail App Password (Easiest, no Cloud Console needed):
 *    Set GMAIL_USER and GMAIL_APP_PASSWORD in backend/.env
 *
 * 2. Google OAuth 2.0 (Desktop app credentials):
 *    Provide backend/credentials.json and authorize with `node gmail-auth.js`
 *
 * 3. Test / Demo Mode (Fallback):
 *    If no credentials are configured, sends via Ethereal.email and returns
 *    a live web preview URL so you can test without credentials!
 */

import { google } from "googleapis";
import nodemailer from "nodemailer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getOAuthClient() {
  const creds = JSON.parse(await fs.readFile(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
  client.setCredentials(token);
  return client;
}

function buildRawMessage({ to, subject, html, fromName, fromEmail }) {
  const senderHeader = fromEmail
    ? `From: "${fromName || 'Whop Affiliate Agent'}" <${fromEmail}>`
    : `From: "${fromName || 'Whop Affiliate Agent'}"`;

  const messageParts = [
    `To: ${to}`,
    senderHeader,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    html,
  ];
  const message = messageParts.join("\n");
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Which delivery route is configured, without exposing any secret.
 * The send screen calls this so a missing setup is visible up front rather
 * than surfacing as a failure after the user has already hit Send.
 */
export async function mailStatus(mailbox) {
  if (mailbox && mailbox.user) {
    return { configured: true, method: "user-mailbox", account: mailbox.user };
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (user && pass) {
    return { configured: true, method: "gmail-app-password", account: user };
  }

  const hasCreds = await fileExists(CREDENTIALS_PATH);
  const hasToken = await fileExists(TOKEN_PATH);

  if (hasCreds && hasToken) {
    return { configured: true, method: "gmail-oauth", account: null };
  }

  if (hasCreds && !hasToken) {
    return {
      configured: false,
      method: "gmail-oauth",
      reason: "credentials.json is here but token.json is missing. Run: node gmail-auth.js",
    };
  }

  return {
    configured: false,
    method: null,
    reason: "No Gmail account connected. Add GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env",
  };
}

/**
 * A readable plain-text version of the HTML.
 *
 * HTML-only mail is a well-known spam signal; every real newsletter ships a
 * text/plain alternative alongside it. Links are kept inline so the text part
 * is actually useful rather than a stripped husk.
 */
export function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href, text) => "\n" + text.replace(/<[^>]+>/g, "").trim() + ": " + href + "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&middot;/g, "-")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rarr;/g, "->")
    .replace(/&#10003;/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Check SMTP credentials before storing them, so a user finds out the password
 * is wrong on the connect screen rather than halfway through a bulk run.
 */
export async function verifyMailbox({ host, port, secure, user, pass }) {
  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: !!secure,
    auth: { user, pass: String(pass).replace(/\s+/g, "") },
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = String(err.message || err);

    if (/invalid login|username and password not accepted|535/i.test(msg)) {
      return {
        ok: false,
        error:
          "Gmail rejected that password. Use a 16-character App Password " +
          "(myaccount.google.com -> Security -> App passwords), not your normal password.",
      };
    }
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
      return { ok: false, error: `Couldn't reach ${host}:${port}. Check the SMTP host and port.` };
    }
    return { ok: false, error: msg };
  } finally {
    transporter.close();
  }
}

/**
 * Send one newsletter.
 *
 * `mailbox` is the signed-in user's own account, so each person sends from
 * their own address. Falls back to the server-wide .env credentials when no
 * mailbox is supplied, which is what a single-user self-hosted copy uses.
 */
export async function sendNewsletter({ to, subject, html, senderName, attachments = [], unsubscribeTo, mailbox, personal = false }) {
  // List-Unsubscribe is the clearest "this is bulk mail" flag there is. It
  // helps spam placement but is also exactly what Gmail reads to file a
  // message under Promotions, so personal sends go without it.
  const bulkHeaders = personal ? {} : {
    "List-Unsubscribe": `<mailto:${unsubscribeTo || (mailbox && mailbox.user)}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  // Method 0: the signed-in user's own mailbox
  if (mailbox && mailbox.user && mailbox.pass) {
    const transporter = nodemailer.createTransport({
      host: mailbox.host,
      port: Number(mailbox.port),
      secure: !!mailbox.secure,
      auth: { user: mailbox.user, pass: String(mailbox.pass).replace(/\s+/g, "") },
    });

    const displayName = senderName || mailbox.fromName || mailbox.user;
    const info = await transporter.sendMail({
      from: `"${displayName}" <${mailbox.user}>`,
      to,
      subject,
      html,
      text: htmlToText(html),
      attachments,
      headers: bulkHeaders,
    });
    transporter.close();

    return { id: info.messageId, method: "user-mailbox", from: mailbox.user, simulated: false };
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPass = process.env.GMAIL_APP_PASSWORD;

  // Method 1: Gmail App Password (Nodemailer)
  if (gmailUser && gmailAppPass) {
    console.log(`[Email] Sending via Gmail App Password (${gmailUser})...`);
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPass.replace(/\s+/g, ""), // clean up any spaces
      },
    });

    const replyTo = unsubscribeTo || gmailUser;

    const info = await transporter.sendMail({
      from: `"${senderName || 'Whop Affiliate Agent'}" <${gmailUser}>`,
      to,
      subject,
      html,
      text: htmlToText(html),
      attachments,
      headers: bulkHeaders,
    });

    return {
      id: info.messageId,
      method: "gmail-app-password",
      simulated: false,
    };
  }

  // Method 2: Google Cloud OAuth 2.0 (credentials.json + token.json)
  const hasCreds = await fileExists(CREDENTIALS_PATH);
  const hasToken = await fileExists(TOKEN_PATH);

  if (hasCreds && hasToken) {
    console.log("[Email] Sending via Gmail API OAuth2...");
    const auth = await getOAuthClient();
    const gmail = google.gmail({ version: "v1", auth });

    const raw = buildRawMessage({ to, subject, html, fromName: senderName });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return {
      id: res.data.id,
      method: "gmail-oauth",
      simulated: false,
    };
  }

  if (hasCreds && !hasToken) {
    throw new Error(
      "backend/credentials.json found, but token.json is missing! Please run 'node gmail-auth.js' in the backend folder to authorize your Gmail account."
    );
  }

  // Method 3: Test / Demo Mode fallback (Ethereal test mailbox)
  console.log("[Email] No Gmail credentials found. Sending via Ethereal Test Inbox...");
  try {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${senderName || 'Whop Affiliate Agent'}" <${testAccount.user}>`,
      to,
      subject,
      html,
      text: htmlToText(html),
      attachments,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[Email] Test email delivered! View preview: ${previewUrl}`);

    return {
      id: info.messageId,
      previewUrl,
      simulated: true,
      note: "Sent in Demo/Test Mode! To send real emails, add GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env",
    };
  } catch (testErr) {
    throw new Error(
      "Email sending is not configured. To send real emails, please add GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env, or save credentials.json in backend/ and run 'node gmail-auth.js'."
    );
  }
}
