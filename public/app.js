// Initialize Lucide Icons
lucide.createIcons();

const form = document.querySelector("#summarizeForm");
const urlInput = document.querySelector("#youtubeUrl");
const themeToggle = document.querySelector("#themeToggle");
const loadingState = document.querySelector("#loadingState");
const results = document.querySelector("#results");
const processingNote = document.querySelector("#processingNote");
const historyPanel = document.querySelector("#historyPanel");
const historyList = document.querySelector("#historyList");

// Progress bar elements
const progressBarFill = document.querySelector(".progress-bar-fill");
const progressPercent = document.querySelector(".progress-percent");
const progressStatus = document.querySelector(".progress-status");

const state = {
  lastResult: null,
  progressInterval: null
};

initTheme();
renderHistory();
setupScrollReveal();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await summarize();
});

themeToggle.addEventListener("click", () => {
  // Theme toggle is mostly visual, as we default to dark cinematic theme
  // We'll keep the logic but it might not be strictly needed.
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("vit-theme", isDark ? "dark" : "light");
  const iconStatus = isDark ? "sun" : "moon";
  themeToggle.innerHTML = `<i data-lucide="${iconStatus}"></i>`;
  lucide.createIcons();
});

document.querySelector("#copyAllButton").addEventListener("click", () => {
  copyText(buildPlainText(state.lastResult));
});

document.querySelector("#downloadTextButton").addEventListener("click", () => {
  downloadFile("video-intelligence-summary.txt", buildPlainText(state.lastResult), "text/plain");
});

document.querySelector("#downloadPdfButton").addEventListener("click", () => {
  window.print();
});

