/**
 * The newsletter templates a user can choose from.
 *
 * All six work for any niche; the campaign's category only decides which one
 * starts selected in the chooser. Each pulls the listing's own Whop image into
 * its hero via {{heroImage}}, which renders as nothing when a listing has none.
 *
 * Adding one: drop the .html in ./templates and add an entry here.
 */

export const TEMPLATES = [
  { id: "sample1", file: "sample1.html", name: "Sample 1", blurb: "Dark masthead, full-width hero, orange button." },
  { id: "sample2", file: "sample2.html", name: "Sample 2", blurb: "Editorial serif on warm paper, pull quote above the image." },
  { id: "sample3", file: "sample3.html", name: "Sample 3", blurb: "Two columns, image beside the headline, teal button." },
  { id: "sample4", file: "sample4.html", name: "Sample 4", blurb: "Deep navy, framed image, sky-blue accent bar." },
  { id: "sample5", file: "sample5.html", name: "Sample 5", blurb: "Magazine cover, image first, serif headline, rust label." },
  { id: "sample6", file: "sample6.html", name: "Sample 6", blurb: "Green banner, avatar thumbnail, why-I-picked-it panel." },
  { id: "plain", file: "plain.html", name: "Plain email", blurb: "Looks like a message you typed yourself. Lands in Primary far more often." },
];

/**
 * Which template a campaign's niche pre-selects in the chooser.
 * The user can pick any of the six regardless.
 */
const NICHE_DEFAULT = {
  trading: "sample1",
  business: "sample3",
  marketing: "sample5",
  fitness: "sample6",
  general: "sample2",
};

const BY_FILE = new Map(TEMPLATES.map((t) => [t.file, t]));
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/**
 * Resolve a user-chosen template to a filename.
 *
 * Accepts an id ("sample3") or a filename ("sample3.html"). Returns null for
 * anything unrecognised, so a bad value falls back to the default instead of
 * being used to read an arbitrary path.
 */
export function resolveTemplate(choice = "") {
  const key = String(choice || "").trim().toLowerCase();
  if (!key) return null;
  if (BY_ID.has(key)) return BY_ID.get(key).file;
  if (BY_FILE.has(key)) return BY_FILE.get(key).file;
  return null;
}

/** The template a category starts on. Always returns a real file. */
export function defaultTemplateFor(category = "") {
  const id = NICHE_DEFAULT[String(category || "").trim().toLowerCase()] || "sample1";
  return BY_ID.get(id).file;
}

/** Which catalog entry a filename belongs to. */
export function templateByFile(file = "") {
  return BY_FILE.get(String(file)) || null;
}
