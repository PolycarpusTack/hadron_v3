import { useState, useEffect } from "react";
import { APP_VERSION } from "../constants/version";

interface AppFooterProps {
  hasApiKey: boolean;
}

const QUOTES = [
  "Support by 2LS. It's the only thing stronger than fear.",
  "Our work will break your heart, and 2LS is here to make sure you're still standing when it does.",
  "A day may come when the courage of 2LS fails... but today is not this day!",
  "This is 2LS!",
];

export default function AppFooter({ hasApiKey }: AppFooterProps) {
  const [quoteIndex, setQuoteIndex] = useState(() =>
    Math.floor(Math.random() * QUOTES.length)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="mt-12 text-center text-sm" style={{ color: 'var(--hd-text-muted)' }}>
      <div className="mb-2">
        Hadron {APP_VERSION}
        {hasApiKey && (
          <span className="ml-4 text-emerald-400">API Key Set</span>
        )}
      </div>
      <div className="text-xs italic opacity-60 transition-opacity duration-500" style={{ color: 'var(--hd-text-dim)' }}>
        {QUOTES[quoteIndex]}
      </div>
      <div className="text-xs opacity-40 mt-1" style={{ color: 'var(--hd-text-dim)' }}>
        Shortcuts: Ctrl+N (New) | Ctrl+H (History) | Ctrl+, (Settings) | Ctrl+Y (Console) | Esc (Close)
      </div>
    </footer>
  );
}
