import { useState, useEffect } from "react";
import { X, BookOpen, HelpCircle, GraduationCap, ChevronRight, ExternalLink, Layers, ArrowRightLeft, FileCode, Cpu, ScrollText } from "lucide-react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { APP_VERSION } from "../constants/version";
import gettingStartedMd from "../docs/getting-started.md?raw";
import architectureMd from "../docs/architecture.md?raw";
import dataFlowMd from "../docs/data-flow.md?raw";
import apiReferenceMd from "../docs/api-reference.md?raw";
import moduleDeepDiveMd from "../docs/module-deep-dive.md?raw";
import versionHistoryMd from "../docs/version-history.md?raw";
import troubleshootingMd from "../docs/troubleshooting.md?raw";

// Documentation content types
type DocType = "getting-started" | "architecture" | "data-flow" | "api-reference" | "module-deep-dive" | "version-history" | "troubleshooting";

interface DocumentationViewerProps {
  isOpen: boolean;
  onClose: () => void;
  initialDoc?: DocType;
}

interface DocSection {
  id: DocType;
  title: string;
  icon: React.ReactNode;
  description: string;
}

const docSections: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: <GraduationCap className="w-5 h-5" />,
    description: "Tutorial for new users — learn Hadron step by step",
  },
  {
    id: "architecture",
    title: "Architecture",
    icon: <Layers className="w-5 h-5" />,
    description: "Directory structure, system diagram, and technology stack",
  },
  {
    id: "data-flow",
    title: "Data Flow",
    icon: <ArrowRightLeft className="w-5 h-5" />,
    description: "How requests flow through the system end to end",
  },
  {
    id: "api-reference",
    title: "API Reference",
    icon: <FileCode className="w-5 h-5" />,
    description: "All Tauri commands, chat tools, and integration endpoints",
  },
  {
    id: "module-deep-dive",
    title: "Module Deep-Dive",
    icon: <Cpu className="w-5 h-5" />,
    description: "Purpose, dependencies, and key logic for every major module",
  },
  {
    id: "version-history",
    title: "Version History",
    icon: <ScrollText className="w-5 h-5" />,
    description: "Release notes and changelog for each version",
  },
  {
    id: "troubleshooting",
    title: "Help & Troubleshooting",
    icon: <HelpCircle className="w-5 h-5" />,
    description: "Solve common problems and find answers",
  },
];

const DOCS: Record<DocType, string> = {
  "getting-started": gettingStartedMd,
  architecture: architectureMd,
  "data-flow": dataFlowMd,
  "api-reference": apiReferenceMd,
  "module-deep-dive": moduleDeepDiveMd,
  "version-history": versionHistoryMd,
  troubleshooting: troubleshootingMd.replace("__VERSION__", APP_VERSION),
};

export default function DocumentationViewer({
  isOpen,
  onClose,
  initialDoc = "getting-started",
}: DocumentationViewerProps) {
  const [selectedDoc, setSelectedDoc] = useState<DocType>(initialDoc);
  const [showSelector, setShowSelector] = useState(true);

  // Reset to selector view when opening
  useEffect(() => {
    if (isOpen) {
      setShowSelector(true);
    }
  }, [isOpen]);

  const handleSelectDoc = (docId: DocType) => {
    setSelectedDoc(docId);
    setShowSelector(false);
  };

  const handleBack = () => {
    setShowSelector(true);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {showSelector ? "Documentation" : docSections.find((d) => d.id === selectedDoc)?.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!showSelector && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                Back to Menu
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showSelector ? (
            /* Document Selector */
            <div className="p-6 space-y-3">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Choose a section:
              </p>
              {docSections.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleSelectDoc(doc.id)}
                  className="w-full flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition group text-left"
                >
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition">
                    {doc.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                      {doc.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {doc.description}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition" />
                </button>
              ))}

              {/* External Links */}
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                  External Resources
                </h3>
                <div className="flex flex-wrap gap-3">
                  <a
                    href="https://github.com/hadron-team/hadron-desktop"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    GitHub Repository
                  </a>
                  <a
                    href="https://github.com/hadron-team/hadron-desktop/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Report Issues
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* Markdown Content */
            <div className="p-6 prose prose-gray dark:prose-invert max-w-none prose-headings:scroll-mt-4 prose-h1:text-2xl prose-h1:font-bold prose-h1:border-b prose-h1:border-gray-200 prose-h1:dark:border-gray-700 prose-h1:pb-2 prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h3:text-lg prose-h3:font-medium prose-code:bg-gray-100 prose-code:dark:bg-gray-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-600 prose-code:dark:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:dark:bg-gray-950 prose-table:text-sm prose-th:bg-gray-100 prose-th:dark:bg-gray-700 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-gray-200 prose-td:dark:border-gray-700 prose-a:text-blue-600 prose-a:dark:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:dark:bg-blue-900/20 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-hr:border-gray-200 prose-hr:dark:border-gray-700">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom link handling for external links
                  a: ({ href, children, ...props }) => {
                    const isExternal = href?.startsWith("http");
                    return (
                      <a
                        href={href}
                        target={isExternal ? "_blank" : undefined}
                        rel={isExternal ? "noopener noreferrer" : undefined}
                        {...props}
                      >
                        {children}
                        {isExternal && (
                          <ExternalLink className="inline w-3 h-3 ml-1 opacity-60" />
                        )}
                      </a>
                    );
                  },
                  // Code block styling
                  code: ({ className, children, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-400 text-sm" {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {DOCS[selectedDoc]}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">Esc</kbd> to close
            {!showSelector && (
              <> &middot; <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs cursor-pointer" onClick={handleBack}>Back</kbd> to menu</>
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}
