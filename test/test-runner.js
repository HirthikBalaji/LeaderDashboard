/**
 * Test runner — validates all four features using sample email data
 * Run: node test/test-runner.js
 */

import { KnowledgeGraph } from "../src/knowledge-graph.js";
import { BehaviorEngine }  from "../src/behavior-engine.js";
import { DigitalTwin }     from "../src/digital-twin.js";
import { CommandCenter }   from "../src/command-center.js";

// ── Sample Data (mimics your inbox.json schema) ───────────────────────────────

const SAMPLE_EMAILS = [
  {
    subject: "URGENT: NAAC Accreditation Documents Pending",
    from: "principal@college.edu",
    to: "hod.cs@college.edu, hod.mech@college.edu",
    cc: "dean@college.edu",
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
    body: "Please submit all pending accreditation documents by Friday. This is critical for our NAAC visit next month. Immediate action required.",
    message_id: "<001@college.edu>",
  },
  {
    subject: "Re: NAAC Accreditation Documents Pending",
    from: "hod.cs@college.edu",
    to: "principal@college.edu",
    cc: null,
    date: new Date(Date.now() - 1.5 * 86400000).toISOString(),
    body: "We have submitted 80% of the documents. The remaining syllabus revision files are pending approval from the board.",
    message_id: "<002@college.edu>",
  },
  {
    subject: "Monthly HOD Report - March 2026",
    from: "hod.mech@college.edu",
    to: "principal@college.edu",
    cc: "dean@college.edu",
    date: new Date(Date.now() - 10 * 86400000).toISOString(),
    body: "Please find attached the monthly HOD report for the Mechanical department. Lab equipment maintenance is overdue. Budget approval needed for replacement of 3 CNC machines.",
    message_id: "<003@college.edu>",
  },
  {
    subject: "Monthly HOD Report - February 2026",
    from: "hod.mech@college.edu",
    to: "principal@college.edu",
    cc: null,
    date: new Date(Date.now() - 40 * 86400000).toISOString(),
    body: "February HOD report. Faculty shortage in thermal engineering. Student exam results pending review.",
    message_id: "<004@college.edu>",
  },
  {
    subject: "Placement Drive - TCS Campus Recruitment",
    from: "placement.officer@college.edu",
    to: "principal@college.edu, hod.cs@college.edu",
    cc: "tpo@college.edu",
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    body: "TCS campus recruitment is scheduled for next week. 150 students registered. Budget approval needed for venue and logistics. Please sanction Rs. 50,000 from placement fund.",
    message_id: "<005@college.edu>",
  },
  {
    subject: "Budget Approval: Lab Equipment - Pending Since 15 days",
    from: "finance@college.edu",
    to: "principal@college.edu",
    cc: null,
    date: new Date(Date.now() - 15 * 86400000).toISOString(),
    body: "The lab equipment purchase approval for Computer Science department has been pending for 15 days. Vendor is waiting. Urgent action required.",
    message_id: "<006@college.edu>",
  },
  {
    subject: "Student Grievance Escalation - Hostel Facility",
    from: "student.dean@college.edu",
    to: "principal@college.edu, admin@college.edu",
    cc: "dean@college.edu",
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    body: "Multiple students have raised grievances about hostel water supply. The issue has been escalating for a week without resolution. Immediate attention required.",
    message_id: "<007@college.edu>",
  },
  {
    subject: "Faculty Leave Approval - Dr. Sharma",
    from: "hod.cs@college.edu",
    to: "principal@college.edu",
    cc: null,
    date: new Date(Date.now() - 6 * 86400000).toISOString(),
    body: "Dr. Sharma has requested 10 days leave for conference presentation in Singapore. Please approve at the earliest as conference is next week.",
    message_id: "<008@college.edu>",
  },
  {
    subject: "Re: Faculty Leave Approval - Dr. Sharma",
    from: "admin@college.edu",
    to: "hod.cs@college.edu",
    cc: null,
    date: new Date(Date.now() - 5.5 * 86400000).toISOString(),
    body: "The leave application has been forwarded to the principal's office. Awaiting approval.",
    message_id: "<009@college.edu>",
  },
  {
    subject: "Research Grant Application - DST SERB",
    from: "research.cell@college.edu",
    to: "principal@college.edu, dean@college.edu",
    cc: null,
    date: new Date(Date.now() - 8 * 86400000).toISOString(),
    body: "We are applying for the DST SERB research grant. The application requires principal's signature and institutional endorsement. Deadline is next week.",
    message_id: "<010@college.edu>",
  },
  {
    subject: "Bumrah's 40% super sale: Ready to score big?",
    from: "foundit <info@alerts.foundit.in>",
    to: "hirthikbalaji2006@gmail.com",
    cc: null,
    date: new Date(Date.now() - 4 * 86400000).toISOString(),
    body: "40% off on all career services. Use code OFFER40.",
    message_id: "<011@promo>",
  },
];

