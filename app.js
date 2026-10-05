import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs";

const $ = (selector) => document.querySelector(selector);

const els = {
  importScreen: $("#importScreen"),
  readerScreen: $("#readerScreen"),
  fileInput: $("#fileInput"),
  dropzone: $("#dropzone"),
  filePill: $("#filePill"),
  textInput: $("#textInput"),
  startBtn: $("#startBtn"),
  status: $("#status"),
  backBtn: $("#backBtn"),
  settingsBtn: $("#settingsBtn"),
  settingsPanel: $("#settingsPanel"),
  fontDown: $("#fontDown"),
  fontUp: $("#fontUp"),
  fontValue: $("#fontValue"),
  lineDown: $("#lineDown"),
  lineUp: $("#lineUp"),
  lineValue: $("#lineValue"),
  themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
  bookTitle: $("#bookTitle"),
  bookProgress: $("#bookProgress"),
  bookViewport: $("#bookViewport"),
  paper: $("#paper"),
  pageContent: $("#pageContent"),
  measurePage: $("#measurePage"),
  prevBtn: $("#prevBtn"),
  nextBtn: $("#nextBtn"),
  progressPercent: $("#progressPercent"),
  progressFill: $("#progressFill"),
  loadingOverlay: $("#loadingOverlay"),
  loadingText: $("#loadingText"),
};

const state = {
  file: null,
  blocks: [],
  pages: [],
  pageIndex: 0,
  title: "Texto",
  fontSize: Number(localStorage.getItem("reader-font-size")) || 19,
  lineHeight: Number(localStorage.getItem("reader-line-height")) || 1.72,
  theme: localStorage.getItem("reader-theme") || "paper",
  repaginateTimer: null,
  turning: false,
};

applyPreferences();
bindEvents();

function bindEvents() {
  els.fileInput.addEventListener("change", (event) => {
    setFile(event.target.files?.[0] || null);
  });

  ["dragenter", "dragover"].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });

  els.dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });

  els.startBtn.addEventListener("click", startReading);
  els.backBtn.addEventListener("click", exitReader);

  els.settingsBtn.addEventListener("click", () => {
    const willOpen = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !willOpen;
    els.settingsBtn.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      !els.settingsPanel.hidden &&
      !els.settingsPanel.contains(event.target) &&
      !els.settingsBtn.contains(event.target)
    ) {
      closeSettings();
    }
  });

  els.prevBtn.addEventListener("click", () => turnPage(-1));
  els.nextBtn.addEventListener("click", () => turnPage(1));

  els.fontDown.addEventListener("click", () => updateFont(-1));
  els.fontUp.addEventListener("click", () => updateFont(1));
  els.lineDown.addEventListener("click", () => updateLineHeight(-0.08));
  els.lineUp.addEventListener("click", () => updateLineHeight(0.08));

  els.themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
  });

  window.addEventListener("keydown", (event) => {
    if (els.readerScreen.hidden) return;

    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      turnPage(1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      turnPage(-1);
    } else if (event.key === "Escape") {
      if (!els.settingsPanel.hidden) closeSettings();
      else exitReader();
    }
  });

  window.addEventListener("resize", () => {
    if (els.readerScreen.hidden || !state.blocks.length) return;
    clearTimeout(state.repaginateTimer);
    state.repaginateTimer = setTimeout(() => repaginate(true), 180);
  });

  setupSwipe();
}

function setFile(file) {
  state.file = file;
  els.status.textContent = "";

  if (!file) {
    els.filePill.hidden = true;
    els.filePill.textContent = "";
    return;
  }

  const extension = getExtension(file.name);
  if (!["pdf", "epub"].includes(extension)) {
    state.file = null;
    els.fileInput.value = "";
    els.filePill.hidden = true;
    els.status.textContent = "Use um arquivo EPUB ou PDF.";
    return;
  }

  els.filePill.textContent = `${file.name} · ${formatBytes(file.size)}`;
  els.filePill.hidden = false;
}

