import { Package, Box, Link2 } from "lucide-react";
import type { ContextInfo } from "../../types";

interface ContextTabProps {
  context?: ContextInfo;
}

export default function ContextTab({ context }: ContextTabProps) {
  if (!context) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Package className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">Context</h3>
        </div>
        <div className="text-center py-8 text-gray-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No context information available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Receiver Object */}
      {context.receiver && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <Box className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold">Receiver Object</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-400">Class</span>
                <code className="block mt-1 px-3 py-2 bg-gray-900 rounded text-purple-400 font-mono">
                  {context.receiver.class}
                </code>
              </div>
              {context.receiver.state && (
                <div>
                  <span className="text-sm text-gray-400">State</span>
                  <div className="mt-1 px-3 py-2 bg-gray-900 rounded text-gray-200">
                    {context.receiver.state}
                  </div>
                </div>
              )}
            </div>
            {context.receiver.description && (
              <div>
                <span className="text-sm text-gray-400">Description</span>
                <p className="mt-1 text-gray-200">{context.receiver.description}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Arguments */}
      {context.arguments && context.arguments.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <Package className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold">Arguments</h3>
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-semibold">
              {context.arguments.length}
            </span>
          </div>
          <div className="p-4">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {context.arguments.map((arg, index) => (
                  <tr key={index} className="border-b border-gray-700/50 last:border-0">
                    <td className="py-3">
                      <code className="text-blue-400 font-mono">{arg.name}</code>
                    </td>
                    <td className="py-3">
                      <span className="text-purple-400">{arg.type || "Unknown"}</span>
                    </td>
                    <td className="py-3">
                      <code className="text-gray-300 font-mono text-sm">
                        {arg.value || "nil"}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Related Objects */}
      {context.relatedObjects && context.relatedObjects.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <Link2 className="w-5 h-5 text-green-400" />
            <h3 className="text-lg font-semibold">Related Objects</h3>
            <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-semibold">
              {context.relatedObjects.length}
            </span>
          </div>
          <div className="p-4 space-y-3">
            {context.relatedObjects.map((obj, index) => (
              <div key={index} className="p-3 bg-gray-900 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <code className="text-green-400 font-mono">{obj.name}</code>
                  <span className="text-gray-500">:</span>
                  <code className="text-purple-400 font-mono">{obj.class}</code>
                </div>
                {obj.relationship && (
                  <p className="text-sm text-gray-400">{obj.relationship}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Data */}
      {!context.receiver &&
        (!context.arguments || context.arguments.length === 0) &&
        (!context.relatedObjects || context.relatedObjects.length === 0) && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="text-center py-8 text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No context information available</p>
            </div>
          </div>
        )}
    </div>
  );
}
