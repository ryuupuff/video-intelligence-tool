const ytdl = require("ytdl-core");

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

function extractVideoId(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();
  const directMatch = trimmed.match(/^[a-zA-Z0-9_-]{11}$/);
  if (directMatch) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "www.");

    if (!YOUTUBE_HOSTS.has(host)) return null;

    if (url.hostname === "youtu.be") {
      return normalizeVideoId(url.pathname.slice(1).split("/")[0]);
    }

    if (url.pathname === "/watch") {
      return normalizeVideoId(url.searchParams.get("v"));
    }

    const pathMatch = url.pathname.match(
      /\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/
    );
    return normalizeVideoId(pathMatch && pathMatch[1]);
  } catch (err) {
    const looseMatch = trimmed.match(
      /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/
    );
    return normalizeVideoId(looseMatch && looseMatch[1]);
  }
}

function normalizeVideoId(videoId) {
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId || "") ? videoId : null;
}

function getCanonicalYoutubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function getVideoMetadata(videoId) {
  const fallback = {
    title: "Untitled YouTube video",
    description: "",
    durationSeconds: 0
  };

  try {
    const info = await ytdl.getBasicInfo(videoId);
    const details = info.videoDetails || {};

    return {
      title: details.title || fallback.title,
      description: details.description || "",
      authorName: details.author?.name,
      thumbnailUrl: details.thumbnails?.at(-1)?.url,
      durationSeconds: Number(details.lengthSeconds || 0)
    };
  } catch (err) {
    console.error(
      `[youtube] ytdl metadata failed for ${videoId}: ${err.name || "Error"} | ${
        err.message
      }`
    );
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      getCanonicalYoutubeUrl(videoId)
    )}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) return fallback;

    const data = await response.json();
    const durationSeconds = await getVideoDuration(videoId);

    return {
      title: data.title || fallback.title,
      description: "",
      authorName: data.author_name,
      thumbnailUrl: data.thumbnail_url,
      durationSeconds
    };
  } catch (err) {
    console.error(
      `[youtube] oEmbed metadata failed for ${videoId}: ${err.name || "Error"} | ${
        err.message
      }`
    );
    return fallback;
  }
}

async function getVideoDuration(videoId) {
  try {
    const response = await fetch(getCanonicalYoutubeUrl(videoId), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (!response.ok) return 0;

    const html = await response.text();
    const durationMatch = html.match(/"approxDurationMs":"(\d+)"/);
    if (!durationMatch) return 0;

    return Math.round(Number(durationMatch[1]) / 1000);
  } catch (err) {
    return 0;
  }
}

module.exports = {
  extractVideoId,
  getCanonicalYoutubeUrl,
  getVideoMetadata
};
