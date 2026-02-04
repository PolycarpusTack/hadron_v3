/**
 * Knowledge Graph Service
 * Phase 3: Builds graph data structure for crash-ticket relationships
 *
 * This service creates a graph representation of:
 * - Analyses (crash logs)
 * - JIRA tickets
 * - Links between analyses and tickets
 * - Crash signatures connecting similar analyses
 */

import { invoke } from "@tauri-apps/api/core";
import logger from "./logger";
import type { Analysis } from "./api";
import type { JiraLink } from "./jira-linking";

// ============================================================================
// Types
// ============================================================================

export type NodeType = "analysis" | "jira" | "signature";

// Signature data structure for crash pattern matching
export interface SignatureData {
  hash: string;
  error_type: string;
  occurrence_count: number;
  status: string;
}

// Union type for graph node data
export type GraphNodeData = Analysis | JiraLink | SignatureData;

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  subLabel?: string;
  severity?: string;
  status?: string;
  data: GraphNodeData;
  // Positioning (set by layout algorithm)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "jira_link" | "signature_match" | "similar";
  label?: string;
  strength?: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    analysisCount: number;
    jiraCount: number;
    signatureCount: number;
    edgeCount: number;
  };
}

export interface GraphFilter {
  showAnalyses: boolean;
  showJiraTickets: boolean;
  showSignatures: boolean;
  severities: string[];
  maxNodes: number;
}

// ============================================================================
// Default Filter
// ============================================================================

export const DEFAULT_FILTER: GraphFilter = {
  showAnalyses: true,
  showJiraTickets: true,
  showSignatures: true,
  severities: ["critical", "high", "medium", "low"],
  maxNodes: 100,
};

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build knowledge graph from database
 */
export async function buildKnowledgeGraph(
  filter: Partial<GraphFilter> = {}
): Promise<KnowledgeGraph> {
  const f = { ...DEFAULT_FILTER, ...filter };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  try {
    // Fetch analyses
    let analyses: Analysis[] = [];
    if (f.showAnalyses) {
      analyses = await invoke<Analysis[]>("get_all_analyses");
      analyses = analyses
        .filter(a => f.severities.includes(a.severity.toLowerCase()))
        .slice(0, f.maxNodes);
    }

    // Fetch all JIRA links
    let jiraLinks: JiraLink[] = [];
    if (f.showJiraTickets) {
      try {
        jiraLinks = await invoke<JiraLink[]>("get_all_jira_links");
      } catch {
        logger.debug("No JIRA links found");
      }
    }

    // Fetch signatures
    let signatures: SignatureData[] = [];
    if (f.showSignatures) {
      try {
        signatures = await invoke<SignatureData[]>("get_top_signatures", {
          limit: 50,
          status: null,
        });
      } catch {
        logger.debug("No signatures found");
      }
    }

    // Build analysis nodes
    for (const analysis of analyses) {
      const nodeId = `analysis:${analysis.id}`;
      if (!nodeIds.has(nodeId)) {
        nodeIds.add(nodeId);
        nodes.push({
          id: nodeId,
          type: "analysis",
          label: truncate(analysis.filename, 25),
          subLabel: analysis.error_type,
          severity: analysis.severity.toLowerCase(),
          data: analysis,
        });
      }
    }

    // Build JIRA nodes and edges
    const jiraKeys = new Set<string>();
    for (const link of jiraLinks) {
      const jiraNodeId = `jira:${link.jiraKey}`;
      const analysisNodeId = `analysis:${link.analysisId}`;

      // Add JIRA node if not exists
      if (!jiraKeys.has(link.jiraKey)) {
        jiraKeys.add(link.jiraKey);
        nodes.push({
          id: jiraNodeId,
          type: "jira",
          label: link.jiraKey,
          subLabel: truncate(link.jiraSummary || "", 30),
          status: link.jiraStatus,
          data: link,
        });
        nodeIds.add(jiraNodeId);
      }

      // Add edge if analysis node exists
      if (nodeIds.has(analysisNodeId)) {
        edges.push({
          id: `link:${link.analysisId}:${link.jiraKey}`,
          source: analysisNodeId,
          target: jiraNodeId,
          type: "jira_link",
          label: link.linkType,
        });
      }
    }

    // Build signature nodes and edges
    for (const sig of signatures) {
      if (sig.occurrence_count < 2) continue; // Only show signatures with multiple occurrences

      const sigNodeId = `signature:${sig.hash.slice(0, 8)}`;
      nodes.push({
        id: sigNodeId,
        type: "signature",
        label: truncate(sig.error_type, 20),
        subLabel: `${sig.occurrence_count} occurrences`,
        status: sig.status,
        data: sig,
      });
      nodeIds.add(sigNodeId);

      // Find analyses with this signature and create edges
      // (This requires additional data - for now we'll skip signature edges)
    }

    // Calculate stats
    const stats = {
      totalNodes: nodes.length,
      analysisCount: nodes.filter(n => n.type === "analysis").length,
      jiraCount: nodes.filter(n => n.type === "jira").length,
      signatureCount: nodes.filter(n => n.type === "signature").length,
      edgeCount: edges.length,
    };

    logger.info("Built knowledge graph", { stats });

    return { nodes, edges, stats };

  } catch (e) {
    logger.error("Failed to build knowledge graph", { error: e });
    throw e;
  }
}

