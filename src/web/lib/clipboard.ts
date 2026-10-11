// Call it inside the click handler, so the browser counts the copy as a user action. False: the clipboard is blocked or absent.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
