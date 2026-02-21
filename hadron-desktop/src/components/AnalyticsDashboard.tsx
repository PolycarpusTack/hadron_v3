import { useState } from "react";
import { BarChart3, Star, FileText, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import type { DatabaseStatistics } from "../services/api";
import { TrendChart } from "./TrendChart";
import { getSeverityBarColor } from "../utils/severity";

interface AnalyticsDashboardProps {
  statistics: DatabaseStatistics;
}

export default function AnalyticsDashboard({ statistics }: AnalyticsDashboardProps) {
  const totalAnalyses = statistics.severity_breakdown.reduce((sum, [_, count]) => sum + count, 0);
  const [showTrends, setShowTrends] = useState(false);

  return (
    <div className="space-y-4 mb-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total Analyses */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <FileText className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Total Analyses</p>
            <p className="text-2xl font-bold">{statistics.total_count}</p>
          </div>
        </div>
      </div>

      {/* Favorites */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Favorites</p>
            <p className="text-2xl font-bold">{statistics.favorite_count}</p>
          </div>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <BarChart3 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400">By Severity</p>
          </div>
        </div>

        {/* Severity bars */}
        <div className="space-y-2">
          {statistics.severity_breakdown
            .sort((a, b) => b[1] - a[1]) // Sort by count descending
            .map(([severity, count]) => {
              const percentage = totalAnalyses > 0 ? (count / totalAnalyses) * 100 : 0;
              const color = getSeverityBarColor(severity);

              return (
                <div key={severity} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16 uppercase">{severity}</span>
                  <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className={`${color} h-full transition-all duration-300`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-gray-300 w-8 text-right">{count}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>

      {/* Trend Chart Toggle */}
      <button
        onClick={() => setShowTrends(!showTrends)}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-800/50
                   border border-gray-700 rounded-lg text-gray-400 hover:text-white
                   hover:bg-gray-800 transition"
      >
        <TrendingUp className="w-4 h-4" />
        <span className="text-sm">{showTrends ? "Hide" : "Show"} Trend Analysis</span>
        {showTrends ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Trend Chart (Collapsible) */}
      {showTrends && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <TrendChart period="day" rangeDays={30} />
        </div>
      )}
    </div>
  );
}
