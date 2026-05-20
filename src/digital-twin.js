/**
 * DigitalTwin – Feature 2: AI Digital Twin of the Institution
 * ============================================================
 * Continuously builds a live operational model tracking:
 *  - Department health & workload
 *  - Communication flow maps
 *  - Hidden operational issues
 *  - Emerging escalations
 *  - Strategic pressure points
 */

import { daysSince } from "./utils.js";

export class DigitalTwin {
  constructor(kg) {
    this.kg = kg;
    this._model = null;
  }

  // ── Build / Refresh Model ─────────────────────────────────────────────────

  build() {
    this._model = {
      departments:        this._buildDepartmentProfiles(),
      communicationFlow:  this._buildCommunicationFlow(),
      operationalIssues:  this._detectOperationalIssues(),
      escalationRisks:    this._detectEscalationRisks(),
      keyCoordinators:    this._identifyKeyCoordinators(),
      communicationGaps:  this._detectCommunicationGaps(),
      strategicInsights:  this._generateStrategicInsights(),
      lastUpdated:        new Date().toISOString(),
    };
    return this._model;
  }

  _ensureModel() {
    if (!this._model) this.build();
    return this._model;
  }

  // ── Department Profiles ───────────────────────────────────────────────────

  _buildDepartmentProfiles() {
    const profiles = [];
    for (const [name, dept] of this.kg.departments) {
      const deptEmails = this.kg.timeline.filter(e => e.dept === name);
      const recentEmails = deptEmails.filter(e =>
        e.timestamp && daysSince(e.timestamp) <= 14
      );
      const highPriCount = deptEmails.filter(e => e.priority === "high").length;

      profiles.push({
        name,
        memberCount: dept.members.size,
        totalEmailActivity: dept.emailCount,
        recentActivity: recentEmails.length,
        stressScore: dept.stressScore,
        stressLevel: dept.stressScore > 60 ? "High" : dept.stressScore > 30 ? "Medium" : "Normal",
        highPriorityIssues: highPriCount,
        isActive: recentEmails.length > 0,
        daysSinceLastActivity: deptEmails.length > 0
          ? Math.min(...deptEmails.map(e => e.timestamp ? daysSince(e.timestamp) : 999))
          : 999,
        topTopics: this._getTopTopicsForDept(name),
      });
    }
    return profiles.sort((a, b) => b.stressScore - a.stressScore);
  }

  _getTopTopicsForDept(deptName) {
    const topicCounts = {};
    for (const event of this.kg.timeline) {
      if (event.dept === deptName) {
        for (const topic of (event.topics || [])) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }
    }
    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
  }

  // ── Communication Flow ────────────────────────────────────────────────────

  _buildCommunicationFlow() {
    // Build adjacency for top N people
    const topPeople = this.kg.getTopCommunicators(15);
    const nodes = topPeople.map(p => ({
      id: p.email,
      name: p.name,
      emailsSent: p.sentCount,
      emailsReceived: p.receivedCount,
      departments: [...p.departments],
      centrality: p.sentCount + p.receivedCount,
    }));

    const links = [];
    const seen = new Set();
    for (const edge of this.kg.edges) {
      const key = [edge.from, edge.to].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        const weight = this.kg.edges.filter(
          e => [e.from, e.to].sort().join("|") === key
        ).length;
        if (weight >= 1) {
          links.push({ source: edge.from, target: edge.to, weight });
        }
      }
    }

