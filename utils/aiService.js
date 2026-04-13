const { createFallbackAnalysis } = require("./fallbackAnalyzer");
const { cleanTranscriptText } = require("./text");

const VALID_TONES = new Set(["formal", "casual", "simplified", "fun"]);
const VALID_MODES = new Set(["study", "quick", "entertainment"]);

async function analyzeTranscript({
  title,
  description,
  videoId,
  url,
  transcript,
  segments,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback
}) {
  const safeTone = VALID_TONES.has(tone) ? tone : "formal";
  const safeMode = VALID_MODES.has(mode) ? mode : "study";

  if (!process.env.OPENAI_API_KEY) {
    return createFallbackAnalysis({
      title,
      description,
      url,
      transcript,
      segments,
      tone: safeTone,
      mode: safeMode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      generatedWith: "local-demo"
    });
  }

  try {
    return await analyzeWithOpenAI({
      title,
      description,
      videoId,
      url,
      transcript,
      segments,
      tone: safeTone,
      mode: safeMode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback
    });
  } catch (err) {
    if (process.env.ALLOW_LOCAL_AI_FALLBACK === "false") {
      const error = new Error("AI API failure");
      error.status = 502;
      error.code = "AI_API_FAILURE";
      error.publicMessage =
        "The AI service could not process the transcript right now. Please try again shortly.";
      throw error;
    }

    return createFallbackAnalysis({
      title,
      description,
      url,
      transcript,
      segments,
      tone: safeTone,
      mode: safeMode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      generatedWith: "local-fallback"
    });
  }
}

async function analyzeWithOpenAI({
  title,
  description,
  videoId,
  url,
  transcript,
  segments,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  allowChunking = true
}) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const cleanedTranscript = cleanTranscriptText(transcript);
  const transcriptLength = cleanedTranscript.length;
  const chunkThreshold = 45000;

  if (usedMetadataFallback) {
    console.log(`[ai] Using fallback metadata summarization (transcript unavailable)`);
  } else {
    console.log(`[ai] Using transcript-based summarization (source: ${transcriptSource})`);
  }

  if (allowChunking && transcriptLength > chunkThreshold) {
    return await analyzeLargeTranscript({
      title,
      description,
      videoId,
      url,
      transcript: cleanedTranscript,
      segments,
      tone,
      mode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      model,
      maxChunkChars: 4500
    });
  }

  const segmentPreview = segments.slice(0, 260).map((segment) => ({
    start: Math.round(segment.start),
    text: segment.text
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise video intelligence engine. Return only valid JSON matching the requested schema. Do not include markdown fences."
        },
        {
          role: "user",
          content: buildPrompt({
            title,
            description,
            videoId,
            url,
            transcript: cleanedTranscript,
            segmentPreview,
            tone,
            mode,
            durationSeconds,
            transcriptSource,
            usedMetadataFallback
          })
        }
      ],
      temperature: mode === "entertainment" || tone === "fun" ? 0.7 : 0.25
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);

  return normalizeAnalysis(parsed, title, model);
}

async function analyzeLargeTranscript({
  title,
  description,
  videoId,
  url,
  transcript,
  segments,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  model,
  maxChunkChars
}) {
  console.log(
    `[ai] Transcript too large (${transcript.length} chars). Using chunk-based analysis...`
  );
  console.log(`[ai] Using transcript-based chunked summarization`);

  let chunks;
  try {
    chunks = splitTranscriptIntoChunks(segments, maxChunkChars);
  } catch (chunkError) {
    console.error(`[ai] chunking failed: ${chunkError.message}`);
    return await analyzeWithOpenAI({
      title,
      description,
      videoId,
      url,
      transcript,
      segments,
      tone,
      mode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      allowChunking: false
    });
  }

  console.log(`[ai] Transcript length: ${transcript.length} chars`);
  console.log(`[ai] Chunks created: ${chunks.length}`);

  if (!chunks.length) {
    return await analyzeWithOpenAI({
      title,
      description,
      videoId,
      url,
      transcript,
      segments,
      tone,
      mode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      allowChunking: false
    });
  }

  const chunkSummaries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const cleanedChunkText = cleanTranscriptText(chunk.text);
    console.log(
      `[ai] Processing chunk ${index + 1}/${chunks.length} (${cleanedChunkText.length} chars)`
    );
    const chunkSummary = await summarizeTranscriptChunk({
      title,
      description,
      videoId,
      url,
      tone,
      mode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      model,
      chunk: cleanedChunkText,
      chunkIndex: index + 1,
      chunkCount: chunks.length
    });

    if (chunkSummary && chunkSummary.summary) {
      console.log(
        `[ai] chunk ${index + 1}/${chunks.length} summary done: ${chunkSummary.summary.length} chars`
      );
      chunkSummaries.push(chunkSummary.summary);
    }
  }

  const combinedSummary = chunkSummaries.filter(Boolean).join("\n\n");

  if (!combinedSummary.trim()) {
    console.error("[ai] No chunk summaries were generated. Falling back to non-chunked analysis.");
    return await analyzeWithOpenAI({
      title,
      description,
      videoId,
      url,
      transcript,
      segments,
      tone,
      mode,
      durationSeconds,
      transcriptSource,
      usedMetadataFallback,
      allowChunking: false
    });
  }

  console.log(`[ai] Combined chunk summaries: ${combinedSummary.length} chars`);
  const finalAnalysis = await analyzeChunkSummaries({
    title,
    description,
    videoId,
    url,
    summaryText: combinedSummary,
    segments,
    tone,
    mode,
    durationSeconds,
    transcriptSource,
    usedMetadataFallback,
    model
  });

  finalAnalysis.transcriptChunkCount = chunks.length;
  return finalAnalysis;
}

