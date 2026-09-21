import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { TEMPLATES, resolveTemplate, defaultTemplateFor, templateByFile } from "./templateCatalog.js";
import { sendNewsletter, mailStatus, verifyMailbox } from "./gmail.js";
import { getBusinesses, getLastSync, wasCached, devCacheEnabled, listingImage } from "./apifyScraper.js";
import { withAffiliate } from "./affiliate.js";
import {
  hashPassword, verifyPassword, createSession, sessionUser, destroySession,
  encryptionConfigured,
} from "./secrets.js";
import {
  findUser, createUser, recordLogin, isLegacy,
  saveMailbox, clearMailbox, mailboxFor, mailboxSummary,
  affiliateHandleFor, emailFor,
} from "./userStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the banner images are reachable from. Fine for local previews; set
// PUBLIC_URL to a real host before sending mail anyone else has to open.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`)
  .replace(/\/+$/, "");
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

/** Reads the bearer token and attaches req.username, or 401s. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const username = sessionUser(token);

  if (!username) {
    return res.status(401).json({ error: "Not signed in" });
  }

  req.username = username;
  req.token = token;
  next();
}

// Helper to fill template tokens
export const BANNER_CID = "themebanner";

/** Which banner file a category uses. */
export function bannerFor(category = "") {
  const niche = ["trading", "business", "marketing", "fitness"]
    .includes(String(category).toLowerCase()) ? String(category).toLowerCase() : "general";
  return { niche, file: path.join(__dirname, "..", "frontend", "img", `theme-${niche}.png`) };
}

function fillTemplate(templateHtml, params) {
  const {
    businessName = "Recommended Program",
    link = "https://whop.com",
    headline = "Discover game-changing resources on Whop",
    price = "",
    seller = "Whop Creator",
    senderName = "Whop Affiliate Agent",
    category = "",
    forEmail = false,
  } = params;

  // A banner drawn for the niche, not the listing's own artwork - Whop listings
  // mostly carry creator selfies and video stills, which read badly in a newsletter.
  // In the browser the banner is fetched over http. In a real email it is
  // attached to the message and referenced by Content-ID, so it renders without
  // the recipient being able to reach this machine - and without the remote-image
  // fetch that mail clients block and spam filters count against you.
  const { niche } = bannerFor(category);
  const imageUrl = forEmail
    ? `cid:${BANNER_CID}`
    : `${PUBLIC_URL}/img/theme-${niche}.png`;

  // Complete <img> tags, or empty strings. Templates can't branch, so the
  // decision is made here and a listing with no image renders without one.
  //
  // Each comes in the width its slot expects: Outlook obeys the width ATTRIBUTE
  // and ignores max-width, so a 600px tag dropped into a 96px column tears the
  // table apart. Templates pick the token that matches their layout.
  const img = (w, extra = "") =>
    imageUrl
      ? `<img src="${imageUrl}" alt="${businessName}" width="${w}" style="width:100%;max-width:${w}px;height:auto;display:block;border:0;outline:none;text-decoration:none;${extra}">`
      : "";

  const heroImage = img(600);
  const sideImage = img(230, "border-radius:10px;");
  const avatarImage = img(96, "border-radius:12px;");

  // Collapses to nothing when a listing has no price, so templates never show
  // a dangling separator like "Creator: Brando Le · "
  const priceLine = price ? ` · ${price}` : "";

  return templateHtml
    .replaceAll("{{heroImage}}", heroImage)
    .replaceAll("{{sideImage}}", sideImage)
    .replaceAll("{{avatarImage}}", avatarImage)
    .replaceAll("{{imageUrl}}", imageUrl || "")
    .replaceAll("{{priceLine}}", priceLine)
    .replaceAll("{{businessName}}", businessName)
    .replaceAll("{{referralLink}}", link)
    .replaceAll("{{headline}}", headline || "Discover game-changing resources on Whop")
    .replaceAll("{{price}}", price || "")
    .replaceAll("{{sellerName}}", seller || "Whop Creator")
    .replaceAll("{{senderName}}", senderName);
}

