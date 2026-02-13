/**
 * Release Notes Style Guide
 * 8 collapsible sections, searchable module labels, keyword rules.
 */

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Search, BookOpen } from "lucide-react";

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

const MODULE_LABELS = [
  { module: "Alternative Scheduling", label: "alternative_scheduling_module" },
  { module: "Transmission Automation Integration", label: "as_run_log_module" },
  { module: "Strategic Planning & Budget Forecasting", label: "budget_simulation_module" },
  { module: "Bumblebee Reports", label: "bumblebee_module" },
  { module: "Sponsoring & Bumper Autoscheduling", label: "bumper_autoslotter_module" },
  { module: "Business API", label: "business_api_module" },
  { module: "Acquisition, Screening & Buying Order Management", label: "buying_order_module" },
  { module: "Catch-up Scheduling", label: "catch_up_module" },
  { module: "Commercial Spot Management", label: "commercial_module" },
  { module: "Compliance", label: "compliance_module" },
  { module: "Configurable REST", label: "configurable_rest_module" },
  { module: "Continuity Scheduling", label: "continuity_module" },
  { module: "Contract & Rights Management", label: "contract_module" },
  { module: "Music & Copyright Reporting", label: "copyright_module" },
  { module: "WHATS'ON Core", label: "core_module" },
  { module: "Statistics & Analysis", label: "cost_analysis_module" },
  { module: "Curation Management", label: "curation_module" },
  { module: "Dashboard", label: "dashboard_module" },
  { module: "Advanced Graphics and Dynamic Branding", label: "dynamic_branding_module" },
  { module: "Financial Stock Management", label: "financial_stock_module" },
  { module: "Model-Based API", label: "generic_importer_module" },
  { module: "Programme Grid Planning", label: "grid_planner_module" },
  { module: "Business Datasets", label: "insight_module" },
  { module: "License", label: "license_module" },
  { module: "Scheduling", label: "linear_scheduling_module" },
  { module: "Media Asset Management (MM2)", label: "mm2_module" },
  { module: "On-demand Scheduling", label: "on_demand_module" },
  { module: "Parent-child Channels", label: "parent_child_channels_module" },
  { module: "Power Report Builder", label: "power_report_module" },
  { module: "Program Guide & EPG", label: "program_guide_module" },
  { module: "Program Management", label: "program_module" },
  { module: "PROMOPLAN", label: "promoplan_module" },
  { module: "Reporting & Exporting Engine", label: "report_module" },
  { module: "Rights Out", label: "rights_out_module" },
  { module: "Running Order", label: "running_order_module" },
  { module: "Traffic & Material Handling", label: "traffic_module" },
  { module: "Promotion & Interstitial Campaign Management", label: "trailer_module" },
  { module: "Scheduling Artist", label: "tx_auto_slotter_module" },
  { module: "Continuity Artist", label: "schedule_finalization_module" },
  { module: "Workflow Engine", label: "workflow_module" },
  { module: "WHATS'ON Web", label: "wow_module" },
];

