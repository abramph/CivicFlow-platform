const crypto = require("crypto");
const { envFlag } = require("./config");

const SESSION_COOKIE = "civicflow_admin_session";
const SESSION_TTL_MS = Math.max(1, Number(process.env.ADMIN_SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;

function parseCookies(headerValue = "") {
  const cookies = {};
  String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const index = part.indexOf("=");
      if (index <= 0) return;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      cookies[name] = decodeURIComponent(value);
    });
  return cookies;
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function getSessionSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || "").trim();
}

function isAdminConfigured() {
  return !!String(process.env.ADMIN_USERNAME || "").trim()
    && !!String(process.env.ADMIN_PASSWORD || "").trim()
    && !!getSessionSecret();
}

function timingSafeMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateCredentials(username, password) {
  if (!isAdminConfigured()) return false;
  return timingSafeMatch(username, process.env.ADMIN_USERNAME)
    && timingSafeMatch(password, process.env.ADMIN_PASSWORD);
}

function signPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

function createSessionToken(username) {
  const payload = JSON.stringify({
    u: String(username || "").trim(),
    exp: Date.now() + SESSION_TTL_MS,
  });
  const encoded = base64UrlEncode(payload);
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

function readSession(req) {
  const cookies = parseCookies(req?.headers?.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature) return null;
  const expectedSignature = signPayload(encoded);
  if (!timingSafeMatch(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload?.u || !payload?.exp || Number(payload.exp) < Date.now()) {
      return null;
    }
    return {
      username: String(payload.u),
      expiresAt: Number(payload.exp),
    };
  } catch (_err) {
    return null;
  }
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || "")}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function shouldUseSecureCookies(req) {
  if (envFlag("ADMIN_SESSION_SECURE", false)) return true;
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" || req?.secure === true;
}

function setSessionCookie(res, req, username) {
  const token = createSessionToken(username);
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: shouldUseSecureCookies(req),
    maxAge: SESSION_TTL_MS / 1000,
  }));
}

function clearSessionCookie(res, req) {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: shouldUseSecureCookies(req),
    maxAge: 0,
  }));
}

function wantsJson(req) {
  const accept = String(req?.headers?.accept || "").toLowerCase();
  return req?.path?.startsWith("/admin/api")
    || req?.path?.startsWith("/api/admin")
    || accept.includes("application/json")
    || req?.xhr === true;
}

function requireAdminSession(req, res, next) {
  if (!isAdminConfigured()) {
    if (wantsJson(req)) {
      return res.status(503).json({ success: false, error: "Admin dashboard is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET." });
    }
    return res.status(503).send("Admin dashboard is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET.");
  }

  const session = readSession(req);
  if (!session) {
    if (wantsJson(req)) {
      return res.status(401).json({ success: false, error: "Admin authentication required." });
    }
    const nextUrl = encodeURIComponent(req.originalUrl || "/admin/licenses");
    return res.redirect(`/admin/login?next=${nextUrl}`);
  }

  req.adminSession = session;
  next();
}

module.exports = {
  SESSION_COOKIE,
  isAdminConfigured,
  validateCredentials,
  readSession,
  setSessionCookie,
  clearSessionCookie,
  requireAdminSession,
};