// GET /api/businesses -> list real businesses directly from Whop API (with fallback)
app.get("/api/businesses", requireAuth, async (req, res) => {
  try {
    const category = req.query.category;
    // The Whop handle, which is a different thing from the login name -
    // empty when the user has not set one, and then links stay untagged
    // rather than carrying something Whop will not recognise.
    const username = await affiliateHandleFor(req.username);
    // Sync sends refresh=true, which forces a live run even when DEV_CACHE is on
    const forceRefresh = req.query.refresh === "true";
    let businesses = await getBusinesses({ forceRefresh });

    if (category && category !== "all") {
      businesses = businesses.filter(
        (b) => (b.category || "").toLowerCase() === category.toLowerCase()
      );
    }

    // Rows cached before imageUrl existed still carry the raw images array
    businesses = businesses.map((b) =>
      b.imageUrl ? b : { ...b, imageUrl: listingImage(b) }
    );

    // Credit every link to the signed-in affiliate
    if (username) {
      businesses = businesses.map((b) => ({
        ...b,
        rawLink: b.link,
        link: withAffiliate(b.link, username),
      }));
    }

    res.json({
      success: true,
      count: businesses.length,
      scrapedAt: await getLastSync(),
      cached: wasCached(),
      devCache: devCacheEnabled,
      affiliate: username || null,
      source: process.env.WHOP_API_KEY ? "whop-api" : "local-cache",
      data: businesses,
    });
  } catch (err) {
    console.error("Error loading businesses:", err);
    res.status(500).json({ error: "Could not load businesses: " + err.message });
  }
});

// GET /api/templates?category=trading -> the eight choices, and the auto-match
app.get("/api/templates", (req, res) => {
  const autoFile = defaultTemplateFor(req.query.category || "");
  const auto = templateByFile(autoFile);
  res.json({
    success: true,
    autoMatch: auto ? auto.id : "general",
    data: TEMPLATES.map(({ id, name, blurb, niche }) => ({ id, name, blurb, niche })),
  });
});

// GET /api/template-preview?category=fitness&name=...&link=...&headline=...&price=...&seller=...
app.get("/api/template-preview", async (req, res) => {
  try {
    const {
      category = "",
      name = "",
      link = "",
      headline = "",
      price = "",
      seller = "",
      image = "",
      sender = "You",
      username = "",
      template = "",
    } = req.query;

    // An explicit pick wins; anything unrecognised falls back to the auto-match
    const templateFile = resolveTemplate(template) || defaultTemplateFor(category);
    const raw = await fs.readFile(path.join(__dirname, "templates", templateFile), "utf-8");
    const filled = fillTemplate(raw, {
      businessName: name,
      category,
      link: withAffiliate(link, username),
      headline,
      price,
      seller,
      senderName: sender,
    });

    const meta = templateByFile(templateFile);
    res.json({ templateFile, templateId: meta ? meta.id : null, html: filled });
  } catch (err) {
    console.error("Error generating template preview:", err);
    res.status(500).json({ error: "Failed to render template preview: " + err.message });
  }
});

// GET /api/mail-status -> can this instance actually deliver mail?
app.get("/api/mail-status", requireAuth, async (req, res) => {
  try {
    // Deliberately no fallback to the server's own .env credentials. In a
    // multi-user deployment that would tell a user they are connected while
    // their mail would actually leave from the operator's account.
    const mailbox = await mailboxFor(req.username);

    if (mailbox) {
      return res.json({
        success: true,
        configured: true,
        method: "user-mailbox",
        account: mailbox.user,
      });
    }

    res.json({
      success: true,
      configured: false,
      method: null,
      reason: "No mailbox connected. Connect your own email account to send.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/register  { username, password }
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body || {};
  const handle = String(username || "").trim();
  const address = String(email || "").trim();

  if (!handle) {
    return res.status(400).json({ error: "Whop username is required" });
  }
  if (handle.includes("@")) {
    return res.status(400).json({
      error: "That looks like an email. Your Whop username is the handle, with no @.",
    });
  }
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(handle)) {
    return res.status(400).json({
      error: "Whop username: 2-40 letters, numbers, dots, dashes or underscores.",
    });
  }
  if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const result = await createUser(handle, hashPassword(password), address);
    if (!result.ok) {
      return res.status(409).json({ error: "That username is taken. Sign in instead." });
    }

    const user = await recordLogin(username);
    const token = createSession(user.username);

    res.json({
      success: true,
      token,
      user: { username: user.username, email: user.email, loginCount: user.loginCount },
      mailbox: null,
    });
  } catch (err) {
    console.error("Register failed:", err);
    res.status(500).json({ error: "Could not create the account" });
  }
});

// POST /api/login  { username, password }
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const existing = await findUser(username);

    if (!existing) {
      return res.status(401).json({ error: "No account with that username" });
    }

    // Pre-auth records have no password; whoever registers that name claims it
    if (isLegacy(existing)) {
      return res.status(409).json({
        error: "That name was used before accounts existed. Create a password for it.",
        needsRegister: true,
      });
    }

    if (!verifyPassword(password, existing.passwordHash)) {
      return res.status(401).json({ error: "Wrong password" });
    }

    const user = await recordLogin(existing.username);
    const token = createSession(user.username);

    res.json({
      success: true,
      token,
      isReturning: (user.loginCount || 0) > 1,
      user: {
        username: user.username,
        email: user.email || "",
        loginCount: user.loginCount,
      },
      mailbox: await mailboxSummary(user.username),
    });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ error: "Could not sign in" });
  }
});

