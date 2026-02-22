import { useEffect, useState, useRef } from "react";
import { APP_VERSION } from "../constants/version";

interface SplashscreenProps {
  onComplete: () => void;
  minDisplayTime?: number;
}

export default function Splashscreen({
  onComplete,
  minDisplayTime = 1500
}: SplashscreenProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const onCompleteRef = useRef(onComplete);

  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onCompleteRef.current(), 500);
    }, minDisplayTime);

    return () => clearTimeout(timer);
  }, [minDisplayTime]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-opacity duration-500 ${
        isExiting ? "opacity-0" : "opacity-100"
      }`}
      style={{ background: 'var(--hd-bg-base)' }}
    >
      {/* Gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-800/10 rounded-full blur-3xl" />
      </div>

      {/* Logo container */}
      <div
        className={`relative z-10 flex flex-col items-center transition-all duration-700 ${
          imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <img
          src="/logo.png"
          alt="Hadron - AI Support Assistant"
          className="w-80 h-80 object-contain drop-shadow-2xl"
          onLoad={() => setImageLoaded(true)}
        />

        {/* Loading indicator */}
        <div className="mt-8 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>

      {/* Version */}
      <div className="absolute bottom-6 text-xs" style={{ color: 'var(--hd-text-dim)' }}>
        v{APP_VERSION}
      </div>
    </div>
  );
}