document.querySelector("#copyQuizButton").addEventListener("click", () => {
  const quizText = (state.lastResult?.quiz || [])
    .map(
      (item, index) =>
        `${index + 1}. ${item.question}\n${item.options
          .map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`)
          .join("\n")}\nAnswer: ${item.answer}`
    )
    .join("\n\n");
  copyText(quizText);
});

document.querySelector("#exportFlashcardsButton").addEventListener("click", () => {
  const flashcards = state.lastResult?.flashcards || [];
  downloadFile(
    "flashcards.json",
    JSON.stringify(flashcards, null, 2),
    "application/json"
  );
});

/* Intersection Observer for Staggered Scroll Reveals */
function setupScrollReveal() {
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };
  
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // Only animate once
      }
    });
  }, observerOptions);

  document.querySelectorAll('.scroll-reveal').forEach(el => {
    observer.observe(el);
  });
}

function resetScrollReveals() {
  document.querySelectorAll('.scroll-reveal').forEach(el => {
    el.classList.remove('visible');
  });
  // Re-run setup
  setTimeout(setupScrollReveal, 100);
}

/* API Fetching & UI Orchestration */
async function summarize() {
  // Get values from custom radio pill groups
  const toneSelect = document.querySelector('input[name="tone"]:checked').value;
  const modeSelect = document.querySelector('input[name="mode"]:checked').value;
  const urlValue = urlInput.value.trim();
  const validUrlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11,}/i;

  if (!urlValue || !validUrlPattern.test(urlValue)) {
    showToast("Please enter a valid YouTube video URL", "error");
    return;
  }

  const payload = {
    url: urlValue,
    tone: toneSelect,
    mode: modeSelect
  };

  processingNote.hidden = true;
  results.hidden = true;
  resetScrollReveals();

  await handleGenerate(payload);
}

async function handleGenerate(payload) {
  setLoading(true);

  try {
    const response = await fetch('/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Request failed');
    }

    const data = await response.json();

    state.lastResult = data;
    renderResult(data);
    saveHistory(data);
    renderHistory();

  } catch (err) {
    console.error(err);
    showToast("Failed to fetch video", "error");
    if (state.lastResult) {
      renderResult(state.lastResult);
      results.hidden = false;
    }
  } finally {
    setLoading(false);
  }
}

function showToast(message, type = "error") {
  const container = document.querySelector("#toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const icon = document.createElement("div");
  icon.className = "toast__icon";
  icon.innerHTML = type === "success"
    ? '<i data-lucide="check-circle"></i>'
    : type === "info"
    ? '<i data-lucide="info"></i>'
    : '<i data-lucide="alert-circle"></i>';

  const text = document.createElement("div");
  text.className = "toast__message";
  text.textContent = message;

  toast.append(icon, text);
  container.appendChild(toast);
  lucide.createIcons();

  const timeoutId = setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease-out forwards";
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 3000);

  toast.addEventListener("mouseenter", () => {
    clearTimeout(timeoutId);
    toast.style.animation = "none";
  });

  toast.addEventListener("mouseleave", () => {
    setTimeout(() => {
      toast.style.animation = "toastOut 0.3s ease-out forwards";
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
    }, 500);
  });
}

/* Loading Animations */
function startLoadingSimulation() {
  loadingState.hidden = false;
  results.hidden = true;
  form.querySelector("button[type='submit']").disabled = true;
  form.querySelector("button[type='submit'] span").textContent = "Working...";
  
  progressBarFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressStatus.textContent = "Analyzing video structure...";
  
  let progress = 0;
  clearInterval(state.progressInterval);
  
  // Fake progress bar that slows down as it gets closer to 90%
  state.progressInterval = setInterval(() => {
    if (progress < 40) {
      progress += Math.random() * 5 + 2;
      progressStatus.textContent = "Extracting transcript & key moments...";
    } else if (progress < 70) {
      progress += Math.random() * 3 + 1;
      progressStatus.textContent = "Generating AI summaries & study notes...";
    } else if (progress < 90) {
      progress += Math.random() * 1;
      progressStatus.textContent = "Finalizing structured output...";
    }
    
    if (progress > 90) progress = 90; // Cap at 90% until real network finishes
    
    const displayProgress = Math.floor(progress);
    progressBarFill.style.width = `${displayProgress}%`;
    progressPercent.textContent = `${displayProgress}%`;
  }, 300);
}

function finishLoadingSimulation() {
  clearInterval(state.progressInterval);
  progressBarFill.style.width = "100%";
  progressPercent.textContent = "100%";
  progressStatus.textContent = "Done!";
  form.querySelector("button[type='submit']").disabled = false;
  form.querySelector("button[type='submit'] span").textContent = "Generate";
}

function stopLoadingSimulation() {
  clearInterval(state.progressInterval);
  loadingState.hidden = true;
  form.querySelector("button[type='submit']").disabled = false;
  form.querySelector("button[type='submit'] span").textContent = "Generate";
}

function setLoading(isLoading) {
  if (isLoading) {
    startLoadingSimulation();
  } else {
    stopLoadingSimulation();
  }
}

/* Content Rendering */
function renderResult(data) {
  loadingState.hidden = true;
  document.body.classList.toggle("quick-mode", data.mode === "quick");
  
  document.querySelector("#resultTitle").textContent = data.title;
  document.querySelector("#resultMeta").textContent = `${labelForMode(
    data.mode
  )} • ${labelForTone(data.tone)} • ${data.transcriptLanguage || "captions"}`;

  if (data.transcriptChunkCount > 1) {
    processingNote.hidden = false;
  } else {
    processingNote.hidden = true;
  }

  document.querySelector("#timeSaved").innerHTML = `You saved approximately <b style='color:#fff'>${data.metrics?.savedMinutes || 0} minutes</b>`;
  document.querySelector("#timeBreakdown").textContent = `${data.metrics?.videoMinutes || 0} min video → ${data.metrics?.readingTimeMinutes || 1} min read`;

  // Typing animation for TLDR
  const tldrEl = document.querySelector("#tldr");
  tldrEl.textContent = "";
  typeWriterEffect(tldrEl, data.tldr || "No TLDR found.", 15);

  renderList("#detailedSummary", data.detailedSummary);
  renderList("#keyTakeaways", data.keyTakeaways);
  renderList("#noteConcepts", data.notes?.keyConcepts);
  renderDefinitions(data.notes?.definitions || []);
  renderList("#noteExamples", data.notes?.examples);
  renderQuiz(data.quiz || []);
  renderFlashcards(data.flashcards || []);
  renderKeyMoments(data);
  renderThumbnail(data);

  document.querySelector("#difficulty").textContent = data.difficulty || "Beginner";
  
  results.hidden = false;
  lucide.createIcons();
  
  // Smooth scroll down to results
  setTimeout(() => {
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

/* Typing Effect Utility */
function typeWriterEffect(element, text, speed) {
  let i = 0;
  element.textContent = "";
  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }
  type();
}

function renderList(selector, items = []) {
  const list = document.querySelector(selector);
  list.innerHTML = "";

  if (!items.length) {
    const item = document.createElement("li");
    item.textContent = "No items generated for this mode.";
    list.append(item);
    return;
  }

  items.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });
}

function renderDefinitions(definitions) {
  const list = document.querySelector("#noteDefinitions");
  list.innerHTML = "";

  if (!definitions.length) {
    const term = document.createElement("dt");
    term.textContent = "No definitions";
    const description = document.createElement("dd");
    description.textContent = "Definitions appear in Study Mode.";
    list.append(term, description);
    return;
  }

  definitions.forEach((definition) => {
    const term = document.createElement("dt");
    term.textContent = definition.term;
    const description = document.createElement("dd");
    description.textContent = definition.definition;
    list.append(term, description);
  });
}

function renderQuiz(quiz) {
  const list = document.querySelector("#quizList");
  list.innerHTML = "";

  quiz.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "quiz-item";

    const question = document.createElement("strong");
    question.textContent = `${index + 1}. ${item.question}`;

    const options = document.createElement("ol");
    item.options.forEach((option) => {
      const optionItem = document.createElement("li");
      optionItem.textContent = option;
      options.append(optionItem);
    });

    const answer = document.createElement("div");
    answer.className = "answer";
    answer.textContent = `Correct: ${item.answer}`;

    wrapper.append(question, options, answer);
    list.append(wrapper);
  });
}

function renderFlashcards(cards) {
  const list = document.querySelector("#flashcards");
  list.innerHTML = "";

  cards.forEach((card) => {
    const wrapper = document.createElement("div");
    wrapper.className = "flashcard";

    const question = document.createElement("strong");
    question.textContent = card.question;

    const answer = document.createElement("p");
    answer.textContent = card.answer;

    wrapper.append(question, answer);
    list.append(wrapper);
  });
}

function renderKeyMoments(data) {
  const list = document.querySelector("#keyMoments");
  list.innerHTML = "";

  (data.keyMoments || []).forEach((moment) => {
    const timestamp = Math.max(0, Math.round(moment.timestamp || 0));
    const link = document.createElement("a");
    link.className = "moment-link";
    link.href = `${data.url}&t=${timestamp}s`;
    link.target = "_blank";
    link.rel = "noreferrer";

    const labelContainer = document.createElement("span");
    const tsEl = document.createElement("span");
    tsEl.className = "ts";
    tsEl.textContent = formatTimestamp(timestamp);
    
    labelContainer.append(tsEl);
    labelContainer.appendChild(document.createTextNode(` ${moment.label}`));

    const reason = document.createElement("small");
    reason.textContent = moment.reason || "Open this moment in YouTube.";

    link.append(labelContainer, reason);
    list.append(link);
  });
}

function renderThumbnail(data) {
  const panel = document.querySelector("#thumbnailPanel");
  const image = document.querySelector("#videoThumbnail");

  if (!data.videoId) {
    panel.hidden = true;
    return;
  }

  try {
    image.src = `https://img.youtube.com/vi/${data.videoId}/maxresdefault.jpg`;
    image.onerror = () => {
      panel.hidden = true;
    };
    panel.hidden = false;
  } catch (err) {
    console.error("Thumbnail render error:", err);
    panel.hidden = true;
  }
}