export default function ReleaseNotesStyleGuide() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["terminology"]));
  const [moduleSearch, setModuleSearch] = useState("");

  const filteredModules = useMemo(() => {
    if (!moduleSearch) return MODULE_LABELS;
    const q = moduleSearch.toLowerCase();
    return MODULE_LABELS.filter(
      (m) =>
        m.module.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q),
    );
  }, [moduleSearch]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sections: Section[] = [
    {
      id: "terminology",
      title: "UI Terminology",
      content: (
        <div className="space-y-2 text-sm text-gray-300">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-700">
                <th className="pb-2 pr-4">UI Element</th>
                <th className="pb-2">Correct Term</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {[
                ["Top bar with File, Edit, etc.", "Menu"],
                ["Icon row below menu", "Toolbar"],
                ["Tree node in navigator", "Level"],
                ["Small preview image", "Thumbnail"],
                ["Sub-section within editor", "Tab page / tab"],
                ["Right side of a screen", "Editor / workspace"],
                ["Left-side hierarchy", "Navigator tree"],
                ["Labeled section within a form", "Group box"],
              ].map(([element, term]) => (
                <tr key={element} className="text-gray-300">
                  <td className="py-1.5 pr-4 text-gray-400">{element}</td>
                  <td className="py-1.5 font-medium">{term}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: "content_rules",
      title: "Content Rules",
      content: (
        <div className="text-sm text-gray-300 space-y-3">
          <div>
            <h5 className="text-xs font-semibold text-green-400 mb-1">Do:</h5>
            <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
              <li>Use realistic values in examples</li>
              <li>Write WHATS'ON (not WOn, WhatsOn)</li>
              <li>Rewrite JIRA text into proper English sentences</li>
              <li>Use active voice, present tense</li>
              <li>Use British English</li>
            </ul>
          </div>
          <div>
            <h5 className="text-xs font-semibold text-red-400 mb-1">Don't:</h5>
            <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
              <li>No abbreviations (tx event, won, RN)</li>
              <li>No arrows (select the tx event &gt;&gt;)</li>
              <li>No excessive capitals</li>
              <li>Avoid "customers" — use "users"</li>
              <li>Avoid "crash" in fix titles</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: "features",
      title: "Writing New Features",
      content: (
        <div className="text-sm text-gray-300 space-y-2">
          <p className="text-xs text-gray-400">
            Structure: <strong>Introduction</strong> → <strong>Detail</strong> → <strong>Conclusion</strong>
          </p>
          <p className="text-xs text-gray-400">
            Vary phrasing: "It is now possible to...", "Users can now...", "From now on..."
          </p>
        </div>
      ),
    },
    {
      id: "fixes_standard",
      title: "Fixes — Standard Format",
      content: (
        <div className="text-sm text-gray-300 space-y-2">
          <ol className="list-decimal list-inside text-xs text-gray-400 space-y-1">
            <li><strong>Title</strong> — Start with "Fix for". Concise and descriptive.</li>
            <li><strong>Issue</strong> — Start with "Previously, ..." Describe what was wrong.</li>
            <li><strong>Steps</strong> — Only for complicated scenarios (optional).</li>
            <li><strong>Cause</strong> — Why it was occurring.</li>
            <li><strong>Solution</strong> — What was done to fix it.</li>
            <li><strong>References</strong> — Ticket number: (MGXPRODUCT-XXXXX)</li>
          </ol>
        </div>
      ),
    },
    {
      id: "fixes_simplified",
      title: "Fixes — Simplified Table Format",
      content: (
        <div className="text-sm text-gray-300 space-y-2">
          <p className="text-xs text-gray-400">
            Confluence table: Issue key | Description | Module | Keywords
          </p>
          <p className="text-xs text-gray-400">
            Description: Start with "Previously, ..." → End with "This issue has been fixed in this version."
          </p>
        </div>
      ),
    },
    {
      id: "titles",
      title: "Title Writing Rules",
      content: (
        <div className="text-sm text-gray-300 space-y-2">
          <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
            <li>Make it speak for itself — not too high-level</li>
            <li>Include where something takes place</li>
            <li>No punctuation (especially no colons)</li>
            <li>No quotes in titles</li>
            <li>Use natural language — say what it does</li>
          </ul>
        </div>
      ),
    },
    {
      id: "modules",
      title: "Module Labels",
      content: (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder="Search modules..."
              className="w-full bg-gray-900 border border-gray-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-amber-400 outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {filteredModules.map((m) => (
              <div
                key={m.label}
                className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-800/50 text-xs"
              >
                <span className="text-gray-300">{m.module}</span>
                <code className="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">
                  {m.label}
                </code>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "keywords",
      title: "Keyword Rules",
      content: (
        <div className="text-sm text-gray-300 space-y-2">
          <p className="text-xs text-gray-400">Each release note needs at least 2 keywords:</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-700">
                <th className="pb-1">Type</th>
                <th className="pb-1">Rule</th>
                <th className="pb-1">Example</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              <tr><td className="py-1">Concept</td><td>Plural name</td><td className="text-amber-400">contracts, transmissions</td></tr>
              <tr><td className="py-1">Application</td><td>Correct app name</td><td className="text-amber-400">contract_navigator</td></tr>
              <tr><td className="py-1">Upgrade</td><td>If pre-upgrade changes</td><td className="text-amber-400">upgrade</td></tr>
            </tbody>
          </table>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-gray-300">
          WHATS'ON Release Notes Style Guide
        </h3>
      </div>

      {sections.map((section) => {
        const isExpanded = expandedSections.has(section.id);
        return (
          <div
            key={section.id}
            className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
            >
              <span className="text-sm font-medium text-gray-200">{section.title}</span>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
