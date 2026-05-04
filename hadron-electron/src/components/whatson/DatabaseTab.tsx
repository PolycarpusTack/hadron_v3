import { Database, Link, User, AlertTriangle } from "lucide-react";
import type { DatabaseAnalysis } from "../../types";

interface DatabaseTabProps {
  database?: DatabaseAnalysis;
}

export default function DatabaseTab({ database }: DatabaseTabProps) {
  if (!database) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold">Database Analysis</h3>
        </div>
        <div className="text-center py-8 text-gray-400">
          <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No database information available</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes("connected") || statusLower.includes("active") || statusLower.includes("open")) {
      return "text-green-400";
    }
    if (statusLower.includes("error") || statusLower.includes("failed") || statusLower.includes("closed")) {
      return "text-red-400";
    }
    if (statusLower.includes("idle") || statusLower.includes("waiting")) {
      return "text-yellow-400";
    }
    return "text-gray-400";
  };

  const getTransactionStateColor = (state: string) => {
    switch (state?.toLowerCase()) {
      case "open":
        return "bg-yellow-500/20 text-yellow-400";
      case "committed":
        return "bg-green-500/20 text-green-400";
      case "rolled_back":
        return "bg-red-500/20 text-red-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  return (
    <div className="space-y-6">
      {/* Transaction State */}
      {database.transactionState && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Transaction State</span>
            <span className={`px-3 py-1 rounded font-semibold ${getTransactionStateColor(database.transactionState)}`}>
              {database.transactionState.replace("_", " ").toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Connections */}
      {database.connections && database.connections.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <Link className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-semibold">Connections</h3>
            <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs font-semibold">
              {database.connections.length}
            </span>
          </div>
          <div className="p-4">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Database</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {database.connections.map((conn, index) => (
                  <tr key={index} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-3">
                      <code className="text-cyan-400 font-mono">{conn.name}</code>
                    </td>
                    <td className="py-3 text-gray-300">{conn.database || "N/A"}</td>
                    <td className="py-3">
                      <span className={`font-semibold ${getStatusColor(conn.status)}`}>
                        {conn.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      {database.activeSessions && database.activeSessions.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <User className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold">Active Sessions</h3>
            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-semibold">
              {database.activeSessions.length}
            </span>
          </div>
          <div className="p-4">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Session ID</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Last Operation</th>
                </tr>
              </thead>
              <tbody>
                {database.activeSessions.map((session, index) => (
                  <tr key={index} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-3">
                      <code className="text-purple-400 font-mono">{session.id}</code>
                    </td>
                    <td className="py-3">
                      <span className={`font-semibold ${getStatusColor(session.status)}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-300 text-sm">
                      {session.lastOperation || "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Database Warnings */}
      {database.warnings && database.warnings.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold">Database Warnings</h3>
          </div>
          <div className="p-4 space-y-2">
            {database.warnings.map((warning, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
              >
                <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-200">{warning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Data */}
      {(!database.connections || database.connections.length === 0) &&
        (!database.activeSessions || database.activeSessions.length === 0) &&
        (!database.warnings || database.warnings.length === 0) &&
        !database.transactionState && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="text-center py-8 text-gray-400">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No database information available</p>
            </div>
          </div>
        )}
    </div>
  );
}