    return { nodes, links };
  }

  // ── Issue Detection ───────────────────────────────────────────────────────

  _detectOperationalIssues() {
    const issues = [];

    // Issue 1: Departments with zero recent activity
    for (const [name, dept] of this.kg.departments) {
      const recent = this.kg.timeline.filter(
        e => e.dept === name && e.timestamp && daysSince(e.timestamp) <= 14
      );
      if (dept.emailCount > 0 && recent.length === 0) {
        issues.push({
          type: "silent_department",
          severity: "medium",
          department: name,
          description: `${name} department has gone silent — no communication in 14 days despite past activity.`,
          recommendation: "Check in with department head. Possible communication breakdown or major issue being handled offline.",
        });
      }
    }

    // Issue 2: High-priority threads with no resolution
    const stalePriority = this.kg.getOpenHighPriorityThreads()
      .filter(t => daysSince(t.lastSeen) > 5);
    for (const t of stalePriority.slice(0, 5)) {
      issues.push({
        type: "stale_high_priority",
        severity: "high",
        subject: t.subject,
        description: `High-priority thread "${t.subject}" has been unresolved for ${daysSince(t.lastSeen)} days.`,
        participants: [...t.participants].slice(0, 4),
        recommendation: "Immediate follow-up required. Risk of escalation if unaddressed.",
      });
    }

    // Issue 3: Overloaded communicators
    for (const person of this.kg.getTopCommunicators(5)) {
      if (person.receivedCount > 50) {
        issues.push({
          type: "communication_overload",
          severity: "medium",
          person: person.name,
          email: person.email,
          description: `${person.name} has received ${person.receivedCount} emails — possible overload or bottleneck.`,
          recommendation: "Consider delegating or redistributing responsibilities.",
        });
      }
    }

    return issues.sort((a, b) => {
      const s = { high: 0, medium: 1, low: 2 };
      return (s[a.severity] ?? 3) - (s[b.severity] ?? 3);
    });
  }

  _detectEscalationRisks() {
    const risks = [];

    // Threads growing in participant count (spreading concern)
    for (const [, thread] of this.kg.threads) {
      if (thread.participants.size >= 4 && thread.priority !== "low") {
        risks.push({
          subject: thread.subject,
          riskType: "widening_circle",
          severity: thread.priority === "high" ? "high" : "medium",
          participantCount: thread.participants.size,
          description: `Thread involving ${thread.participants.size} people — widening concern.`,
          topics: [...thread.topics],
        });
      }
    }

    // Topics flagged as high-risk
    const riskyTopics = ["Compliance", "Accreditation", "Student Affairs"];
    for (const topic of riskyTopics) {
      const topicThreads = this.kg.searchByTopic(topic)
        .filter(t => t.priority === "high" || daysSince(t.lastSeen) < 7);
      if (topicThreads.length > 0) {
        risks.push({
          riskType: "critical_topic_active",
          topic,
          severity: "high",
          activeThreads: topicThreads.length,
          description: `${topicThreads.length} active thread(s) on "${topic}" — requires executive attention.`,
          threads: topicThreads.slice(0, 3).map(t => t.subject),
        });
      }
    }

    return risks;
  }

  _identifyKeyCoordinators() {
    // People who connect many others (high betweenness approximation)
    const people = this.kg.getTopCommunicators(20);
    const coordinators = people
      .filter(p => p.communicationPartners.size >= 3)
      .map(p => ({
        name: p.name,
        email: p.email,
        uniqueContacts: p.communicationPartners.size,
        departments: [...p.departments],
        totalVolume: p.sentCount + p.receivedCount,
        role: p.sentCount > p.receivedCount ? "Initiator" : "Responder",
        importance: "Key coordinator — removing this person would disconnect communication paths",
      }))
      .sort((a, b) => b.uniqueContacts - a.uniqueContacts)
      .slice(0, 8);
    return coordinators;
  }

  _detectCommunicationGaps() {
    const gaps = [];
    const deptNames = [...this.kg.departments.keys()];

    // Check which departments never communicate with each other
    for (let i = 0; i < deptNames.length; i++) {
      for (let j = i + 1; j < deptNames.length; j++) {
        const d1 = deptNames[i], d2 = deptNames[j];
        const deptAMembers = this.kg.departments.get(d1)?.members || new Set();
        const deptBMembers = this.kg.departments.get(d2)?.members || new Set();

        const crossEdges = this.kg.edges.filter(
          e => (deptAMembers.has(e.from) && deptBMembers.has(e.to)) ||
               (deptBMembers.has(e.from) && deptAMembers.has(e.to))
        );

        if (crossEdges.length === 0 && deptAMembers.size > 0 && deptBMembers.size > 0) {
          gaps.push({
            departments: [d1, d2],
            description: `No communication detected between ${d1} and ${d2}.`,
            severity: "low",
            recommendation: "Consider a cross-department coordination meeting.",
          });
        }
      }
    }
    return gaps.slice(0, 6);
  }

  _generateStrategicInsights() {
    const model = this._model || {};
    const depts = model.departments || this._buildDepartmentProfiles();
    const overloaded = depts.filter(d => d.stressLevel === "High");
    const silent     = depts.filter(d => !d.isActive && d.totalEmailActivity > 0);

    const insights = [];

    if (overloaded.length > 0) {
      insights.push({
        type: "workload_imbalance",
        title: "Department Overload Detected",
        description: `${overloaded.map(d => d.name).join(", ")} show high stress indicators. Redistribution of resources may be needed.`,
        priority: "high",
      });
    }

    if (silent.length > 0) {
      insights.push({
        type: "communication_silence",
        title: "Silent Departments",
        description: `${silent.map(d => d.name).join(", ")} have gone dark recently. Investigate potential issues.`,
        priority: "medium",
      });
    }

    const totalEmails  = this.kg.rawEmails.length;
    const highPriEmails = this.kg.rawEmails.filter(e => e._meta?.priority === "high").length;
    if (totalEmails > 0 && highPriEmails / totalEmails > 0.3) {
      insights.push({
        type: "high_priority_surge",
        title: "High Priority Email Surge",
        description: `${Math.round((highPriEmails / totalEmails) * 100)}% of emails are high priority — institution may be in an elevated stress period.`,
        priority: "high",
      });
    }

    return insights;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getDepartmentHealth() {
    return this._ensureModel().departments;
  }

  getOperationalIssues() {
    return this._ensureModel().operationalIssues;
  }

  getEscalationRisks() {
    return this._ensureModel().escalationRisks;
  }

  getKeyCoordinators() {
    return this._ensureModel().keyCoordinators;
  }

  getCommunicationGaps() {
    return this._ensureModel().communicationGaps;
  }

  getStrategicInsights() {
    return this._ensureModel().strategicInsights;
  }

  getFullModel() {
    return this._ensureModel();
  }

  getMostStressedDept() {
    const depts = this.getDepartmentHealth();
    return depts.length > 0 ? depts[0] : null;
  }
}
