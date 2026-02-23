import { useEffect, useState } from "react";
import { api, FeedbackSummary } from "../../services/api";

interface FeedbackButtonsProps {
  analysisId: number;
}

export function FeedbackButtons({ analysisId }: FeedbackButtonsProps) {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [userVote, setUserVote] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionField, setCorrectionField] = useState("");
  const [correctionValue, setCorrectionValue] = useState("");

  useEffect(() => {
    api.getFeedbackSummary(analysisId).then(setSummary).catch(console.error);
  }, [analysisId]);

  const handleVote = async (type: "thumbs_up" | "thumbs_down") => {
    try {
      await api.submitFeedback(analysisId, { feedbackType: type });
      setUserVote(type);
      // Refresh summary
      const s = await api.getFeedbackSummary(analysisId);
      setSummary(s);
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    }
  };

  const handleRating = async (stars: number) => {
    try {
      await api.submitFeedback(analysisId, {
        feedbackType: "rating",
        rating: stars,
      });
      setRating(stars);
      const s = await api.getFeedbackSummary(analysisId);
      setSummary(s);
    } catch (e) {
      console.error("Failed to submit rating:", e);
    }
  };

  const handleCorrection = async () => {
    if (!correctionField.trim()) return;
    try {
      await api.submitFeedback(analysisId, {
        feedbackType: "correction",
        fieldName: correctionField,
        correctedValue: correctionValue,
      });
      setShowCorrection(false);
      setCorrectionField("");
      setCorrectionValue("");
      const s = await api.getFeedbackSummary(analysisId);
      setSummary(s);
    } catch (e) {
      console.error("Failed to submit correction:", e);
    }
  };

  return (
    <div className="border-t border-slate-700 pt-3">
      <div className="flex items-center gap-4">
        {/* Thumbs up/down */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleVote("thumbs_up")}
            className={`rounded px-2 py-1 text-sm transition-colors ${
              userVote === "thumbs_up"
                ? "bg-green-500/20 text-green-400"
                : "text-slate-400 hover:text-green-400"
            }`}
          >
            &#x1F44D; {summary?.thumbsUp || 0}
          </button>
          <button
            onClick={() => handleVote("thumbs_down")}
            className={`rounded px-2 py-1 text-sm transition-colors ${
              userVote === "thumbs_down"
                ? "bg-red-500/20 text-red-400"
                : "text-slate-400 hover:text-red-400"
            }`}
          >
            &#x1F44E; {summary?.thumbsDown || 0}
          </button>
        </div>

        {/* Star rating */}
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRating(star)}
              className={`text-lg ${
                star <= rating ? "text-yellow-400" : "text-slate-600"
              } hover:text-yellow-400`}
            >
              &#9733;
            </button>
          ))}
          {summary?.averageRating && (
            <span className="ml-1 text-xs text-slate-400">
              ({summary.averageRating.toFixed(1)})
            </span>
          )}
        </div>

        {/* Correction toggle */}
        <button
          onClick={() => setShowCorrection(!showCorrection)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Suggest correction
        </button>
      </div>

      {/* Correction form */}
      {showCorrection && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={correctionField}
            onChange={(e) => setCorrectionField(e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">Field...</option>
            <option value="errorType">Error Type</option>
            <option value="severity">Severity</option>
            <option value="component">Component</option>
            <option value="rootCause">Root Cause</option>
          </select>
          <input
            type="text"
            value={correctionValue}
            onChange={(e) => setCorrectionValue(e.target.value)}
            placeholder="Correct value..."
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={handleCorrection}
            disabled={!correctionField}
            className="rounded bg-blue-600/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