// POST /api/logout
app.post("/api/logout", requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ success: true });
});

// GET /api/mailbox -> what this user has connected (never the password)
app.get("/api/mailbox", requireAuth, async (req, res) => {
  res.json({
    success: true,
    encryptionReady: encryptionConfigured(),
    whopUsername: await affiliateHandleFor(req.username),
    email: await emailFor(req.username),
    mailbox: await mailboxSummary(req.username),
  });
});

// PUT /api/mailbox  { address, password, fromName, host?, port? }
app.put("/api/mailbox", requireAuth, async (req, res) => {
  const { address, password, fromName, host, port } = req.body || {};

  if (!address || !password) {
    return res.status(400).json({ error: "Email address and password are required" });
  }
  if (!encryptionConfigured()) {
    return res.status(500).json({
      error: "ENCRYPTION_KEY is not set on the server, so credentials can't be stored safely.",
    });
  }

  // Gmail is the common case; anything else needs its own SMTP host
  const isGmail = /@(gmail|googlemail)\.com$/i.test(String(address));
  const smtpHost = host || (isGmail ? "smtp.gmail.com" : null);
  const smtpPort = Number(port) || 465;

  if (!smtpHost) {
    return res.status(400).json({
      error: "That isn't a Gmail address, so an SMTP host is needed too.",
    });
  }

  try {
    const verified = await verifyMailbox({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      user: address,
      pass: password,
    });

    if (!verified.ok) {
      return res.status(400).json({ error: verified.error });
    }

    await saveMailbox(req.username, {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      user: address,
      pass: password,
      fromName: fromName || "",
    });

    res.json({ success: true, mailbox: await mailboxSummary(req.username) });
  } catch (err) {
    console.error("Mailbox save failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mailbox
app.delete("/api/mailbox", requireAuth, async (req, res) => {
  await clearMailbox(req.username);
  res.json({ success: true, mailbox: null });
});

// POST /api/send  { businessName, category, link, headline, price, seller, leadEmail, subject }
app.post("/api/send", requireAuth, async (req, res) => {
  const {
    businessName,
    category,
    link,
    headline,
    price,
    seller,
    leadEmail,
    subject,
    senderName,
    username,
    template,
    image,
  } = req.body;

  if (!leadEmail) {
    return res.status(400).json({ error: "leadEmail is required" });
  }

  try {
    const templateFile = resolveTemplate(template) || defaultTemplateFor(category);
    const raw = await fs.readFile(path.join(__dirname, "templates", templateFile), "utf-8");
    const html = fillTemplate(raw, {
      forEmail: true,
      businessName: businessName || "",
      category: category || "",
      link: withAffiliate(link, username),
      headline: headline || "",
      price: price || "",
      seller: seller || "",
      senderName: senderName || "You",
    });

    // The banner travels with the message instead of being fetched from this
    // machine, so it renders for the recipient and triggers no remote-image load.
    const banner = bannerFor(category);
    const attachments = [];
    try {
      await fs.access(banner.file);
      attachments.push({ filename: `${banner.niche}.png`, path: banner.file, cid: BANNER_CID });
    } catch (err) {
      console.warn(`Banner missing for ${banner.niche}; sending without it.`);
    }

    const mailbox = await mailboxFor(req.username);
    if (!mailbox) {
      return res.status(400).json({
        error: "No mailbox connected. Connect your email account before sending.",
        needsMailbox: true,
      });
    }

    const result = await sendNewsletter({
      to: leadEmail,
      subject: subject || `Thought you'd like ${businessName || "this recommendation"}`,
      html,
      senderName: senderName || "You",
      attachments,
      mailbox,
    });

    res.json({
      success: true,
      messageId: result.id,
      previewUrl: result.previewUrl || null,
      simulated: !!result.simulated,
      note: result.note || null,
    });
  } catch (err) {
    console.error("Error sending newsletter:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
