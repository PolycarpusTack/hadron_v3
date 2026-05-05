import { describe, it, expect } from "vitest";
import { getModelSafeLimit, formatBytes } from "../src/utils/model-fit";

describe("getModelSafeLimit", () => {
  it("returns correct limit for GPT-5.4 Mini (400K ctx)", () => {
    // 400_000 tokens × 4 bytes × 0.7 safety = 1_120_000
    expect(getModelSafeLimit("openai", "gpt-5.4-mini")).toBe(1_120_000);
  });

  it("returns correct limit for Claude Sonnet 4 (200K ctx)", () => {
    // 200_000 × 4 × 0.7 = 560_000
    expect(getModelSafeLimit("anthropic", "claude-sonnet-4-0")).toBe(560_000);
  });

  it("returns fallback 512_000 for unknown model", () => {
    expect(getModelSafeLimit("openai", "gpt-unknown-future")).toBe(512_000);
  });

  it("returns fallback 512_000 for unknown provider", () => {
    expect(getModelSafeLimit("unknownprovider", "some-model")).toBe(512_000);
  });

  it("returns fallback for local providers with context=0", () => {
    // llamacpp default has context: 0 → fallback
    expect(getModelSafeLimit("llamacpp", "default")).toBe(512_000);
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1 MB as KB", () => {
    expect(formatBytes(512_000)).toBe("512 KB");
  });
  it("formats bytes at 1 MB boundary as MB", () => {
    expect(formatBytes(1_000_000)).toBe("1.0 MB");
  });
  it("formats bytes above 1 MB", () => {
    expect(formatBytes(1_120_000)).toBe("1.1 MB");
  });
});
