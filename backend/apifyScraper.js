import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ApifyClient } from "apify-client";
import { NICHES, PER_NICHE, classify } from "./niches.js";

const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

// One search per niche query, so every filter pill in the UI has real listings behind it.
// SEARCH_URLS keeps the niche alongside the url so results can be traced back to it.
const SEARCH_URLS = NICHES.flatMap((niche) =>
  niche.queries.map((query) => ({
    niche: niche.id,
    query,
    url: `https://whop.com/discover/search/?q=${encodeURIComponent(query)}`,
  }))
);

const input = {
  urls: SEARCH_URLS.map(({ url }) => ({ url })),

  queries: [],
  catalogBrowse: true,
  scrapeCompanies: false,

  sortBy: "trending",
  sortDirection: "",

  categories: [],

  affiliateEnabledOnly: false,
  discoverableOnly: true,
  verifiedOnly: false,
  freeOnly: false,
  paidOnly: false,
  withSocialsOnly: false,

  includeSocials: true,
  includeOwner: true,
  includeCompanyDetails: true,
  includeGrowthMetrics: true,
  includeAffiliate: true,
  includePlans: true,

  maxPlansPerProduct: 5,

  includeImages: true,
  includeFaq: false,
  includeExperiences: false,
  includeReviews: false,

  maxReviewsPerProduct: 5,

  includeCompanyProducts: false,

  getKeywordRevenueDetails: false,
  getKeywordSearchVolume: false,
  keywordRevenueDays: 90,
  getTopKeywords: false,

  // 4 per search x 12 searches = 48 fetched, then capped to PER_NICHE (9) per niche.
  // A little headroom, because a listing found by one niche's search can classify
  // into another. Raise this only if a niche keeps coming back short.
  limit: 4,
  concurrency: 8,
  maxRetries: 3,
  requestDelay: 0,
  resumeOffset: 0,
  maxScanned: 50000,

  proxyConfiguration: {
    useApifyProxy: false,
  },
};


// ---------------------------------------------------------------------------
// DEV CACHE - a build-time convenience, off by default.
//
// With DEV_CACHE=true in .env the first scrape is saved to .dev-cache.json and
// reused on every page refresh, so iterating on the UI costs no Apify runs.
// The Sync button still forces a live run, and the UI labels cached results.
//
// Remove DEV_CACHE from .env (or set it to false) for the real experience:
// a genuine scrape on every Browse marketplace click, nothing stored.
// ---------------------------------------------------------------------------

const DEV_CACHE = process.env.DEV_CACHE === "true";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_CACHE_PATH = path.join(__dirname, ".dev-cache.json");

let lastScrapeAt = null;
let servedFromCache = false;

// A browser refresh mid-scrape used to abandon the request and start a second
// actor run, so no run ever finished and nothing was ever cached. Callers that
// arrive while a run is in progress now join that run instead of starting another.
let inFlight = null;

async function readDevCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(DEV_CACHE_PATH, "utf-8"));
    return Array.isArray(parsed?.data) && parsed.data.length ? parsed : null;
  } catch (err) {
    return null;
  }
}

async function writeDevCache(data, scrapedAt) {
  try {
    await fs.writeFile(
      DEV_CACHE_PATH,
      JSON.stringify({ scrapedAt, count: data.length, data }, null, 2)
    );
  } catch (err) {
    console.error("[DEV_CACHE] could not write:", err.message);
  }
}

/**
 * Listings for the UI.
 *
 * Runs the Apify actor, unless DEV_CACHE is on and a cache exists and the caller
 * did not ask for a refresh.
 */
