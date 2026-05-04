import { FileText, Layers, ListChecks } from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";
import { parseAnalysis, type ParsedAnalysis, type AnalysisPart } from "../utils/analysisParser";

interface MultiPartAnalysisViewerProps {
  rootCause: string;
  className?: string;
}

/**
 * Component for rendering multi-part analyses with collapsible sections
 * Supports Complete Analysis (10 parts) and Specialized Analyses Suite (8 parts)
 */
export default function MultiPartAnalysisViewer({ rootCause, className = "" }: MultiPartAnalysisViewerProps) {
  const parsed: ParsedAnalysis = parseAnalysis(rootCause);

  // Get icon based on analysis type
  const getIcon = () => {
    switch (parsed.type) {
      case 'complete':
        return <FileText className="w-5 h-5" />;
      case 'specialized':
        return <Layers className="w-5 h-5" />;
      default:
        return <ListChecks className="w-5 h-5" />;
    }
  };

  // Get title based on analysis type
  const getTitle = () => {
    switch (parsed.type) {
      case 'complete':
        return 'Complete Root Cause Analysis';
      case 'specialized':
        return 'Specialized Analyses Suite';
      default:
        return 'Root Cause Analysis';
    }
  };

  // Get badge based on analysis type
  const getBadge = () => {
    if (parsed.type === 'complete') {
      return (
        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-semibold">
          10 Parts
        </span>
      );
    }
    if (parsed.type === 'specialized') {
      return (
        <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs font-semibold">
          8 Analyses
        </span>
      );
    }
    return null;
  };

  // Render simple analysis (single section)
  if (parsed.type === 'simple') {
    return (
      <CollapsibleSection
        title={getTitle()}
        icon={getIcon()}
        className={className}
      >
        <div className="text-gray-300 leading-relaxed whitespace-pre-wrap text-left">
          {rootCause}
        </div>
      </CollapsibleSection>
    );
  }

  // Render multi-part analysis with individual collapsible sections
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {getIcon()}
          <h3 className="text-xl font-semibold">{getTitle()}</h3>
          {getBadge()}
        </div>
      </div>

      {/* Individual parts as collapsible sections */}
      <div className="space-y-3">
        {parsed.parts.map((part: AnalysisPart) => (
          <CollapsibleSection
            key={part.index}
            title={part.title}
            className={`${className} bg-gray-900/30`}
            defaultOpen={part.index === 0} // Only first section open by default
          >
            <div className="text-gray-300 leading-relaxed whitespace-pre-wrap text-left">
              {part.content}
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
