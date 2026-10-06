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
  pageJumpForm: $("#pageJumpForm"),
  pageJumpInput: $("#pageJumpInput"),
  pageJumpTotal: $("#pageJumpTotal"),
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

  els.pageJumpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    goToSelectedPage();
  });

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
  cleanupTurnLayer();
  renderBlocksInto(els.pageContent, state.pageIndex);

  const current = state.pageIndex + 1;
  const total = Math.max(1, state.pages.length);
  const percent = total <= 1 ? 100 : Math.round((state.pageIndex / (total - 1)) * 100);

  els.bookProgress.textContent = `Página ${current} de ${total}`;
  els.progressPercent.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  els.prevBtn.disabled = state.pageIndex <= 0;
  els.nextBtn.disabled = state.pageIndex >= total - 1;
  els.pageJumpInput.max = String(total);
  els.pageJumpInput.value = String(current);
  els.pageJumpTotal.textContent = `de ${total}`;

  resetPaperVisuals();
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

let turnScene = null;

function renderBlocksInto(container, pageIndex) {
  container.replaceChildren();
  const page = state.pages[pageIndex] || [];
  page.forEach((block) => container.append(createBlockElement(block)));
}

function createTurnPage(pageIndex, className) {
  const article = document.createElement("article");
  article.className = `paper ${className}`;
  article.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "page-content";
  renderBlocksInto(content, pageIndex);

  const corner = document.createElement("div");
  corner.className = "page-corner";
  corner.setAttribute("aria-hidden", "true");

  article.append(content, corner);
  return article;
}

function cleanupTurnLayer() {
  if (turnScene) {
    turnScene.underlay?.remove();
    turnScene.curl?.remove();
    turnScene.shadow?.remove();
  }

  turnScene = null;
  resetPaperVisuals();
}

function resetPaperVisuals() {
  els.paper.style.transition = "none";
  els.paper.style.clipPath = "inset(0 0 0 0)";
  els.paper.style.transform = "translate3d(0,0,0)";
  els.paper.style.transformOrigin = "center center";
  els.paper.style.opacity = "1";
  els.paper.style.filter = "";
  els.paper.style.setProperty("--turn-shadow-opacity", "0");
  els.paper.style.setProperty("--curl-x", "92%");
  els.paper.style.setProperty("--curl-y", "50%");
}

function prepareTurn(direction, touchYPercent = 50) {
  const targetIndex = state.pageIndex + direction;
  if (targetIndex < 0 || targetIndex >= state.pages.length) return null;

  if (turnScene?.direction === direction) {
    turnScene.touchY = touchYPercent;
    return turnScene;
  }

  cleanupTurnLayer();

  const underlay = createTurnPage(targetIndex, "turn-underlay");
  const curl = createTurnPage(state.pageIndex, "turn-curl-sheet");
  const shadow = document.createElement("div");
  shadow.className = "turn-fold-shadow";
  shadow.setAttribute("aria-hidden", "true");

  els.bookViewport.insertBefore(underlay, els.paper);
  els.bookViewport.append(shadow, curl);

  turnScene = {
    direction,
    targetIndex,
    underlay,
    curl,
    shadow,
    progress: 0,
    touchY: touchYPercent,
  };

  applyCurlProgress(turnScene, 0, touchYPercent);
  return turnScene;
}

