export async function writeText(text: string): Promise<void> {
  return window.hadron.writeToClipboard(text)
}

export async function readText(): Promise<string> {
  return window.hadron.readFromClipboard()
}
