/**
 * MCPServer – Minimal MCP stdio transport (no external SDK required)
 * ==================================================================
 * Implements the Model Context Protocol over stdin/stdout using
 * JSON-RPC 2.0. Compatible with Claude Desktop, Claude Code, and
 * any MCP-compliant client.
 *
 * Tools exposed:
 *  - load_emails          : Ingest email JSON array and build knowledge graph
 *  - get_predictions      : F1 – Proactive Executive Intelligence
 *  - get_digital_twin     : F2 – Full institutional digital twin
 *  - get_knowledge_graph  : F3 – Knowledge graph snapshot
 *  - executive_query      : F4 – Natural language command center query
 *  - get_daily_briefing   : Concise morning brief
 *  - search_emails        : Full-text email search
 *  - get_department_health: Department workload analysis
 *  - get_escalations      : Active escalation risks
 *  - get_key_coordinators : Identify critical people
 */

import { createInterface } from "readline";

const TOOL_DEFINITIONS = [
  {
    name: "load_emails",
    description: "Ingest an array of email objects (from your .mbox JSON export) to build the institutional knowledge graph. Must be called first before any analysis tools.",
    inputSchema: {
      type: "object",
      properties: {
        emails: {
          type: "array",
          description: "Array of email objects with fields: subject, from, to, cc, date, body, message_id",
          items: { type: "object" },
        },
        reset: {
          type: "boolean",
          description: "If true, clears existing data before loading. Default: false (append mode)",
        },
      },
      required: ["emails"],
    },
  },
  {
    name: "executive_query",
    description: "Natural-language executive command center. Ask anything about your institution: 'Show pending approvals', 'Which department is most stressed?', 'Find discussions about accreditation', 'What bottlenecks exist?', 'Who are the key coordinators for placements?'",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Your natural language question or command about the institution",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_predictions",
    description: "Feature 1: Proactive Executive Intelligence. Returns predictions about upcoming urgent actions, delayed responses, recurring workflows due soon, and decision bottlenecks — before you even ask.",
    inputSchema: {
      type: "object",
      properties: {
        urgency_filter: {
          type: "string",
          enum: ["all", "critical", "high", "medium"],
          description: "Filter predictions by urgency level. Default: all",
        },
      },
    },
  },
  {
    name: "get_digital_twin",
    description: "Feature 2: AI Digital Twin of the Institution. Returns a live operational model with department health, communication flows, hidden issues, escalation risks, key coordinators, and strategic insights.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["full", "departments", "issues", "escalations", "coordinators", "gaps", "insights"],
          description: "Which section of the digital twin to return. Default: full",
        },
      },
    },
  },
  {
    name: "get_knowledge_graph",
    description: "Feature 3: Knowledge Graph & Workflow Intelligence. Returns the graph of people, relationships, projects, departments, threads, and priorities built from email analysis.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["summary", "people", "threads", "departments", "projects", "full"],
          description: "Which part of the knowledge graph to return. Default: summary",
        },
        limit: {
          type: "number",
          description: "Max items to return per category (default: 20)",
        },
      },
    },
  },
  {
    name: "get_daily_briefing",
    description: "Returns the executive morning briefing: critical items, pending approvals, recurring workflows due today, active bottlenecks, and top predictions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_emails",
    description: "Full-text search across all loaded emails and threads by topic, keyword, person, or department.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term — topic, keyword, person name, or department",
        },
        priority_filter: {
          type: "string",
          enum: ["all", "high", "medium", "normal", "low"],
          description: "Filter results by priority. Default: all",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_department_health",
    description: "Returns detailed workload, stress scores, and status for all departments. Identifies overloaded, silent, or at-risk departments.",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          description: "Optional: filter to a specific department name",
        },
      },
    },
  },
  {
    name: "get_escalations",
    description: "Returns active escalation risks, silently growing issues, high-priority stalled threads, and hidden operational problems the principal may not be aware of.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_key_coordinators",
    description: "Identifies the most important connectors and coordinators in the institution — people whose absence would most disrupt operations.",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          description: "Optional: filter to a specific department",
        },
        limit: {
          type: "number",
          description: "Number of coordinators to return (default: 10)",
        },
      },
    },
  },
];

export class MCPServer {
  constructor(name, version, engines) {
    this.name    = name;
    this.version = version;
    this.kg      = engines.kg;
    this.be      = engines.be;
    this.dt      = engines.dt;
    this.cc      = engines.cc;
    this.initialized = false;
  }

  start() {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let buffer = "";

    rl.on("line", line => {
      buffer += line;
      try {
        const msg = JSON.parse(buffer);
        buffer = "";
        this._handleMessage(msg);
      } catch {
        // Accumulate multi-line JSON
      }
    });

    process.stdin.on("end", () => process.exit(0));
  }

  _send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  _reply(id, result) {
    this._send({ jsonrpc: "2.0", id, result });
  }

