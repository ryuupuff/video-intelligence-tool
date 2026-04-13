const {
  extractVideoId,
  getCanonicalYoutubeUrl,
  getVideoMetadata
} = require("../utils/youtube");
const { fetchTranscript } = require("../utils/transcriptService");
const { analyzeTranscript } = require("../utils/aiService");
const { calculateTimeSaved } = require("../utils/metrics");

async function summarizeVideo(req, res, next) {
  try {
    const { url, tone = "formal", mode = "study" } = req.body || {};
    const videoId = extractVideoId(url);

    if (!videoId) {
      const error = new Error("Invalid YouTube URL");
      error.status = 400;
      error.code = "INVALID_YOUTUBE_URL";
      error.publicMessage = "Please enter a valid YouTube video URL.";
      throw error;
    }

    const metadata = await getVideoMetadata(videoId);
    const transcriptResult = await fetchTranscript(videoId, metadata);

    if (!transcriptResult.segments.length) {
      const error = new Error("Transcript unavailable");
      error.status = 404;
      error.code = "TRANSCRIPT_UNAVAILABLE";
      error.publicMessage =
        "This video does not have an available transcript. Try a video with captions enabled.";
      throw error;
    }

    // Log which source we're using
    if (transcriptResult.usedMetadataFallback) {
      console.log(
        `[controller] Transcript fallback in use for ${videoId} - using metadata-based analysis`
      );
    } else {
      console.log(
        `[controller] Using transcript-based summarization for ${videoId} from ${transcriptResult.source}`
      );
    }

    const durationSeconds =
      metadata.durationSeconds || transcriptResult.durationSeconds || 0;

    const analysis = await analyzeTranscript({
      title: metadata.title,
      description: metadata.description,
      videoId,
      url: getCanonicalYoutubeUrl(videoId),
      transcript: transcriptResult.text,
      segments: transcriptResult.segments,
      tone,
      mode,
      durationSeconds,
      transcriptSource: transcriptResult.source,
      usedMetadataFallback: transcriptResult.usedMetadataFallback
    });

    const metrics = calculateTimeSaved({
      videoDurationSeconds: durationSeconds,
      summaryText: [
        analysis.tldr,
        ...(analysis.detailedSummary || []),
        ...(analysis.keyTakeaways || [])
      ].join(" ")
    });

    res.json({
      videoId,
      url: getCanonicalYoutubeUrl(videoId),
      title: analysis.videoTitle || metadata.title || "Untitled YouTube video",
      tone,
      mode,
      transcriptLanguage: transcriptResult.language,
      transcriptSource: transcriptResult.source,
      transcriptLength: transcriptResult.text.length,
      usedMetadataFallback: Boolean(transcriptResult.usedMetadataFallback),
      durationSeconds,
      metrics,
      ...analysis
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { summarizeVideo };
