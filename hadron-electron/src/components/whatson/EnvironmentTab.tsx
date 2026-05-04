import { Server, Monitor, Database, Info } from "lucide-react";
import { format } from "date-fns";
import type { EnvironmentInfo } from "../../types";
import type { Analysis } from "../../services/api";

interface EnvironmentTabProps {
  environment?: EnvironmentInfo;
  analysis: Analysis;
}

export default function EnvironmentTab({ environment, analysis }: EnvironmentTabProps) {
  return (
    <div className="space-y-6">
      {/* Application Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Server className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">Application</h3>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-4">
            {environment?.application?.version && (
              <div>
                <span className="text-sm text-gray-400">Version</span>
                <p className="mt-1 text-gray-200 font-mono">{environment.application.version}</p>
              </div>
            )}
            {environment?.application?.build && (
              <div>
                <span className="text-sm text-gray-400">Build</span>
                <p className="mt-1 text-gray-200 font-mono">{environment.application.build}</p>
              </div>
            )}
            {environment?.application?.configuration && (
              <div className="md:col-span-2">
                <span className="text-sm text-gray-400">Configuration</span>
                <p className="mt-1 text-gray-200">{environment.application.configuration}</p>
              </div>
            )}
            {!environment?.application && (
              <div className="md:col-span-2 text-gray-400 text-sm">
                No application information extracted from crash log
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Platform Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Monitor className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-semibold">Platform</h3>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-3 gap-4">
            {environment?.platform?.os && (
              <div>
                <span className="text-sm text-gray-400">Operating System</span>
                <p className="mt-1 text-gray-200">{environment.platform.os}</p>
              </div>
            )}
            {environment?.platform?.memory && (
              <div>
                <span className="text-sm text-gray-400">Memory</span>
                <p className="mt-1 text-gray-200">{environment.platform.memory}</p>
              </div>
            )}
            {environment?.platform?.user && (
              <div>
                <span className="text-sm text-gray-400">User</span>
                <p className="mt-1 text-gray-200 font-mono">{environment.platform.user}</p>
              </div>
            )}
            {!environment?.platform && (
              <div className="md:col-span-3 text-gray-400 text-sm">
                No platform information extracted from crash log
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Database Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Database className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold">Database</h3>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-4">
            {environment?.database?.type && (
              <div>
                <span className="text-sm text-gray-400">Type</span>
                <p className="mt-1 text-gray-200">{environment.database.type}</p>
              </div>
            )}
            {environment?.database?.sessionState && (
              <div>
                <span className="text-sm text-gray-400">Session State</span>
                <p className="mt-1 text-gray-200">{environment.database.sessionState}</p>
              </div>
            )}
            {environment?.database?.connectionInfo && (
              <div className="md:col-span-2">
                <span className="text-sm text-gray-400">Connection Info</span>
                <p className="mt-1 text-gray-200 font-mono text-sm">{environment.database.connectionInfo}</p>
              </div>
            )}
            {!environment?.database && (
              <div className="md:col-span-2 text-gray-400 text-sm">
                No database information extracted from crash log
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Analysis Metadata */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Info className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold">Analysis Metadata</h3>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Analysis ID</span>
              <p className="mt-1 font-mono">{analysis.id}</p>
            </div>
            <div>
              <span className="text-gray-400">File</span>
              <p className="mt-1 truncate" title={analysis.filename}>{analysis.filename}</p>
            </div>
            <div>
              <span className="text-gray-400">File Size</span>
              <p className="mt-1">{analysis.file_size_kb.toFixed(2)} KB</p>
            </div>
            <div>
              <span className="text-gray-400">Analyzed</span>
              <p className="mt-1">{format(new Date(analysis.analyzed_at), "MMM d, yyyy h:mm a")}</p>
            </div>
            <div>
              <span className="text-gray-400">AI Model</span>
              <p className="mt-1">{analysis.ai_model}</p>
            </div>
            {analysis.ai_provider && (
              <div>
                <span className="text-gray-400">Provider</span>
                <p className="mt-1 capitalize">{analysis.ai_provider}</p>
              </div>
            )}
            <div>
              <span className="text-gray-400">Tokens Used</span>
              <p className="mt-1">{analysis.tokens_used.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-400">Cost</span>
              <p className="mt-1 text-green-400 font-semibold">${analysis.cost.toFixed(4)}</p>
            </div>
            {analysis.analysis_duration_ms && (
              <div>
                <span className="text-gray-400">Duration</span>
                <p className="mt-1">{(analysis.analysis_duration_ms / 1000).toFixed(2)}s</p>
              </div>
            )}
            <div>
              <span className="text-gray-400">Truncated</span>
              <p className="mt-1">{analysis.was_truncated ? "Yes" : "No"}</p>
            </div>
            {analysis.confidence && (
              <div>
                <span className="text-gray-400">Confidence</span>
                <p className={`mt-1 font-semibold ${
                  analysis.confidence === 'HIGH' ? 'text-green-400' :
                  analysis.confidence === 'MEDIUM' ? 'text-yellow-400' :
                  'text-orange-400'
                }`}>
                  {analysis.confidence}
                </p>
              </div>
            )}
            {analysis.view_count > 0 && (
              <div>
                <span className="text-gray-400">Views</span>
                <p className="mt-1">{analysis.view_count}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