// ── Run Tests ─────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  ✅ ${label}`); }
function fail(label, err) { console.error(`  ❌ ${label}: ${err}`); }
function section(title) { console.log(`\n── ${title} ─────────────────────────────────────────`); }

async function runTests() {
  console.log("🧪 Smart Mail MCP — Test Suite\n");

  // Bootstrap
  const kg = new KnowledgeGraph();
  const be = new BehaviorEngine(kg);
  const dt = new DigitalTwin(kg);
  const cc = new CommandCenter(kg, be, dt);

  try {
    kg.ingestEmails(SAMPLE_EMAILS);
    pass(`Ingested ${SAMPLE_EMAILS.length} emails`);
  } catch (e) { fail("Email ingestion", e.message); return; }

  // ── Feature 1: Knowledge Graph ──────────────────────────────────────────
  section("Feature 3: Knowledge Graph");
  try {
    pass(`People nodes: ${kg.people.size}`);
    pass(`Thread nodes: ${kg.threads.size}`);
    pass(`Departments: ${kg.departments.size}`);
    pass(`Projects: ${kg.projects.size}`);

    const topPeople = kg.getTopCommunicators(3);
    pass(`Top communicator: ${topPeople[0]?.name || "N/A"}`);

    const highPri = kg.getOpenHighPriorityThreads();
    pass(`High-priority open threads: ${highPri.length}`);

    const accred = kg.searchByTopic("accreditation");
    if (accred.length === 0) fail("Topic search: accreditation", "No results");
    else pass(`Topic search 'accreditation': ${accred.length} thread(s)`);
  } catch (e) { fail("Knowledge Graph", e.message); }

  // ── Feature 1: Behavior Engine ─────────────────────────────────────────
  section("Feature 1: Proactive Executive Intelligence");
  try {
    be.analyzePatterns();
    const preds = be.getPredictions();
    pass(`Generated ${preds.length} prediction(s)`);

    const critical = preds.filter(p => p.urgency === "critical");
    const high     = preds.filter(p => p.urgency === "high");
    pass(`Critical: ${critical.length}, High: ${high.length}`);

    const recurring = be.getPatterns().recurringThreads;
    pass(`Recurring workflow patterns: ${recurring.length}`);

    const bottlenecks = be.getPatterns().bottlenecks;
    pass(`Communication bottlenecks: ${bottlenecks.length}`);

    const briefing = be.getDailyBriefing();
    pass(`Daily briefing generated: "${briefing.summary}"`);
  } catch (e) { fail("Behavior Engine", e.message); }

  // ── Feature 2: Digital Twin ────────────────────────────────────────────
  section("Feature 2: AI Digital Twin");
  try {
    dt.build();
    const depts = dt.getDepartmentHealth();
    pass(`Department profiles: ${depts.length}`);
    if (depts[0]) pass(`Most stressed dept: ${depts[0].name} (score: ${depts[0].stressScore})`);

    const issues = dt.getOperationalIssues();
    pass(`Operational issues detected: ${issues.length}`);

    const risks = dt.getEscalationRisks();
    pass(`Escalation risks: ${risks.length}`);

    const coordinators = dt.getKeyCoordinators();
    pass(`Key coordinators identified: ${coordinators.length}`);

    const insights = dt.getStrategicInsights();
    pass(`Strategic insights: ${insights.length}`);
  } catch (e) { fail("Digital Twin", e.message); }

  // ── Feature 4: Command Center ──────────────────────────────────────────
  section("Feature 4: Executive Command Center");
  const queries = [
    "Show pending approvals",
    "Which department has maximum workload?",
    "Summarize today's important events",
    "Find all discussions about accreditation",
    "What issues are escalating silently?",
    "What bottlenecks are affecting approvals?",
    "Who are the key coordinators keeping placements moving?",
    "What communication gaps exist?",
    "Full briefing",
  ];

  for (const q of queries) {
    try {
      const result = cc.query(q);
      if (!result || !result.status) throw new Error("No status in response");
      pass(`"${q}" → status: ${result.status}`);
    } catch (e) { fail(`Query: "${q}"`, e.message); }
  }

  console.log("\n✅ All tests complete!\n");
}

runTests().catch(console.error);
