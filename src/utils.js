/**
 * Utility helpers for the Smart Mail MCP server
 */

// ── Email Metadata Extraction ─────────────────────────────────────────────────

export function extractEmailMeta(email) {
  const from    = normalizeAddress(email.from);
  const toRaw   = email.to || "";
  const ccRaw   = email.cc || "";
  const to      = toRaw.split(",").map(normalizeAddress).filter(Boolean);
  const cc      = ccRaw.split(",").map(normalizeAddress).filter(Boolean);
  const subject = email.subject || "(no subject)";
  const body    = email.body ? stripHTML(email.body) : (email.html_body ? stripHTML(email.html_body) : "");
  const date    = parseDate(email.date);
  const priority = classifyPriority(subject, body, email.from);
  const topics   = detectTopics(subject + " " + body);

  return { from, to, cc, subject, body, date, priority, topics, messageId: email.message_id };
}

export function normalizeAddress(raw) {
  if (!raw) return null;
  // Handle "Name <email@domain>" format
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();
  return raw.toLowerCase().trim().replace(/[<>]/g, "");
}

export function stripHTML(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  try { return new Date(dateStr); } catch { return new Date(0); }
}

// ── Priority Classification ───────────────────────────────────────────────────

const HIGH_PRIORITY_SIGNALS = [
  "urgent", "asap", "immediately", "critical", "deadline", "overdue",
  "approval required", "action required", "pending approval", "escalat",
  "important", "priority", "risk", "alert", "warning", "immediate attention",
  "board", "accreditation", "compliance", "regulatory", "legal",
];

const LOW_PRIORITY_SIGNALS = [
  "newsletter", "subscription", "offer", "sale", "discount", "promo",
  "unsubscribe", "marketing", "advertisement",
];

export function classifyPriority(subject, body, from) {
  const text = (subject + " " + body).toLowerCase();
  const fromStr = (from || "").toLowerCase();

  // Marketing/promo senders → low
  const promoSenders = ["noreply", "no-reply", "newsletter", "marketing", "alerts.", "info@alerts"];
  if (promoSenders.some(s => fromStr.includes(s))) return "low";

  const highScore = HIGH_PRIORITY_SIGNALS.filter(s => text.includes(s)).length;
  const lowScore  = LOW_PRIORITY_SIGNALS.filter(s => text.includes(s)).length;

  if (highScore >= 2) return "high";
  if (highScore === 1 && lowScore === 0) return "medium";
  if (lowScore > 0) return "low";
  return "normal";
}

// ── Topic Detection ──────────────────────────────────────────────────────────

const TOPIC_PATTERNS = [
  { topic: "Accreditation",   patterns: ["naac", "nba", "accreditation", "aacsb", "nirf"] },
  { topic: "Placement",       patterns: ["placement", "recruiter", "internship", "campus recruitment", "job offer", "hire"] },
  { topic: "Exam & Results",  patterns: ["exam", "result", "grade", "cgpa", "sgpa", "mark", "score", "evaluation"] },
  { topic: "Research",        patterns: ["research", "publication", "conference", "journal", "grant", "phd"] },
  { topic: "Budget Approval", patterns: ["budget", "fund", "expenditure", "invoice", "finance", "approval", "sanction"] },
  { topic: "Faculty",         patterns: ["faculty", "professor", "hod", "department head", "staff meeting", "leave"] },
  { topic: "Student Affairs", patterns: ["student", "grievance", "hostel", "disciplinary", "club", "fest"] },
  { topic: "Infrastructure",  patterns: ["lab", "equipment", "maintenance", "facility", "construction", "repair"] },
  { topic: "Syllabus",        patterns: ["syllabus", "curriculum", "course", "module", "timetable", "schedule"] },
  { topic: "Compliance",      patterns: ["compliance", "legal", "statutory", "regulation", "audit", "inspection"] },
];

export function detectTopics(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const { topic, patterns } of TOPIC_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) found.push(topic);
  }
  return found.length > 0 ? found : ["General"];
}

// ── Time Helpers ──────────────────────────────────────────────────────────────

export function formatDate(date) {
  if (!date || !(date instanceof Date)) return "Unknown";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function daysSince(date) {
  if (!date) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

export function hourOfDay(date) {
  if (!date) return -1;
  return date.getHours();
}

export function dayOfWeek(date) {
  if (!date) return -1;
  return date.getDay(); // 0=Sun
}

// ── Text Helpers ──────────────────────────────────────────────────────────────

export function truncate(str, len = 200) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

export function toPercent(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}
