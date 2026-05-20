/**
 * BehaviorEngine – Feature 1: Proactive Executive Intelligence
 * ============================================================
 * Learns workflow patterns from email history and proactively predicts:
 *  - Upcoming urgent actions
 *  - Delayed responses
 *  - Recurring workflows due soon
 *  - Decision bottlenecks
 *  - Stakeholder risks
 */

import { dayOfWeek, hourOfDay, daysSince } from "./utils.js";

export class BehaviorEngine {
  constructor(kg) {
    this.kg = kg;
    this.patterns = {};
    this.predictions = [];
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  analyzePatterns() {
    this.patterns = {
      replyTiming:      this._analyzeReplyTiming(),
      recurringThreads: this._detectRecurringThreads(),
      workloadRhythm:   this._analyzeWorkloadRhythm(),
      bottlenecks:      this._detectBottlenecks(),
      pendingApprovals: this._findPendingApprovals(),
    };
    this.predictions = this._generatePredictions();
    return this.patterns;
  }

  // Find threads with regular cadence (weekly reports, monthly reviews, etc.)
  _detectRecurringThreads() {
    const recurring = [];
    for (const [, thread] of this.kg.threads) {
      if (thread.messages.length >= 2) {
        const gaps = [];
        const sorted = [...thread.messages].sort((a, b) => a.date - b.date);
        for (let i = 1; i < sorted.length; i++) {
          gaps.push(sorted[i].date - sorted[i - 1].date);
        }
        if (gaps.length > 0) {
          const avgGapMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          const avgGapDays = avgGapMs / 86400000;
          if (avgGapDays <= 35) { // Monthly or more frequent
            const lastMsg = sorted[sorted.length - 1];
            const daysSinceLast = daysSince(lastMsg.date);
            const dueInDays = Math.round(avgGapDays - daysSinceLast);
            recurring.push({
              subject: thread.subject,
              avgGapDays: Math.round(avgGapDays),
              dueInDays,
              isOverdue: dueInDays < 0,
              lastSeen: lastMsg.date,
              participants: [...thread.participants],
              topics: [...thread.topics],
            });
          }
        }
      }
    }
    return recurring.sort((a, b) => a.dueInDays - b.dueInDays);
  }

  // Detect typical reply times by hour/day for the principal
  _analyzeReplyTiming() {
    const hourBuckets = Array(24).fill(0);
    const dayBuckets  = Array(7).fill(0);

    for (const event of this.kg.timeline) {
      if (event.timestamp && event.priority !== "low") {
        hourBuckets[hourOfDay(event.timestamp)]++;
        dayBuckets[dayOfWeek(event.timestamp)]++;
      }
    }

    const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
    const peakDay  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayBuckets.indexOf(Math.max(...dayBuckets))];

    return { hourBuckets, dayBuckets, peakHour, peakDay };
  }

  // Emails/threads with no reply for a long time (possible delayed response)
  _detectBottlenecks() {
    const bottlenecks = [];
    for (const [, thread] of this.kg.threads) {
      if (thread.priority === "high" || thread.priority === "medium") {
        const staleDays = daysSince(thread.lastSeen);
        if (staleDays >= 3) {
          bottlenecks.push({
            subject: thread.subject,
            staleDays,
            priority: thread.priority,
            participants: [...thread.participants],
            topics: [...thread.topics],
            severity: staleDays >= 7 ? "critical" : staleDays >= 5 ? "high" : "medium",
          });
        }
      }
    }
    return bottlenecks.sort((a, b) => b.staleDays - a.staleDays);
  }

  _findPendingApprovals() {
    const approvalKeywords = ["approval", "approve", "sanction", "pending", "waiting", "authorize", "sign off"];
    const pending = [];
    for (const [, thread] of this.kg.threads) {
      const text = thread.subject.toLowerCase() + " " + [...thread.topics].join(" ").toLowerCase();
      const score = approvalKeywords.filter(k => text.includes(k)).length;
      if (score > 0 || thread.topics.has("Budget Approval")) {
        const staleDays = daysSince(thread.lastSeen);
        pending.push({
          subject: thread.subject,
          staleDays,
          participants: [...thread.participants],
          topics: [...thread.topics],
          urgencyScore: score * 10 + (staleDays > 5 ? 20 : 0),
        });
      }
    }
    return pending.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }

