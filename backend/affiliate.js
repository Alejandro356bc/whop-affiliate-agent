// Whop affiliate links carry the referrer's username in the `a` query param:
//   https://whop.com/discover/elite-options/elite-options/?a=<username>
// and Whop's generic signup link is https://whop.com/new/?a=<username>.
//
// withAffiliate() stamps the logged-in user's username onto any product link so
// every campaign they send is credited to them.

const WHOP_FALLBACK = "https://whop.com/new/";

export function withAffiliate(link, username) {
  const user = String(username || "").trim();
  const raw = String(link || "").trim();

  if (!user) return raw;

  const target = raw || WHOP_FALLBACK;

  try {
    const url = new URL(target);
    // set() replaces an existing `a` rather than appending a second one
    url.searchParams.set("a", user);
    return url.toString();
  } catch (err) {
    // Not an absolute URL - fall back to plain string surgery, keeping any #hash last
    const [beforeHash, ...hashParts] = target.split("#");
    const hash = hashParts.length ? "#" + hashParts.join("#") : "";

    const stripped = beforeHash
      .replace(/([?&])a=[^&]*/g, "$1")
      .replace(/[?&]+$/, "")
      .replace(/\?&/, "?");

    const separator = stripped.includes("?") ? "&" : "?";
    return `${stripped}${separator}a=${encodeURIComponent(user)}${hash}`;
  }
}
