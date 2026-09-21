/**
 * Fills .dev-cache.json with one real scrape, so the UI has listings to work
 * with and you never wait on Apify while building.
 *
 *   npm run seed
 *
 * Run it whenever the cached listings feel stale. It forces a live run and
 * overwrites the cache. DEV_CACHE is turned on for this process regardless of
 * .env, because writing the cache is the entire point of the script.
 */

import "dotenv/config";

process.env.DEV_CACHE = "true";

const { getBusinesses, getLastSync } = await import("./apifyScraper.js");

console.log("Seeding the dev cache with a live scrape. This takes a minute.\n");

try {
  const businesses = await getBusinesses({ forceRefresh: true });

  const spread = businesses.reduce((acc, b) => {
    acc[b.category] = (acc[b.category] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nDone. ${businesses.length} listings cached at ${await getLastSync()}.`);
  console.log("Per niche:", spread);
  console.log("\nStart the server and press Browse marketplace - it will be instant.");
} catch (err) {
  console.error("\nSeeding failed:", err.message);
  console.error("The cache was left as it was. Check APIFY_TOKEN in .env.");
  process.exitCode = 1;
}
