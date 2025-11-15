import { useState } from "react";
import { Languages, Copy, Check } from "lucide-react";
import logger from "../services/logger";

interface TranslateViewProps {
  onTranslate: (content: string) => Promise<string>;
  isTranslating: boolean;
}

export default function TranslateView({ onTranslate, isTranslating }: TranslateViewProps) {
  const [input, setInput] = useState("");
  const [translation, setTranslation] = useState("");
  const [copied, setCopied] = useState(false);

  const handleTranslate = async () => {
    if (!input.trim()) return;

    try {
      const result = await onTranslate(input);
      setTranslation(result);
    } catch (error) {
      logger.error('Translation failed', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(translation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setInput("");
    setTranslation("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Languages className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Tech-to-Plain Translator</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Get detailed explanations of what your code does, what it means, and actionable solutions for errors
            </p>
          </div>
        </div>
      </div>

      {/* Input Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <label className="block text-sm font-medium mb-2">
          Paste your technical content here:
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste code, SQL queries, error messages, stack traces, or logs... Get step-by-step explanations, root cause analysis, and solutions!"
          className="w-full h-64 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
          disabled={isTranslating}
        />

        <div className="mt-4 flex gap-3">
          <button
            onClick={handleTranslate}
            disabled={!input.trim() || isTranslating}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition"
          >
            {isTranslating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Translating...
              </>
            ) : (
              <>
                <Languages className="w-4 h-4" />
                Translate
              </>
            )}
          </button>

          <button
            onClick={handleClear}
            disabled={isTranslating}
            className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Translation Output */}
      {translation && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Plain Language Explanation</h3>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="prose dark:prose-invert max-w-none">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-relaxed">
                {translation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4">
        <h4 className="font-semibold mb-2 text-sm">💡 What You Get:</h4>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <li>• Step-by-step explanation of what the code actually does</li>
          <li>• Purpose and context of the functionality</li>
          <li>• Breakdown of technical terms and logic flow</li>
          <li>• For errors: root cause, investigative actions, and solutions</li>
          <li>• Real-world analogies to make concepts relatable</li>
        </ul>
      </div>
    </div>
  );
}
