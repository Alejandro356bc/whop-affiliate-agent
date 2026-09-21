/**
 * Run this once: `node gmail-auth.js`
 * Opens a URL for you to authorize the app, then saves token.json.
 */

import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

async function main() {
  let credsRaw;
  try {
    credsRaw = await fs.readFile(CREDENTIALS_PATH, "utf-8");
  } catch (err) {
    console.error(
      `\n❌ credentials.json not found at ${CREDENTIALS_PATH}!\n` +
      `Please download your OAuth 2.0 Client ID (Desktop app) credentials from Google Cloud Console\n` +
      `and save it as 'backend/credentials.json'.\n\n` +
      `Alternatively, you can skip Google OAuth completely by adding GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env!\n`
    );
    process.exit(1);
  }

  const creds = JSON.parse(credsRaw);
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
  console.log("Authorize this app by visiting:\n", authUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("\nPaste the code from that page here: ", async (code) => {
    rl.close();
    const { tokens } = await client.getToken(code.trim());
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log("Saved token to token.json — you're ready to send.");
  });
}

main().catch(console.error);