export async function getBusinesses({ forceRefresh = false } = {}) {
  if (DEV_CACHE && !forceRefresh) {
    const cached = await readDevCache();
    if (cached) {
      lastScrapeAt = cached.scrapedAt;
      servedFromCache = true;
      console.log(
        `[DEV_CACHE] Served ${cached.data.length} listings from .dev-cache.json ` +
        `(scraped ${cached.scrapedAt}). Press Sync for a live run.`
      );
      return cached.data;
    }
  }

  if (inFlight) {
    console.log("[scrape] a run is already in progress - joining it instead of starting another.");
    return inFlight;
  }

  inFlight = (async () => {
    const businesses = await scrapeWhop();
    lastScrapeAt = new Date().toISOString();
    servedFromCache = false;
    if (DEV_CACHE) {
      await writeDevCache(businesses, lastScrapeAt);
      console.log("[DEV_CACHE] Saved this run to .dev-cache.json for the next refresh.");
    }
    return businesses;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** When the listings currently in play were scraped. */
export async function getLastSync() {
  return lastScrapeAt;
}

/** Whether the last response came from the dev cache rather than a live run. */
export function wasCached() {
  return servedFromCache;
}

export const devCacheEnabled = DEV_CACHE;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov)(\?|$)/i;

/**
 * Apify returns a mixed images array: stills and mp4 previews.
 * Returns the first real still, or null.
 */
export function firstStill(images) {
  for (const entry of images || []) {
    if (entry?.isVideo) continue;
    const url = entry?.image?.original;
    if (typeof url === "string" && url && !VIDEO_EXT.test(url)) return url;
  }
  return null;
}

/**
 * Some listings ship only video previews (Elite Options Pro, for one), so the
 * creator's avatar stands in. Still real artwork from the same listing.
 */
export function ownerAvatar(owner) {
  const found = JSON.stringify(owner || {}).match(/https?:\/\/[^"\ ]+/g) || [];
  return found.find((u) => IMAGE_EXT.test(u)) || null;
}

/** The best image a listing can offer, or null when it truly has none. */
export function listingImage(item) {
  return firstStill(item?.images) || ownerAvatar(item?.owner) || null;
}

/** Where the Apify credits actually get spent. */
async function scrapeWhop() {
  try {
    console.log(`Starting Apify Actor (${SEARCH_URLS.length} searches)...`);

    // Run Actor and wait for completion
    const run = await client
      .actor("nhbOZ2tINefMqzaz6")
      .call(input);

    console.log("Apify Actor finished.");
    console.log("Dataset ID:", run.defaultDatasetId);

    // Get results from Actor dataset
    const { items } = await client
      .dataset(run.defaultDatasetId)
      .listItems();

    console.log(`Received ${items.length} results from Apify.`);

    // Convert Apify data to the format expected by your frontend
    const businesses = items.map((item) => {
      // Trace the listing back to the search that surfaced it, when the actor says
      const source = SEARCH_URLS.find(
        (s) => item.searchQuery === s.query || String(item.sourceUrl || "") === s.url
      );
      const niche = classify(item, source ? source.query : "");

      return {
        // Product identification
        id:
          item.productId ||
          item.id ||
          item.whopId ||
          item.url,

        // Product name
        name:
          item.title ||
          item.name ||
          "Unknown Product",

        // Price
        price:
          item.currentPriceUsd !== undefined &&
          item.currentPriceUsd !== null
            ? `$${item.currentPriceUsd}`
            : "",

        // Niche: our own id, so the UI filter and the template matcher agree
        category: niche.id,
        categoryLabel: niche.label,

        // What Whop itself called it, kept for reference
        whopCategory: item.categoryName || item.category || null,

        // Seller / company
        seller:
          item.companyTitle ||
          item.company?.title ||
          item.owner?.name ||
          "Unknown Seller",

        // Commission
        commission:
          item.affiliate?.commission ||
          item.affiliate?.commissionRate ||
          item.commission ||
          0,

        // Description / headline
        headline:
          item.headline ||
          item.description ||
          "",

        description:
          item.description ||
          item.headline ||
          "",

        // Whop URL
        link:
          item.url ||
          item.productUrl ||
          "",

        // Additional data
        reviewsAverage:
          item.reviewsAverage || 0,

        members:
          item.companyMemberCount || 0,

        affiliate:
          item.affiliate || null,

        plans:
          item.plans || [],

        images:
          item.images || [],

        // First non-video still, for the newsletter hero
        imageUrl: listingImage(item),

        socials:
          item.socials || [],

        owner:
          item.owner || null,

        companyDetails:
          item.companyDetails || null,

        growthMetrics:
          item.growthMetrics || null,
      };
    });

    // Keep at most PER_NICHE listings in each niche. Results arrive in Whop's
    // "trending" order, so the first ones through are the strongest.
    const kept = [];
    const perNiche = new Map();
    for (const b of businesses) {
      const n = perNiche.get(b.category) || 0;
      if (n >= PER_NICHE) continue;
      perNiche.set(b.category, n + 1);
      kept.push(b);
    }

    const spread = Object.fromEntries(
      NICHES.map((n) => [n.id, perNiche.get(n.id) || 0])
    );
    if (perNiche.get("general")) spread.general = perNiche.get("general");

    console.log(`Scraped ${businesses.length}, kept ${kept.length}.`);
    console.log("Listings per niche:", spread);

    const short = NICHES.filter((n) => (perNiche.get(n.id) || 0) < PER_NICHE);
    if (short.length) {
      console.warn(
        `Short of ${PER_NICHE}: ${short.map((n) => n.id).join(", ")}. ` +
        `Raise \`limit\` in apifyScraper.js or add queries in niches.js.`
      );
    }

    return kept;

  } catch (error) {
    console.error("Apify scraping failed:");
    console.error(error);

    throw error;
  }
}