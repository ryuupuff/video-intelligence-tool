function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Clean transcript text for AI analysis
 * Removes URLs, hashtags, spam patterns, and excessive whitespace
 */
function cleanTranscriptText(text) {
  if (!text || typeof text !== "string") return "";

  return text
    // Remove URLs (http, https, www)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    // Remove hashtags
    .replace(/#\w+/g, "")
    // Remove mentions
    .replace(/@\w+/g, "")
    // Remove timestamps in format [HH:MM:SS] or (HH:MM:SS)
    .replace(/\[\d{1,2}:\d{2}:\d{2}\]|\(\d{1,2}:\d{2}:\d{2}\)/g, "")
    // Remove excessive whitespace
    .replace(/\s+/g, " ")
    // Trim whitespace
    .trim();
}

module.exports = { decodeHtml, cleanTranscriptText };