  _analyzeWorkloadRhythm() {
    const weekly = Array(7).fill(0);
    for (const event of this.kg.timeline) {
      if (event.timestamp) weekly[dayOfWeek(event.timestamp)]++;
    }
    return { weekly, labels: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] };
  }

  // ── Predictions ────────────────────────────────────────────────────────────

  _generatePredictions() {
    const predictions = [];
    const now = new Date();
    const todayDay = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getDay()];
    const currentHour = now.getHours();

    // Prediction: Recurring threads due soon
    for (const r of (this.patterns.recurringThreads || []).slice(0, 5)) {
      if (r.dueInDays <= 2 || r.isOverdue) {
        predictions.push({
          type: "recurring_workflow",
          urgency: r.isOverdue ? "critical" : "high",
          title: r.isOverdue
            ? `⚠️ Overdue: "${r.subject}" (${Math.abs(r.dueInDays)} days late)`
            : `📅 Due Soon: "${r.subject}" (in ${r.dueInDays} day${r.dueInDays === 1 ? "" : "s"})`,
          detail: `This thread recurs every ~${r.avgGapDays} days. Participants: ${r.participants.slice(0, 3).join(", ")}`,
          action: "Review thread and send update or follow-up",
        });
      }
    }

    // Prediction: Peak work hour advice
    const { peakHour, peakDay } = this.patterns.replyTiming || {};
    if (peakHour !== undefined) {
      predictions.push({
        type: "workflow_rhythm",
        urgency: "info",
        title: `🕐 Peak productivity: ${peakHour}:00–${peakHour + 1}:00 on ${peakDay}s`,
        detail: "Schedule critical decisions and replies during this window for best coverage.",
        action: "Block this time for focused executive work",
      });
    }

    // Prediction: Stale high-priority threads
    for (const b of (this.patterns.bottlenecks || []).slice(0, 4)) {
      predictions.push({
        type: "bottleneck",
        urgency: b.severity,
        title: `🔴 Communication Gap: "${b.subject}" (${b.staleDays} days silent)`,
        detail: `Topic: ${b.topics.join(", ")}. Involves: ${b.participants.slice(0, 3).join(", ")}`,
        action: "Send follow-up or escalate to responsible stakeholder",
      });
    }

    // Prediction: Pending approvals
    for (const p of (this.patterns.pendingApprovals || []).slice(0, 3)) {
      predictions.push({
        type: "pending_approval",
        urgency: p.staleDays > 5 ? "critical" : "high",
        title: `✅ Pending Approval: "${p.subject}"`,
        detail: `Waiting ${p.staleDays} days. Involved: ${p.participants.slice(0, 3).join(", ")}`,
        action: "Approve, reject, or request more information",
      });
    }

    // Sort by urgency
    const urgencyOrder = { critical: 0, high: 1, medium: 2, info: 3 };
    return predictions.sort((a, b) =>
      (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getPredictions() {
    if (this.predictions.length === 0) this.analyzePatterns();
    return this.predictions;
  }

  getPatterns() {
    if (!this.patterns.replyTiming) this.analyzePatterns();
    return this.patterns;
  }

  getDailyBriefing() {
    const preds = this.getPredictions();
    const critical = preds.filter(p => p.urgency === "critical");
    const high     = preds.filter(p => p.urgency === "high");
    const today    = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long" });

    return {
      date: today,
      summary: `${critical.length} critical items, ${high.length} high-priority items need your attention today.`,
      criticalItems: critical,
      highPriorityItems: high,
      pendingApprovals: this.patterns.pendingApprovals?.slice(0, 5) || [],
      recurringDue: this.patterns.recurringThreads?.filter(r => r.dueInDays <= 3) || [],
      bottlenecks: this.patterns.bottlenecks?.slice(0, 3) || [],
    };
  }
}