  _error(id, code, message) {
    this._send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  _handleMessage(msg) {
    const { id, method, params } = msg;

    switch (method) {
      case "initialize":
        this._reply(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: this.name, version: this.version },
        });
        break;

      case "initialized":
        // Notification — no reply needed
        break;

      case "tools/list":
        this._reply(id, { tools: TOOL_DEFINITIONS });
        break;

      case "tools/call":
        this._handleToolCall(id, params?.name, params?.arguments || {});
        break;

      default:
        this._error(id, -32601, `Unknown method: ${method}`);
    }
  }

  async _handleToolCall(id, toolName, args) {
    try {
      const result = await this._executeTool(toolName, args);
      this._reply(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      this._reply(id, {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  async _executeTool(name, args) {
    switch (name) {
      case "load_emails": {
        const { emails, reset = false } = args;
        if (!Array.isArray(emails)) throw new Error("emails must be an array");
        if (reset) {
          // Re-create engines (simple reset)
          this.kg.people.clear();
          this.kg.threads.clear();
          this.kg.departments.clear();
          this.kg.projects.clear();
          this.kg.edges.length = 0;
          this.kg.timeline.length = 0;
          this.kg.rawEmails.length = 0;
          this.be.patterns = {};
          this.be.predictions = [];
          this.dt._model = null;
        }
        this.kg.ingestEmails(emails);
        this.be.analyzePatterns();
        this.dt.build();
        return {
          status: "success",
          message: `Loaded ${emails.length} email(s). Knowledge graph built.`,
          stats: {
            emails: this.kg.rawEmails.length,
            people: this.kg.people.size,
            threads: this.kg.threads.size,
            departments: this.kg.departments.size,
            projects: this.kg.projects.size,
            predictions: this.be.predictions.length,
          },
        };
      }

      case "executive_query": {
        const { query } = args;
        if (!query) throw new Error("query is required");
        this._requireData();
        return await this.cc.query(query);
      }

      case "get_predictions": {
        this._requireData();
        const preds = this.be.getPredictions();
        const filter = args.urgency_filter || "all";
        const filtered = filter === "all" ? preds : preds.filter(p => p.urgency === filter);
        return {
          totalPredictions: filtered.length,
          predictions: filtered,
          generatedAt: new Date().toISOString(),
        };
      }

      case "get_digital_twin": {
        this._requireData();
        const section = args.section || "full";
        const model = this.dt.getFullModel();
        if (section === "full") return model;
        const map = {
          departments: "departments",
          issues:      "operationalIssues",
          escalations: "escalationRisks",
          coordinators:"keyCoordinators",
          gaps:        "communicationGaps",
          insights:    "strategicInsights",
        };
        return { section, data: model[map[section]] };
      }

      case "get_knowledge_graph": {
        this._requireData();
        const view  = args.view || "summary";
        const limit = args.limit || 20;
        const full  = this.kg.serialize();
        if (view === "full") return full;
        if (view === "summary") return {
          emailCount:  full.emailCount,
          peopleCount: full.people.length,
          threadCount: full.threads.length,
          deptCount:   full.departments.length,
          projectCount: full.projects.length,
          topPeople:   full.people.slice(0, 5).map(p => ({ name: p.name, email: p.email, sent: p.sentCount, received: p.receivedCount })),
          topDepts:    full.departments.slice(0, 5).map(d => ({ name: d.name, emails: d.emailCount, stress: d.stressScore })),
          topProjects: full.projects.sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 5),
        };
        const sectionMap = { people: "people", threads: "threads", departments: "departments", projects: "projects" };
        return (full[sectionMap[view]] || []).slice(0, limit);
      }

      case "get_daily_briefing": {
        this._requireData();
        return this.be.getDailyBriefing();
      }

      case "search_emails": {
        this._requireData();
        const { query, priority_filter = "all", limit = 10 } = args;
        const threads = this.kg.searchByTopic(query);
        let emails = this.kg.rawEmails.filter(e => {
          const text = ((e.subject || "") + " " + (e._meta?.body || "")).toLowerCase();
          return query.toLowerCase().split(/\s+/).some(k => k.length > 2 && text.includes(k));
        });
        if (priority_filter !== "all") {
          emails = emails.filter(e => e._meta?.priority === priority_filter);
        }
        return {
          query,
          threadMatches: threads.slice(0, limit).map(t => ({
            subject: t.subject,
            priority: t.priority,
            messages: t.messages.length,
            participants: [...t.participants].slice(0, 4),
            topics: [...t.topics],
          })),
          emailMatches: emails.slice(0, limit).map(e => ({
            subject: e.subject,
            from: e.from,
            date: e.date,
            priority: e._meta?.priority,
            preview: (e._meta?.body || "").slice(0, 200),
          })),
          totalFound: threads.length + emails.length,
        };
      }

      case "get_department_health": {
        this._requireData();
        const { department } = args;
        const depts = this.dt.getDepartmentHealth();
        if (department) {
          const found = depts.find(d => d.name.toLowerCase().includes(department.toLowerCase()));
          return found || { error: `Department "${department}" not found.`, availableDepts: depts.map(d => d.name) };
        }
        return { departments: depts, summary: this.kg.getMostStressedDepts(3) };
      }

      case "get_escalations": {
        this._requireData();
        return {
          escalationRisks: this.dt.getEscalationRisks(),
          operationalIssues: this.dt.getOperationalIssues(),
          predictions: this.be.getPredictions().filter(p => p.urgency === "critical" || p.type === "bottleneck"),
          summary: `${this.dt.getEscalationRisks().length} active escalation risk(s) detected.`,
        };
      }

      case "get_key_coordinators": {
        this._requireData();
        const { department, limit = 10 } = args;
        let coordinators = this.dt.getKeyCoordinators();
        if (department) {
          coordinators = coordinators.filter(c =>
            c.departments.some(d => d.toLowerCase().includes(department.toLowerCase()))
          );
        }
        return { coordinators: coordinators.slice(0, limit), total: coordinators.length };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  _requireData() {
    if (this.kg.rawEmails.length === 0) {
      throw new Error("No emails loaded. Call load_emails first with your email JSON data.");
    }
  }
}
