# Smart Executive Mail MCP Server

An **AI Chief of Staff** for institution principals. Transforms raw email data into institutional intelligence.

## Features

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Proactive Executive Intelligence** | Predicts urgent actions, delayed responses, recurring workflows, and decision bottlenecks — before you ask |
| F2 | **AI Digital Twin of the Institution** | Live operational model of departments, communication flows, hidden issues, and escalation risks |
| F3 | **Knowledge Graph & Workflow Intelligence** | Graph of people, relationships, projects, departments, priorities built from email history |
| F4 | **Executive Command Center** | Natural-language queries: "Show pending approvals", "Which dept is most stressed?", "Find accreditation discussions" |

---

## Requirements

- **Node.js 18+** (uses native ES modules — no npm install needed)
- Your email data exported as a **JSON array** (same schema as your `.mbox` export)

---

## Quick Start

```bash
# Run the test suite first
node test/test-runner.js

# Start the MCP server (stdio mode)
node src/index.js
```

---

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "smart-mail-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/smart-mail-mcp/src/index.js"]
    }
  }
}
```

Then restart Claude Desktop. The tools will appear automatically.

---

## Claude Code Configuration

```bash
# Add to your project
claude mcp add smart-mail-mcp node /absolute/path/to/smart-mail-mcp/src/index.js
```

---

## Available Tools

### `load_emails`
Ingest your email JSON export. Call this first.
```json
{
  "emails": [ /* your email array */ ],
  "reset": false
}
```

### `executive_query`
Natural-language command center. Examples:
- `"Show pending approvals"`
- `"Which department has maximum workload?"`
- `"Summarize today's important events"`
- `"Find all discussions about accreditation"`
- `"What issues are escalating silently?"`
- `"What bottlenecks are affecting approvals?"`
- `"Who are the key coordinators keeping placements moving?"`
- `"What communication gaps exist between departments?"`
- `"Full briefing"`

### `get_predictions`
F1: Proactive predictions — upcoming urgent actions, stalled threads, recurring workflows due.
```json
{ "urgency_filter": "critical" }   // all | critical | high | medium
```

### `get_digital_twin`
F2: Full institutional digital twin.
```json
{ "section": "departments" }  // full | departments | issues | escalations | coordinators | gaps | insights
```

### `get_knowledge_graph`
F3: Knowledge graph snapshot.
```json
{ "view": "people", "limit": 20 }  // summary | people | threads | departments | projects | full
```

### `get_daily_briefing`
Morning executive briefing — critical items, pending approvals, bottlenecks.

### `search_emails`
Full-text search across threads and emails.
```json
{ "query": "NAAC accreditation", "priority_filter": "high", "limit": 10 }
```

### `get_department_health`
Department workload, stress scores, activity status.
```json
{ "department": "Placement" }
```

### `get_escalations`
Active escalation risks and hidden operational issues.

### `get_key_coordinators`
Most critical people — those whose absence would most disrupt operations.
```json
{ "department": "Placement", "limit": 5 }
```

---

## Email JSON Schema

Your email objects should have these fields (all optional except `subject` and `from`):

```json
{
  "subject": "URGENT: Budget Approval Required",
  "from": "hod.cs@college.edu",
  "to": "principal@college.edu",
  "cc": "dean@college.edu",
  "date": "2026-03-20T13:59:45+00:00",
  "body": "Plain text or HTML body",
  "message_id": "<unique-id@domain>"
}
```

The server automatically:
- Strips HTML from body
- Classifies priority (high / medium / normal / low)
- Detects topics (Accreditation, Placement, Budget, Faculty, etc.)
- Infers departments
- Builds relationship graph

---

## Architecture

```
src/
├── index.js          # Entry point — bootstraps all engines
├── mcp-server.js     # MCP stdio transport (JSON-RPC 2.0, no external deps)
├── knowledge-graph.js # F3: People, threads, depts, projects, edges
├── behavior-engine.js # F1: Pattern analysis & proactive predictions
├── digital-twin.js   # F2: Live institutional operational model
├── command-center.js  # F4: Natural language query routing
└── utils.js          # Email parsing, priority classification, topic detection

test/
└── test-runner.js    # Full test suite with sample institutional emails
```

---

## Example Workflow with Claude

1. Export your mbox as JSON (one email object per array element)
2. Tell Claude: *"Load these emails into the smart-mail-mcp server"* → use `load_emails`
3. Ask: *"What needs my attention today?"* → `get_daily_briefing`
4. Ask: *"Which department is most stressed this month?"* → `executive_query`
5. Ask: *"Find all pending approvals older than 5 days"* → `get_predictions`
6. Ask: *"Show me the full institutional status report"* → `get_digital_twin`

---

## License
MIT
# LeaderDashboard
# LeaderDashboard
# LeaderDashboard
