/**
 * Async serialization lock for widget window operations.
 * Prevents concurrent resize/move/show/hide sequences from interleaving,
 * which corrupts wry/WebView2 event loop state and causes
 * ILLEGAL_INSTRUCTION (0xc000001d) crashes on Windows.
 */
let chain = Promise.resolve();

export function withWidgetLock(fn: () => Promise<void>): Promise<void> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}
