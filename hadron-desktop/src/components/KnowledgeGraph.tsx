/**
 * Knowledge Graph Visualization Component
 * Phase 3: Interactive SVG visualization of crash-ticket relationships
 *
 * Features:
 * - Force-directed graph layout
 * - Drag and zoom
 * - Node selection and details
 * - Filter by node type and severity
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Filter, X, Info } from "lucide-react";
import {
  buildKnowledgeGraph,
  applyForceLayout,
  getNodeColor,
  getNodeRadius,
  type KnowledgeGraph as KnowledgeGraphType,
  type GraphNode,
  type GraphFilter,
  DEFAULT_FILTER,
} from "../services/knowledge-graph";
import logger from "../services/logger";

interface KnowledgeGraphProps {
  /** Callback when a node is selected */
  onNodeSelect?: (node: GraphNode) => void;
  /** Initial filter */
  initialFilter?: Partial<GraphFilter>;
}

export default function KnowledgeGraph({
  onNodeSelect,
  initialFilter,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [graph, setGraph] = useState<KnowledgeGraphType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GraphFilter>({ ...DEFAULT_FILTER, ...initialFilter });
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // View state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<{ node: GraphNode; startX: number; startY: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);

  // Load graph data
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let data = await buildKnowledgeGraph(filter);

      // Get container dimensions
      const width = containerRef.current?.clientWidth || 800;
      const height = containerRef.current?.clientHeight || 600;

      // Apply layout
      data = applyForceLayout(data, width, height);

      setGraph(data);
      setViewBox({ x: 0, y: 0, width, height });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logger.error("Failed to load knowledge graph", { error: e });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Handle zoom
  const handleZoom = (delta: number) => {
    const newZoom = Math.max(0.5, Math.min(3, zoom + delta));
    setZoom(newZoom);

    const factor = 1 / newZoom;
    const width = (containerRef.current?.clientWidth || 800) * factor;
    const height = (containerRef.current?.clientHeight || 600) * factor;

    setViewBox(prev => ({
      ...prev,
      width,
      height,
    }));
  };

  // Handle node drag
  const handleNodeMouseDown = (e: React.MouseEvent, node: GraphNode) => {
    e.stopPropagation();
    setDragging({ node, startX: e.clientX, startY: e.clientY });
    node.fx = node.x;
    node.fy = node.y;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) {
      const dx = (e.clientX - dragging.startX) / zoom;
      const dy = (e.clientY - dragging.startY) / zoom;
      dragging.node.x = (dragging.node.fx || 0) + dx;
      dragging.node.y = (dragging.node.fy || 0) + dy;
      setGraph({ ...graph! });
    } else if (panning) {
      const dx = (e.clientX - panning.startX) / zoom;
      const dy = (e.clientY - panning.startY) / zoom;
      setViewBox(prev => ({
        ...prev,
        x: panning.viewX - dx,
        y: panning.viewY - dy,
      }));
    }
  };

  const handleMouseUp = () => {
    if (dragging) {
      dragging.node.fx = dragging.node.x;
      dragging.node.fy = dragging.node.y;
    }
    setDragging(null);
    setPanning(null);
  };

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      setPanning({
        startX: e.clientX,
        startY: e.clientY,
        viewX: viewBox.x,
        viewY: viewBox.y,
      });
    }
  };

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
    onNodeSelect?.(node);
  };

  const handleResetView = () => {
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;
    setViewBox({ x: 0, y: 0, width, height });
    setZoom(1);
  };

  // Render loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-900/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Building knowledge graph...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-gray-900/50 rounded-lg border border-red-500/30">
        <div className="text-red-400 mb-4">{error}</div>
        <button
          onClick={loadGraph}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-gray-900/50 rounded-lg border border-gray-700">
        <Info className="w-12 h-12 text-gray-500 mb-4" />
        <p className="text-gray-400 mb-2">No data to visualize</p>
        <p className="text-sm text-gray-500">
          Link JIRA tickets to analyses to see the knowledge graph
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-[600px] bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          onClick={loadGraph}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleZoom(0.2)}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleZoom(-0.2)}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetView}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          title="Reset view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          className={`p-2 rounded-lg transition ${
            showFilterPanel ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"
          }`}
          title="Filter"
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="absolute top-3 right-3 z-10 text-xs text-gray-500 bg-gray-800/80 px-3 py-1.5 rounded-lg">
        {graph.stats.totalNodes} nodes • {graph.stats.edgeCount} edges
      </div>

      {/* Filter Panel */}
      {showFilterPanel && (
        <div className="absolute top-14 left-3 z-10 w-64 bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-sm">Filters</h4>
            <button onClick={() => setShowFilterPanel(false)}>
              <X className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
          </div>

          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filter.showAnalyses}
                onChange={(e) => setFilter({ ...filter, showAnalyses: e.target.checked })}
                className="rounded"
              />
              <span>Analyses</span>
              <span className="text-xs text-gray-500">({graph.stats.analysisCount})</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filter.showJiraTickets}
                onChange={(e) => setFilter({ ...filter, showJiraTickets: e.target.checked })}
                className="rounded"
              />
              <span>JIRA Tickets</span>
              <span className="text-xs text-gray-500">({graph.stats.jiraCount})</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filter.showSignatures}
                onChange={(e) => setFilter({ ...filter, showSignatures: e.target.checked })}
                className="rounded"
              />
              <span>Signatures</span>
              <span className="text-xs text-gray-500">({graph.stats.signatureCount})</span>
            </label>

            <div>
              <label className="block text-gray-400 mb-1">Max nodes</label>
              <input
                type="range"
                min="20"
                max="200"
                value={filter.maxNodes}
                onChange={(e) => setFilter({ ...filter, maxNodes: Number(e.target.value) })}
                className="w-full"
              />
              <span className="text-xs text-gray-500">{filter.maxNodes}</span>
            </div>
          </div>
        </div>
      )}

      {/* SVG Graph */}
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Edges */}
        <g className="edges">
          {graph.edges.map((edge) => {
            const source = graph.nodes.find(n => n.id === edge.source);
            const target = graph.nodes.find(n => n.id === edge.target);
            if (!source || !target) return null;

            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={edge.type === "jira_link" ? "#3b82f6" : "#6b7280"}
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g className="nodes">
          {graph.nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer"
              onMouseDown={(e) => handleNodeMouseDown(e, node)}
              onClick={() => handleNodeClick(node)}
              onMouseEnter={() => setHoveredNode(node)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Node circle */}
              <circle
                r={getNodeRadius(node) * (selectedNode?.id === node.id ? 1.3 : 1)}
                fill={getNodeColor(node)}
                stroke={selectedNode?.id === node.id ? "#fff" : "transparent"}
                strokeWidth={2}
                className="transition-all duration-150"
              />

              {/* Node icon based on type */}
              {node.type === "jira" && (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="8"
                  fontWeight="bold"
                >
                  J
                </text>
              )}
              {node.type === "signature" && (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize="8"
                  fontWeight="bold"
                >
                  S
                </text>
              )}

              {/* Label (shown on hover) */}
              {hoveredNode?.id === node.id && (
                <g>
                  <rect
                    x={-60}
                    y={getNodeRadius(node) + 5}
                    width={120}
                    height={36}
                    rx={4}
                    fill="rgba(31, 41, 55, 0.95)"
                    stroke="#374151"
                  />
                  <text
                    y={getNodeRadius(node) + 20}
                    textAnchor="middle"
                    fill="white"
                    fontSize="10"
                    fontWeight="medium"
                  >
                    {node.label}
                  </text>
                  {node.subLabel && (
                    <text
                      y={getNodeRadius(node) + 32}
                      textAnchor="middle"
                      fill="#9ca3af"
                      fontSize="8"
                    >
                      {node.subLabel}
                    </text>
                  )}
                </g>
              )}
            </g>
          ))}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 text-xs bg-gray-800/80 px-3 py-2 rounded-lg">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Critical</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-orange-500" />
          <span>High</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span>Medium</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>JIRA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-purple-500" />
          <span>Signature</span>
        </div>
      </div>

      {/* Selected Node Details */}
      {selectedNode && (
        <div className="absolute bottom-3 right-3 z-10 w-72 bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: getNodeColor(selectedNode) }}
              />
              <span className="font-medium capitalize">{selectedNode.type}</span>
            </div>
            <button onClick={() => setSelectedNode(null)}>
              <X className="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">Name:</span>
              <span className="ml-2">{selectedNode.label}</span>
            </div>
            {selectedNode.subLabel && (
              <div>
                <span className="text-gray-400">Details:</span>
                <span className="ml-2 text-gray-300">{selectedNode.subLabel}</span>
              </div>
            )}
            {selectedNode.severity && (
              <div>
                <span className="text-gray-400">Severity:</span>
                <span className={`ml-2 capitalize ${
                  selectedNode.severity === "critical" ? "text-red-400" :
                  selectedNode.severity === "high" ? "text-orange-400" :
                  selectedNode.severity === "medium" ? "text-yellow-400" :
                  "text-blue-400"
                }`}>
                  {selectedNode.severity}
                </span>
              </div>
            )}
            {selectedNode.status && (
              <div>
                <span className="text-gray-400">Status:</span>
                <span className="ml-2">{selectedNode.status}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
