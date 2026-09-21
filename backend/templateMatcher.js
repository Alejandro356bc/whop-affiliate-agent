/**
 * Maps a business's category/niche to one of the template files in ./templates.
 *
 * The niche definitions (ids, keywords, which template each one uses) live in
 * ./niches.js so the scraper, the UI filter and this matcher can't drift apart.
 * Add a niche there, not here.
 */

import { templateFor } from "./niches.js";

export function matchTemplate(category = "") {
  return templateFor(category);
}
