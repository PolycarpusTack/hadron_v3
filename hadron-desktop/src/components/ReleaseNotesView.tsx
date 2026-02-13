/**
 * Release Notes Generator - Shell View
 * Config check, amber-themed tab bar, progress events, and sub-component routing.
 */

import { useState, useEffect, useCallback } from "react";
import { FileText, Wand2, CheckCircle, BookOpen, History, AlertCircle, Loader2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isJiraEnabled } from "../services/jira";
import { getReleaseNotes } from "../services/release-notes";
import logger from "../services/logger";
import type { ReleaseNotesProgress, ReleaseNotesDraft } from "../types";

import ReleaseNotesGenerator from "./release-notes/ReleaseNotesGenerator";
import ReleaseNotesEditor from "./release-notes/ReleaseNotesEditor";
import ReleaseNotesReview from "./release-notes/ReleaseNotesReview";
import ReleaseNotesInsights from "./release-notes/ReleaseNotesInsights";
import ReleaseNotesStyleGuide from "./release-notes/ReleaseNotesStyleGuide";
import ReleaseNotesHistory from "./release-notes/ReleaseNotesHistory";

type TabId = "generate" | "review" | "style_guide" | "history";
type ReviewSubTab = "editor" | "checklist" | "insights";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "generate", label: "Generate", icon: <Wand2 className="w-4 h-4" /> },
  { id: "review", label: "Review", icon: <CheckCircle className="w-4 h-4" /> },
  { id: "style_guide", label: "Style Guide", icon: <BookOpen className="w-4 h-4" /> },
  { id: "history", label: "History", icon: <History className="w-4 h-4" /> },
];

export default function ReleaseNotesView() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("generate");
  const [reviewSubTab, setReviewSubTab] = useState<ReviewSubTab>("editor");
  const [progress, setProgress] = useState<ReleaseNotesProgress | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);

  useEffect(() => {
    isJiraEnabled().then(setConfigured).catch(() => setConfigured(false));
  }, []);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<ReleaseNotesProgress>("release-notes-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.phase === "complete" || event.payload.phase === "failed") {
        setTimeout(() => setProgress(null), 3000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleGenerated = useCallback((id: number) => {
    setActiveDraftId(id);
    setActiveTab("review");
    setReviewSubTab("editor");
    logger.info("Release notes generated, switching to review", { id });
  }, []);

  const handleOpenDraft = useCallback((id: number) => {
    setActiveDraftId(id);
    setActiveTab("review");
    setReviewSubTab("editor");
  }, []);

  // Not-configured state
  if (configured === null) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full" />
        <span className="ml-3 text-gray-400">Checking JIRA configuration...</span>
      </div>
    );
  }

  if (configured === false) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-8 text-center">
        <FileText className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">JIRA Not Configured</h3>
        <p className="text-gray-400 max-w-md mx-auto">
          The Release Notes Generator requires JIRA integration to fetch tickets.
          Configure your JIRA connection in Settings to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-amber-500/10">
          <FileText className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Release Notes Generator</h2>
          <p className="text-sm text-gray-400">
            AI-powered release notes from JIRA tickets
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      {progress && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-amber-400">{progress.message}</span>
            <span className="text-xs text-gray-500">{Math.round(progress.progress)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-amber-400 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center gap-1 border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-all text-sm font-medium ${
              activeTab === tab.id
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeTab === "generate" && (
          <ReleaseNotesGenerator
            onGenerated={handleGenerated}
            isGenerating={progress !== null && progress.phase !== "complete" && progress.phase !== "failed"}
          />
        )}
        {activeTab === "review" && (
          activeDraftId ? (
            <div className="space-y-4">
              {/* Review Sub-tabs */}
              <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-1">
                {([
                  { id: "editor" as const, label: "Editor" },
                  { id: "checklist" as const, label: "Checklist" },
                  { id: "insights" as const, label: "Insights" },
                ]).map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setReviewSubTab(sub.id)}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      reviewSubTab === sub.id
                        ? "bg-gray-700 text-amber-400"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {reviewSubTab === "editor" && (
                <ReleaseNotesEditor draftId={activeDraftId} />
              )}
              {reviewSubTab === "checklist" && (
                <ReleaseNotesReview draftId={activeDraftId} />
              )}
              {reviewSubTab === "insights" && (
                <ReleaseNotesInsightsWrapper draftId={activeDraftId} />
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-gray-600" />
              <p>No draft selected. Generate release notes or select one from History.</p>
            </div>
          )
        )}
        {activeTab === "style_guide" && <ReleaseNotesStyleGuide />}
        {activeTab === "history" && <ReleaseNotesHistory onOpenDraft={handleOpenDraft} />}
      </div>
    </div>
  );
}

/** Wrapper that loads draft data for the insights panel */
function ReleaseNotesInsightsWrapper({ draftId }: { draftId: number }) {
  const [draft, setDraft] = useState<ReleaseNotesDraft | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getReleaseNotes(draftId)
      .then((d) => setDraft(d))
      .catch(() => setDraft(null))
      .finally(() => setLoading(false));
  }, [draftId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!draft) return null;

  return (
    <ReleaseNotesInsights
      insightsJson={draft.aiInsights}
      ticketCount={draft.ticketCount}
      tokensUsed={draft.tokensUsed}
      cost={draft.cost}
      durationMs={draft.generationDurationMs}
    />
  );
}
