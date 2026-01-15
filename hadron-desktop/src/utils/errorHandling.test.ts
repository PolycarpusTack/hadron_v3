import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  retryOperation,
  getUserFriendlyErrorMessage,
  getRecoverySuggestions,
} from "./errorHandling";

// Mock the logger to prevent console output during tests
vi.mock("../services/logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("getUserFriendlyErrorMessage", () => {
  it("returns network error message for fetch errors", () => {
    const error = new Error("fetch failed");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Network error. Please check your internet connection and try again."
    );
  });

  it("returns network error message for network errors", () => {
    const error = new Error("network unavailable");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Network error. Please check your internet connection and try again."
    );
  });

  it("returns API key error for 401 errors", () => {
    const error = new Error("Request failed with status 401");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Invalid API key. Please check your OpenAI API key in Settings."
    );
  });

  it("returns API key error for explicit API key messages", () => {
    const error = new Error("API key is invalid");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Invalid API key. Please check your OpenAI API key in Settings."
    );
  });

  it("returns rate limit error for 429 errors", () => {
    const error = new Error("Request failed with status 429");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Rate limit exceeded. Please wait a moment and try again."
    );
  });

  it("returns rate limit error for explicit rate limit messages", () => {
    const error = new Error("rate limit exceeded");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Rate limit exceeded. Please wait a moment and try again."
    );
  });

  it("returns timeout error message", () => {
    const error = new Error("Request timeout");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Request timed out. Please try again."
    );
  });

  it("returns database error message", () => {
    const error = new Error("database is locked");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Database error. Your analysis may not have been saved. Please try again."
    );
  });

  it("returns database error for SQLite errors", () => {
    const error = new Error("SQLite constraint violation");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Database error. Your analysis may not have been saved. Please try again."
    );
  });

  it("returns file error for ENOENT errors", () => {
    const error = new Error("ENOENT: no such file or directory");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "File not found or cannot be read. Please check the file path."
    );
  });

  it("returns Python error for Python-related issues", () => {
    const error = new Error("Python subprocess failed");
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Analysis engine error. Please ensure Python is installed and configured correctly."
    );
  });

  it("returns the original message for unknown errors", () => {
    const error = new Error("Some specific error");
    expect(getUserFriendlyErrorMessage(error)).toBe("Some specific error");
  });

  it("returns generic message for non-Error objects", () => {
    expect(getUserFriendlyErrorMessage("string error")).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getUserFriendlyErrorMessage(null)).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getUserFriendlyErrorMessage(undefined)).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getUserFriendlyErrorMessage(42)).toBe(
      "An unexpected error occurred. Please try again."
    );
  });
});

describe("getRecoverySuggestions", () => {
  it("returns network suggestions for network errors", () => {
    const error = new Error("network unavailable");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Check your internet connection");
    expect(suggestions).toContain("Verify firewall settings");
    expect(suggestions).toContain("Try again in a few moments");
  });

  it("returns API key suggestions for auth errors", () => {
    const error = new Error("Request failed with status 401");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Open Settings and verify your API key");
    expect(suggestions).toContain("Ensure the API key starts with 'sk-'");
    expect(suggestions).toContain("Generate a new API key if needed");
  });

  it("returns rate limit suggestions for 429 errors", () => {
    const error = new Error("429 Too Many Requests");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Wait a few minutes before trying again");
    expect(suggestions).toContain("Consider upgrading your OpenAI plan");
  });

  it("returns database suggestions for database errors", () => {
    const error = new Error("database is locked");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Close and restart the application");
    expect(suggestions).toContain("Check available disk space");
  });

  it("returns Python suggestions for Python errors", () => {
    const error = new Error("Python not found");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Ensure Python 3.10+ is installed");
    expect(suggestions).toContain("Run 'pip install -r requirements.txt'");
    expect(suggestions).toContain("Check the console for detailed error messages");
  });

  it("returns default suggestions for unknown errors", () => {
    const error = new Error("Something went wrong");
    const suggestions = getRecoverySuggestions(error);

    expect(suggestions).toContain("Try again");
    expect(suggestions).toContain("Restart the application if the problem persists");
    expect(suggestions).toContain("Check the console for more details");
  });

  it("handles non-Error inputs", () => {
    const suggestions = getRecoverySuggestions("string error");
    expect(suggestions.length).toBeGreaterThan(0);
  });
});

describe("retryOperation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const resultPromise = retryOperation(fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValue("success");

    const resultPromise = retryOperation(fn, { delayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const resultPromise = retryOperation(fn, { maxAttempts: 3, delayMs: 100 });

    // Run all timers first
    await vi.runAllTimersAsync();

    // Then check the rejection
    await expect(resultPromise).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects maxAttempts option", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const resultPromise = retryOperation(fn, { maxAttempts: 5, delayMs: 100 });

    // Run all timers first
    await vi.runAllTimersAsync();

    // Then check the rejection
    await expect(resultPromise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("uses exponential backoff when enabled", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const resultPromise = retryOperation(fn, {
      maxAttempts: 3,
      delayMs: 1000,
      backoff: true,
    });

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(0);

    // Wait for first backoff (1000ms * 2^0 = 1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    // Wait for second backoff (1000ms * 2^1 = 2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;
    expect(result).toBe("success");
  });

  it("uses constant delay when backoff is disabled", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const resultPromise = retryOperation(fn, {
      maxAttempts: 3,
      delayMs: 500,
      backoff: false,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("converts non-Error throws to Error objects", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    const resultPromise = retryOperation(fn, { maxAttempts: 1 });

    // Run all timers first
    await vi.runAllTimersAsync();

    // Then check the rejection
    await expect(resultPromise).rejects.toThrow("string error");
  });
});
