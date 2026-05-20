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

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// ── Engine singletons ─────────────────────────────────────────────────────────
const kg = new KnowledgeGraph();
const be = new BehaviorEngine(kg);
const dt = new DigitalTwin(kg);
const cc = new CommandCenter(kg, be, dt);

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
      return json(res, 200, cc.query(body.query));
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

    // 404
    return json(res, 404, { error: "Not found", path, availableRoutes: listRoutes() });

  } catch (err) {
    if (err.status) return json(res, err.status, { error: err.message });
    console.error(err);
    return json(res, 500, { error: err.message });
  }
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
    body { margin: 0; background: #0f0f0f; }
    .swagger-ui .topbar { background: #1a1a2e; }
    .swagger-ui .topbar .link { display: none; }
    .swagger-ui .info .title { color: #7c3aed; }
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
