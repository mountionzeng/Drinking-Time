// Earlier single-image book edits kept the author's exact words twice in this template.
// Recover only a verbatim match; never present renderer instructions as a user message.
export function historicalBookImageFeedback(prompt:string) {
  const header="Compose one new image from the supplied reference images.\n图1 is the base: its aspect ratio and overall composition carry over unless the user asks otherwise.\nTake from each reference only what the user names below; do not borrow anything else from them.\n\n";
  if (!prompt.startsWith(header)) return;
  const end=prompt.indexOf("\nCharacter continuity across all generated shots:",header.length);
  if (end<0) return;
  const text=prompt.slice(header.length,end);
  if (text && text.length<=2000 && prompt.slice(end).includes("【用户持续要求】"+text+"。这些要求必须完整落实")) return text;
}