function applyCurlProgress(scene, progress, touchYPercent = scene.touchY) {
  if (!scene) return;

  const p = clamp(progress, 0, 1);
  const direction = scene.direction;
  const width = Math.max(1, els.paper.clientWidth);
  const foldX = direction > 0 ? width * (1 - p) : width * p;
  const wave = Math.sin(Math.PI * p);
  const curlSpan = clamp(width * (0.15 + wave * 0.11), 86, 310);
  const lift = 8 + wave * 56;
  const rotation = 7 + Math.pow(p, 0.76) * 120;
  const verticalBias = clamp((touchYPercent - 50) / 50, -1, 1);
  const tilt = verticalBias * wave * 1.15;
  const sliceOpacity = clamp(p * 4.5, 0, 1);

  scene.progress = p;
  scene.touchY = touchYPercent;

  els.paper.style.transition = "none";
  scene.curl.style.transition = "none";
  scene.underlay.style.transition = "none";
  scene.shadow.style.transition = "none";

  if (direction > 0) {
    const left = Math.max(0, foldX - curlSpan);
    const right = Math.min(width, foldX + curlSpan * 0.18);
    const leftPct = (left / width) * 100;
    const rightInsetPct = ((width - right) / width) * 100;

    els.paper.style.clipPath = `inset(0 ${p * 100}% 0 0)`;
    scene.curl.style.clipPath =
      `inset(0 ${rightInsetPct}% 0 ${leftPct}%)`;
    scene.curl.style.transformOrigin = `${foldX}px ${touchYPercent}%`;
    scene.curl.style.transform =
      `translate3d(${-p * 12}px,0,${lift}px) rotateY(${-rotation}deg) rotateZ(${tilt}deg) scaleX(${1 - wave * 0.055})`;
    scene.curl.style.setProperty("--turn-shadow-direction", "90deg");
    scene.curl.style.setProperty("--curl-highlight-x", "78%");
  } else {
    const left = Math.max(0, foldX - curlSpan * 0.18);
    const right = Math.min(width, foldX + curlSpan);
    const leftPct = (left / width) * 100;
    const rightInsetPct = ((width - right) / width) * 100;

    els.paper.style.clipPath = `inset(0 0 0 ${p * 100}%)`;
    scene.curl.style.clipPath =
      `inset(0 ${rightInsetPct}% 0 ${leftPct}%)`;
    scene.curl.style.transformOrigin = `${foldX}px ${touchYPercent}%`;
    scene.curl.style.transform =
      `translate3d(${p * 12}px,0,${lift}px) rotateY(${rotation}deg) rotateZ(${-tilt}deg) scaleX(${1 - wave * 0.055})`;
    scene.curl.style.setProperty("--turn-shadow-direction", "270deg");
    scene.curl.style.setProperty("--curl-highlight-x", "22%");
  }

  scene.curl.style.opacity = String(sliceOpacity);
  scene.curl.style.filter =
    `brightness(${0.98 + wave * 0.035}) saturate(${1 - wave * 0.035})`;
  scene.curl.style.setProperty("--curl-y", `${touchYPercent}%`);

  const shadowWidth = clamp(width * 0.095, 72, 150);
  const shadowLeft = clamp(
    foldX - shadowWidth * (direction > 0 ? 0.56 : 0.44),
    -shadowWidth * 0.3,
    width - shadowWidth * 0.7
  );

  scene.shadow.style.left = `${shadowLeft}px`;
  scene.shadow.style.opacity = String(clamp(wave * 0.92 + p * 0.08, 0, 0.94));
  scene.shadow.style.transform =
    `translateZ(18px) scaleX(${0.78 + wave * 0.34}) ${direction < 0 ? "rotate(180deg)" : ""}`;

  scene.underlay.style.opacity = String(0.76 + p * 0.24);
  scene.underlay.style.transform =
    `translate3d(0,0,-2px) scale(${0.992 + p * 0.008})`;
  scene.underlay.style.filter =
    `brightness(${0.965 + p * 0.035})`;

  els.paper.style.filter =
    `brightness(${1 - p * 0.018})`;
}

