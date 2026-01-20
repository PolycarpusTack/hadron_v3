import { TestTube, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { TestScenario } from "../../types";
import { getPriorityColor } from "../../utils/whatsOnParser";

interface TestScenariosSectionProps {
  scenarios: TestScenario[];
}

export default function TestScenariosSection({ scenarios }: TestScenariosSectionProps) {
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set([scenarios[0]?.id]));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleScenario = (id: string) => {
    const newExpanded = new Set(expandedScenarios);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedScenarios(newExpanded);
  };

  const getTestTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "regression":
        return "bg-red-500/20 text-red-400";
      case "smoke":
        return "bg-green-500/20 text-green-400";
      case "integration":
        return "bg-purple-500/20 text-purple-400";
      case "unit":
        return "bg-blue-500/20 text-blue-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  const copyScenario = (scenario: TestScenario) => {
    const text = `
Test Scenario: ${scenario.name}
ID: ${scenario.id}
Priority: ${scenario.priority}
Type: ${scenario.type}

Description:
${scenario.description}

Steps:
${scenario.steps}

Expected Result:
${scenario.expectedResult}

${scenario.dataRequirements ? `Data Requirements:\n${scenario.dataRequirements}` : ""}
    `.trim();

    navigator.clipboard.writeText(text);
    setCopiedId(scenario.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!scenarios || scenarios.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <TestTube className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold">Test Scenarios</h3>
        </div>
        <div className="text-center py-6 text-gray-400">
          <TestTube className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No test scenarios generated</p>
        </div>
      </div>
    );
  }

  // Group scenarios by priority
  const p0 = scenarios.filter((s) => s.priority === "P0");
  const p1 = scenarios.filter((s) => s.priority === "P1");
  const p2 = scenarios.filter((s) => s.priority === "P2");

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <TestTube className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold">Test Scenarios</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {p0.length > 0 && (
            <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded font-semibold">
              {p0.length} P0
            </span>
          )}
          {p1.length > 0 && (
            <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded font-semibold">
              {p1.length} P1
            </span>
          )}
          {p2.length > 0 && (
            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded font-semibold">
              {p2.length} P2
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {scenarios.map((scenario) => (
          <div key={scenario.id} className="bg-gray-900 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleScenario(scenario.id)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition"
            >
              <div className="flex items-center gap-3">
                {expandedScenarios.has(scenario.id) ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <span className="font-mono text-xs text-gray-500">{scenario.id}</span>
                <span className="font-medium text-gray-200">{scenario.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getTestTypeColor(scenario.type)}`}>
                  {scenario.type}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getPriorityColor(scenario.priority)}`}>
                  {scenario.priority}
                </span>
              </div>
            </button>

            {expandedScenarios.has(scenario.id) && (
              <div className="px-4 pb-4 border-t border-gray-800 space-y-4">
                {/* Description */}
                <div className="mt-3">
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Description</h5>
                  <p className="text-sm text-gray-300">{scenario.description}</p>
                </div>

                {/* Steps */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Steps</h5>
                  <pre className="p-3 bg-gray-800 rounded text-sm text-gray-300 whitespace-pre-wrap font-sans">
                    {scenario.steps}
                  </pre>
                </div>

                {/* Expected Result */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Expected Result</h5>
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded text-sm text-gray-200">
                    {scenario.expectedResult}
                  </div>
                </div>

                {/* Data Requirements */}
                {scenario.dataRequirements && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-400 mb-1">Data Requirements</h5>
                    <p className="text-sm text-gray-400">{scenario.dataRequirements}</p>
                  </div>
                )}

                {/* Copy Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => copyScenario(scenario)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                  >
                    {copiedId === scenario.id ? (
                      <>
                        <Check className="w-3 h-3 text-green-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy Scenario
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
