function calculateTimeSaved({ videoDurationSeconds, summaryText }) {
  const words = String(summaryText || "").trim().split(/\s+/).filter(Boolean).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 220));
  const videoMinutes = Math.max(0, Math.ceil((videoDurationSeconds || 0) / 60));
  const savedMinutes = Math.max(0, videoMinutes - readingTimeMinutes);

  return {
    videoMinutes,
    readingTimeMinutes,
    savedMinutes
  };
}

module.exports = { calculateTimeSaved };
