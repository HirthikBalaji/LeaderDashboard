/**
 * CommandCenter – Feature 4: Executive Command Center
 * ====================================================
 * Handles natural-language queries from the principal.
 * Enhanced with RAG (Retrieval-Augmented Generation) using Ollama.
 */

import { truncate, daysSince } from "./utils.js";

export class CommandCenter {
  constructor(kg, be, dt, ai = null) {
    this.kg = kg;
    this.be = be;
    this.dt = dt;
    this.ai = ai; // OllamaEngine instance
  }

  /**
   * Main entry point — parses a natural language query and routes to the
   * correct handler. Now asynchronous to support AI generation.
   */
  async query(naturalLanguageQuery) {
    const q = naturalLanguageQuery.toLowerCase().trim();
    const intent = this._classifyIntent(q);

    // If AI is available and it's not a basic help/utility command, use RAG
    if (this.ai && !["help", "email_summary", "full_briefing"].includes(intent)) {
      return await this._ragQuery(naturalLanguageQuery);
    }

    return this._dispatch(intent, q, naturalLanguageQuery);
  }

  // ── Intent Classification ─────────────────────────────────────────────────

  _classifyIntent(q) {
    const matchers = [
      { intent: "pending_approvals",     patterns: ["pending approval", "pending", "approve", "waiting for approval", "sanction"] },
      { intent: "department_workload",   patterns: ["department", "workload", "maximum work", "overloaded", "most stress", "stress", "busiest"] },
      { intent: "today_summary",         patterns: ["today", "today's events", "summarize today", "morning brief", "daily brief", "what happened"] },
      { intent: "search_topic",          patterns: ["find", "search", "all discussion", "about", "related to", "topic", "accreditation", "placement", "compliance"] },
      { intent: "escalations",           patterns: ["escalat", "silent issue", "hidden issue", "unreported", "risk", "brewing"] },
      { intent: "bottlenecks",           patterns: ["bottleneck", "stuck", "delayed", "blocking", "approval delay", "slow"] },
      { intent: "key_people",            patterns: ["key coordinator", "who is responsible", "important person", "key person", "who runs", "coordinator", "placement moving"] },
      { intent: "communication_gaps",    patterns: ["communication gap", "not talking", "silent department", "no communication"] },
      { intent: "email_summary",         patterns: ["summarize email", "email summary", "summarise"] },
      { intent: "full_briefing",         patterns: ["full briefing", "full report", "everything", "complete status"] },
      { intent: "department_detail",     patterns: ["show department", "department status", "department detail", "tell me about"] },
      { intent: "help",                  patterns: ["help", "what can you do", "commands", "how to use"] },
    ];

    for (const { intent, patterns } of matchers) {
      if (patterns.some(p => q.includes(p))) return intent;
    }
    return "search_topic"; // Default: treat as topic search
  }

  async _dispatch(intent, q, original) {
    switch (intent) {
      case "pending_approvals":   return this._pendingApprovals();
      case "department_workload": return this._departmentWorkload();
      case "today_summary":       return this._todaySummary();
      case "search_topic":        return this._searchTopic(original);
      case "escalations":         return this._escalations();
      case "bottlenecks":         return this._bottlenecks();
      case "key_people":          return this._keyPeople(q);
      case "communication_gaps":  return this._communicationGaps();
      case "email_summary":       return this._emailSummary(q);
      case "full_briefing":       return this._fullBriefing();
      case "department_detail":   return this._departmentDetail(q);
      case "help":                return this._help();
      default:                    return this._searchTopic(original);
    }
  }

  // ── RAG Implementation ────────────────────────────────────────────────────

  /**
   * Performs Retrieval-Augmented Generation:
   * 1. Retrieves relevant data from Knowledge Graph and Engines
   * 2. Formats as context
   * 3. Prompts Ollama (Llama 3.2) for a strategic answer
   */
  async _ragQuery(query) {
    // 1. Retrieval
    const stopWords = ["find", "show", "all", "me", "the", "about", "related", "to", "discussion", "what", "is", "are", "tell", "details"];
    const keywords = query.split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.includes(w.toLowerCase()))
      .join(" ");

    const searchTerm = keywords || query;
    
    // Get threads and emails
    const threads = this.kg.searchByTopic(searchTerm);
    const emails = this.kg.rawEmails.filter(e => {
      const text = ((e.subject || "") + " " + (e._meta?.body || "")).toLowerCase();
      return searchTerm.toLowerCase().split(/\s+/).some(k => k.length > 2 && text.includes(k));
    }).slice(0, 10);

