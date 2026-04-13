const ytdl = require("ytdl-core");
const { decodeHtml } = require("./text");

async function fetchTranscript(videoId, metadata = {}) {
  const attempts = [
    ["youtube-transcript", () => fetchFromYoutubeTranscriptPackage(videoId)],
    ["ytdl-core captions", () => fetchFromYtdlCaptions(videoId)],
    ["youtube timedtext list", () => fetchFromYoutubeTimedText(videoId)]
  ];

  if (process.env.YOUTUBE_TRANSCRIPT_API_URL) {
    attempts.push([
      "configured transcript API",
      () => fetchFromConfiguredApi(videoId)
    ]);
  }

  const failures = [];

  for (const [name, fetcher] of attempts) {
    try {
      logTranscript(`Trying ${name} for ${videoId}`);
      const result = await fetcher();
      logTranscriptSuccess(name, result);
      return result;
    } catch (err) {
      failures.push({ name, err });
      logTranscriptError(name, err);
    }
  }

  const metadataFallback = buildMetadataTranscript(metadata);
  if (metadataFallback) {
    logTranscript(
      `All transcript methods failed for ${videoId}. Falling back to title + description text (${metadataFallback.text.length} chars).`
    );
    return metadataFallback;
  }

  throwTranscriptError(
    `All transcript methods failed: ${failures
      .map((failure) => `${failure.name}: ${getErrorDetails(failure.err)}`)
      .join(" | ")}`
  );
}

async function fetchFromYoutubeTranscriptPackage(videoId) {
  const module = await import("youtube-transcript/dist/youtube-transcript.esm.js");
  const fetchTranscript =
    module.fetchTranscript || module.YoutubeTranscript?.fetchTranscript;

  if (typeof fetchTranscript !== "function") {
    throw new Error("youtube-transcript did not expose fetchTranscript.");
  }

  const rawSegments = await fetchTranscript(videoId, { lang: "en" });
  const segments = normalizeSegments(rawSegments);

  if (!segments.length) {
    throw new Error("youtube-transcript returned zero segments.");
  }

  return buildTranscriptResult(segments, "en", "youtube-transcript");
}

async function fetchFromYtdlCaptions(videoId) {
  const info = await ytdl.getInfo(videoId);
  const captionTracks =
    info.player_response?.captions?.playerCaptionsTracklistRenderer
      ?.captionTracks || [];

  if (!captionTracks.length) {
    throw new Error("ytdl-core found no caption tracks.");
  }

  const preferredTrack = chooseCaptionTrack(captionTracks);
  const captionUrl = new URL(preferredTrack.baseUrl);
  captionUrl.searchParams.set("fmt", "json3");

  const response = await fetch(captionUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Caption track request failed with ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const text = await response.text();
  const segments = parseCaptionBody(text, response.headers.get("content-type"));

  if (!segments.length) {
    throw new Error(
      `Caption track response contained no readable segments. Body preview: ${text.slice(
        0,
        500
      )}`
    );
  }

  return buildTranscriptResult(
    segments,
    preferredTrack.languageCode || "unknown",
    preferredTrack.kind === "asr" ? "ytdl-core auto captions" : "ytdl-core captions"
  );
}

async function fetchFromConfiguredApi(videoId) {
  const endpoint = new URL(process.env.YOUTUBE_TRANSCRIPT_API_URL);
  endpoint.searchParams.set("videoId", videoId);

  const response = await fetch(endpoint);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Configured transcript API failed with ${response.status}: ${body.slice(
        0,
        1000
      )}`
    );
  }

  const data = await response.json();
  const rawSegments = data.transcript || data.segments || [];
  const segments = normalizeSegments(rawSegments);

  if (!segments.length) {
    throw new Error(
      `Configured transcript API returned no transcript. Response keys: ${Object.keys(
        data
      ).join(", ")}`
    );
  }

  return buildTranscriptResult(
    segments,
    data.language || "unknown",
    "configured transcript API"
  );
}

async function fetchFromYoutubeTimedText(videoId) {
  const tracks = await getCaptionTracks(videoId);
  if (!tracks.length) {
    throw new Error("YouTube timedtext list returned no caption tracks.");
  }

  const preferredTrack = chooseTimedTextTrack(tracks);

  const url = new URL("https://video.google.com/timedtext");
  url.searchParams.set("v", videoId);
  url.searchParams.set("lang", preferredTrack.langCode);
  url.searchParams.set("fmt", "json3");
  if (preferredTrack.name) url.searchParams.set("name", preferredTrack.name);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube timedtext failed with ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const text = await response.text();
  const segments = parseCaptionBody(text, response.headers.get("content-type"));

  if (!segments.length) {
    throw new Error(
      `YouTube timedtext captions were empty or unreadable. Body preview: ${text.slice(
        0,
        500
      )}`
    );
  }

  return buildTranscriptResult(
    segments,
    preferredTrack.langCode,
    preferredTrack.kind === "asr" ? "youtube timedtext auto captions" : "youtube timedtext"
  );
}

async function getCaptionTracks(videoId) {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}`;
  const response = await fetch(listUrl);
  if (!response.ok) return [];

  const xml = await response.text();
  const tracks = [];
  const trackRegex = /<track\b([^>]*)>/g;
  let match;

  while ((match = trackRegex.exec(xml))) {
    const attrs = parseXmlAttributes(match[1]);
    if (attrs.lang_code) {
      tracks.push({
        langCode: attrs.lang_code,
        name: attrs.name || "",
        kind: attrs.kind || "",
        displayName: attrs.lang_translated || attrs.lang_original || attrs.lang_code
      });
    }
  }

  return tracks;
}

function parseXmlAttributes(rawAttrs) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(rawAttrs))) {
    attrs[match[1]] = decodeHtml(match[2]);
  }

  return attrs;
}