async function summarizeTranscriptChunk({
  title,
  description,
  videoId,
  url,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  model,
  chunk,
  chunkIndex,
  chunkCount
}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise video intelligence engine. Return only valid JSON matching the requested schema. Do not include markdown fences."
        },
        {
          role: "user",
          content: buildChunkSummaryPrompt({
            title,
            description,
            videoId,
            url,
            tone,
            mode,
            durationSeconds,
            transcriptSource,
            usedMetadataFallback,
            chunk,
            chunkIndex,
            chunkCount
          })
        }
      ],
      temperature: mode === "entertainment" || tone === "fun" ? 0.7 : 0.25
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed while summarizing transcript chunk: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned no content for chunk summary");
  }

  try {
    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed.summary !== "string") {
      throw new Error("Missing or invalid summary field in chunk response");
    }

    return parsed;
  } catch (parseError) {
    console.error(
      `[ai] Failed to parse chunk summary response: ${parseError.message}\nContent: ${content.slice(0, 200)}`
    );
    throw parseError;
  }
}

async function analyzeChunkSummaries({
  title,
  description,
  videoId,
  url,
  summaryText,
  segments,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  model
}) {
  const segmentPreview = segments.slice(0, 260).map((segment) => ({
    start: Math.round(segment.start),
    text: segment.text
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise video intelligence engine. Return only valid JSON matching the requested schema. Do not include markdown fences."
        },
        {
          role: "user",
          content: buildPrompt({
            title,
            description,
            videoId,
            url,
            transcript: summaryText,
            segmentPreview,
            tone,
            mode,
            durationSeconds,
            transcriptSource,
            usedMetadataFallback,
            transcriptNote:
              "The transcript provided below is a set of chunk summaries from a long video transcript. Use it as the basis for the final analysis."
          })
        }
      ],
      temperature: mode === "entertainment" || tone === "fun" ? 0.7 : 0.25
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed when combining chunk summaries: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);

  return normalizeAnalysis(parsed, title, model);
}

function buildChunkSummaryPrompt({
  title,
  description,
  videoId,
  url,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  chunk,
  chunkIndex,
  chunkCount
}) {
  return `Summarize this portion of a YouTube transcript into clear, structured bullet points.
Focus on key concepts, main ideas, and important examples from this chunk only.
Return only valid JSON with this exact shape:
{
  "summary": "• Point 1\n• Point 2\n• Point 3 (max 3-4 clear bullets, 1-2 sentences each)"
}

Video:
- title: ${title}
- videoId: ${videoId}
- description: ${description || "No description"}
- durationSeconds: ${durationSeconds}
- selectedTone: ${tone}
- selectedMode: ${mode}
- chunk: ${chunkIndex}/${chunkCount}

Guidelines:
- Extract only the main ideas and concepts from this chunk
- Use bullet points, NOT raw transcript text
- Keep each point concise (1-2 sentences max)
- Do NOT repeat the transcript text verbatim
- Do NOT invent new details
- Focus on: concepts, examples, definitions, key moments

Transcript chunk:
${chunk}`;
}

