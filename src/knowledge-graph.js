/**
 * KnowledgeGraph
 * ==============
 * Builds and maintains an in-memory graph from email data covering:
 *  - People & relationships
 *  - Departments & projects
 *  - Threads & topics
 *  - Priority signals
 *  - Temporal patterns
 */

import { extractEmailMeta, classifyPriority, detectTopics } from "./utils.js";

export class KnowledgeGraph {
  constructor() {
    this.people      = new Map(); // email → PersonNode
    this.threads     = new Map(); // subject_key → ThreadNode
    this.departments = new Map(); // dept_name → DeptNode
    this.projects    = new Map(); // project_id → ProjectNode
    this.edges       = [];        // { from, to, type, weight, timestamp }
    this.timeline    = [];        // chronological email events
    this.rawEmails   = [];
  }

  // ── Ingestion ─────────────────────────────────────────────────────────────

  ingestEmails(emails) {
    for (const email of emails) {
      this._processEmail(email);
    }
    this._computeRelationshipWeights();
    return this;
  }

  _processEmail(email) {
    const meta = extractEmailMeta(email);
    this.rawEmails.push({ ...email, _meta: meta });

    // Register people
    const fromNode = this._upsertPerson(meta.from);
    for (const addr of meta.to) this._upsertPerson(addr);
    for (const addr of meta.cc) this._upsertPerson(addr);

    // Register thread
    const thread = this._upsertThread(meta);

    // Register departments
    const dept = this._inferDepartment(meta);
    if (dept) {
      this._upsertDepartment(dept);
      this._linkPersonToDept(meta.from, dept);
    }

    // Register projects / topics
    for (const topic of meta.topics) {
      this._upsertProject(topic, email);
    }

    // Timeline event
    this.timeline.push({
      timestamp: meta.date,
      type: "email",
      from: meta.from,
      to: meta.to,
      subject: meta.subject,
      priority: meta.priority,
      topics: meta.topics,
      dept,
    });

    // Relationship edges: sender → each recipient
    for (const addr of [...meta.to, ...meta.cc]) {
      this.edges.push({
        from: meta.from,
        to: addr,
        type: "emailed",
        weight: meta.priority === "high" ? 3 : 1,
        timestamp: meta.date,
      });
    }
  }

  _upsertPerson(email) {
    if (!email) return null;
    const key = email.toLowerCase();
    if (!this.people.has(key)) {
      this.people.set(key, {
        email: key,
        name: this._guessName(email),
        sentCount: 0,
        receivedCount: 0,
        topics: new Set(),
        departments: new Set(),
        responseTimeMs: [],
        lastSeen: null,
        communicationPartners: new Map(), // partner_email → count
      });
    }
    return this.people.get(key);
  }

  _upsertThread(meta) {
    const key = meta.subject.replace(/^(re:|fwd?:)\s*/gi, "").trim().toLowerCase();
    if (!this.threads.has(key)) {
      this.threads.set(key, {
        key,
        subject: meta.subject,
        participants: new Set(),
        messages: [],
        priority: meta.priority,
        topics: new Set(meta.topics),
        firstSeen: meta.date,
        lastSeen: meta.date,
        status: "open",
      });
    }
    const t = this.threads.get(key);
    t.participants.add(meta.from);
    meta.to.forEach(a => t.participants.add(a));
    t.messages.push(meta);
    t.lastSeen = meta.date > t.lastSeen ? meta.date : t.lastSeen;
    t.priority = meta.priority === "high" ? "high" : t.priority;
    for (const topic of meta.topics) t.topics.add(topic);
    return t;
  }

  _upsertDepartment(name) {
    if (!this.departments.has(name)) {
      this.departments.set(name, {
        name,
        members: new Set(),
        emailCount: 0,
        activeProjects: new Set(),
        lastActivity: null,
        stressScore: 0,
      });
    }
    const d = this.departments.get(name);
    d.emailCount++;
    return d;
  }

  _upsertProject(topic, email) {
    const key = topic.toLowerCase();
    if (!this.projects.has(key)) {
      this.projects.set(key, {
        id: key,
        name: topic,
        mentionCount: 0,
        relatedEmails: [],
        stakeholders: new Set(),
        lastMentioned: null,
      });
    }
    const p = this.projects.get(key);
    p.mentionCount++;
    p.relatedEmails.push(email.message_id || email.subject);
    p.lastMentioned = email.date;
    return p;
  }