function animateCurl(scene, target, duration) {
  return new Promise((resolve) => {
    const from = scene.progress;
    const started = performance.now();

    function frame(now) {
      if (!turnScene || turnScene !== scene) {
        resolve();
        return;
      }

      const elapsed = now - started;
      const t = clamp(elapsed / Math.max(1, duration), 0, 1);

      // Curva suave de leitura: saída controlada, aceleração no meio e assentamento lento.
      const eased = 0.5 - Math.cos(Math.PI * t) / 2;
      const value = from + (target - from) * eased;

      applyCurlProgress(scene, value, scene.touchY);

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function setupSwipe() {
  let active = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let directionLocked = false;
  let horizontalGesture = false;
  let startTime = 0;
  let dragDirection = 0;
  let touchYPercent = 50;

  els.paper.addEventListener("pointerdown", (event) => {
    if (state.turning || event.button > 0) return;

    active = true;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dragDirection = 0;
    directionLocked = false;
    horizontalGesture = false;
    startTime = performance.now();

    const rect = els.paper.getBoundingClientRect();
    touchYPercent = clamp(
      ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
      8,
      92
    );

    els.paper.setPointerCapture?.(event.pointerId);
  });

  els.paper.addEventListener("pointermove", (event) => {
    if (!active || state.turning) return;

    const currentDx = event.clientX - startX;
    const currentDy = event.clientY - startY;

    if (!directionLocked && (Math.abs(currentDx) > 6 || Math.abs(currentDy) > 6)) {
      directionLocked = true;
      horizontalGesture = Math.abs(currentDx) > Math.abs(currentDy) * 1.05;
    }

    if (!horizontalGesture) return;

    dx = currentDx;
    const intendedDirection = dx < 0 ? 1 : -1;
    const targetIndex = state.pageIndex + intendedDirection;
    const canTurn = targetIndex >= 0 && targetIndex < state.pages.length;

    if (!canTurn) {
      cleanupTurnLayer();
      const resistance = Math.sign(dx) * Math.min(Math.abs(dx) * 0.11, 24);
      els.paper.style.transform = `translate3d(${resistance}px,0,0)`;
      return;
    }

    if (dragDirection !== intendedDirection || !turnScene) {
      dragDirection = intendedDirection;
      prepareTurn(dragDirection, touchYPercent);
    }

    const width = Math.max(1, els.paper.clientWidth);
    const progress = clamp(Math.abs(dx) / (width * 0.88), 0, 0.995);

    applyCurlProgress(turnScene, progress, touchYPercent);
  });

  const finish = async (event) => {
    if (!active) return;
    active = false;

    try {
      els.paper.releasePointerCapture?.(event.pointerId);
    } catch {}

    if (!horizontalGesture || !dragDirection || !turnScene) {
      cleanupTurnLayer();
      return;
    }

    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = Math.abs(dx) / elapsed;
    const progress = turnScene.progress;
    const shouldTurn =
      progress >= 0.23 ||
      (velocity > 0.52 && Math.abs(dx) > 28);

    if (shouldTurn) {
      await completeTurn(dragDirection, false);
    } else {
      await cancelDraggedTurn();
    }
  };

  els.paper.addEventListener("pointerup", finish);
  els.paper.addEventListener("pointercancel", finish);
}

async function cancelDraggedTurn() {
  const scene = turnScene;
  if (!scene) {
    resetPaperVisuals();
    return;
  }

  const duration = 180 + scene.progress * 320;
  await animateCurl(scene, 0, duration);
  cleanupTurnLayer();
}

async function completeTurn(direction, programmatic = false) {
  if (state.turning) return;

  const nextIndex = state.pageIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.pages.length) {
    await cancelDraggedTurn();
    return;
  }

  const scene = turnScene || prepareTurn(direction, 50);
  if (!scene) return;

  state.turning = true;
  closeSettings();

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reducedMotion) {
    const remaining = 1 - scene.progress;
    const duration = programmatic
      ? 940
      : clamp(250 + remaining * 430, 260, 650);

    await animateCurl(scene, 1, duration);
  }

  state.pageIndex = nextIndex;
  cleanupTurnLayer();
  renderPage();
  state.turning = false;
}

async function turnPage(direction) {
  if (state.turning) return;

  const nextIndex = state.pageIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.pages.length) return;

  const scene = prepareTurn(direction, 50);
  if (!scene) return;

  // Um pequeno início visível evita a sensação de "teleporte" ao clicar.
  applyCurlProgress(scene, 0.015, 50);
  await nextFrame();
  await completeTurn(direction, true);
}

function goToSelectedPage() {
  if (!state.pages.length || state.turning) return;

  const total = state.pages.length;
  const requested = Number.parseInt(els.pageJumpInput.value, 10);

  if (!Number.isFinite(requested)) {
    els.pageJumpInput.value = String(state.pageIndex + 1);
    return;
  }

  const pageNumber = clamp(requested, 1, total);
  const targetIndex = pageNumber - 1;

  els.pageJumpInput.value = String(pageNumber);

  if (targetIndex === state.pageIndex) {
    closeSettings();
    return;
  }

  cleanupTurnLayer();
  state.pageIndex = targetIndex;
  renderPage();
  closeSettings();
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