function buildPrompt({
  title,
  description,
  videoId,
  url,
  transcript,
  segmentPreview,
  tone,
  mode,
  durationSeconds,
  transcriptSource,
  usedMetadataFallback,
  transcriptNote = ""
}) {
  return `${transcriptNote ? `${transcriptNote}\n\n` : ""}Analyze this YouTube transcript as a Video Intelligence Tool.
CRITICAL: Return ONLY structured JSON. Do NOT copy raw transcript text into the response.

Video:
- title: ${title}
- videoId: ${videoId}
- description: ${description || "No description available"}
- durationSeconds: ${durationSeconds}
- transcriptSource: ${transcriptSource || "unknown"}
- transcriptFallback: ${
    usedMetadataFallback
      ? "No captions were available. Analyze based only on title and description, and be transparent about the limited source."
      : "Transcript captions were available."
  }
- selectedTone: ${tone}
- selectedMode: ${mode}

Mode rules:
- study: Produce detailed summary with 5-8 bullets, comprehensive notes, quiz, flashcards
- quick: Produce concise TLDR (3 lines max), 3-5 detailed bullets, 3 key takeaways ONLY
- entertainment: Use lighter voice, keep summary fun, include key moments, skip quiz/flashcards

OUTPUT REQUIREMENTS (STRICT):
1. TLDR: 3 lines MAXIMUM, concise and impactful
2. detailedSummary: 4-8 bullet points, each 1-2 sentences
3. keyTakeaways: 3-5 concise takeaway sentences (NOT bullet points)
4. Each field must be non-empty
5. Do NOT repeat your own text
6. Do NOT include raw transcript excerpts (summarize instead)
7. Use clear, structured formatting

Return JSON with this exact shape:
{
  "videoTitle": "string",
  "tldr": "3-line summary",
  "detailedSummary": ["• Point 1", "• Point 2", "• Point 3"],
  "keyTakeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],
  "notes": {
    "keyConcepts": ["concept1", "concept2"],
    "definitions": [{"term": "string", "definition": "string"}],
    "examples": ["example1", "example2"]
  },
  "quiz": [{"question": "string", "options": ["A", "B", "C", "D"], "answer": "string"}],
  "flashcards": [{"question": "string", "answer": "string"}],
  "keyMoments": [{"timestamp": 0, "label": "string", "reason": "string"}],
  "difficulty": "Beginner|Intermediate|Advanced"
}

Timeline reference (use for keyMoments timestamps):
${JSON.stringify(segmentPreview)}

Transcript content:
${transcript}`;
}

function splitTranscriptIntoChunks(segments, maxChars) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const segment of segments) {
    const text = String(segment.text || "").trim();
    if (!text) continue;

    if (currentLength + text.length + 1 > maxChars && currentChunk.length) {
      chunks.push({
        text: currentChunk.map((segment) => segment.text).join(" "),
        segments: currentChunk
      });
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(segment);
    currentLength += text.length + 1;
  }

  if (currentChunk.length) {
    chunks.push({
      text: currentChunk.map((segment) => segment.text).join(" "),
      segments: currentChunk
    });
  }

  return chunks;
}

function normalizeAnalysis(raw, fallbackTitle, generatedWith) {
  return {
    videoTitle: raw.videoTitle || fallbackTitle,
    tldr: raw.tldr || "No summary was generated.",
    detailedSummary: asStringArray(raw.detailedSummary),
    keyTakeaways: asStringArray(raw.keyTakeaways),
    notes: {
      keyConcepts: asStringArray(raw.notes?.keyConcepts),
      definitions: Array.isArray(raw.notes?.definitions)
        ? raw.notes.definitions.map((item) => ({
            term: String(item.term || "Concept"),
            definition: String(item.definition || item.meaning || "")
          }))
        : [],
      examples: asStringArray(raw.notes?.examples)
    },
    quiz: Array.isArray(raw.quiz)
      ? raw.quiz.map((item) => ({
          question: String(item.question || ""),
          options: asStringArray(item.options).slice(0, 4),
          answer: String(item.answer || "")
        }))
      : [],
    flashcards: Array.isArray(raw.flashcards)
      ? raw.flashcards.map((item) => ({
          question: String(item.question || ""),
          answer: String(item.answer || "")
        }))
      : [],
    keyMoments: Array.isArray(raw.keyMoments)
      ? raw.keyMoments.map((item) => ({
          timestamp: Number(item.timestamp || 0),
          label: String(item.label || "Key moment"),
          reason: String(item.reason || "")
        }))
      : [],
    difficulty: raw.difficulty || "Beginner",
    transcriptChunkCount: Number(raw.transcriptChunkCount || 1),
    generatedWith
  };
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

module.exports = { analyzeTranscript };
