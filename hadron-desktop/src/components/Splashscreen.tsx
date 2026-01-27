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

  // Keep ref updated
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      // Allow exit animation to complete
      setTimeout(() => onCompleteRef.current(), 500);
    }, minDisplayTime);

    return () => clearTimeout(timer);
  }, [minDisplayTime]); // Only depend on minDisplayTime

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gray-900 transition-opacity duration-500 ${
        isExiting ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      </div>

      {/* Logo container */}
      <div
        className={`relative z-10 flex flex-col items-center transition-all duration-700 ${
          imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <img
          src="/logo.png"
          alt="Hadron Logo"
          className="w-64 h-64 object-contain drop-shadow-2xl"
          onLoad={() => setImageLoaded(true)}
        />

        {/* App name */}
        <h1 className="mt-6 text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Hadron
        </h1>
        <p className="mt-2 text-gray-400 text-sm">
          Smalltalk Crash Analyzer
        </p>

        {/* Loading indicator */}
        <div className="mt-8 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>

      {/* Version */}
      <div className="absolute bottom-6 text-gray-600 text-xs">
        v{APP_VERSION}
      </div>
    </div>
  );
}