async function startReading() {
  const pasted = els.textInput.value.trim();

  if (!state.file && !pasted) {
    els.status.textContent = "Selecione um EPUB/PDF ou cole um texto antes de continuar.";
    return;
  }

  els.status.textContent = "";
  els.startBtn.disabled = true;
  showLoading("Preparando leitura…");

  try {
    let result;

    if (state.file) {
      const extension = getExtension(state.file.name);

      if (extension === "pdf") {
        result = await parsePdf(state.file);
      } else if (extension === "epub") {
        result = await parseEpub(state.file);
      } else {
        throw new Error("Formato de arquivo não suportado.");
      }
    } else {
      result = {
        title: inferTextTitle(pasted),
        blocks: parsePlainText(pasted),
      };
    }

    if (!result.blocks.length) {
      throw new Error("Não encontrei texto legível nesse conteúdo.");
    }

    state.title = result.title || "Leitura";
    state.blocks = result.blocks;
    state.pageIndex = 0;

    els.bookTitle.textContent = state.title;
    els.importScreen.hidden = true;
    els.readerScreen.hidden = false;

    await waitForLayout();
    await repaginate(false);

    hideLoading();
  } catch (error) {
    console.error(error);
    hideLoading();
    els.status.textContent =
      error?.message || "Não foi possível abrir esse conteúdo.";
  } finally {
    els.startBtn.disabled = false;
  }
}

