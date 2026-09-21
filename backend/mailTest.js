/**
 * Proves mail delivery actually works, before you point this at a real list.
 *
 *   npm run mail:test your@email.com
 *
 * Sends one plain message through exactly the same path the app uses, so a
 * success here means the app will deliver too.
 */

import "dotenv/config";
import { sendNewsletter, mailStatus } from "./gmail.js";

const to = process.argv[2];

if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("Usage: npm run mail:test your@email.com");
  process.exit(1);
}

const status = await mailStatus();

if (!status.configured) {
  console.error("\nMail is NOT configured, so nothing would reach anyone.\n");
  console.error(`  ${status.reason}\n`);
  console.error("Fastest route (no Google Cloud project needed):");
  console.error("  1. Turn on 2-Step Verification on your Google account");
  console.error("  2. myaccount.google.com -> Security -> App passwords -> generate one for Mail");
  console.error("  3. Put these two lines in backend/.env:");
  console.error("       GMAIL_USER=you@gmail.com");
  console.error("       GMAIL_APP_PASSWORD=the16charpassword");
  console.error("  4. Run this again (a new process, so .env is re-read)\n");
  process.exit(1);
}

console.log(`Mail is configured via ${status.method}${status.account ? ` (${status.account})` : ""}.`);
console.log(`Sending a test message to ${to} ...\n`);

try {
  const result = await sendNewsletter({
    to,
    subject: "Whop Affiliate Agent - delivery test",
    html: `<p>This is a delivery test from your Whop Affiliate Agent.</p>
           <p>If you are reading this in your inbox, real sending works.</p>`,
    senderName: "Whop Affiliate Agent",
  });

  if (result.simulated) {
    console.log("Sent to a DEMO mailbox only - this did NOT reach the address above.");
    if (result.previewUrl) console.log(`Preview: ${result.previewUrl}`);
    console.log(`\n${result.note || ""}`);
    process.exitCode = 1;
  } else {
    console.log(`Delivered. Message id: ${result.id}`);
    console.log(`Method: ${result.method}`);
    console.log(`\nCheck ${to} - it should be there within a minute.`);
  }
} catch (err) {
  console.error(`Send failed: ${err.message}`);
  process.exitCode = 1;
}