function normalizeSegments(rawSegments) {
  return rawSegments
    .map((segment) => ({
      start: toSeconds(segment.start || segment.offset || segment.startTime || 0),
      duration: toSeconds(segment.duration || segment.dur || 0),
      text: decodeHtml(String(segment.text || segment.caption || "")).trim()
    }))
    .filter((segment) => segment.text);
}

function parseCaptionBody(body, contentType = "") {
  const trimmed = String(body || "").trim();

  if (!trimmed) return [];

  if (contentType.includes("application/json") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return (parsed.events || [])
      .filter((event) => Array.isArray(event.segs))
      .map((event) => ({
        start: (event.tStartMs || 0) / 1000,
        duration: (event.dDurationMs || 0) / 1000,
        text: decodeHtml(
          event.segs.map((seg) => seg.utf8 || "").join("").trim()
        )
      }))
      .filter((segment) => segment.text);
  }

  const segments = [];
  const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const srv3Regex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let match;

  while ((match = textRegex.exec(trimmed))) {
    const attrs = parseXmlAttributes(match[1]);
    segments.push({
      start: Number(attrs.start || 0),
      duration: Number(attrs.dur || 0),
      text: stripXml(decodeHtml(match[2])).trim()
    });
  }

  while ((match = srv3Regex.exec(trimmed))) {
    const attrs = parseXmlAttributes(match[1]);
    segments.push({
      start: Number(attrs.t || 0) / 1000,
      duration: Number(attrs.d || 0) / 1000,
      text: stripXml(decodeHtml(match[2])).trim()
    });
  }

  return segments.filter((segment) => segment.text);
}

function buildTranscriptResult(segments, language, source) {
  const text = segments.map((segment) => segment.text).join(" ");
  const lastSegment = segments[segments.length - 1];
  const durationSeconds = Math.ceil(
    (lastSegment.start || 0) + (lastSegment.duration || 0)
  );

  return {
    text,
    segments,
    language,
    source,
    durationSeconds
  };
}

function chooseCaptionTrack(tracks) {
  return (
    tracks.find((track) => track.languageCode === "en" && track.kind !== "asr") ||
    tracks.find((track) => track.languageCode?.startsWith("en")) ||
    tracks.find((track) => track.kind === "asr") ||
    tracks[0]
  );
}

function chooseTimedTextTrack(tracks) {
  return (
    tracks.find((track) => track.langCode === "en" && track.kind !== "asr") ||
    tracks.find((track) => track.langCode?.startsWith("en")) ||
    tracks.find((track) => track.kind === "asr") ||
    tracks[0]
  );
}

function buildMetadataTranscript(metadata) {
  const parts = [metadata.title, metadata.description]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (!parts.length) return null;

  const text = parts.join("\n\n");
  return {
    text,
    segments: [
      {
        start: 0,
        duration: 0,
        text
      }
    ],
    language: "metadata",
    source: "video title + description",
    durationSeconds: metadata.durationSeconds || 0,
    usedMetadataFallback: true
  };
}

function toSeconds(value) {
  const number = Number(value || 0);
  return number > 10000 ? number / 1000 : number;
}

function stripXml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function logTranscript(message) {
  console.log(`[transcript] ${message}`);
}

function logTranscriptSuccess(source, result) {
  console.log(
    `[transcript] SUCCESS via ${source}: ${result.segments.length} segments, ${result.text.length} chars, language=${result.language || "unknown"}`
  );
}

function logTranscriptError(source, err) {
  console.error(`[transcript] FAILED via ${source}: ${getErrorDetails(err)}`);
}

function getErrorDetails(err) {
  if (!err) return "Unknown error";
  const parts = [
    err.name,
    err.message,
    err.code ? `code=${err.code}` : "",
    err.status ? `status=${err.status}` : "",
    err.stack ? `stack=${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

function throwTranscriptError(message) {
  const error = new Error(message);
  error.status = 404;
  error.code = "TRANSCRIPT_UNAVAILABLE";
  error.publicMessage =
    "No transcript could be fetched after trying every available caption method.";
  throw error;
}

module.exports = { fetchTranscript };
