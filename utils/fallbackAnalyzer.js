const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "most",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "video",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your"
]);

function createFallbackAnalysis({
  title,
  description,
  url,
  transcript,
  segments,
  tone,
  mode,
  transcriptSource,
  usedMetadataFallback,
  generatedWith
}) {
  const sourceText = [transcript, description].filter(Boolean).join(" ");
  const sentences = splitSentences(sourceText);
  const keywords = extractKeywords(sourceText);
  const importantSentences = rankSentences(sentences, keywords);
  const compact = importantSentences.slice(0, mode === "quick" ? 4 : 8);
  const takeaways = compact.slice(0, 5).map((sentence) => tighten(sentence));
  const keyMoments = buildKeyMoments(segments, keywords, url);
  const isStudy = mode === "study";

  return {
    videoTitle: title,
    tldr: styleTldr(
      compact.slice(0, 3).join(" ") ||
        `${title}. ${description || "No transcript text was available."}`,
      tone,
      mode,
      usedMetadataFallback
    ),
    detailedSummary: compact.map((sentence) => tighten(sentence)),
    keyTakeaways: takeaways,
    notes: {
      keyConcepts: keywords.slice(0, 8).map(titleCase),
      definitions: isStudy
        ? keywords.slice(0, 5).map((keyword) => ({
            term: titleCase(keyword),
            definition: `A recurring idea in the video connected to ${keyword}. Review the surrounding examples for context.`
          }))
        : [],
      examples: isStudy
        ? importantSentences
            .filter((sentence) => /example|case|for instance|such as/i.test(sentence))
            .slice(0, 4)
            .map(tighten)
        : []
    },
    quiz: isStudy ? buildQuiz(keywords, takeaways) : [],
    flashcards: isStudy ? buildFlashcards(keywords, takeaways) : [],
    keyMoments,
    difficulty: classifyDifficulty(sourceText),
    generatedWith,
    sourceNote: usedMetadataFallback
      ? `Generated from video title and description because every transcript method failed. Source: ${transcriptSource}.`
      : `Generated from transcript source: ${transcriptSource || "unknown"}.`
  };
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35);
}

function extractKeywords(text) {
  const counts = new Map();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([word]) => word);
}

function rankSentences(sentences, keywords) {
  const ranked = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    const score =
      keywords.reduce(
        (total, keyword) => total + (lower.includes(keyword) ? 1 : 0),
        0
      ) +
      (/important|key|remember|because|therefore|means|example/i.test(sentence)
        ? 2
        : 0) -
      index * 0.01;

    return { sentence, score };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
    .map((item) => item.sentence);
}

function buildKeyMoments(segments, keywords, url) {
  const scored = segments.map((segment) => {
    const lower = segment.text.toLowerCase();
    const score =
      keywords.reduce(
        (total, keyword) => total + (lower.includes(keyword) ? 1 : 0),
        0
      ) + (/important|example|concept|step|reason|problem/i.test(segment.text) ? 2 : 0);

    return { ...segment, score };
  });

  return scored
    .filter((segment) => segment.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({
      timestamp: Math.max(0, Math.round(segment.start)),
      label: index === 0 ? "Core concept" : inferMomentLabel(segment.text),
      reason: tighten(segment.text).slice(0, 130),
      url: `${url}&t=${Math.max(0, Math.round(segment.start))}s`
    }));
}

function inferMomentLabel(text) {
  if (/example|case|instance/i.test(text)) return "Important example";
  if (/step|first|next|finally/i.test(text)) return "Process step";
  if (/problem|challenge|mistake/i.test(text)) return "Common challenge";
  return "Key insight";
}

function buildQuiz(keywords, takeaways) {
  return takeaways.slice(0, 5).map((takeaway, index) => {
    const answer = titleCase(keywords[index] || "main idea");
    return {
      question: `Which concept best connects to this point: "${takeaway.slice(
        0,
        90
      )}"?`,
      options: [
        answer,
        titleCase(keywords[index + 1] || "unrelated detail"),
        "A random statistic",
        "The video upload date"
      ],
      answer
    };
  });
}

function buildFlashcards(keywords, takeaways) {
  return keywords.slice(0, 8).map((keyword, index) => ({
    question: `What should you remember about ${titleCase(keyword)}?`,
    answer:
      takeaways[index % Math.max(takeaways.length, 1)] ||
      `${titleCase(keyword)} is one of the recurring ideas in the video.`
  }));
}

function classifyDifficulty(text) {
  const averageWordLength =
    text.replace(/[^a-zA-Z\s]/g, "").split(/\s+/).join("").length /
    Math.max(1, text.split(/\s+/).length);
  const technicalSignals = (text.match(/\b(algorithm|architecture|framework|model|optimization|theory|implementation|analysis)\b/gi) || []).length;

  if (averageWordLength > 6 || technicalSignals > 12) return "Advanced";
  if (averageWordLength > 5 || technicalSignals > 4) return "Intermediate";
  return "Beginner";
}

function styleTldr(text, tone, mode, usedMetadataFallback) {
  const cleaned = tighten(text);
  const prefix = usedMetadataFallback
    ? "Transcript unavailable; based on the video title and description: "
    : "";
  if (mode === "entertainment" || tone === "fun") {
    return `${prefix}Here is the gist: ${cleaned}`;
  }
  if (tone === "simplified") {
    return `${prefix}In simple terms: ${cleaned}`;
  }
  if (tone === "casual") {
    return `${prefix}Quick take: ${cleaned}`;
  }
  return `${prefix}${cleaned}`;
}

function tighten(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text) {
  return String(text || "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

module.exports = { createFallbackAnalysis };
