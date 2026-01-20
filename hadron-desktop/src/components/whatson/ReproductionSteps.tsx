import { Play, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import type { WhatsOnUserScenario } from "../../types";

interface ReproductionStepsProps {
  scenario: WhatsOnUserScenario;
}

export default function ReproductionSteps({ scenario }: ReproductionStepsProps) {
  const getLikelihoodColor = (likelihood: string) => {
    switch (likelihood.toLowerCase()) {
      case "always":
        return "text-red-400 bg-red-500/10";
      case "often":
        return "text-orange-400 bg-orange-500/10";
      case "sometimes":
        return "text-yellow-400 bg-yellow-500/10";
      case "rarely":
        return "text-blue-400 bg-blue-500/10";
      default:
        return "text-gray-400 bg-gray-500/10";
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Play className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold">User Scenario & Reproduction</h3>
        </div>
        <span className={`px-3 py-1 rounded text-xs font-semibold ${getLikelihoodColor(scenario.reproductionLikelihood)}`}>
          <RefreshCw className="w-3 h-3 inline mr-1" />
          {scenario.reproductionLikelihood}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Description */}
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-2">What the user was trying to do</h4>
          <p className="text-gray-200">{scenario.description}</p>
        </div>

        {/* Workflow */}
        {scenario.workflow && (
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
            <span className="text-sm text-purple-400 font-semibold">Workflow: </span>
            <span className="text-gray-200">{scenario.workflow}</span>
          </div>
        )}

        {/* Steps Timeline */}
        {scenario.steps && scenario.steps.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-3">Reproduction Steps</h4>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-700" />

              <div className="space-y-4">
                {scenario.steps.map((step, index) => (
                  <div key={index} className="relative flex gap-4">
                    {/* Step indicator */}
                    <div
                      className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                        step.isCrashPoint
                          ? "bg-red-500 text-white"
                          : "bg-gray-700 text-gray-300"
                      }`}
                    >
                      {step.isCrashPoint ? (
                        <AlertCircle className="w-4 h-4" />
                      ) : (
                        <span className="text-sm font-semibold">{step.step}</span>
                      )}
                    </div>

                    {/* Step content */}
                    <div
                      className={`flex-1 p-3 rounded-lg ${
                        step.isCrashPoint
                          ? "bg-red-500/10 border border-red-500/30"
                          : "bg-gray-700/50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className={`font-medium ${step.isCrashPoint ? "text-red-400" : "text-gray-200"}`}>
                            {step.action}
                          </p>
                          {step.details && (
                            <p className="text-sm text-gray-400 mt-1">{step.details}</p>
                          )}
                        </div>
                        {step.isCrashPoint && (
                          <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs font-semibold rounded">
                            CRASH POINT
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Expected vs Actual */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-green-400">Expected Result</span>
            </div>
            <p className="text-sm text-gray-200">{scenario.expectedResult}</p>
          </div>

          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Actual Result</span>
            </div>
            <p className="text-sm text-gray-200">{scenario.actualResult}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
