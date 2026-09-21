/**
 * scraper.js
 *
 * Logs into Whop with a persisted browser session and scrapes the
 * Affiliate Marketplace listing (program name, niche/category, commission
 * rate, and the program's page URL), saving results to businesses.json.
 *
 * WHOP'S AFFILIATE MARKETPLACE IS BEHIND LOGIN.
 * There is no public "list every affiliate program" page, so this script
 * drives a real (visible, non-headless) browser the first time so you can
 * log in yourself. After that, your session is saved to storage-state.json
 * and reused headlessly.
 *
 * IMPORTANT: Check Whop's Terms of Service for their current stance on
 * automated access before relying on this for anything beyond personal,
 * low-volume use. This script only reads pages you already have permission
 * to view as a logged-in user — it does not bypass any auth.
 *
 * The CSS selectors below are placeholders. Whop's frontend markup will
 * not match this exactly — open the Affiliate Marketplace page in Chrome,
 * right-click a listing -> Inspect, and update the selectors marked
 * "ADJUST ME" to match what you actually see.
 *
 * Usage:
 *   npm run scrape
 */

import { chromium } from "playwright";
import fs from "fs/promises";

const STORAGE_STATE = "./storage-state.json";
const AFFILIATE_MARKETPLACE_URL = "https://whop.com/hub/affiliate-marketplace"; // ADJUST ME if Whop's actual dashboard URL differs
const OUTPUT_FILE = "./businesses.json";

async function getContext(browser) {
  const hasSession = await fs
    .access(STORAGE_STATE)
    .then(() => true)
    .catch(() => false);

  if (hasSession) {
    return browser.newContext({ storageState: STORAGE_STATE });
  }

  console.log("\nNo saved session found — a browser window will open.");
  console.log("Log into your Whop account, navigate to the Affiliate Marketplace,");
  console.log("then come back to this terminal and press Enter.\n");
  const context = await browser.newContext();
  return context;
}

async function waitForManualLogin(page) {
  await page.goto("https://whop.com/login");
  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });
}

async function scrapeListings(page) {
  await page.goto(AFFILIATE_MARKETPLACE_URL, { waitUntil: "networkidle" });

  // ADJUST ME: replace this selector with the actual repeating card/row
  // element for one affiliate program in the marketplace list.
  const cardSelector = "[data-testid='affiliate-program-card']";

  await page.waitForSelector(cardSelector, { timeout: 15000 }).catch(() => {
    console.warn(
      `Could not find "${cardSelector}" — the selectors in scraper.js need to be updated to match Whop's current markup.`
    );
  });

  const listings = await page.$$eval(cardSelector, (cards) =>
    cards.map((card) => {
      // ADJUST ME: each of these should point at the right sub-element
      // within a single card.
      const name = card.querySelector("[data-testid='program-name']")?.textContent?.trim() || "";
      const category = card.querySelector("[data-testid='program-category']")?.textContent?.trim() || "";
      const commission = card.querySelector("[data-testid='program-commission']")?.textContent?.trim() || "";
      const link = card.querySelector("a")?.href || "";

      return { name, category, commission, link };
    })
  );

  return listings;
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await getContext(browser);
  const page = await context.newPage();

  const hasSession = await fs
    .access(STORAGE_STATE)
    .then(() => true)
    .catch(() => false);

  if (!hasSession) {
    await waitForManualLogin(page);
    await context.storageState({ path: STORAGE_STATE });
    console.log("Session saved to storage-state.json for future runs.");
  }

  const listings = await scrapeListings(page);
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(listings, null, 2));
  console.log(`Saved ${listings.length} listings to ${OUTPUT_FILE}`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
