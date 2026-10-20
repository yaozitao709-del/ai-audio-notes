export function applySpeakerAssignments(transcript, assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) return transcript;
  const speakerByUtterance = new Map(
    assignments
      .filter((item) => Number.isInteger(item?.utteranceId) && String(item?.speaker || "").trim())
      .map((item) => [item.utteranceId, String(item.speaker).trim()])
  );
  if (speakerByUtterance.size === 0) return transcript;

  let changed = false;
  const updated = transcript.map((line) => {
    const speaker = speakerByUtterance.get(line.utteranceId);
    if (!speaker || speaker === line.speaker) return line;
    changed = true;
    return { ...line, speaker };
  });
  return changed ? updated : transcript;
}