async function parsePdf(file) {
  showLoading("Abrindo PDF…");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const blocks = [];
  let totalCharacters = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    showLoading(`Lendo PDF · página ${pageNumber} de ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const lines = [];
    let currentLine = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;

      const piece = item.str.replace(/\s+/g, " ").trim();
      if (piece) {
        currentLine += (currentLine ? " " : "") + piece;
        totalCharacters += piece.length;
      }

      if (item.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = "";
      }
    }

    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageParagraphs = linesToParagraphs(lines);
    blocks.push(...pageParagraphs.map((text) => ({ tag: "p", text })));
  }

  if (totalCharacters < 20) {
    throw new Error(
      "Este PDF parece ser digitalizado ou composto por imagens. Esta versão do leitor não faz OCR."
    );
  }

  return {
    title: file.name.replace(/\.pdf$/i, ""),
    blocks,
  };
}

async function parseEpub(file) {
  if (typeof window.ePub !== "function") {
    throw new Error("A biblioteca EPUB não carregou. Verifique sua conexão e tente novamente.");
  }

  showLoading("Abrindo EPUB…");
  const arrayBuffer = await file.arrayBuffer();
  const book = window.ePub(arrayBuffer);

  try {
    await book.ready;
    const metadata = await book.loaded.metadata;
    const items = book.spine.spineItems.filter(
      (item) => item.linear !== "no" && !(item.properties || []).includes("nav")
    );

    const blocks = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      showLoading(`Lendo EPUB · seção ${index + 1} de ${items.length}`);

      try {
        await item.load(book.load.bind(book));
        const doc = item.document;
        const root = doc?.body || item.contents;

        if (root) {
          blocks.push(...extractBlocksFromHtml(root));
        }
      } finally {
        item.unload();
      }
    }

    return {
      title: metadata?.title || file.name.replace(/\.epub$/i, ""),
      blocks: dedupeAdjacentBlocks(blocks),
    };
  } finally {
    book.destroy();
  }
}

function extractBlocksFromHtml(root) {
  const blocks = [];
  const accepted = new Set(["H1", "H2", "H3", "H4", "P", "BLOCKQUOTE", "LI", "PRE"]);
  const ignored = new Set(["SCRIPT", "STYLE", "SVG", "NOSCRIPT", "NAV"]);

  function walk(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (ignored.has(node.tagName)) return;

    if (accepted.has(node.tagName)) {
      const text = cleanText(node.textContent);
      if (text) {
        blocks.push({
          tag: normalizeTag(node.tagName.toLowerCase()),
          text,
        });
      }
      return;
    }

    [...node.children].forEach(walk);
  }

  [...root.children].forEach(walk);

  // EPUBs mal estruturados às vezes têm texto apenas em DIVs.
  if (!blocks.length) {
    const fallback = cleanText(root.textContent);
    if (fallback) {
      return parsePlainText(fallback);
    }
  }

  return blocks;
}

function parsePlainText(text) {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();

  const chunks = normalized.includes("\n\n")
    ? normalized.split(/\n{2,}/)
    : normalized.split(/\n+/);

  const cleanChunks = chunks.map(cleanText).filter(Boolean);

  return cleanChunks.map((chunk, index) => {
    const isLikelyHeading =
      chunk.length <= 90 &&
      !/[.!?;:]$/.test(chunk) &&
      (index === 0 || chunk.split(/\s+/).length <= 10);

    return {
      tag: isLikelyHeading ? (index === 0 ? "h1" : "h2") : "p",
      text: chunk,
    };
  });
}

function linesToParagraphs(lines) {
  if (!lines.length) return [];

  const paragraphs = [];
  let paragraph = "";

  for (let i = 0; i < lines.length; i++) {
    let line = cleanText(lines[i]);
    if (!line) continue;

    // Corrige hifenização comum no fim da linha de PDFs.
    if (paragraph.endsWith("-") && /^[a-zá-úà-ùâ-ûãõç]/i.test(line)) {
      paragraph = paragraph.slice(0, -1) + line;
    } else {
      paragraph += (paragraph ? " " : "") + line;
    }

    const next = cleanText(lines[i + 1] || "");
    const sentenceEnd = /[.!?…]["'”’)]?$/.test(line);
    const shortLine = line.length < 52;
    const nextLooksLikeHeading =
      next && next.length < 75 && !/[.!?;:]$/.test(next) && next.split(/\s+/).length <= 9;

    if ((sentenceEnd && shortLine) || nextLooksLikeHeading) {
      if (paragraph.trim()) paragraphs.push(paragraph.trim());
      paragraph = "";
    }
  }

  if (paragraph.trim()) paragraphs.push(paragraph.trim());
  return paragraphs;
}

async function repaginate(preservePosition) {
  if (!state.blocks.length) return;

  showLoading("Ajustando páginas…");

  const oldCount = state.pages.length;
  const oldRatio =
    preservePosition && oldCount > 1 ? state.pageIndex / (oldCount - 1) : 0;

  syncMeasureSize();

  state.pages = paginateBlocks(state.blocks);

  if (!state.pages.length) {
    state.pages = [[{ tag: "p", text: "Nenhum conteúdo disponível." }]];
  }

  state.pageIndex = preservePosition
    ? Math.min(
        state.pages.length - 1,
        Math.max(0, Math.round(oldRatio * Math.max(0, state.pages.length - 1)))
      )
    : 0;

  renderPage();
  hideLoading();
}

function paginateBlocks(blocks) {
  const pages = [];
  let currentPage = [];

  els.measurePage.replaceChildren();

  const commitPage = () => {
    if (currentPage.length) {
      pages.push(currentPage);
      currentPage = [];
      els.measurePage.replaceChildren();
    }
  };

  for (const original of blocks) {
    let remaining = cleanText(original.text);
    if (!remaining) continue;

    const tag = normalizeTag(original.tag);
    const unsplittable = /^h[1-4]$/.test(tag);

    while (remaining) {
      const fullEl = createBlockElement({ tag, text: remaining });
      els.measurePage.append(fullEl);

      if (fitsMeasure()) {
        currentPage.push({ tag, text: remaining });
        remaining = "";
        continue;
      }

      fullEl.remove();

      if (unsplittable && currentPage.length) {
        commitPage();
        continue;
      }

      const words = remaining.split(/\s+/).filter(Boolean);
      const fitCount = findWordsThatFit(tag, words);

      if (fitCount <= 0) {
        if (currentPage.length) {
          commitPage();
          continue;
        }

        // Proteção para viewport extremamente pequena.
        const forced = words.slice(0, 1).join(" ");
        const forcedEl = createBlockElement({ tag, text: forced });
        els.measurePage.append(forcedEl);
        currentPage.push({ tag, text: forced });
        remaining = words.slice(1).join(" ");
        commitPage();
        continue;
      }

      const fittedText = words.slice(0, fitCount).join(" ");
      const fittedEl = createBlockElement({ tag, text: fittedText });
      els.measurePage.append(fittedEl);
      currentPage.push({ tag, text: fittedText });

      remaining = words.slice(fitCount).join(" ").trim();

      if (remaining) commitPage();
    }
  }

  commitPage();
  return pages;
}

function findWordsThatFit(tag, words) {
  let low = 1;
  let high = words.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const probe = createBlockElement({
      tag,
      text: words.slice(0, mid).join(" "),
    });

    els.measurePage.append(probe);
    const fits = fitsMeasure();
    probe.remove();

    if (fits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function fitsMeasure() {
  return els.measurePage.scrollHeight <= els.measurePage.clientHeight + 1;
}

function syncMeasureSize() {
  const rect = els.pageContent.getBoundingClientRect();

  if (rect.width < 10 || rect.height < 10) {
    throw new Error("Não foi possível calcular a área de leitura.");
  }

  els.measurePage.style.width = `${rect.width}px`;
  els.measurePage.style.height = `${rect.height}px`;
}

function renderPage() {
  els.pageContent.replaceChildren();

  const page = state.pages[state.pageIndex] || [];
  page.forEach((block) => {
    els.pageContent.append(createBlockElement(block));
  });

  const current = state.pageIndex + 1;
  const total = Math.max(1, state.pages.length);
  const percent = total <= 1 ? 100 : Math.round((state.pageIndex / (total - 1)) * 100);

  els.bookProgress.textContent = `Página ${current} de ${total}`;
  els.progressPercent.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  els.prevBtn.disabled = state.pageIndex <= 0;
  els.nextBtn.disabled = state.pageIndex >= total - 1;

  els.paper.style.transition = "";
  els.paper.style.transform = "translate3d(0,0,0) rotateY(0deg)";
  els.paper.style.opacity = "1";
  els.paper.style.setProperty("--turn-shadow-opacity", "0");
}

function createBlockElement(block) {
  const tag = normalizeTag(block.tag);
  const el = document.createElement(tag);
  el.textContent = block.text;
  return el;
}

function normalizeTag(tag) {
  const allowed = new Set(["h1", "h2", "h3", "h4", "p", "blockquote", "li", "pre"]);
  return allowed.has(String(tag).toLowerCase()) ? String(tag).toLowerCase() : "p";
}

function setupSwipe() {
  let active = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let directionLocked = false;
  let horizontalGesture = false;
  let startTime = 0;

  els.paper.addEventListener("pointerdown", (event) => {
    if (state.turning || event.button > 0) return;

    active = true;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    directionLocked = false;
    horizontalGesture = false;
    startTime = performance.now();

    els.paper.style.transition = "none";
    els.paper.setPointerCapture?.(event.pointerId);
  });

  els.paper.addEventListener("pointermove", (event) => {
    if (!active || state.turning) return;

    const currentDx = event.clientX - startX;
    const currentDy = event.clientY - startY;

    if (!directionLocked && (Math.abs(currentDx) > 7 || Math.abs(currentDy) > 7)) {
      directionLocked = true;
      horizontalGesture = Math.abs(currentDx) > Math.abs(currentDy) * 1.12;
    }

    if (!horizontalGesture) return;

    dx = currentDx;

    const goingNext = dx < 0;
    const goingPrev = dx > 0;

    if (
      (goingNext && state.pageIndex >= state.pages.length - 1) ||
      (goingPrev && state.pageIndex <= 0)
    ) {
      dx *= 0.2;
    }

    const width = Math.max(1, els.paper.clientWidth);
    const amount = Math.min(1, Math.abs(dx) / width);
    const rotation = amount * 68;
    const translate = dx * 0.075;

    els.paper.style.transformOrigin = goingNext ? "left center" : "right center";
    els.paper.style.transform = `translate3d(${translate}px,0,0) rotateY(${goingNext ? -rotation : rotation}deg)`;
    els.paper.style.setProperty("--turn-shadow-opacity", String(amount * 0.9));
    els.paper.style.setProperty(
      "--turn-shadow-direction",
      goingNext ? "90deg" : "270deg"
    );
  });

  const finish = async (event) => {
    if (!active) return;
    active = false;

    try {
      els.paper.releasePointerCapture?.(event.pointerId);
    } catch {}

    if (!horizontalGesture || Math.abs(dx) < 4) {
      resetDraggedPage();
      return;
    }

    const width = Math.max(1, els.paper.clientWidth);
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = Math.abs(dx) / elapsed;
    const threshold = width * 0.16;
    const shouldTurn = Math.abs(dx) > threshold || velocity > 0.55;

    if (shouldTurn && dx < 0 && state.pageIndex < state.pages.length - 1) {
      await turnPage(1, true);
    } else if (shouldTurn && dx > 0 && state.pageIndex > 0) {
      await turnPage(-1, true);
    } else {
      resetDraggedPage();
    }
  };

  els.paper.addEventListener("pointerup", finish);
  els.paper.addEventListener("pointercancel", finish);
}

function resetDraggedPage() {
  els.paper.style.transition =
    "transform 220ms cubic-bezier(.2,.75,.2,1), opacity 220ms ease";
  els.paper.style.transform = "translate3d(0,0,0) rotateY(0deg)";
  els.paper.style.opacity = "1";
  els.paper.style.setProperty("--turn-shadow-opacity", "0");
}

async function turnPage(direction, fromDrag = false) {
  if (state.turning) return;

  const nextIndex = state.pageIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.pages.length) {
    if (fromDrag) resetDraggedPage();
    return;
  }

  state.turning = true;
  closeSettings();

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reducedMotion) {
    state.pageIndex = nextIndex;
    renderPage();
    state.turning = false;
    return;
  }

  const outRotation = direction > 0 ? -92 : 92;
  const outTranslate = direction > 0 ? -7 : 7;

  els.paper.style.transformOrigin = direction > 0 ? "left center" : "right center";
  els.paper.style.transition =
    "transform 260ms cubic-bezier(.28,.72,.18,1), opacity 210ms ease";
  els.paper.style.transform = `translate3d(${outTranslate}%,0,0) rotateY(${outRotation}deg)`;
  els.paper.style.opacity = "0.18";
  els.paper.style.setProperty("--turn-shadow-opacity", "0.9");

  await sleep(255);

  state.pageIndex = nextIndex;
  renderPage();

  const inRotation = direction > 0 ? 74 : -74;
  const inTranslate = direction > 0 ? 5 : -5;

  els.paper.style.transition = "none";
  els.paper.style.transformOrigin = direction > 0 ? "right center" : "left center";
  els.paper.style.transform = `translate3d(${inTranslate}%,0,0) rotateY(${inRotation}deg)`;
  els.paper.style.opacity = "0.28";
  els.paper.style.setProperty("--turn-shadow-opacity", "0.55");

  await nextFrame();

  els.paper.style.transition =
    "transform 280ms cubic-bezier(.18,.78,.18,1), opacity 220ms ease";
  els.paper.style.transform = "translate3d(0,0,0) rotateY(0deg)";
  els.paper.style.opacity = "1";
  els.paper.style.setProperty("--turn-shadow-opacity", "0");

  await sleep(285);
  state.turning = false;
}

function updateFont(delta) {
  const next = clamp(state.fontSize + delta, 15, 28);
  if (next === state.fontSize) return;

  state.fontSize = next;
  localStorage.setItem("reader-font-size", String(next));
  document.documentElement.style.setProperty("--reader-font-size", `${next}px`);
  els.fontValue.textContent = String(next);
  scheduleRepaginate();
}

function updateLineHeight(delta) {
  const next = Math.round(clamp(state.lineHeight + delta, 1.35, 2.15) * 100) / 100;
  if (next === state.lineHeight) return;

  state.lineHeight = next;
  localStorage.setItem("reader-line-height", String(next));
  document.documentElement.style.setProperty("--reader-line-height", String(next));
  els.lineValue.textContent = next.toFixed(2);
  scheduleRepaginate();
}

function scheduleRepaginate() {
  if (els.readerScreen.hidden || !state.blocks.length) return;

  clearTimeout(state.repaginateTimer);
  state.repaginateTimer = setTimeout(() => repaginate(true), 120);
}

function setTheme(theme) {
  if (!["paper", "sepia", "dark"].includes(theme)) return;

  state.theme = theme;
  localStorage.setItem("reader-theme", theme);
  document.body.dataset.theme = theme;

  els.themeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === theme);
  });
}

function applyPreferences() {
  document.documentElement.style.setProperty(
    "--reader-font-size",
    `${state.fontSize}px`
  );
  document.documentElement.style.setProperty(
    "--reader-line-height",
    String(state.lineHeight)
  );
  els.fontValue.textContent = String(state.fontSize);
  els.lineValue.textContent = state.lineHeight.toFixed(2);
  setTheme(state.theme);
}

function exitReader() {
  if (state.turning) return;

  closeSettings();
  els.readerScreen.hidden = true;
  els.importScreen.hidden = false;
  els.pageContent.replaceChildren();
  state.pages = [];
  state.pageIndex = 0;
}

function closeSettings() {
  els.settingsPanel.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
}

function showLoading(message) {
  els.loadingText.textContent = message;
  els.loadingOverlay.hidden = false;
}

function hideLoading() {
  els.loadingOverlay.hidden = true;
}

function inferTextTitle(text) {
  const firstLine = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (firstLine && firstLine.length <= 90) return firstLine;
  return "Texto colado";
}

function dedupeAdjacentBlocks(blocks) {
  const result = [];

  for (const block of blocks) {
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.tag === block.tag &&
      previous.text === block.text
    ) {
      continue;
    }
    result.push(block);
  }

  return result;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00ad/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function getExtension(name) {
  return String(name).split(".").pop()?.toLowerCase() || "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );

  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

function waitForLayout() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}
