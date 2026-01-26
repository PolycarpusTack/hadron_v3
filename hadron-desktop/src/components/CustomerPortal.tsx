/**
 * Customer Self-Service Portal
 * Phase 5: AI-powered issue resolution before ticket creation
 *
 * Features:
 * - Issue description input
 * - AI-powered suggestions
 * - Deflection tracking
 * - Ticket creation fallback
 */

import { useState, useCallback } from "react";
import {
  Search,
  CheckCircle,
  ExternalLink,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  AlertCircle,
  FileText,
  HelpCircle,
  ChevronRight,
  BookOpen,
  Ticket,
} from "lucide-react";
import {
  getSuggestions,
  recordSolutionHelpful,
  recordTicketCreation,
  startSession,
  type IssueDescription,
  type SelfServiceResult,
  type SuggestedSolution,
} from "../services/self-service";
import logger from "../services/logger";

interface CustomerPortalProps {
  customerId?: string;
  onCreateTicket?: (description: string) => void;
  onClose?: () => void;
}

type PortalStep = "describe" | "suggestions" | "resolved" | "create_ticket";

export default function CustomerPortal({
  customerId,
  onCreateTicket,
  onClose,
}: CustomerPortalProps) {
  const [step, setStep] = useState<PortalStep>("describe");
  const [description, setDescription] = useState("");
  const [component, setComponent] = useState<string>("");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SelfServiceResult | null>(null);
  const [expandedSolution, setExpandedSolution] = useState<string | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());

  const components = [
    { value: "", label: "Select component (optional)" },
    { value: "epg", label: "EPG Management" },
    { value: "rights", label: "Rights & Contracts" },
    { value: "scheduling", label: "Scheduling" },
    { value: "playout", label: "Playout Integration" },
    { value: "mam", label: "Media Asset Management" },
    { value: "reporting", label: "Reporting & Analytics" },
    { value: "admin", label: "User Management" },
    { value: "api", label: "API/Integrations" },
    { value: "workflow", label: "Workflow Engine" },
    { value: "database", label: "Database/Performance" },
  ];

  const handleSearch = useCallback(async () => {
    if (!description.trim() || description.length < 20) {
      setError("Please provide a detailed description (at least 20 characters)");
      return;
    }

    setLoading(true);
    setError(null);

    // Start new session
    startSession(customerId);

    const issue: IssueDescription = {
      description,
      component: component || undefined,
      urgency,
      customerId,
    };

    try {
      const suggestions = await getSuggestions(issue);
      setResult(suggestions);
      setStep("suggestions");
      logger.info("Self-service suggestions loaded", {
        suggestionCount: suggestions.suggestions.length,
        searchTime: suggestions.searchTime,
      });
    } catch (e) {
      setError("Failed to find solutions. Please try again or create a ticket.");
      logger.error("Self-service search failed", { error: e });
    } finally {
      setLoading(false);
    }
  }, [description, component, urgency, customerId]);

  const handleSolutionHelpful = async (solution: SuggestedSolution) => {
    await recordSolutionHelpful(solution.id);
    setFeedbackGiven(prev => new Set(prev).add(solution.id));
    setStep("resolved");
  };

  const handleSolutionNotHelpful = (solutionId: string) => {
    setFeedbackGiven(prev => new Set(prev).add(solutionId));
  };

  const handleCreateTicket = async () => {
    if (result) {
      await recordTicketCreation(result.suggestions.map(s => s.id));
    }
    if (onCreateTicket) {
      onCreateTicket(description);
    }
    setStep("create_ticket");
  };

  const handleStartOver = () => {
    setStep("describe");
    setDescription("");
    setComponent("");
    setResult(null);
    setFeedbackGiven(new Set());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 border-b border-gray-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <HelpCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">WHATS'ON Support</h1>
              <p className="text-sm text-gray-400">Self-Service Portal</p>
            </div>
          </div>
          {customerId && (
            <span className="text-sm text-gray-400">
              Customer: <span className="text-gray-300">{customerId}</span>
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Step: Describe Issue */}
        {step === "describe" && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold text-white mb-2">
                How can we help you today?
              </h2>
              <p className="text-gray-400">
                Describe your issue and we'll find solutions from our knowledge base
              </p>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-4">
              {/* Description Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Describe your issue
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Please describe what's happening in detail. Include any error messages, what you were trying to do, and when the issue started..."
                  className="w-full h-40 px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg
                           text-white placeholder-gray-500 resize-none
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="mt-1 text-xs text-gray-500">
                  {description.length}/20 characters minimum
                </div>
              </div>

              {/* Component Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Component (optional)
                  </label>
                  <select
                    value={component}
                    onChange={(e) => setComponent(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg
                             text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {components.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Urgency
                  </label>
                  <select
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as typeof urgency)}
                    className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg
                             text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="low">Low - Can wait</option>
                    <option value="normal">Normal</option>
                    <option value="high">High - Affecting work</option>
                    <option value="critical">Critical - Production impact</option>
                  </select>
                </div>
              </div>

              {/* Error Display */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Search Button */}
              <button
                onClick={handleSearch}
                disabled={loading || description.length < 20}
                className="w-full flex items-center justify-center gap-2 px-6 py-3
                         bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed
                         text-white font-medium rounded-lg transition"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Finding solutions...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Find Solutions
                  </>
                )}
              </button>
            </div>

            {/* Quick Links */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <QuickLink
                icon={<BookOpen className="w-5 h-5" />}
                title="Documentation"
                description="Browse user guides"
              />
              <QuickLink
                icon={<FileText className="w-5 h-5" />}
                title="Release Notes"
                description="Latest updates"
              />
              <QuickLink
                icon={<MessageSquare className="w-5 h-5" />}
                title="Contact Support"
                description="Get human help"
                onClick={() => setStep("create_ticket")}
              />
            </div>
          </div>
        )}

        {/* Step: Show Suggestions */}
        {step === "suggestions" && result && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  We found {result.suggestions.length} potential solution{result.suggestions.length !== 1 ? "s" : ""}
                </h2>
                <p className="text-gray-400 text-sm mt-1">
                  Search completed in {result.searchTime}ms
                </p>
              </div>
              <button
                onClick={handleStartOver}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Start Over
              </button>
            </div>

            {/* Issue Summary */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Your Issue</h3>
              <p className="text-gray-300 line-clamp-2">{description}</p>
            </div>

            {/* Suggestions */}
            <div className="space-y-4">
              {result.suggestions.map((solution, index) => (
                <SolutionCard
                  key={solution.id}
                  solution={solution}
                  index={index}
                  expanded={expandedSolution === solution.id}
                  onToggle={() => setExpandedSolution(
                    expandedSolution === solution.id ? null : solution.id
                  )}
                  onHelpful={() => handleSolutionHelpful(solution)}
                  onNotHelpful={() => handleSolutionNotHelpful(solution.id)}
                  feedbackGiven={feedbackGiven.has(solution.id)}
                />
              ))}
            </div>

            {/* Related Documentation */}
            {result.documentation.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-medium text-white mb-4">
                  Related Documentation
                </h3>
                <div className="space-y-2">
                  {result.documentation.map((doc, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-gray-800/30 border border-gray-700 rounded-lg hover:bg-gray-800/50 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <BookOpen className="w-5 h-5 text-blue-400" />
                        <div>
                          <span className="text-gray-200">{doc.title}</span>
                          {doc.component && (
                            <span className="ml-2 text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">
                              {doc.component}
                            </span>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-gray-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Tickets */}
            {result.relatedTickets.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-medium text-white mb-4">
                  Similar Resolved Issues
                </h3>
                <div className="space-y-2">
                  {result.relatedTickets.map((ticket) => (
                    <div
                      key={ticket.jiraKey}
                      className="flex items-center justify-between p-3 bg-gray-800/30 border border-gray-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Ticket className="w-5 h-5 text-green-400" />
                        <div>
                          <span className="text-gray-200">{ticket.jiraKey}</span>
                          <span className="mx-2 text-gray-600">-</span>
                          <span className="text-gray-400">{ticket.summary}</span>
                        </div>
                      </div>
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                        {ticket.resolution || ticket.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Create Ticket CTA */}
            <div className="mt-8 p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-white">
                    Still need help?
                  </h3>
                  <p className="text-gray-400 text-sm mt-1">
                    If these solutions don't resolve your issue, we're here to help
                  </p>
                </div>
                <button
                  onClick={handleCreateTicket}
                  className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700
                           text-white font-medium rounded-lg transition"
                >
                  <Ticket className="w-5 h-5" />
                  Create Support Ticket
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step: Issue Resolved */}
        {step === "resolved" && (
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-6 bg-green-500/20 rounded-full flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">
              Great! We're glad that helped.
            </h2>
            <p className="text-gray-400 mb-8">
              Your feedback helps us improve our solutions for everyone
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={handleStartOver}
                className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
              >
                New Search
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step: Create Ticket */}
        {step === "create_ticket" && (
          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-6 bg-blue-500/20 rounded-full flex items-center justify-center">
              <Ticket className="w-10 h-10 text-blue-400" />
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">
              Creating your support ticket
            </h2>
            <p className="text-gray-400 mb-8">
              A support engineer will review your issue and respond shortly
            </p>
            <div className="max-w-md mx-auto bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-left">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Issue Description</h3>
              <p className="text-gray-300 text-sm">{description}</p>
            </div>
            <div className="mt-8">
              <button
                onClick={handleStartOver}
                className="text-gray-400 hover:text-white transition"
              >
                Search for another issue
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function QuickLink({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 bg-gray-800/30 border border-gray-700 rounded-lg
               hover:bg-gray-800/50 hover:border-gray-600 transition text-left"
    >
      <div className="text-blue-400">{icon}</div>
      <div>
        <div className="text-gray-200 font-medium">{title}</div>
        <div className="text-sm text-gray-500">{description}</div>
      </div>
    </button>
  );
}

function SolutionCard({
  solution,
  index,
  expanded,
  onToggle,
  onHelpful,
  onNotHelpful,
  feedbackGiven,
}: {
  solution: SuggestedSolution;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onHelpful: () => void;
  onNotHelpful: () => void;
  feedbackGiven: boolean;
}) {
  const confidenceColor =
    solution.confidence >= 0.8
      ? "text-green-400"
      : solution.confidence >= 0.6
      ? "text-yellow-400"
      : "text-gray-400";

  const sourceLabel =
    solution.source === "gold"
      ? "Verified Solution"
      : solution.source === "documentation"
      ? "Documentation"
      : solution.source === "similar_ticket"
      ? "Similar Case"
      : "AI Suggestion";

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/70 transition"
      >
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center text-blue-400 font-medium">
            {index + 1}
          </div>
          <div className="text-left">
            <h3 className="text-gray-200 font-medium">{solution.title}</h3>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">
                {sourceLabel}
              </span>
              <span className={`text-xs ${confidenceColor}`}>
                {Math.round(solution.confidence * 100)}% match
              </span>
            </div>
          </div>
        </div>
        <ChevronRight
          className={`w-5 h-5 text-gray-500 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700">
          <div className="pt-4 space-y-4">
            {/* Description */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">Description</h4>
              <p className="text-gray-300">{solution.description}</p>
            </div>

            {/* Steps */}
            {solution.steps.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Steps to resolve</h4>
                <ol className="space-y-2">
                  {solution.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-gray-300">
                      <span className="flex-shrink-0 w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs text-gray-400">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Feedback */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-700">
              <span className="text-sm text-gray-400">Did this solve your issue?</span>
              {feedbackGiven ? (
                <span className="text-sm text-gray-500">Thanks for your feedback!</span>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={onHelpful}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30
                             text-green-400 rounded-lg transition text-sm"
                  >
                    <ThumbsUp className="w-4 h-4" />
                    Yes
                  </button>
                  <button
                    onClick={onNotHelpful}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600
                             text-gray-300 rounded-lg transition text-sm"
                  >
                    <ThumbsDown className="w-4 h-4" />
                    No
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