    // Get relevant engine data if query matches certain patterns
    let extraContext = "";
    if (query.includes("workload") || query.includes("stress") || query.includes("department")) {
      const depts = this.dt.getDepartmentHealth();
      extraContext += `\nDepartment Health: ${JSON.stringify(depts.slice(0, 3))}`;
    }
    if (query.includes("risk") || query.includes("escalat") || query.includes("silent")) {
      const risks = this.dt.getEscalationRisks();
      extraContext += `\nEscalation Risks: ${JSON.stringify(risks)}`;
    }

    // 2. Context Construction
    const context = `
RELEVANT THREADS:
${threads.slice(0, 5).map(t => `- ${t.subject} (Participants: ${[...t.participants].join(", ")})`).join("\n")}

RELEVANT EMAILS:
${emails.map((e, i) => `[${i+1}] FROM: ${e.from} | SUBJECT: ${e.subject}\nBODY PREVIEW: ${truncate(e._meta?.body || e.body, 200)}`).join("\n\n")}

INSTITUTIONAL METRICS:
${extraContext}
    `.trim();

    const systemPrompt = `You are a professional Executive Chief of Staff AI for an institution principal.
You have access to the institution's communication "Knowledge Graph" and "Digital Twin" metrics.
Your goal is to answer queries based ONLY on the provided context.
If the information is not in the context, say you don't have enough data to answer precisely.
Always be professional, objective, and highlight risks or actions if found.
Keep the answer concise and formatted in Markdown.`;

    const prompt = `CONTEXT:\n${context}\n\nUSER QUERY: ${query}\n\nProvide a strategic answer based on the institutional data provided above.`;

    // 3. Generation
    const aiResponse = await this.ai.generate(prompt, systemPrompt);

    if (!aiResponse) {
      // Fallback to rule-based if AI fails
      const intent = this._classifyIntent(query.toLowerCase());
      return await this._dispatch(intent, query.toLowerCase(), query);
    }

    return {
      status: "ok",
      title: "🤖 AI Executive Intelligence",
      summary: aiResponse,
      sourceCount: threads.length + emails.length,
      isAiGenerated: true
    };
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  _pendingApprovals() {
    const patterns = this.be.getPatterns();
    const pending  = patterns.pendingApprovals || [];
    if (pending.length === 0) {
      return { status: "ok", message: "No pending approvals detected in recent emails.", items: [] };
    }
    return {
      status: "ok",
      title: `📋 Pending Approvals (${pending.length})`,
      items: pending.map(p => ({
        subject: p.subject,
        waitingDays: p.staleDays,
        involvedParties: p.participants?.slice(0, 4) || [],
        urgency: p.staleDays > 7 ? "Critical" : p.staleDays > 3 ? "High" : "Normal",
        recommendedAction: `Review and respond to "${p.subject}"`,
      })),
      summary: `${pending.filter(p => p.staleDays > 7).length} critical, ${pending.filter(p => p.staleDays <= 7).length} normal pending approvals.`,
    };
  }

  _departmentWorkload() {
    const depts = this.dt.getDepartmentHealth();
    return {
      status: "ok",
      title: "🏢 Department Workload Analysis",
      mostStressed: depts[0] || null,
      departments: depts.map(d => ({
        name: d.name,
        stressLevel: d.stressLevel,
        stressScore: d.stressScore,
        recentActivity: d.recentActivity,
        highPriorityIssues: d.highPriorityIssues,
        memberCount: d.memberCount,
        topTopics: d.topTopics,
        status: d.isActive ? "Active" : "Inactive",
        recommendation: d.stressScore > 60
          ? "⚠️ Needs immediate attention — consider resource reallocation."
          : d.stressScore > 30
          ? "📊 Moderate load — monitor closely."
          : "✅ Operating normally.",
      })),
      summary: `Most stressed: ${depts[0]?.name || "N/A"} (score: ${depts[0]?.stressScore || 0}). ${depts.filter(d => d.stressLevel === "High").length} department(s) under high stress.`,
    };
  }

