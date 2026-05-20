#!/usr/bin/env node
/**
 * Smart Executive Mail MCP Server
 * ================================
 * Features:
 *  F1 – Proactive Executive Intelligence (behavior patterns → predictions)
 *  F2 – AI Digital Twin of the Institution (live operational awareness)
 *  F3 – Knowledge Graph & Workflow Intelligence (people, projects, priorities)
 *  F4 – Executive Command Center (natural-language queries over institution data)
 *
 * Transport: stdio (standard MCP transport)
 * Input:     JSON mbox/email array (same schema as your inbox.json)
 */

import { readFileSync } from "fs";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { BehaviorEngine } from "./behavior-engine.js";
import { DigitalTwin } from "./digital-twin.js";
import { CommandCenter } from "./command-center.js";
import { MCPServer } from "./mcp-server.js";
import { OllamaEngine } from "./ollama-engine.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const kg  = new KnowledgeGraph();
const be  = new BehaviorEngine(kg);
const dt  = new DigitalTwin(kg);
const ai  = new OllamaEngine("llama3.2");
const cc  = new CommandCenter(kg, be, dt, ai);

const server = new MCPServer("smart-mail-mcp", "1.0.0", { kg, be, dt, cc });
server.start();
