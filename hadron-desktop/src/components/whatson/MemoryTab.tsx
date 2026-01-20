import { HardDrive, AlertTriangle } from "lucide-react";
import type { MemoryAnalysis, MemorySpace } from "../../types";
import { formatMemoryValue, calculatePercentage } from "../../utils/whatsOnParser";

interface MemoryTabProps {
  memory?: MemoryAnalysis;
}

interface MemorySpaceCardProps {
  name: string;
  space?: MemorySpace;
  color: string;
}

function MemorySpaceCard({ name, space, color }: MemorySpaceCardProps) {
  const percentage = space?.percentUsed ?? calculatePercentage(space?.used, space?.total);

  const getPercentageColor = (pct: number) => {
    if (pct >= 90) return "bg-red-500";
    if (pct >= 75) return "bg-orange-500";
    if (pct >= 50) return "bg-yellow-500";
    return color;
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold">{name}</h4>
        <span className="text-sm text-gray-400">
          {formatMemoryValue(space?.used, space?.total)}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${getPercentageColor(percentage)}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-sm">
        <span className="text-gray-400">Usage</span>
        <span className={`font-semibold ${percentage >= 90 ? "text-red-400" : percentage >= 75 ? "text-orange-400" : "text-gray-200"}`}>
          {percentage}%
        </span>
      </div>
    </div>
  );
}

export default function MemoryTab({ memory }: MemoryTabProps) {
  if (!memory) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <HardDrive className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-semibold">Memory Analysis</h3>
        </div>
        <div className="text-center py-8 text-gray-400">
          <HardDrive className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No memory information available</p>
        </div>
      </div>
    );
  }

  const hasSpaceData = memory.oldSpace || memory.newSpace || memory.permSpace;

  return (
    <div className="space-y-6">
      {/* Memory Spaces */}
      {hasSpaceData && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <HardDrive className="w-5 h-5 text-green-400" />
            <h3 className="text-lg font-semibold">Memory Spaces</h3>
          </div>
          <div className="p-4 grid md:grid-cols-3 gap-4">
            {memory.oldSpace && (
              <MemorySpaceCard name="Old Space" space={memory.oldSpace} color="bg-blue-500" />
            )}
            {memory.newSpace && (
              <MemorySpaceCard name="New Space" space={memory.newSpace} color="bg-green-500" />
            )}
            {memory.permSpace && (
              <MemorySpaceCard name="Perm Space" space={memory.permSpace} color="bg-purple-500" />
            )}
          </div>
        </div>
      )}

      {/* Memory Warnings */}
      {memory.warnings && memory.warnings.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-700">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold">Memory Warnings</h3>
          </div>
          <div className="p-4 space-y-2">
            {memory.warnings.map((warning, index) => (
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

      {/* Memory Tips */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Memory Space Reference</h4>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-blue-400 font-semibold">Old Space</span>
            <p className="text-gray-400 mt-1">
              Long-lived objects that survived multiple GC cycles. High usage may indicate memory leaks.
            </p>
          </div>
          <div>
            <span className="text-green-400 font-semibold">New Space</span>
            <p className="text-gray-400 mt-1">
              Recently allocated objects. High churn here is normal during active processing.
            </p>
          </div>
          <div>
            <span className="text-purple-400 font-semibold">Perm Space</span>
            <p className="text-gray-400 mt-1">
              Permanent objects like classes and methods. Typically stable after system startup.
            </p>
          </div>
        </div>
      </div>

      {/* No Data */}
      {!hasSpaceData && (!memory.warnings || memory.warnings.length === 0) && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="text-center py-8 text-gray-400">
            <HardDrive className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No memory information available</p>
          </div>
        </div>
      )}
    </div>
  );
}