  _todaySummary() {
    const briefing = this.be.getDailyBriefing();
    const recentActivity = this.kg.getRecentActivity(1);
    return {
      status: "ok",
      title: `📅 Today's Executive Briefing — ${briefing.date}`,
      summary: briefing.summary,
      emailsToday: recentActivity.length,
      criticalItems: briefing.criticalItems,
      highPriorityItems: briefing.highPriorityItems.slice(0, 5),
      pendingApprovals: briefing.pendingApprovals.slice(0, 3),
      upcomingWorkflows: briefing.recurringDue.map(r => ({
        name: r.subject,
        dueIn: r.dueInDays <= 0 ? `Overdue by ${Math.abs(r.dueInDays)} days` : `Due in ${r.dueInDays} days`,
      })),
      activeBottlenecks: briefing.bottlenecks.slice(0, 3),
    };
  }

  _searchTopic(query) {
    // Extract meaningful keywords from the query
    const stopWords = ["find", "show", "all", "me", "the", "about", "related", "to", "discussion", "what", "is", "are", "tell"];
    const keywords = query.split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.includes(w.toLowerCase()))
      .join(" ");

    const searchTerm = keywords || query;
    const threads = this.kg.searchByTopic(searchTerm);
    const topicEmails = this.kg.rawEmails.filter(e => {
      const text = ((e.subject || "") + " " + (e._meta?.body || "")).toLowerCase();
      return searchTerm.toLowerCase().split(/\s+/).some(k => k.length > 2 && text.includes(k));
    });

    if (threads.length === 0 && topicEmails.length === 0) {
      return {
        status: "not_found",
        message: `No discussions found for "${searchTerm}". Try different keywords.`,
        suggestions: ["accreditation", "placement", "budget", "faculty", "compliance"],
      };
    }