// ============================================================================
// Force-Directed Layout
// ============================================================================

const SIMULATION_ITERATIONS = 100;

/**
 * Apply force-directed layout to graph nodes
 */
export function applyForceLayout(
  graph: KnowledgeGraph,
  width: number,
  height: number
): KnowledgeGraph {
  const { nodes, edges } = graph;

  // Initialize positions randomly
  for (const node of nodes) {
    node.x = Math.random() * width;
    node.y = Math.random() * height;
    node.vx = 0;
    node.vy = 0;
  }

  // Create node lookup
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Run simulation
  for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
    const alpha = 1 - i / SIMULATION_ITERATIONS;

    // Apply forces
    applyRepulsion(nodes, alpha);
    applyAttraction(edges, nodeMap, alpha);
    applyCenter(nodes, width, height, alpha);
    applyBounds(nodes, width, height);

    // Update positions
    for (const node of nodes) {
      if (node.fx != null) {
        node.x = node.fx;
        node.vx = 0;
      } else {
        node.vx! *= 0.6; // Friction
        node.x! += node.vx!;
      }
      if (node.fy != null) {
        node.y = node.fy;
        node.vy = 0;
      } else {
        node.vy! *= 0.6;
        node.y! += node.vy!;
      }
    }
  }

  return graph;
}

function applyRepulsion(nodes: GraphNode[], alpha: number): void {
  const strength = 500 * alpha;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x! - nodes[i].x!;
      const dy = nodes[j].y! - nodes[i].y!;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = strength / (dist * dist);

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      nodes[i].vx! -= fx;
      nodes[i].vy! -= fy;
      nodes[j].vx! += fx;
      nodes[j].vy! += fy;
    }
  }
}

function applyAttraction(
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
  alpha: number
): void {
  const strength = 0.1 * alpha;
  const targetLength = 100;

  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const dx = target.x! - source.x!;
    const dy = target.y! - source.y!;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - targetLength) * strength;

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    source.vx! += fx;
    source.vy! += fy;
    target.vx! -= fx;
    target.vy! -= fy;
  }
}

function applyCenter(
  nodes: GraphNode[],
  width: number,
  height: number,
  alpha: number
): void {
  const cx = width / 2;
  const cy = height / 2;
  const strength = 0.05 * alpha;

  for (const node of nodes) {
    node.vx! += (cx - node.x!) * strength;
    node.vy! += (cy - node.y!) * strength;
  }
}

function applyBounds(nodes: GraphNode[], width: number, height: number): void {
  const padding = 50;
  for (const node of nodes) {
    node.x = Math.max(padding, Math.min(width - padding, node.x!));
    node.y = Math.max(padding, Math.min(height - padding, node.y!));
  }
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Get node color based on type and severity
 */
export function getNodeColor(node: GraphNode): string {
  switch (node.type) {
    case "analysis":
      switch (node.severity) {
        case "critical":
          return "#ef4444"; // red-500
        case "high":
          return "#f97316"; // orange-500
        case "medium":
          return "#eab308"; // yellow-500
        case "low":
          return "#5420e8"; // cobalt-500
        default:
          return "#6b7280"; // gray-500
      }
    case "jira":
      return "#22c55e"; // green-500
    case "signature":
      return "#7e6db6"; // mauve-500
    default:
      return "#6b7280";
  }
}

/**
 * Get node radius based on type
 */
export function getNodeRadius(node: GraphNode): number {
  switch (node.type) {
    case "analysis":
      return 8;
    case "jira":
      return 10;
    case "signature":
      return 12;
    default:
      return 8;
  }
}
