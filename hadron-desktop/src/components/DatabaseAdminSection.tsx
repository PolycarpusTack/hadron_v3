import { useState, useEffect } from "react";
import {
  Database,
  HardDrive,
  Calendar,
  Star,
  FileText,
  Languages,
  AlertTriangle,
  Check,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { getDatabaseInfo } from "../services/api";
import type { DatabaseInfo } from "../types";
import { formatDistanceToNow } from "date-fns";

interface DatabaseAdminSectionProps {
  onRefresh?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function DatabaseAdminSection({ onRefresh }: DatabaseAdminSectionProps) {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDatabaseInfo();
  }, []);

  const loadDatabaseInfo = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getDatabaseInfo();
      setInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load database info");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await loadDatabaseInfo();
    onRefresh?.();
  };

  if (loading) {
    return (
      <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          <span className="text-gray-400">Loading database info...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Failed to load database info</p>
            <p className="text-sm text-gray-400 mt-1">{error}</p>
            <button
              onClick={loadDatabaseInfo}
              className="mt-2 text-sm text-blue-400 hover:text-blue-300"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div className="space-y-4">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold">Database Status</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1.5 hover:bg-gray-700 rounded transition"
          title="Refresh database info"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Schema Version & Migration Status */}
      <div
        className={`p-4 rounded-lg border ${
          info.needs_migration
            ? "bg-yellow-500/10 border-yellow-500/30"
            : "bg-green-500/10 border-green-500/30"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {info.needs_migration ? (
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            ) : (
              <Check className="w-5 h-5 text-green-400" />
            )}
            <div>
              <p className="font-medium">
                Schema Version: <span className="font-mono">{info.schema_version}</span>
              </p>
              <p className="text-sm text-gray-400">
                {info.needs_migration
                  ? "Migration required - database schema is outdated"
                  : "Database schema is up to date"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Analyses Count */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <FileText className="w-4 h-4" />
            <span className="text-xs">Analyses</span>
          </div>
          <p className="text-2xl font-bold">{info.analyses_count.toLocaleString()}</p>
        </div>

        {/* Translations Count */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Languages className="w-4 h-4" />
            <span className="text-xs">Translations</span>
          </div>
          <p className="text-2xl font-bold">{info.translations_count.toLocaleString()}</p>
        </div>

        {/* Favorites Count */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Star className="w-4 h-4" />
            <span className="text-xs">Favorites</span>
          </div>
          <p className="text-2xl font-bold">{info.favorites_count.toLocaleString()}</p>
        </div>

        {/* Database Size */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <HardDrive className="w-4 h-4" />
            <span className="text-xs">Database Size</span>
          </div>
          <p className="text-2xl font-bold">
            {info.database_size_bytes
              ? formatBytes(info.database_size_bytes)
              : "Unknown"}
          </p>
        </div>
      </div>

      {/* Last Analysis */}
      {info.last_analysis_at && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Calendar className="w-4 h-4" />
            <span className="text-xs">Last Analysis</span>
          </div>
          <p className="text-sm">
            {formatDistanceToNow(new Date(info.last_analysis_at), { addSuffix: true })}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {new Date(info.last_analysis_at).toLocaleString()}
          </p>
        </div>
      )}

      {/* Database Path Info */}
      <div className="text-xs text-gray-500 p-3 bg-gray-900/30 rounded-lg">
        <p className="font-medium text-gray-400 mb-1">Storage Location</p>
        <p className="font-mono break-all">
          {navigator.platform.includes("Win")
            ? "%APPDATA%\\hadron\\analyses.db"
            : navigator.platform.includes("Mac")
            ? "~/Library/Application Support/hadron/analyses.db"
            : "~/.local/share/hadron/analyses.db"}
        </p>
      </div>
    </div>
  );
}