    return {
      status: "ok",
      title: `🔍 Search Results: "${searchTerm}"`,
      threadCount: threads.length,
      emailCount: topicEmails.length,
      threads: threads.slice(0, 8).map(t => ({
        subject: t.subject,
        priority: t.priority,
        participants: [...t.participants].slice(0, 4),
        topics: [...t.topics],
        lastActivity: daysSince(t.lastSeen) === 0 ? "Today" : `${daysSince(t.lastSeen)} days ago`,
        messageCount: t.messages.length,
      })),
      recentEmails: topicEmails.slice(0, 5).map(e => ({
        subject: e.subject,
        from: e.from,
        date: e.date,
        preview: truncate(e._meta?.body || e.body, 120),
      })),
    };
  }

  _escalations() {
    const risks = this.dt.getEscalationRisks();
    const issues = this.dt.getOperationalIssues();
    const silentIssues = issues.filter(i => i.type === "silent_department" || i.type === "stale_high_priority");

    return {
      status: "ok",
      title: "🚨 Escalation Risks & Hidden Issues",
      escalationRisks: risks,
      silentIssues: silentIssues,
      totalCount: risks.length + silentIssues.length,
      summary: risks.length === 0 && silentIssues.length === 0
        ? "No active escalation risks detected."
        : `${risks.length} escalation risk(s), ${silentIssues.length} hidden issue(s) detected.`,
    };
  }

  _bottlenecks() {
    const patterns = this.be.getPatterns();
    const bottlenecks = patterns.bottlenecks || [];
    const issues = this.dt.getOperationalIssues()
      .filter(i => i.type === "communication_overload");

    return {
      status: "ok",
      title: "⚠️ Approval & Communication Bottlenecks",
      stalledThreads: bottlenecks.map(b => ({
        subject: b.subject,
        stalledDays: b.staleDays,
        severity: b.severity,
        parties: b.participants?.slice(0, 4) || [],
        topics: b.topics,
        action: `Follow up on "${b.subject}" — ${b.staleDays} days without response.`,
      })),
      overloadedPeople: issues.map(i => ({
        name: i.person,
        email: i.email,
        description: i.description,
        recommendation: i.recommendation,
      })),
      summary: `${bottlenecks.length} stalled thread(s), ${issues.length} overloaded communicator(s).`,
    };
  }

  _keyPeople(q) {
    const coordinators = this.dt.getKeyCoordinators();
    let filtered = coordinators;

    // Check if query mentions a specific department/topic
    const topicHint = ["placement", "finance", "academic", "research", "admin", "faculty"]
      .find(t => q.includes(t));
    if (topicHint) {
      filtered = coordinators.filter(c =>
        c.departments.some(d => d.toLowerCase().includes(topicHint))
      );
    }

    return {
      status: "ok",
      title: "👥 Key Coordinators & Stakeholders",
      coordinators: (filtered.length > 0 ? filtered : coordinators).map(c => ({
        name: c.name,
        email: c.email,
        role: c.role,
        departments: c.departments,
        uniqueContacts: c.uniqueContacts,
        importance: c.importance,
        communicationVolume: c.totalVolume,
      })),
      summary: `${coordinators.length} key coordinators identified. Top: ${coordinators[0]?.name || "N/A"} with ${coordinators[0]?.uniqueContacts || 0} unique contacts.`,
    };
  }

  _communicationGaps() {
    const gaps = this.dt.getCommunicationGaps();
    return {
      status: "ok",
      title: "📡 Communication Gaps",
      gaps: gaps,
      summary: gaps.length === 0
        ? "No significant communication gaps detected."
        : `${gaps.length} inter-department communication gap(s) detected.`,
      recommendations: gaps.map(g =>
        `Schedule a meeting between ${g.departments.join(" & ")} teams.`
      ).slice(0, 4),
    };
  }

  _emailSummary(q) {
    // Extract email count or time range from query
    const countMatch = q.match(/(\d+)\s*email/);
    const limit = countMatch ? parseInt(countMatch[1]) : 10;
    const recentEmails = this.kg.rawEmails
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);

    return {
      status: "ok",
      title: `📧 Email Summary (Last ${limit})`,
      totalInInbox: this.kg.rawEmails.length,
      emails: recentEmails.map(e => ({
        subject: e.subject,
        from: e.from,
        date: e.date,
        priority: e._meta?.priority || "normal",
        topics: e._meta?.topics || [],
        preview: truncate(e._meta?.body || e.body, 150),
      })),
    };
  }

  _fullBriefing() {
    return {
      status: "ok",
      title: "🏛️ Full Institutional Status Report",
      dailyBriefing:      this.be.getDailyBriefing(),
      departmentHealth:   this.dt.getDepartmentHealth(),
      operationalIssues:  this.dt.getOperationalIssues(),
      escalationRisks:    this.dt.getEscalationRisks(),
      keyCoordinators:    this.dt.getKeyCoordinators().slice(0, 5),
      strategicInsights:  this.dt.getStrategicInsights(),
      communicationGaps:  this.dt.getCommunicationGaps(),
      knowledgeGraph: {
        totalPeople:      this.kg.people.size,
        totalThreads:     this.kg.threads.size,
        totalDepartments: this.kg.departments.size,
        totalEmails:      this.kg.rawEmails.length,
      },
    };
  }

  _departmentDetail(q) {
    // Try to find which department they're asking about
    const deptNames = [...this.kg.departments.keys()];
    const mentioned = deptNames.find(d => q.includes(d.toLowerCase()));

    if (!mentioned) {
      return this._departmentWorkload();
    }

    const dept = this.kg.departments.get(mentioned);
    const deptEmails = this.kg.timeline.filter(e => e.dept === mentioned);
    const threads = [...this.kg.threads.values()]
      .filter(t => deptEmails.some(e => e.subject === t.subject));

    return {
      status: "ok",
      title: `🏢 ${mentioned} — Detailed Status`,
      emailCount: dept.emailCount,
      members: [...dept.members],
      stressScore: dept.stressScore,
      topTopics: this._topicsFromTimeline(deptEmails),
      activeThreads: threads.slice(0, 5).map(t => ({
        subject: t.subject,
        priority: t.priority,
        participants: [...t.participants].slice(0, 4),
        lastActivity: `${daysSince(t.lastSeen)} days ago`,
      })),
    };
  }

  _topicsFromTimeline(events) {
    const counts = {};
    for (const e of events) {
      for (const t of (e.topics || [])) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }

  _help() {
    return {
      status: "ok",
      title: "🤖 Executive Command Center — Available Commands",
      commands: [
        { command: "Show pending approvals",                    description: "Lists all threads awaiting a decision or sign-off" },
        { command: "Which department has maximum workload?",    description: "Shows department stress analysis and ranking" },
        { command: "Summarize today's important events",        description: "Daily executive briefing with priorities" },
        { command: "Find all discussions about <topic>",        description: "Full-text search across all email threads" },
        { command: "What issues are escalating silently?",      description: "Detects hidden or emerging operational risks" },
        { command: "What bottlenecks are affecting approvals?", description: "Shows stalled threads and overloaded communicators" },
        { command: "Who are the key coordinators?",             description: "Identifies most connected people in institution" },
        { command: "What communication gaps exist?",            description: "Finds department pairs that don't communicate" },
        { command: "Summarize my last 10 emails",               description: "Quick summary of recent inbox" },
        { command: "Full briefing",                             description: "Complete institutional status report" },
      ],
    };
  }
}