function saveHistory(data) {
  const history = getHistory();
  const entry = {
    title: data.title,
    url: data.url,
    savedAt: new Date().toISOString()
  };
  const next = [entry, ...history.filter((item) => item.url !== data.url)].slice(0, 5);
  localStorage.setItem("vit-history", JSON.stringify(next));
}

function renderHistory() {
  const history = getHistory();
  historyPanel.hidden = history.length === 0;
  historyList.innerHTML = "";

  history.forEach((item) => {
    const button = document.createElement("button");
    button.className = "history-chip";
    button.type = "button";
    button.title = item.title;
    
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "youtube");
    icon.style.width = "14px"; icon.style.height = "14px"; icon.style.marginRight = "6px";
    icon.style.display = "inline-block"; icon.style.verticalAlign = "middle";

    const text = document.createElement("span");
    text.textContent = item.title || item.url;
    text.style.verticalAlign = "middle";

    button.append(icon, text);

    button.addEventListener("click", () => {
      urlInput.value = item.url;
      urlInput.focus();
    });
    historyList.append(button);
  });
  
  if (history.length > 0) lucide.createIcons();
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("vit-history") || "[]");
  } catch (err) {
    return [];
  }
}

function buildPlainText(data) {
  if (!data) return "";

  return [
    data.title,
    "",
    `Mode: ${labelForMode(data.mode)}`,
    `Tone: ${labelForTone(data.tone)}`,
    `Time saved: ${data.metrics?.savedMinutes || 0} minutes`,
    "",
    "TL;DR",
    data.tldr,
    "",
    "Detailed Summary",
    ...(data.detailedSummary || []).map((item) => `- ${item}`),
    "",
    "Key Takeaways",
    ...(data.keyTakeaways || []).map((item) => `- ${item}`),
    "",
    "Notes",
    ...(data.notes?.keyConcepts || []).map((item) => `- ${item}`),
    "",
    "Quiz",
    ...(data.quiz || []).map(
      (item, index) => `${index + 1}. ${item.question}\nAnswer: ${item.answer}`
    ),
    "",
    "Flashcards",
    ...(data.flashcards || []).map((item) => `Q: ${item.question}\nA: ${item.answer}`),
    "",
    "Key Moments",
    ...(data.keyMoments || []).map(
      (item) => `${formatTimestamp(item.timestamp)} -> ${item.label}: ${item.reason}`
    )
  ].join("\n");
}

// setError is intentionally removed to keep the UI clean. Errors are logged only to the console.

async function copyText(text) {
  await navigator.clipboard.writeText(text || "");
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents || ""], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initTheme() {
  const storedTheme = localStorage.getItem("vit-theme");
  // Default to cinematic dark unless literally set to light
  const useDark = storedTheme !== "light"; 
  document.body.classList.toggle("dark", useDark);
}

function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function labelForMode(mode) {
  return {
    study: "Study",
    quick: "Quick",
    entertainment: "Chill"
  }[mode] || "Study";
}

function labelForTone(tone) {
  return {
    formal: "Formal",
    casual: "Casual",
    simplified: "Simplified",
    fun: "Fun"
  }[tone] || "Formal";
}
