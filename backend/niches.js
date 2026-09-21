/**
 * The single source of truth for niches.
 *
 * Every layer agrees on these ids: the Apify scraper tags each listing with one,
 * the frontend filter pills send one, and templateMatcher picks a newsletter from one.
 *
 * `queries`  - what to search Whop's marketplace for, so each niche has real listings.
 * `keywords` - what to look for in a listing to decide which niche it belongs to.
 */

/** How many listings to keep per niche. 4 niches x 9 = 36 in the UI. */
export const PER_NICHE = 9;

export const NICHES = [
  {
    id: "trading",
    label: "Trading & Bets",
    template: "trading.html",
    queries: ["trading", "crypto", "sports betting picks"],
    keywords: [
      "trading", "trader", "forex", "crypto", "bitcoin", "stocks", "options",
      "signals", "betting", "picks", "invest", "futures", "day trade", "scalp",
    ],
  },
  {
    id: "business",
    label: "Business & Coaching",
    template: "business.html",
    queries: ["business coaching", "e-commerce", "dropshipping"],
    keywords: [
      "business", "coach", "coaching", "consulting", "mentorship", "agency",
      "freelanc", "e-commerce", "ecommerce", "dropship", "amazon fba", "sales",
      "entrepreneur", "saas", "reselling", "flipping",
    ],
  },
  {
    id: "marketing",
    label: "Marketing & UGC",
    template: "marketing.html",
    queries: ["marketing", "ugc creator", "social media growth"],
    keywords: [
      "marketing", "reels", "faceless", "social media", "growth", "viral", "ugc",
      "seo", "traffic", "content creator", "tiktok", "youtube", "instagram",
      "copywriting", "ads", "affiliate",
    ],
  },
  {
    id: "fitness",
    label: "Fitness & Health",
    template: "fitness.html",
    queries: ["fitness", "weight loss coaching", "gym program"],
    keywords: [
      "fitness", "gym", "workout", "training program", "strength", "bodybuild",
      "health", "meal prep", "diet", "nutrition", "weight loss", "muscle", "wellness",
    ],
  },
];

export const GENERAL = {
  id: "general",
  label: "General",
  template: "general.html",
  keywords: [],
};

export const ALL_NICHES = [...NICHES, GENERAL];

function countHits(haystack, keywords) {
  if (!haystack) return 0;
  return keywords.reduce((n, k) => (haystack.includes(k) ? n + 1 : n), 0);
}

/**
 * Decide which niche a scraped listing belongs to.
 *
 * Whop's own categoryName is the strongest signal but it is free text ("Trading",
 * "E-commerce", sometimes empty), so the title and description are scored too, and
 * the search term that surfaced the listing acts as a tie-breaker.
 */
export function classify(item = {}, sourceQuery = "") {
  const category = String(item.categoryName || item.category || "").toLowerCase();
  const title = String(item.title || item.name || "").toLowerCase();
  const blurb = String(item.description || item.headline || "").toLowerCase();
  const query = String(sourceQuery || "").toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const niche of NICHES) {
    const score =
      countHits(category, niche.keywords) * 4 +
      countHits(title, niche.keywords) * 2 +
      countHits(blurb, niche.keywords) * 1 +
      countHits(query, niche.keywords) * 2;

    if (score > bestScore) {
      best = niche;
      bestScore = score;
    }
  }

  return best || GENERAL;
}

/** Look a niche up by its id, for anything that already carries one. */
export function nicheById(id = "") {
  const key = String(id).toLowerCase();
  return ALL_NICHES.find((n) => n.id === key) || GENERAL;
}

/** Which newsletter template a category string should use. */
export function templateFor(category = "") {
  const key = String(category || "").toLowerCase();

  // Already one of our ids (the normal path once the scraper has tagged a listing)
  const exact = ALL_NICHES.find((n) => n.id === key);
  if (exact) return exact.template;

  // Otherwise treat it as free text and keyword-match it
  const matched = NICHES.find((n) => n.keywords.some((k) => key.includes(k)));
  return matched ? matched.template : GENERAL.template;
}
