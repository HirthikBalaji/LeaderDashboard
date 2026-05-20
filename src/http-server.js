/**
 * Smart Executive Mail — Universal HTTP + OpenAPI Server
 * =======================================================
 * Exposes every MCP tool as a REST endpoint using only Node.js built-ins.
 *
 * GET  /openapi.json          → Full OpenAPI 3.1 spec (importable by any tool)
 * GET  /docs                  → Swagger UI (browser)
 * POST /api/load_emails        → Ingest email JSON array
 * POST /api/executive_query    → Natural-language institutional query
 * GET  /api/predictions        → Proactive executive intelligence
 * GET  /api/digital_twin       → AI digital twin of the institution
 * GET  /api/knowledge_graph    → Knowledge graph snapshot
 * GET  /api/daily_briefing     → Morning executive brief
 * POST /api/search_emails      → Full-text email search
 * GET  /api/department_health  → Department workload analysis
 * GET  /api/escalations        → Escalation risks & hidden issues
 * GET  /api/key_coordinators   → Key people & coordinators
 * GET  /health                 → Health check
 */

import http from "node:http";
import { URL } from "node:url";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { BehaviorEngine }  from "./behavior-engine.js";
import { DigitalTwin }     from "./digital-twin.js";
import { CommandCenter }   from "./command-center.js";
import { OllamaEngine }    from "./ollama-engine.js";

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// ── Engine singletons ─────────────────────────────────────────────────────────
const kg = new KnowledgeGraph();
const be = new BehaviorEngine(kg);
const dt = new DigitalTwin(kg);
const ai = new OllamaEngine("llama3.2");
const cc = new CommandCenter(kg, be, dt, ai);

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function requireData() {
  if (kg.rawEmails.length === 0) {
    throw { status: 422, message: "No emails loaded. POST /api/load_emails first." };
  }
}