  _linkPersonToDept(email, dept) {
    const person = this.people.get(email?.toLowerCase());
    if (!person) return;
    person.departments.add(dept);
    const deptNode = this.departments.get(dept);
    if (deptNode) deptNode.members.add(email);
  }

  // ── Graph Analytics ───────────────────────────────────────────────────────

  _computeRelationshipWeights() {
    // Aggregate communication counts between persons
    for (const edge of this.edges) {
      const sender = this.people.get(edge.from?.toLowerCase());
      const receiver = this.people.get(edge.to?.toLowerCase());
      if (sender) {
        sender.sentCount++;
        const prev = sender.communicationPartners.get(edge.to) || 0;
        sender.communicationPartners.set(edge.to, prev + edge.weight);
      }
      if (receiver) {
        receiver.receivedCount++;
      }
    }

    // Compute department stress scores (email volume × high-priority ratio)
    for (const [, dept] of this.departments) {
      const deptEmails = this.timeline.filter(e => e.dept === dept.name);
      const highPri = deptEmails.filter(e => e.priority === "high").length;
      dept.stressScore = deptEmails.length > 0
        ? Math.round((highPri / deptEmails.length) * 100 + Math.log(deptEmails.length + 1) * 5)
        : 0;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _guessName(email) {
    const local = email.split("@")[0] || "";
    return local.replace(/[._]/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  _inferDepartment(meta) {
    const text = (meta.subject + " " + meta.body).toLowerCase();
    const deptKeywords = {
      "Placement": ["placement", "recruiter", "campus hire", "internship", "job offer"],
      "Academics": ["syllabus", "curriculum", "exam", "assignment", "lecture", "faculty", "hod report"],
      "Finance": ["budget", "payment", "approval", "invoice", "expenditure", "fund"],
      "Administration": ["circular", "notice", "schedule", "attendance", "administration"],
      "Research": ["research", "publication", "paper", "grant", "phd", "thesis"],
      "Infrastructure": ["infrastructure", "maintenance", "lab", "equipment", "facility"],
      "Student Affairs": ["student", "disciplinary", "hostel", "grievance", "club"],
    };
    let bestDept = null, bestScore = 0;
    for (const [dept, keywords] of Object.entries(deptKeywords)) {
      const score = keywords.filter(k => text.includes(k)).length;
      if (score > bestScore) { bestScore = score; bestDept = dept; }
    }
    return bestScore > 0 ? bestDept : "General";
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getTopCommunicators(limit = 10) {
    return [...this.people.values()]
      .sort((a, b) => (b.sentCount + b.receivedCount) - (a.sentCount + a.receivedCount))
      .slice(0, limit);
  }

  getMostStressedDepts(limit = 5) {
    return [...this.departments.values()]
      .sort((a, b) => b.stressScore - a.stressScore)
      .slice(0, limit);
  }

  getOpenHighPriorityThreads() {
    return [...this.threads.values()]
      .filter(t => t.priority === "high" && t.status === "open")
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  searchByTopic(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const [, thread] of this.threads) {
      const score =
        (thread.subject.toLowerCase().includes(q) ? 3 : 0) +
        ([...thread.topics].some(t => t.toLowerCase().includes(q)) ? 2 : 0);
      if (score > 0) results.push({ thread, score });
    }
    return results.sort((a, b) => b.score - a.score).map(r => r.thread);
  }

  getRecentActivity(days = 7) {
    const cutoff = Date.now() - days * 86400000;
    return this.timeline
      .filter(e => e.timestamp && e.timestamp.getTime() > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  serialize() {
    return {
      people: [...this.people.values()].map(p => ({
        ...p,
        topics: [...p.topics],
        departments: [...p.departments],
        communicationPartners: Object.fromEntries(p.communicationPartners),
      })),
      threads: [...this.threads.values()].map(t => ({
        ...t,
        participants: [...t.participants],
        topics: [...t.topics],
      })),
      departments: [...this.departments.values()].map(d => ({
        ...d,
        members: [...d.members],
        activeProjects: [...d.activeProjects],
      })),
      projects: [...this.projects.values()].map(p => ({
        ...p,
        stakeholders: [...p.stakeholders],
      })),
      emailCount: this.rawEmails.length,
    };
  }
}
