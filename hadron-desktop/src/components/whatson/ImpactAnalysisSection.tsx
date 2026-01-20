import { AlertTriangle, Shield, Zap } from "lucide-react";
import type { WhatsOnImpactAnalysis } from "../../types";
import { getDataRiskColor, getSeverityColor } from "../../utils/whatsOnParser";

interface ImpactAnalysisSectionProps {
  impact: WhatsOnImpactAnalysis;
}

export default function ImpactAnalysisSection({ impact }: ImpactAnalysisSectionProps) {
  const getDataRiskBadge = (risk: string) => {
    const color = getDataRiskColor(risk);
    return (
      <span className={`px-3 py-1 rounded text-sm font-semibold ${color} bg-gray-700/50`}>
        {risk.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-orange-400" />
          <h3 className="text-lg font-semibold">Impact Analysis</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Data at Risk:</span>
          {getDataRiskBadge(impact.dataAtRisk)}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Data Risk Description */}
        {impact.dataRiskDescription && (
          <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-sm text-gray-200">{impact.dataRiskDescription}</p>
            </div>
          </div>
        )}

        {/* Directly Affected Features */}
        {impact.directlyAffected && impact.directlyAffected.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Directly Affected ({impact.directlyAffected.length})
            </h4>
            <div className="grid gap-3">
              {impact.directlyAffected.map((feature, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${getSeverityColor(feature.severity)}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{feature.feature}</span>
                        <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                          {feature.module}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">{feature.description}</p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold uppercase ${getSeverityColor(
                        feature.severity
                      )}`}
                    >
                      {feature.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Potentially Affected Features */}
        {impact.potentiallyAffected && impact.potentiallyAffected.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Potentially Affected ({impact.potentiallyAffected.length})
            </h4>
            <div className="grid gap-3">
              {impact.potentiallyAffected.map((feature, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-200">{feature.feature}</span>
                        <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                          {feature.module}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">{feature.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No Impact Case */}
        {(!impact.directlyAffected || impact.directlyAffected.length === 0) &&
          (!impact.potentiallyAffected || impact.potentiallyAffected.length === 0) && (
            <div className="text-center py-6 text-gray-400">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No significant feature impact identified</p>
            </div>
          )}
      </div>
    </div>
  );
}