function getQueryParam(url, key, defaultVal = undefined) {
  return url.searchParams.get(key) ?? defaultVal;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  const url  = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (path === "/health" && method === "GET") {
      return json(res, 200, {
        status: "ok",
        server: "smart-mail-mcp",
        version: "1.0.0",
        emailsLoaded: kg.rawEmails.length,
        uptime: process.uptime(),
      });
    }

    // ── OpenAPI spec ────────────────────────────────────────────────────────
    if (path === "/openapi.json" && method === "GET") {
      return json(res, 200, buildOpenAPISpec(req));
    }

    // ── Swagger UI ──────────────────────────────────────────────────────────
    if (path === "/docs" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(buildSwaggerUI(req));
    }

    // ── Dashboard ───────────────────────────────────────────────────────────
    if (path === "/" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(buildDashboard(req));
    }

    // ── API routes ──────────────────────────────────────────────────────────
    if (path === "/api/load_emails" && method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.emails)) throw { status: 400, message: "emails must be an array" };
      if (body.reset) {
        kg.people.clear(); kg.threads.clear(); kg.departments.clear();
        kg.projects.clear(); kg.edges.length = 0; kg.timeline.length = 0;
        kg.rawEmails.length = 0; be.patterns = {}; be.predictions = []; dt._model = null;
      }
      kg.ingestEmails(body.emails);
      be.analyzePatterns();
      dt.build();
      return json(res, 200, {
        status: "success",
        message: `Loaded ${body.emails.length} email(s). Knowledge graph built.`,
        stats: {
          emails: kg.rawEmails.length,
          people: kg.people.size,
          threads: kg.threads.size,
          departments: kg.departments.size,
          projects: kg.projects.size,
          predictions: be.predictions.length,
        },
      });
    }

    if (path === "/api/executive_query" && method === "POST") {
      requireData();
      const body = await readBody(req);
      if (!body.query) throw { status: 400, message: "query is required" };
      const result = await cc.query(body.query);
      return json(res, 200, result);
    }

    if (path === "/api/predictions" && method === "GET") {
      requireData();
      const filter = getQueryParam(url, "urgency", "all");
      const preds  = be.getPredictions();
      const result = filter === "all" ? preds : preds.filter(p => p.urgency === filter);
      return json(res, 200, { totalPredictions: result.length, predictions: result });
    }

    if (path === "/api/digital_twin" && method === "GET") {
      requireData();
      const section = getQueryParam(url, "section", "full");
      const model   = dt.getFullModel();
      if (section === "full") return json(res, 200, model);
      const map = {
        departments: "departments", issues: "operationalIssues",
        escalations: "escalationRisks", coordinators: "keyCoordinators",
        gaps: "communicationGaps", insights: "strategicInsights",
      };
      return json(res, 200, { section, data: model[map[section]] ?? [] });
    }

    if (path === "/api/knowledge_graph" && method === "GET") {
      requireData();
      const view  = getQueryParam(url, "view", "summary");
      const limit = parseInt(getQueryParam(url, "limit", "20"));
      const full  = kg.serialize();
      if (view === "full") return json(res, 200, full);
      if (view === "summary") return json(res, 200, {
        emailCount: full.emailCount, peopleCount: full.people.length,
        threadCount: full.threads.length, deptCount: full.departments.length,
        topPeople: full.people.slice(0, 5),
        topDepts:  full.departments.slice(0, 5),
        topProjects: full.projects.sort((a,b) => b.mentionCount - a.mentionCount).slice(0, 5),
      });
      const sectionMap = { people: "people", threads: "threads", departments: "departments", projects: "projects" };
      return json(res, 200, (full[sectionMap[view]] || []).slice(0, limit));
    }

    if (path === "/api/daily_briefing" && method === "GET") {
      requireData();
      return json(res, 200, be.getDailyBriefing());
    }

    if (path === "/api/search_emails" && method === "POST") {
      requireData();
      const body   = await readBody(req);
      const { query, priority_filter = "all", limit = 10 } = body;
      if (!query) throw { status: 400, message: "query is required" };
      const threads = kg.searchByTopic(query);
      let emails = kg.rawEmails.filter(e => {
        const text = ((e.subject || "") + " " + (e._meta?.body || "")).toLowerCase();
        return query.toLowerCase().split(/\s+/).some(k => k.length > 2 && text.includes(k));
      });
      if (priority_filter !== "all") emails = emails.filter(e => e._meta?.priority === priority_filter);
      return json(res, 200, {
        query, totalFound: threads.length + emails.length,
        threadMatches: threads.slice(0, limit).map(t => ({
          subject: t.subject, priority: t.priority,
          participants: [...t.participants].slice(0, 4), topics: [...t.topics],
        })),
        emailMatches: emails.slice(0, limit).map(e => ({
          subject: e.subject, from: e.from, date: e.date,
          priority: e._meta?.priority,
          preview: (e._meta?.body || "").slice(0, 200),
        })),
      });
    }

    if (path === "/api/department_health" && method === "GET") {
      requireData();
      const dept  = getQueryParam(url, "department");
      const depts = dt.getDepartmentHealth();
      if (dept) {
        const found = depts.find(d => d.name.toLowerCase().includes(dept.toLowerCase()));
        return json(res, 200, found || { error: `Department "${dept}" not found`, available: depts.map(d => d.name) });
      }
      return json(res, 200, { departments: depts });
    }

    if (path === "/api/escalations" && method === "GET") {
      requireData();
      return json(res, 200, {
        escalationRisks:   dt.getEscalationRisks(),
        operationalIssues: dt.getOperationalIssues(),
        criticalPredictions: be.getPredictions().filter(p => p.urgency === "critical"),
      });
    }

    if (path === "/api/key_coordinators" && method === "GET") {
      requireData();
      const dept  = getQueryParam(url, "department");
      const limit = parseInt(getQueryParam(url, "limit", "10"));
      let coords  = dt.getKeyCoordinators();
      if (dept) coords = coords.filter(c => c.departments.some(d => d.toLowerCase().includes(dept.toLowerCase())));
      return json(res, 200, { coordinators: coords.slice(0, limit), total: coords.length });
    }

    if (path === "/api/ai_curation" && method === "GET") {
      requireData();
      const limit = parseInt(getQueryParam(url, "limit", "10"));
      const emails = kg.rawEmails.slice(0, limit).map(e => ({
        from: e.from,
        subject: e.subject,
        body: e._meta?.body || e.body || ""
      }));
      const curation = await ai.curateEmails(emails);
      return json(res, 200, { curation });
    }

    // 404
    return json(res, 404, { error: "Not found", path, availableRoutes: listRoutes() });

  } catch (err) {
    if (err.status) return json(res, err.status, { error: err.message });
    console.error(err);
    return json(res, 500, { error: err.message });
  }
}

// ── Dashboard HTML ────────────────────────────────────────────────────────────

function buildDashboard(req) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Executive Mail — Dashboard</title>
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --sidebar-bg: #ffffff;
            --danger: #ef4444;
            --warning: #f59e0b;
            --success: #10b981;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background-color: var(--bg); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }

        /* Sidebar */
        aside { width: 260px; background: var(--sidebar-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 1.5rem; }
        .logo { font-weight: 700; font-size: 1.25rem; color: var(--primary); margin-bottom: 2rem; display: flex; align-items: center; gap: 0.5rem; }
        nav { flex: 1; }
        nav ul { list-style: none; }
        nav li { margin-bottom: 0.5rem; }
        nav a { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; text-decoration: none; color: var(--text-muted); border-radius: 0.5rem; transition: all 0.2s; font-size: 0.95rem; }
        nav a:hover { background: #f1f5f9; color: var(--text-main); }
        nav a.active { background: #eff6ff; color: var(--primary); font-weight: 600; }
        
        .sidebar-footer { border-top: 1px solid var(--border); padding-top: 1.5rem; margin-top: auto; }
        .sidebar-footer a { color: var(--text-muted); text-decoration: none; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; }

        /* Main Content */
        main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        header { height: 64px; background: #ffffff; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; position: sticky; top: 0; z-index: 10; }
        .search-container { position: relative; width: 400px; }
        .search-container input { width: 100%; padding: 0.5rem 1rem 0.5rem 2.5rem; border: 1px solid var(--border); border-radius: 0.5rem; outline: none; transition: border-color 0.2s; }
        .search-container input:focus { border-color: var(--primary); }
        .search-container i { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); width: 16px; height: 16px; }

        .content { padding: 2rem; max-width: 1200px; margin: 0 auto; width: 100%; }
        
        /* Dashboard Grid */
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
        
        /* Cards */
        .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
        .card-title { font-size: 1rem; font-weight: 600; color: var(--text-main); }
        .card-icon { width: 40px; height: 40px; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: var(--primary); }

        /* Stats */
        .stat-value { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
        .stat-label { font-size: 0.875rem; color: var(--text-muted); }

        /* Predictions List */
        .prediction-meta { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
        .badge { font-size: 0.75rem; font-weight: 600; padding: 0.125rem 0.5rem; border-radius: 1rem; text-transform: uppercase; }
        .badge-critical { background: #fee2e2; color: #ef4444; }
        .badge-high { background: #ffedd5; color: #f59e0b; }
        .badge-medium { background: #f0fdf4; color: #10b981; }
        .badge-info { background: #e0f2fe; color: #0ea5e9; }
        .prediction-title { font-weight: 600; margin-bottom: 0.5rem; font-size: 1.1rem; }
        .prediction-detail { font-size: 0.875rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem; }

        /* Command Center / Chat */
        #view-command { height: calc(100vh - 120px); }
        .chat-container { display: flex; flex-direction: column; height: 100%; background: #fff; border: 1px solid var(--border); border-radius: 1rem; overflow: hidden; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
        .message { max-width: 80%; }
        .message.user { align-self: flex-end; }
        .message-content { padding: 1rem; border-radius: 1rem; font-size: 0.95rem; line-height: 1.5; }
        .message.ai .message-content { background: #f1f5f9; color: var(--text-main); border-bottom-left-radius: 0.25rem; }
        .message.user .message-content { background: var(--primary); color: #ffffff; border-bottom-right-radius: 0.25rem; }
        
        .chat-input-area { border-top: 1px solid var(--border); padding: 1.5rem; display: flex; gap: 0.75rem; background: #fff; }
        .chat-input-area input { flex: 1; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 0.5rem; outline: none; font-size: 1rem; }
        .chat-input-area input:focus { border-color: var(--primary); }
        .chat-input-area button { background: var(--primary); color: #ffffff; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 0.5rem; }
        .chat-input-area button:hover { background: var(--primary-hover); }

        /* Section Views */
        .section-view { display: none; animation: fadeIn 0.3s ease-out; }
        .section-view.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* Loading Bar */
        #loader { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: var(--primary); z-index: 100; display: none; }
        .loading-active #loader { display: block; animation: loading 2s infinite linear; }
        @keyframes loading { 0% { transform: scaleX(0); transform-origin: 0% 50%; } 50% { transform: scaleX(0.5); transform-origin: 0% 50%; } 100% { transform: scaleX(1); transform-origin: 100% 50%; } }

        .loader-inline { width: 16px; height: 16px; border: 2px solid #e2e8f0; border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s infinite linear; }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .prose h1, .prose h2, .prose h3 { margin-top: 1.5rem; margin-bottom: 1rem; color: var(--text-main); }
        .prose ul, .prose ol { padding-left: 1.5rem; margin-bottom: 1rem; }
        .prose li { margin-bottom: 0.5rem; }
    </style>
</head>
<body class="loading-active">
    <div id="loader"></div>
    <aside>
        <div class="logo">
            <i data-lucide="mail"></i>
            Smart Executive
        </div>
        <nav>
            <ul>
                <li><a href="#" onclick="showSection('briefing')" class="active" id="nav-briefing"><i data-lucide="layout-dashboard"></i> Daily Briefing</a></li>
                <li><a href="#" onclick="showSection('intelligence')" id="nav-intelligence"><i data-lucide="zap"></i> Intelligence</a></li>
                <li><a href="#" onclick="showSection('digital-twin')" id="nav-digital-twin"><i data-lucide="activity"></i> Digital Twin</a></li>
                <li><a href="#" onclick="showSection('knowledge')" id="nav-knowledge"><i data-lucide="database"></i> Knowledge Graph</a></li>
                <li><a href="#" onclick="showSection('ai-curation')" id="nav-ai-curation"><i data-lucide="brain-circuit"></i> AI Curation</a></li>
                <li><a href="#" onclick="showSection('command')" id="nav-command"><i data-lucide="message-square"></i> Command Center</a></li>
            </ul>
        </nav>
        <div class="sidebar-footer">
            <a href="https://blogs.hirthikbalaji.dpdns.org/HELIOS/" target="_blank"><i data-lucide="external-link"></i> API Documentation</a>
        </div>
    </aside>

    <main>
        <header>
            <div class="search-container">
                <i data-lucide="search"></i>
                <input type="text" placeholder="Search emails or ask anything..." id="global-search">
            </div>
            <div id="connection-status" style="font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--success);"></span>
                Server Online
            </div>
        </header>

        <div class="content">
            <!-- Daily Briefing Section -->
            <section id="view-briefing" class="section-view active">
                <div style="margin-bottom: 2rem;">
                    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a;">Executive Briefing</h1>
                    <p id="briefing-date" style="color: var(--text-muted); font-size: 1.1rem;"></p>
                </div>

                <div class="grid">
                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">Critical Actions</span>
                            <div class="card-icon" style="color: var(--danger); background: #fee2e2;"><i data-lucide="alert-circle"></i></div>
                        </div>
                        <div class="stat-value" id="count-critical">0</div>
                        <div class="stat-label">Require immediate attention</div>
                    </div>
                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">Pending Approvals</span>
                            <div class="card-icon" style="color: var(--warning); background: #ffedd5;"><i data-lucide="clock"></i></div>
                        </div>
                        <div class="stat-value" id="count-pending">0</div>
                        <div class="stat-label">Awaiting executive sign-off</div>
                    </div>
                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">Inst. Stability</span>
                            <div class="card-icon" style="color: var(--success); background: #f0fdf4;"><i data-lucide="shield-check"></i></div>
                        </div>
                        <div class="stat-value" id="avg-health">94%</div>
                        <div class="stat-label">Operational health index</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 2rem; border-left: 4px solid var(--primary);">
                    <div class="card-header">
                        <span class="card-title" style="display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="file-text"></i> Strategic Summary</span>
                    </div>
                    <p id="briefing-summary" style="line-height: 1.7; color: #334155; font-size: 1.05rem;">Analyzing institutional data for your morning brief...</p>
                </div>

                <h2 style="font-size: 1.25rem; margin-bottom: 1rem; font-weight: 600;">Priority Items</h2>
                <div id="briefing-items" class="grid"></div>
            </section>

            <!-- Intelligence Section -->
            <section id="view-intelligence" class="section-view">
                <div style="margin-bottom: 2rem;">
                    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a;">Proactive Intelligence</h1>
                    <p style="color: var(--text-muted); font-size: 1.1rem;">Behavior patterns and predicted institutional risks</p>
                </div>
                <div id="predictions-list" class="grid"></div>
            </section>

            <!-- Digital Twin Section -->
            <section id="view-digital-twin" class="section-view">
                <div style="margin-bottom: 2rem;">
                    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a;">Institutional Digital Twin</h1>
                    <p style="color: var(--text-muted); font-size: 1.1rem;">Live operational health across all departments</p>
                </div>
                <div id="dept-health-list" class="grid"></div>
            </section>

            <!-- Knowledge Section -->
            <section id="view-knowledge" class="section-view">
                <div style="margin-bottom: 2rem;">
                    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a;">Knowledge Graph</h1>
                    <p style="color: var(--text-muted); font-size: 1.1rem;">Structural intelligence derived from communication flows</p>
                </div>
                <div class="grid" style="grid-template-columns: 2fr 1fr;">
                    <div class="card">
                        <div class="card-header"><span class="card-title">Key Coordinators</span></div>
                        <div id="kg-coordinators" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
                    </div>
                    <div class="card">
                        <div class="card-header"><span class="card-title">Active Projects</span></div>
                        <div id="kg-projects" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
                    </div>
                </div>
            </section>

            <!-- AI Curation Section -->
            <section id="view-ai-curation" class="section-view">
                <div style="margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a;">AI Strategic Curation</h1>
                        <p style="color: var(--text-muted); font-size: 1.1rem;">Llama 3.2 powered strategic analysis of your latest communications</p>
                    </div>
                    <button onclick="loadAICuration()" class="card" style="padding: 0.5rem 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--primary);">
                        <i data-lucide="refresh-cw" style="width: 16px;"></i> Refresh Analysis
                    </button>
                </div>
                <div class="card" style="min-height: 400px; line-height: 1.6;">
                    <div id="ai-curation-content" style="color: #334155;">
                        Click refresh to generate a strategic analysis using Llama 3.2...
                    </div>
                </div>
            </section>

            <!-- Command Center Section -->
            <section id="view-command" class="section-view">
                <div class="chat-container">
                    <div class="chat-messages" id="chat-messages">
                        <div class="message ai">
                            <div class="message-content">
                                <strong>Welcome to the Command Center.</strong><br>
                                I am your Institutional AI. I can help you find information, analyze workload, or identify risks.<br><br>
                                <em>Try asking: "Which department is currently overloaded?" or "Find all emails regarding NAAC accreditation."</em>
                            </div>
                        </div>
                    </div>
                    <div class="chat-input-area">
                        <input type="text" id="chat-input" placeholder="Type your institutional query...">
                        <button id="chat-send">Execute <i data-lucide="send"></i></button>
                    </div>
                </div>
            </section>
        </div>
    </main>

    <script>
        lucide.createIcons();
        
        const API_BASE = '/api';
        let currentSection = 'briefing';
        
        async function apiFetch(endpoint, options = {}) {
            document.body.classList.add('loading-active');
            try {
                const response = await fetch(\`\${API_BASE}\${endpoint}\`, options);
                const data = await response.json();
                if (data.error && data.error.includes('No emails loaded')) {
                    document.getElementById('briefing-summary').innerHTML = '<span style="color: var(--danger)">No data loaded. Please use the /api/load_emails endpoint to ingest institution emails first.</span>';
                }
                return data;
            } catch (err) {
                console.error(err);
                return { error: 'Connection failed' };
            } finally {
                document.body.classList.remove('loading-active');
            }
        }

        function showSection(id) {
            currentSection = id;
            document.querySelectorAll('.section-view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
            
            document.getElementById('view-' + id).classList.add('active');
            document.getElementById('nav-' + id).classList.add('active');
            
            if (id === 'briefing') loadBriefing();
            if (id === 'intelligence') loadIntelligence();
            if (id === 'digital-twin') loadDigitalTwin();
            if (id === 'knowledge') loadKnowledge();
            if (id === 'ai-curation') loadAICuration();
            
            if (id === 'command') {
                setTimeout(() => document.getElementById('chat-input').focus(), 100);
            }
        }

        async function loadAICuration() {
            const container = document.getElementById('ai-curation-content');
            container.innerHTML = '<div style="display:flex; align-items:center; gap:0.5rem;"><div class="loader-inline"></div> Analyzing emails with Llama 3.2...</div>';
            
            const data = await apiFetch('/ai_curation');
            if (data.error) {
                container.innerHTML = '<span style="color: var(--danger)">' + data.error + '</span>';
                return;
            }
            
            if (data.curation) {
                container.innerHTML = '<div class="prose">' + marked.parse(data.curation) + '</div>';
            } else {
                container.innerHTML = 'No curation generated.';
            }
            lucide.createIcons();
        }

        async function loadBriefing() {
            const data = await apiFetch('/daily_briefing');
            if (data.error) return;
            
            document.getElementById('briefing-date').innerText = data.date || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            document.getElementById('briefing-summary').innerText = data.summary || 'No institutional summary available for today.';
            document.getElementById('count-critical').innerText = data.criticalItems?.length || 0;
            document.getElementById('count-pending').innerText = data.pendingApprovals?.length || 0;

            const items = document.getElementById('briefing-items');
            items.innerHTML = '';
            const allItems = [...(data.criticalItems || []), ...(data.highPriorityItems || [])].slice(0, 6);
            
            if (allItems.length === 0) {
                items.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No priority items for today.</div>';
            } else {
                allItems.forEach(p => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.innerHTML = \`
                        <div class="prediction-meta">
                            <span class="badge badge-\${p.urgency || 'medium'}">\${p.urgency}</span>
                        </div>
                        <div class="prediction-title" style="font-size: 1rem;">\${p.title}</div>
                        <div class="prediction-detail" style="margin-bottom: 0;">\${p.detail}</div>
                    \`;
                    items.appendChild(card);
                });
            }
        }

        async function loadIntelligence() {
            const data = await apiFetch('/predictions');
            const list = document.getElementById('predictions-list');
            list.innerHTML = '';
            
            if (!data.predictions?.length) {
                list.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align: center;">No intelligence patterns detected. Ingest more data to see predictions.</div>';
                return;
            }

            data.predictions.forEach(p => {
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = \`
                    <div class="prediction-meta">
                        <span class="badge badge-\${p.urgency || 'medium'}">\${p.urgency}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">\${p.type}</span>
                    </div>
                    <div class="prediction-title">\${p.title}</div>
                    <div class="prediction-detail">\${p.detail}</div>
                    <div style="padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.875rem; color: var(--primary); font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                        <i data-lucide="arrow-right-circle" style="width: 16px;"></i> Recommended: \${p.action}
                    </div>
                \`;
                list.appendChild(card);
            });
            lucide.createIcons();
        }

        async function loadDigitalTwin() {
            const data = await apiFetch('/department_health');
            const list = document.getElementById('dept-health-list');
            list.innerHTML = '';
            
            if (!data.departments?.length) {
                list.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align: center;">No department health data available.</div>';
                return;
            }

            data.departments.forEach(d => {
                const card = document.createElement('div');
                card.className = 'card';
                const stressColor = d.stressScore > 70 ? 'var(--danger)' : (d.stressScore > 40 ? 'var(--warning)' : 'var(--success)');
                card.innerHTML = \`
                    <div class="card-header">
                        <span class="card-title">\${d.name}</span>
                        <div class="card-icon"><i data-lucide="users"></i></div>
                    </div>
                    <div style="margin-bottom: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem; font-weight: 500;">
                            <span>Workload</span>
                            <span>\${d.workloadScore}%</span>
                        </div>
                        <div style="height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
                            <div style="width: \${d.workloadScore}%; height: 100%; background: var(--primary); border-radius: 4px;"></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem; font-weight: 500;">
                            <span>Stress Level</span>
                            <span style="color: \${stressColor}">\${d.stressScore}%</span>
                        </div>
                        <div style="height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
                            <div style="width: \${d.stressScore}%; height: 100%; background: \${stressColor}; border-radius: 4px;"></div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.875rem; color: var(--text-muted); padding-top: 1rem; border-top: 1px solid var(--border);">
                        <span>Status: <strong style="color: var(--text-main)">\${d.status}</strong></span>
                        <i data-lucide="info" style="width: 14px; cursor: help;"></i>
                    </div>
                \`;
                list.appendChild(card);
            });
            lucide.createIcons();
        }

        async function loadKnowledge() {
            const data = await apiFetch('/key_coordinators');
            const projectData = await apiFetch('/knowledge_graph?view=projects');
            
            const coordList = document.getElementById('kg-coordinators');
            coordList.innerHTML = data.coordinators?.map(c => \`
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: #f8fafc; border-radius: 0.5rem; border: 1px solid var(--border);">
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600;">\${c.name}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">\${c.departments.join(', ')}</span>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Centrality</div>
                        <div style="font-weight: 700; color: var(--primary);">\${c.centralityScore}</div>
                    </div>
                </div>
            \`).join('') || '<div style="color: var(--text-muted)">No coordinator data.</div>';

            const projectsList = document.getElementById('kg-projects');
            projectsList.innerHTML = projectData.map?.(p => \`
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    <span style="font-weight: 500;">\${p.name}</span>
                    <span class="badge badge-info">\${p.mentionCount} Mentions</span>
                </div>
            \`).join('') || '<div style="color: var(--text-muted)">No project data.</div>';
        }

        // Chat logic
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');
        const chatMessages = document.getElementById('chat-messages');

        async function sendQuery() {
            const query = chatInput.value.trim();
            if (!query) return;

            chatInput.value = '';
            appendMessage('user', query);

            const data = await apiFetch('/executive_query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (data.error) {
                appendMessage('ai', '<strong>Error:</strong> ' + data.error);
            } else {
                const htmlContent = marked.parse(data.summary);
                appendMessage('ai', \`<div style="font-weight: 700; margin-bottom: 0.5rem; color: var(--primary);">\${data.title}</div><div class="prose">\${htmlContent}</div>\`);
            }

        }

        function appendMessage(role, text) {
            const msg = document.createElement('div');
            msg.className = 'message ' + role;
            msg.innerHTML = \`<div class="message-content">\${text}</div>\`;
            chatMessages.appendChild(msg);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        chatSend.onclick = sendQuery;
        chatInput.onkeypress = (e) => { if (e.key === 'Enter') sendQuery(); };

        document.getElementById('global-search').onkeypress = (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value;
                showSection('command');
                chatInput.value = query;
                sendQuery();
                e.target.value = '';
            }
        };

        // Initial load
        loadBriefing();
    </script>
</body>
</html>`;
}

// ── OpenAPI 3.1 Spec ──────────────────────────────────────────────────────────

function buildOpenAPISpec(req) {
  const base = `http://${req.headers.host}`;
  return {
    openapi: "3.1.0",
    info: {
      title: "Smart Executive Mail API",
      version: "1.0.0",
      description: "AI Chief of Staff for institution principals. Transforms email data into institutional intelligence across 4 features: Proactive Executive Intelligence, AI Digital Twin, Knowledge Graph, and Executive Command Center.",
      contact: { name: "Smart Mail MCP", url: "https://github.com/your-org/smart-mail-mcp" },
    },
    servers: [{ url: base, description: "Local server" }],
    tags: [
      { name: "Setup",      description: "Load and initialize email data" },
      { name: "F1 – Intelligence", description: "Proactive Executive Intelligence: predictions & behavior patterns" },
      { name: "F2 – Digital Twin", description: "AI Digital Twin of the Institution" },
      { name: "F3 – Knowledge",    description: "Knowledge Graph & Workflow Intelligence" },
      { name: "F4 – Command",      description: "Executive Command Center: natural-language queries" },
      { name: "Utility",    description: "Health and meta endpoints" },
    ],
    paths: {

      "/health": {
        get: {
          tags: ["Utility"],
          summary: "Server health check",
          operationId: "getHealth",
          responses: {
            "200": { description: "Server is running", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } } },
          },
        },
      },

      "/api/load_emails": {
        post: {
          tags: ["Setup"],
          summary: "Load email data",
          description: "Ingest an array of email objects. Builds the knowledge graph, behavior patterns, and digital twin. Call this before any other endpoint.",
          operationId: "loadEmails",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoadEmailsRequest" },
                example: {
                  emails: [
                    {
                      subject: "URGENT: NAAC Accreditation Documents Pending",
                      from: "principal@college.edu",
                      to: "hod.cs@college.edu",
                      cc: "dean@college.edu",
                      date: "2026-03-18T10:00:00Z",
                      body: "Please submit all accreditation documents by Friday.",
                      message_id: "<001@college.edu>",
                    },
                  ],
                  reset: false,
                },
              },
            },
          },
          responses: {
            "200": { description: "Emails loaded and graph built", content: { "application/json": { schema: { $ref: "#/components/schemas/LoadEmailsResponse" } } } },
            "400": { description: "Invalid request body" },
          },
        },
      },

      "/api/executive_query": {
        post: {
          tags: ["F4 – Command"],
          summary: "Natural-language executive query",
          description: "Ask anything about your institution in plain English. The AI routes your query to the right analytical engine.\n\nExample queries:\n- \"Show pending approvals\"\n- \"Which department has maximum workload?\"\n- \"Find all discussions about accreditation\"\n- \"What issues are escalating silently?\"\n- \"Who are the key coordinators for placements?\"",
          operationId: "executiveQuery",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QueryRequest" },
                example: { query: "Which department has maximum workload?" },
              },
            },
          },
          responses: {
            "200": { description: "Query result", content: { "application/json": { schema: { $ref: "#/components/schemas/QueryResponse" } } } },
            "400": { description: "Missing query field" },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/predictions": {
        get: {
          tags: ["F1 – Intelligence"],
          summary: "Get proactive predictions",
          description: "Returns AI-generated predictions about upcoming urgent actions, delayed responses, recurring workflows due soon, and decision bottlenecks — before you even ask.",
          operationId: "getPredictions",
          parameters: [
            {
              name: "urgency",
              in: "query",
              description: "Filter by urgency level",
              schema: { type: "string", enum: ["all", "critical", "high", "medium"], default: "all" },
            },
          ],
          responses: {
            "200": { description: "List of predictions", content: { "application/json": { schema: { $ref: "#/components/schemas/PredictionsResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/digital_twin": {
        get: {
          tags: ["F2 – Digital Twin"],
          summary: "Get institutional digital twin",
          description: "Returns the live operational model of the institution: department health, communication flows, hidden issues, escalation risks, key coordinators, and strategic insights.",
          operationId: "getDigitalTwin",
          parameters: [
            {
              name: "section",
              in: "query",
              description: "Which section to return",
              schema: { type: "string", enum: ["full", "departments", "issues", "escalations", "coordinators", "gaps", "insights"], default: "full" },
            },
          ],
          responses: {
            "200": { description: "Digital twin data", content: { "application/json": { schema: { $ref: "#/components/schemas/DigitalTwinResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/knowledge_graph": {
        get: {
          tags: ["F3 – Knowledge"],
          summary: "Get knowledge graph",
          description: "Returns the graph of people, relationships, projects, departments, threads, and priorities built from email analysis.",
          operationId: "getKnowledgeGraph",
          parameters: [
            {
              name: "view",
              in: "query",
              description: "Which slice of the graph to return",
              schema: { type: "string", enum: ["summary", "people", "threads", "departments", "projects", "full"], default: "summary" },
            },
            {
              name: "limit",
              in: "query",
              description: "Max items per category",
              schema: { type: "integer", default: 20 },
            },
          ],
          responses: {
            "200": { description: "Knowledge graph data", content: { "application/json": { schema: { $ref: "#/components/schemas/KnowledgeGraphResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/daily_briefing": {
        get: {
          tags: ["F1 – Intelligence"],
          summary: "Get daily executive briefing",
          description: "Returns a concise morning briefing: critical items, pending approvals, recurring workflows due today, active bottlenecks, and top predictions.",
          operationId: "getDailyBriefing",
          responses: {
            "200": { description: "Daily briefing", content: { "application/json": { schema: { $ref: "#/components/schemas/DailyBriefingResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/search_emails": {
        post: {
          tags: ["F3 – Knowledge"],
          summary: "Search emails and threads",
          description: "Full-text search across all loaded emails and threads by topic, keyword, person name, or department.",
          operationId: "searchEmails",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchRequest" },
                example: { query: "NAAC accreditation", priority_filter: "high", limit: 10 },
              },
            },
          },
          responses: {
            "200": { description: "Search results", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } },
            "400": { description: "Missing query" },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/department_health": {
        get: {
          tags: ["F2 – Digital Twin"],
          summary: "Get department health",
          description: "Returns workload, stress scores, and activity status for all departments. Identifies overloaded, silent, or at-risk departments.",
          operationId: "getDepartmentHealth",
          parameters: [
            {
              name: "department",
              in: "query",
              description: "Filter to a specific department name (partial match)",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Department health data", content: { "application/json": { schema: { $ref: "#/components/schemas/DepartmentHealthResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/escalations": {
        get: {
          tags: ["F2 – Digital Twin"],
          summary: "Get escalation risks",
          description: "Returns active escalation risks, silently growing issues, high-priority stalled threads, and hidden operational problems.",
          operationId: "getEscalations",
          responses: {
            "200": { description: "Escalation data", content: { "application/json": { schema: { $ref: "#/components/schemas/EscalationsResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

      "/api/key_coordinators": {
        get: {
          tags: ["F2 – Digital Twin"],
          summary: "Get key coordinators",
          description: "Identifies the most important connectors in the institution — people whose absence would most disrupt operations.",
          operationId: "getKeyCoordinators",
          parameters: [
            {
              name: "department",
              in: "query",
              description: "Filter to a specific department",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              description: "Number of coordinators to return",
              schema: { type: "integer", default: 10 },
            },
          ],
          responses: {
            "200": { description: "Coordinator data", content: { "application/json": { schema: { $ref: "#/components/schemas/CoordinatorsResponse" } } } },
            "422": { description: "No emails loaded" },
          },
        },
      },

    },

    components: {
      schemas: {
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            server: { type: "string", example: "smart-mail-mcp" },
            version: { type: "string", example: "1.0.0" },
            emailsLoaded: { type: "integer", example: 250 },
            uptime: { type: "number", description: "Server uptime in seconds" },
          },
        },
        Email: {
          type: "object",
          required: ["subject", "from"],
          properties: {
            subject:    { type: "string", example: "URGENT: NAAC Accreditation Pending" },
            from:       { type: "string", example: "hod.cs@college.edu" },
            to:         { type: "string", example: "principal@college.edu" },
            cc:         { type: "string", nullable: true },
            date:       { type: "string", format: "date-time" },
            body:       { type: "string", description: "Plain text or HTML body" },
            message_id: { type: "string" },
          },
        },
        LoadEmailsRequest: {
          type: "object",
          required: ["emails"],
          properties: {
            emails: { type: "array", items: { $ref: "#/components/schemas/Email" } },
            reset:  { type: "boolean", default: false, description: "Clear existing data before loading" },
          },
        },
        LoadEmailsResponse: {
          type: "object",
          properties: {
            status:  { type: "string" },
            message: { type: "string" },
            stats: {
              type: "object",
              properties: {
                emails: { type: "integer" }, people: { type: "integer" },
                threads: { type: "integer" }, departments: { type: "integer" },
                projects: { type: "integer" }, predictions: { type: "integer" },
              },
            },
          },
        },
        QueryRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", example: "Which department has maximum workload?" },
          },
        },
        QueryResponse: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "not_found"] },
            title:  { type: "string" },
            summary: { type: "string" },
          },
          additionalProperties: true,
          description: "Response shape varies by query intent. Always includes status, title, and summary.",
        },
        Prediction: {
          type: "object",
          properties: {
            type:   { type: "string" },
            urgency: { type: "string", enum: ["critical", "high", "medium", "info"] },
            title:  { type: "string" },
            detail: { type: "string" },
            action: { type: "string" },
          },
        },
        PredictionsResponse: {
          type: "object",
          properties: {
            totalPredictions: { type: "integer" },
            predictions: { type: "array", items: { $ref: "#/components/schemas/Prediction" } },
          },
        },
        DigitalTwinResponse: {
          type: "object",
          additionalProperties: true,
          description: "Full operational model or a named section of it.",
        },
        KnowledgeGraphResponse: {
          type: "object",
          additionalProperties: true,
          description: "Knowledge graph data — shape varies by view parameter.",
        },
        DailyBriefingResponse: {
          type: "object",
          properties: {
            date:    { type: "string" },
            summary: { type: "string" },
            criticalItems: { type: "array", items: { $ref: "#/components/schemas/Prediction" } },
            highPriorityItems: { type: "array", items: { $ref: "#/components/schemas/Prediction" } },
            pendingApprovals: { type: "array", items: { type: "object" } },
            recurringDue:    { type: "array", items: { type: "object" } },
            bottlenecks:     { type: "array", items: { type: "object" } },
          },
        },
        SearchRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query:           { type: "string" },
            priority_filter: { type: "string", enum: ["all", "high", "medium", "normal", "low"], default: "all" },
            limit:           { type: "integer", default: 10 },
          },
        },
        SearchResponse: {
          type: "object",
          properties: {
            query:         { type: "string" },
            totalFound:    { type: "integer" },
            threadMatches: { type: "array", items: { type: "object" } },
            emailMatches:  { type: "array", items: { type: "object" } },
          },
        },
        DepartmentHealthResponse: {
          type: "object",
          properties: {
            departments: { type: "array", items: { type: "object" } },
          },
        },
        EscalationsResponse: {
          type: "object",
          properties: {
            escalationRisks:     { type: "array", items: { type: "object" } },
            operationalIssues:   { type: "array", items: { type: "object" } },
            criticalPredictions: { type: "array", items: { $ref: "#/components/schemas/Prediction" } },
          },
        },
        CoordinatorsResponse: {
          type: "object",
          properties: {
            coordinators: { type: "array", items: { type: "object" } },
            total: { type: "integer" },
          },
        },
      },
    },
  };
}

// ── Swagger UI HTML ───────────────────────────────────────────────────────────

function buildSwaggerUI(req) {
  const specUrl = `http://${req.headers.host}/openapi.json`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Smart Executive Mail API — Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css">
  <style>
    body { margin: 0; background: #ffffff; font-family: 'Inter', sans-serif; }
    .swagger-ui .topbar { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 10px 0; }
    .swagger-ui .topbar .link { display: none; }
    .swagger-ui .info .title { color: #2563eb !important; font-weight: 700; }
    .swagger-ui .opblock.opblock-get { background: rgba(37, 99, 235, 0.05); border-color: #2563eb; }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #2563eb; }
    .swagger-ui .opblock.opblock-post { background: rgba(16, 185, 129, 0.05); border-color: #10b981; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #10b981; }
    .swagger-ui .scheme-container { background: #f8fafc; box-shadow: none; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script>
    SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      tryItOutEnabled: true,
      supportedSubmitMethods: ["get","post","put","delete","patch"],
    });
  </script>
</body>
</html>`;
}

// ── Route list for 404 helper ─────────────────────────────────────────────────

function listRoutes() {
  return [
    "GET  /health",
    "GET  /openapi.json",
    "GET  /docs",
    "POST /api/load_emails",
    "POST /api/executive_query",
    "GET  /api/predictions?urgency=all|critical|high|medium",
    "GET  /api/digital_twin?section=full|departments|issues|escalations|coordinators|gaps|insights",
    "GET  /api/knowledge_graph?view=summary|people|threads|departments|projects|full&limit=20",
    "GET  /api/daily_briefing",
    "POST /api/search_emails",
    "GET  /api/department_health?department=<name>",
    "GET  /api/escalations",
    "GET  /api/key_coordinators?department=<name>&limit=10",
  ];
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`\n🚀 Smart Executive Mail API running`);
  console.log(`   REST:    http://localhost:${PORT}/api/`);
  console.log(`   Docs:    http://localhost:${PORT}/docs`);
  console.log(`   OpenAPI: http://localhost:${PORT}/openapi.json`);
  console.log(`   Health:  http://localhost:${PORT}/health\n`);
});
