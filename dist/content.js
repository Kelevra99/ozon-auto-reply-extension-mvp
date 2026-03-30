// src/dom.ts
var REPLY_INPUT_SELECTORS = [
  "textarea#AnswerCommentForm",
  'textarea[id*="AnswerComment"]',
  "textarea",
  '[contenteditable="true"]',
  'div[role="textbox"]',
  'input[type="text"]'
];
var UI_ROOT_CLASS = "ozon-auto-reply-root";
var HIDDEN_NATIVE_AI_ATTR = "data-ozon-auto-reply-hidden";
function unique(items) {
  return [...new Set(items)];
}
function textOf(node) {
  const value = node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return value || null;
}
function normalizeText(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function cleanTextCandidate(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}
function dedupeNested(elements) {
  return elements.filter((element, index, array) => {
    return !array.some((other, otherIndex) => otherIndex !== index && other.contains(element));
  });
}
function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function findClosestModalRoot(start) {
  let current = start instanceof HTMLElement ? start : start?.parentElement ?? null;
  while (current && current !== document.body) {
    const text = normalizeText(current.innerText);
    const hasHeader = text.includes("\u041E\u0442\u0437\u044B\u0432 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440");
    const hasReplyField = Boolean(current.querySelector('textarea#AnswerCommentForm, textarea[id*="AnswerComment"]'));
    const hasProduct = Boolean(current.querySelector('a[href*="/product/"]'));
    const hasReviewBlock = Boolean(current.querySelector("[reviewuuid]"));
    if (hasHeader && hasReplyField && hasProduct && hasReviewBlock) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}
function findElementsByExactText(root, text) {
  return Array.from(root.querySelectorAll("div, span, label, button, a")).filter(
    (element) => normalizeText(element.textContent) === text
  );
}
function findValueByLabel(root, label) {
  const labelNodes = findElementsByExactText(root, label);
  for (const labelNode of labelNodes) {
    let current = labelNode;
    while (current && current !== root) {
      const parent = current.parentElement;
      if (!parent) break;
      const children = Array.from(parent.children);
      const ownIndex = children.findIndex((child) => child.contains(labelNode));
      if (children.length >= 2 && ownIndex !== -1) {
        const siblingTexts = children.filter((_, index) => index !== ownIndex).map((child) => normalizeText(child.innerText)).map((value) => value.replace(new RegExp(`^${label}:?\\s*`, "i"), "").trim()).filter(Boolean).filter((value) => value !== label);
        if (siblingTexts.length) {
          return siblingTexts[0] ?? null;
        }
      }
      current = parent;
    }
  }
  return null;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function findValueByInlineLabel(root, label) {
  const rawText = root.innerText ?? "";
  const escaped = escapeRegExp(label);
  const match = rawText.match(new RegExp(`${escaped}:\\s*([^\\n\\r]+)`, "i"));
  return cleanTextCandidate(match?.[1] ?? null);
}
function pickProductName(modal) {
  const linkText = cleanTextCandidate(textOf(modal.querySelector('a[href*="/product/"] div, a[href*="/product/"]')));
  if (linkText) return linkText;
  const headingCandidates = Array.from(modal.querySelectorAll("div")).map((element) => normalizeText(element.innerText)).filter(Boolean).filter((value) => value !== "\u041E\u0442\u0437\u044B\u0432 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440").filter((value) => !value.startsWith("\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430:")).filter((value) => !value.startsWith("\u0410\u0440\u0442\u0438\u043A\u0443\u043B:")).filter((value) => !value.startsWith("\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u0442\u043E\u0432\u0430\u0440\u0430:"));
  return headingCandidates[0] ?? null;
}
function countDirectSvgChildren(node) {
  return Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "svg").length;
}
function countStarCluster(root) {
  let best = 0;
  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const node of nodes) {
    const directSvgCount = countDirectSvgChildren(node);
    if (directSvgCount >= 1 && directSvgCount <= 5) {
      best = Math.max(best, directSvgCount);
    }
  }
  return best || null;
}
function pickRating(modal) {
  const ratingLabel = findElementsByExactText(modal, "\u041E\u0446\u0435\u043D\u043A\u0430")[0] ?? null;
  if (ratingLabel) {
    let current = ratingLabel;
    while (current && current !== modal) {
      const parent = current.parentElement;
      if (!parent) break;
      const children = Array.from(parent.children);
      const ownIndex = children.findIndex((child) => child.contains(ratingLabel));
      if (children.length >= 2 && ownIndex !== -1) {
        for (const sibling of children.filter((_, index) => index !== ownIndex)) {
          const cluster = countStarCluster(sibling);
          if (cluster) return cluster;
          const nestedSvgCount = sibling.querySelectorAll("svg").length;
          if (nestedSvgCount >= 1 && nestedSvgCount <= 5) return nestedSvgCount;
          const numeric = normalizeText(sibling.innerText).match(/\b([1-5])\b/);
          if (numeric) return Number(numeric[1]);
        }
      }
      const currentCluster = countStarCluster(current);
      if (currentCluster) return currentCluster;
      current = parent;
    }
  }
  const direct = normalizeText(modal.innerText).match(/\b([1-5])\s*\/\s*5\b/);
  return direct ? Number(direct[1]) : null;
}
function parseVisibleDate(raw) {
  if (!raw) return null;
  const iso = raw.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];
  const ruDots = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (ruDots) {
    const [, dd, mm, yyyy] = ruDots;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const ruWords = raw.match(/\b(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (ruWords) {
    const [, dd, monthRaw, yyyy] = ruWords;
    const monthMap = {
      \u044F\u043D\u0432\u0430\u0440\u044F: "01",
      \u0444\u0435\u0432\u0440\u0430\u043B\u044F: "02",
      \u043C\u0430\u0440\u0442\u0430: "03",
      \u0430\u043F\u0440\u0435\u043B\u044F: "04",
      \u043C\u0430\u044F: "05",
      \u0438\u044E\u043D\u044F: "06",
      \u0438\u044E\u043B\u044F: "07",
      \u0430\u0432\u0433\u0443\u0441\u0442\u0430: "08",
      \u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F: "09",
      \u043E\u043A\u0442\u044F\u0431\u0440\u044F: "10",
      \u043D\u043E\u044F\u0431\u0440\u044F: "11",
      \u0434\u0435\u043A\u0430\u0431\u0440\u044F: "12"
    };
    const month = monthMap[monthRaw.toLowerCase()];
    if (month) {
      return `${yyyy}-${month}-${dd.padStart(2, "0")}`;
    }
  }
  return raw.trim();
}
function slugifyPart(value, fallback) {
  if (!value) return fallback;
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallback;
}
async function sha1Hex(value) {
  const buffer = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function buildReviewExternalId(fields) {
  if (fields.nativeId) {
    return `ozon::native::${fields.nativeId}`;
  }
  const fingerprintBase = [
    fields.productName ?? "",
    fields.authorName ?? "",
    fields.reviewDate ?? "",
    (fields.reviewText ?? "").slice(0, 120)
  ].join("||");
  const hash = (await sha1Hex(fingerprintBase)).slice(0, 12);
  const product = slugifyPart(fields.productName, "unknown-product");
  const author = slugifyPart(fields.authorName, "unknown-author");
  const date = slugifyPart(fields.reviewDate, "unknown-date");
  return `ozon::${product}::${author}::${date}::${hash}`;
}
function extractDomContext(modal) {
  const article = findValueByInlineLabel(modal, "\u0410\u0440\u0442\u0438\u043A\u0443\u043B");
  const orderNumber = findValueByInlineLabel(modal, "\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u043A\u0430\u0437\u0430");
  const productRatingRaw = findValueByInlineLabel(modal, "\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u0442\u043E\u0432\u0430\u0440\u0430");
  const productRating = productRatingRaw?.match(/([0-9]+(?:[.,][0-9]+)?)/)?.[1]?.replace(",", ".") ?? null;
  const productUrl = modal.querySelector('a[href*="/product/"]')?.href ?? null;
  const labels = unique(
    Array.from(modal.querySelectorAll("button, span, a, div")).map((el) => cleanTextCandidate(textOf(el))).filter((value) => Boolean(value)).filter((value) => value.length <= 80).slice(0, 30)
  );
  return {
    article,
    orderNumber,
    productRating,
    productUrl,
    labels
  };
}
function isReviewPage() {
  if (/\/reviews?(?:[/?#]|$)/i.test(location.href)) {
    return true;
  }
  const pageText = (document.body?.innerText ?? "").toLowerCase();
  return pageText.includes("\u043E\u0442\u0437\u044B\u0432\u044B") && pageText.includes("\u043E\u0442\u0437\u044B\u0432 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440");
}
function findReviewCards() {
  const rootsFromInputs = Array.from(document.querySelectorAll(REPLY_INPUT_SELECTORS.join(","))).map((input) => findClosestModalRoot(input)).filter((value) => isElementVisible(value));
  const fallbackRoots = Array.from(document.querySelectorAll("div")).filter((element) => {
    if (!isElementVisible(element)) return false;
    const text = normalizeText(element.innerText);
    return text.includes("\u041E\u0442\u0437\u044B\u0432 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440") && text.includes("\u0422\u0435\u043A\u0441\u0442 \u043E\u0442\u0432\u0435\u0442\u0430") && Boolean(element.querySelector('a[href*="/product/"]')) && Boolean(element.querySelector("[reviewuuid]"));
  });
  return dedupeNested(unique([...rootsFromInputs, ...fallbackRoots]));
}
function getReviewSignature(card) {
  const nativeId = card.querySelector("[reviewuuid]")?.getAttribute("reviewuuid");
  if (nativeId) return `native:${nativeId}`;
  const productName = pickProductName(card) ?? "unknown-product";
  const authorName = cleanTextCandidate(findValueByLabel(card, "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C")) ?? "unknown-author";
  const reviewDate = parseVisibleDate(cleanTextCandidate(findValueByLabel(card, "\u0414\u0430\u0442\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438"))) ?? "unknown-date";
  return `fallback:${productName}::${authorName}::${reviewDate}`;
}
async function extractReview(card) {
  const nativeId = card.querySelector("[reviewuuid]")?.getAttribute("reviewuuid") || null;
  const productName = pickProductName(card);
  const authorName = cleanTextCandidate(findValueByLabel(card, "\u041F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C"));
  const reviewDate = parseVisibleDate(cleanTextCandidate(findValueByLabel(card, "\u0414\u0430\u0442\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438")));
  const reviewText = cleanTextCandidate(findValueByLabel(card, "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439"));
  const rating = pickRating(card);
  const replyInput = findReplyInput(card);
  const existingSellerReply = replyInput instanceof HTMLTextAreaElement || replyInput instanceof HTMLInputElement ? cleanTextCandidate(replyInput.value) : null;
  const reviewExternalId = await buildReviewExternalId({
    nativeId,
    productName,
    authorName,
    reviewDate,
    reviewText
  });
  return {
    reviewExternalId,
    productName,
    rating,
    reviewText,
    reviewDate,
    authorName,
    existingSellerReply,
    pageUrl: window.location.href,
    domContext: extractDomContext(card)
  };
}
function findReplyInput(card) {
  for (const selector of REPLY_INPUT_SELECTORS) {
    const input = card.querySelector(selector);
    if (input) return input;
  }
  return null;
}
function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}
function insertReplyIntoInput(target, value) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    setNativeValue(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "End" }));
    target.focus();
    return;
  }
  if (target.isContentEditable) {
    target.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, value);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  throw new Error("\u041D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0439 \u0442\u0438\u043F \u043F\u043E\u043B\u044F \u043E\u0442\u0432\u0435\u0442\u0430");
}
function findAnswerSection(card) {
  const replyInput = findReplyInput(card);
  if (!replyInput) return null;
  let current = replyInput.parentElement;
  while (current && current !== card) {
    const text = normalizeText(current.innerText);
    if (text.includes("\u0422\u0435\u043A\u0441\u0442 \u043E\u0442\u0432\u0435\u0442\u0430")) {
      return current;
    }
    current = current.parentElement;
  }
  return replyInput.parentElement;
}
function findReplyEditorFrame(card) {
  const replyInput = findReplyInput(card);
  if (!replyInput) return null;
  let current = replyInput.parentElement;
  while (current && current !== card) {
    if (current.hasAttribute("data-replicated-value")) {
      return current;
    }
    const hasDirectInput = Array.from(current.children).some((child) => {
      if (!(child instanceof HTMLElement)) return false;
      return child.tagName.toLowerCase() === "textarea" || child.getAttribute("contenteditable") === "true" || child.getAttribute("role") === "textbox";
    });
    if (hasDirectInput) {
      return current;
    }
    current = current.parentElement;
  }
  return replyInput.parentElement;
}
function findNativeAiContainer(card) {
  const editorFrame = findReplyEditorFrame(card);
  if (!editorFrame) return null;
  const exact = editorFrame.querySelector(":scope > .ct680-c3");
  if (exact) return exact;
  const directChildren = Array.from(editorFrame.children);
  for (const child of directChildren) {
    if (child.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) continue;
    const text = normalizeText(child.innerText);
    const hasGenerate = text.includes("\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C");
    const hasAi = text.includes("AI");
    const hasQuota = text.includes("\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0439") || text.includes("\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E");
    if (hasGenerate || hasAi && hasQuota) {
      return child;
    }
  }
  return null;
}
function hideNativeAiContainer(card) {
  const nativeAi = findNativeAiContainer(card);
  if (!nativeAi) return;
  if (nativeAi.getAttribute(HIDDEN_NATIVE_AI_ATTR) === "true") return;
  nativeAi.style.display = "none";
  nativeAi.style.visibility = "hidden";
  nativeAi.style.pointerEvents = "none";
  nativeAi.style.height = "0";
  nativeAi.style.minHeight = "0";
  nativeAi.style.margin = "0";
  nativeAi.style.padding = "0";
  nativeAi.style.overflow = "hidden";
  nativeAi.setAttribute(HIDDEN_NATIVE_AI_ATTR, "true");
}
function findUiMountTarget(card) {
  const editorFrame = findReplyEditorFrame(card);
  if (editorFrame) {
    return { target: editorFrame, mode: "after-editor" };
  }
  const answerSection = findAnswerSection(card);
  if (answerSection) {
    return { target: answerSection, mode: "append" };
  }
  return { target: card, mode: "append" };
}
function mountUiRoot(card, reviewSignature) {
  const signature = reviewSignature ?? getReviewSignature(card);
  let root = card.querySelector(`.${UI_ROOT_CLASS}`);
  if (root && root.dataset.reviewSignature !== signature) {
    root.remove();
    root = null;
  }
  if (!document.getElementById("ozon-auto-reply-styles")) {
    const style = document.createElement("style");
    style.id = "ozon-auto-reply-styles";
    style.textContent = `
      .${UI_ROOT_CLASS} {
        width: 100%;
        margin-top: 10px;
        font-family: Inter, system-ui, sans-serif;
      }

      .ozon-auto-reply-panel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        padding: 12px 16px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid #e7edf5;
        box-shadow: 0 2px 6px rgba(0,0,0,0.04);
        box-sizing: border-box;
      }

      .ozon-auto-reply-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .ozon-auto-reply-status {
        font-size: 14px;
        color: #6b7a90;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ozon-auto-reply-status:empty {
        display: none;
      }

      .ozon-auto-reply-status.error {
        color: #b91c1c;
      }

      .ozon-auto-reply-status.success {
        color: #047857;
      }

      .ozon-auto-reply-status.warn {
        color: #b45309;
      }

      .ozon-auto-reply-btn {
        height: 44px;
        padding: 0 18px;
        border-radius: 12px;
        border: 0;
        background: #005bff;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        flex: 0 0 auto;
      }

      .ozon-auto-reply-btn:hover {
        background: #0047cc;
      }

      .ozon-auto-reply-btn[disabled] {
        opacity: 0.55;
        cursor: wait;
      }

      .ozon-auto-reply-badge,
      .ozon-auto-reply-meta {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }
  if (!root) {
    root = document.createElement("div");
    root.className = UI_ROOT_CLASS;
    root.innerHTML = `
      <div class="ozon-auto-reply-panel">
        <div class="ozon-auto-reply-left">
          <div class="ozon-auto-reply-badge">ChatGPT</div>
          <div class="ozon-auto-reply-status" data-role="status"></div>
        </div>
        <button type="button" class="ozon-auto-reply-btn" data-role="generate">\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442</button>
      </div>
      <div class="ozon-auto-reply-meta" data-role="meta"></div>
    `;
  }
  root.dataset.reviewSignature = signature;
  hideNativeAiContainer(card);
  const mountTarget = findUiMountTarget(card);
  if (mountTarget.mode === "after-editor") {
    if (root.previousElementSibling !== mountTarget.target) {
      mountTarget.target.insertAdjacentElement("afterend", root);
    }
  } else if (root.parentElement !== mountTarget.target) {
    mountTarget.target.append(root);
  }
  return root;
}

// src/content.ts
var scanDebounceMs = 180;
var scanTimer = null;
var processedCards = /* @__PURE__ */ new WeakMap();
var AUTO_MODE_STORAGE_KEY = "fineroxAutoReplyEnabled";
var AUTO_ROOT_ID = "finerox-auto-runner";
var AUTO_STYLES_ID = "finerox-auto-runner-styles";
var triedTitlesInCycle = /* @__PURE__ */ new Set();
var autoState = {
  enabled: false,
  running: false,
  stopRequested: false,
  batchTarget: randomInt(10, 15),
  processedInBatch: 0,
  totalProcessed: 0,
  refreshedWithoutWork: false,
  statusText: "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D.",
  statusTone: "default"
};
var HIDDEN_NATIVE_AI_ATTR2 = "data-ozon-auto-reply-hidden";
var OZON_UI_ROOT_CLASS = "ozon-auto-reply-root";
var OZON_UI_STYLES_ID = "ozon-auto-reply-styles";
var extensionEnabled = true;
function cleanupInjectedUi() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
    scanTimer = null;
  }
  document.querySelectorAll(`.${OZON_UI_ROOT_CLASS}`).forEach((root) => {
    root.remove();
  });
  document.getElementById(AUTO_ROOT_ID)?.remove();
  document.getElementById(AUTO_STYLES_ID)?.remove();
  document.getElementById(OZON_UI_STYLES_ID)?.remove();
  document.querySelectorAll(`[${HIDDEN_NATIVE_AI_ATTR2}="true"]`).forEach((element) => {
    element.style.display = "";
    element.style.visibility = "";
    element.style.pointerEvents = "";
    element.style.height = "";
    element.style.minHeight = "";
    element.style.margin = "";
    element.style.padding = "";
    element.style.overflow = "";
    element.removeAttribute(HIDDEN_NATIVE_AI_ATTR2);
  });
}
function runExtensionUiBoot() {
  if (!extensionEnabled) return;
  void bindCards();
  window.setTimeout(() => void bindCards(), 300);
  window.setTimeout(() => void bindCards(), 1e3);
  window.setTimeout(() => ensureAutoControls(), 300);
  window.setTimeout(() => ensureAutoControls(), 1e3);
  void initAutoMode();
}
async function applyExtensionEnabledState(enabled) {
  extensionEnabled = enabled;
  if (!enabled) {
    if (autoState.enabled || autoState.running) {
      await stopAutoMode("\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.");
    } else {
      autoState.enabled = false;
      autoState.stopRequested = true;
      autoState.running = false;
      updateAutoControls();
    }
    cleanupInjectedUi();
    return;
  }
  autoState.stopRequested = false;
  runExtensionUiBoot();
}
function getRuntime() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error("\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 OZON \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F.");
  }
  return runtime;
}
async function sendMessage(message) {
  const runtime = getRuntime();
  const response = await runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F");
  }
  return response.data;
}
function normalizeText2(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function truncate(value, max = 60) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}\u2026`;
}
function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
async function sleepRange(minMs, maxMs) {
  await sleep(randomInt(minMs, maxMs));
}
async function waitUntil(check, timeoutMs = 5e3, intervalMs = 120) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return false;
}
function isElementVisible2(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function scheduleScan() {
  if (!extensionEnabled) return;
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void bindCards();
    ensureAutoControls();
  }, scanDebounceMs);
}
function updateStatus(root, text, tone = "default") {
  const status = root.querySelector('[data-role="status"]');
  if (!status) return;
  status.textContent = text;
  status.className = "ozon-auto-reply-status";
  if (tone !== "default") status.classList.add(tone);
}
function updateMeta(root, metaText) {
  const meta = root.querySelector('[data-role="meta"]');
  if (meta) meta.textContent = metaText;
}
function setBusy(root, busy) {
  root.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}
async function reportResult(payload) {
  try {
    await sendMessage({ type: "REPORT_RESULT", payload });
  } catch (error) {
    console.warn("[Finerox Auto Reply] Failed to report result", error);
  }
}
async function generateAndInsertForCard(card, root) {
  let review = null;
  if (!extensionEnabled) {
    throw new Error("\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.");
  }
  try {
    setBusy(root, true);
    root.dataset.processing = "true";
    updateStatus(root, "\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0445...");
    updateMeta(root, "");
    review = await extractReview(card);
    updateStatus(root, "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u043E\u0442\u0432\u0435\u0442\u0430...");
    const settings = await sendMessage({
      type: "GET_SETTINGS"
    });
    const result = await sendMessage({
      type: "GENERATE_REPLY",
      payload: {
        ...review,
        marketplace: "ozon",
        mode: settings.mode
      }
    });
    root.dataset.reviewExternalId = review.reviewExternalId;
    root.dataset.reviewLogId = result.reviewLogId;
    root.dataset.generatedReply = result.generatedReply;
    updateStatus(root, "\u0412\u0441\u0442\u0430\u0432\u043A\u0430 \u043E\u0442\u0432\u0435\u0442\u0430...");
    const input = findReplyInput(card);
    if (!input) {
      throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043F\u043E\u043B\u0435 \u043E\u0442\u0432\u0435\u0442\u0430");
    }
    insertReplyIntoInput(input, result.generatedReply);
    updateStatus(root, "\u041E\u0442\u0432\u0435\u0442 \u0432\u0441\u0442\u0430\u0432\u043B\u0435\u043D", "success");
    updateMeta(root, "");
    await reportResult({
      reviewLogId: result.reviewLogId,
      status: "inserted",
      finalReply: result.generatedReply
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u043E\u0442\u0437\u044B\u0432";
    updateStatus(root, message, "error");
    updateMeta(root, "");
    if (root.dataset.reviewLogId) {
      await reportResult({
        reviewLogId: root.dataset.reviewLogId,
        status: "failed",
        errorText: message
      });
    }
    throw error;
  } finally {
    root.dataset.processing = "false";
    setBusy(root, false);
  }
}
function bindCard(card) {
  if (!extensionEnabled) return;
  const signature = getReviewSignature(card);
  const root = mountUiRoot(card, signature);
  const generateButton = root.querySelector('[data-role="generate"]');
  if (!generateButton) return;
  processedCards.set(card, signature);
  root.dataset.reviewSignature = signature;
  if (root.dataset.handlersBound !== "true") {
    generateButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (root.dataset.processing === "true" || generateButton.dataset.busy === "true") {
        return;
      }
      generateButton.dataset.busy = "true";
      generateButton.disabled = true;
      try {
        await generateAndInsertForCard(card, root);
      } catch (error) {
        console.error("[Finerox Auto Reply] generate click failed", error);
      } finally {
        generateButton.dataset.busy = "false";
        generateButton.disabled = false;
      }
    });
    root.dataset.handlersBound = "true";
  }
}
async function bindCards() {
  if (!extensionEnabled || !isReviewPage()) return;
  const cards = findReviewCards();
  for (const card of cards) {
    const signature = getReviewSignature(card);
    const previousSignature = processedCards.get(card);
    const currentRoot = card.querySelector(".ozon-auto-reply-root");
    const currentRootSignature = currentRoot?.dataset.reviewSignature;
    if (previousSignature === signature && currentRoot && currentRootSignature === signature) {
      continue;
    }
    bindCard(card);
  }
}
function initObserver() {
  const observer = new MutationObserver((mutations) => {
    const shouldScan = mutations.some((mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0);
    if (shouldScan) {
      scheduleScan();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener(
    "click",
    () => {
      window.setTimeout(() => scheduleScan(), 80);
      window.setTimeout(() => scheduleScan(), 260);
      window.setTimeout(() => scheduleScan(), 800);
    },
    true
  );
  document.addEventListener(
    "keyup",
    () => {
      window.setTimeout(() => scheduleScan(), 120);
    },
    true
  );
}
function setAutoStatus(text, tone = "default") {
  autoState.statusText = text;
  autoState.statusTone = tone;
  updateAutoControls();
}
async function getPersistentAutoModeEnabled() {
  const data = await chrome.storage.local.get(AUTO_MODE_STORAGE_KEY);
  return Boolean(data[AUTO_MODE_STORAGE_KEY]);
}
async function setPersistentAutoModeEnabled(value) {
  await chrome.storage.local.set({ [AUTO_MODE_STORAGE_KEY]: value });
}
function ensureAutoStyles() {
  if (document.getElementById(AUTO_STYLES_ID)) return;
  const style = document.createElement("style");
  style.id = AUTO_STYLES_ID;
  style.textContent = `
    #${AUTO_ROOT_ID} {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: 12px;
      flex-wrap: wrap;
    }

    .finerox-auto-btn {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: #005bff;
      color: #fff;
      white-space: nowrap;
    }

    .finerox-auto-btn.stop {
      background: #c62828;
    }

    .finerox-auto-status {
      font-size: 13px;
      line-height: 1.35;
      color: #5b6575;
      max-width: 520px;
    }

    .finerox-auto-status.success {
      color: #047857;
    }

    .finerox-auto-status.error {
      color: #b91c1c;
    }

    .finerox-auto-status.warn {
      color: #b45309;
    }
  `;
  document.head.appendChild(style);
}
function findHeaderMount() {
  const byId = document.getElementById("download-report-ai");
  if (byId) {
    return byId.closest(".cs580-a5") ?? byId.parentElement?.parentElement?.parentElement ?? null;
  }
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => normalizeText2(element.innerText) === "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043E\u0442\u0447\u0451\u0442" || normalizeText2(element.innerText) === "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043E\u0442\u0447\u0435\u0442"
  );
  if (!button) return null;
  return button.closest(".cs580-a5") ?? button.parentElement?.parentElement?.parentElement ?? null;
}
function ensureAutoControls() {
  if (!extensionEnabled || !isReviewPage()) return;
  ensureAutoStyles();
  const mount = findHeaderMount();
  if (!mount) return;
  let root = document.getElementById(AUTO_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = AUTO_ROOT_ID;
    root.innerHTML = `
      <button type="button" class="finerox-auto-btn" data-role="toggle">\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442</button>
      <div class="finerox-auto-status" data-role="status">\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D.</div>
    `;
    const toggleButton = root.querySelector('[data-role="toggle"]');
    toggleButton?.addEventListener("click", () => {
      if (autoState.enabled) {
        void stopAutoMode("\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D \u0432\u0440\u0443\u0447\u043D\u0443\u044E.");
      } else {
        void startAutoMode();
      }
    });
  }
  if (root.parentElement !== mount) {
    mount.append(root);
  }
  updateAutoControls();
}
function updateAutoControls() {
  const root = document.getElementById(AUTO_ROOT_ID);
  if (!root) return;
  const toggleButton = root.querySelector('[data-role="toggle"]');
  const status = root.querySelector('[data-role="status"]');
  if (toggleButton) {
    toggleButton.textContent = autoState.enabled ? "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442" : "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442";
    toggleButton.classList.toggle("stop", autoState.enabled);
  }
  if (status) {
    status.textContent = autoState.statusText;
    status.className = "finerox-auto-status";
    if (autoState.statusTone !== "default") {
      status.classList.add(autoState.statusTone);
    }
  }
}
function findWaitingFilterButton() {
  return document.querySelector('button[data-active="true"] span.s3c80-b5')?.closest("button") ?? Array.from(document.querySelectorAll("button")).find(
    (button) => normalizeText2(button.innerText) === "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"
  ) ?? null;
}
function isWaitingFilterActive(button) {
  return button?.dataset.active === "true";
}
async function clickElement(element) {
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  await sleepRange(180, 420);
  element.click();
}
async function ensureWaitingFilterActive() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"');
  }
  if (isWaitingFilterActive(filterButton)) {
    return;
  }
  setAutoStatus('\u0412\u043A\u043B\u044E\u0447\u0430\u044E \u0444\u0438\u043B\u044C\u0442\u0440 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"...');
  await clickElement(filterButton);
  const activated = await waitUntil(() => {
    const current = findWaitingFilterButton();
    return Boolean(current && isWaitingFilterActive(current));
  }, 7e3, 140);
  if (!activated) {
    throw new Error('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"');
  }
  await sleepRange(700, 1300);
}
async function refreshWaitingFilter() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"');
  }
  setAutoStatus("\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u0441\u043F\u0438\u0441\u043E\u043A \u043E\u0442\u0437\u044B\u0432\u043E\u0432...");
  if (isWaitingFilterActive(filterButton)) {
    await clickElement(filterButton);
    await waitUntil(() => {
      const current = findWaitingFilterButton();
      return Boolean(current && !isWaitingFilterActive(current));
    }, 5e3, 140);
    await sleepRange(700, 1300);
  }
  const nextFilterButton = findWaitingFilterButton();
  if (!nextFilterButton) {
    throw new Error('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043D\u0430\u0439\u0442\u0438 \u043A\u043D\u043E\u043F\u043A\u0443 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"');
  }
  await clickElement(nextFilterButton);
  const activated = await waitUntil(() => {
    const current = findWaitingFilterButton();
    return Boolean(current && isWaitingFilterActive(current));
  }, 7e3, 140);
  if (!activated) {
    throw new Error('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 "\u0416\u0434\u0443\u0442 \u043E\u0442\u0432\u0435\u0442\u0430"');
  }
  triedTitlesInCycle.clear();
  autoState.processedInBatch = 0;
  autoState.batchTarget = randomInt(10, 15);
  autoState.refreshedWithoutWork = false;
  await sleepRange(1200, 2200);
}
function getRowStatus(row) {
  const text = normalizeText2(row.innerText);
  if (text.includes("\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D")) return "\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D";
  if (text.includes("\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D")) return "\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D";
  if (text.includes("\u041D\u043E\u0432\u044B\u0439")) return "\u041D\u043E\u0432\u044B\u0439";
  return null;
}
function findCandidateRowRoot(titleNode) {
  const directRow = titleNode.closest("tr");
  if (directRow) return directRow;
  let current = titleNode.parentElement;
  while (current && current !== document.body) {
    const text = normalizeText2(current.innerText);
    if (text.includes("\u041D\u043E\u0432\u044B\u0439") || text.includes("\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D") || text.includes("\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}
function getVisiblePendingCandidates() {
  const titleNodes = Array.from(document.querySelectorAll("div.n1d-ba8[title]")).filter(isElementVisible2);
  const usedRows = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const titleNode of titleNodes) {
    const row = findCandidateRowRoot(titleNode);
    if (!row || usedRows.has(row)) continue;
    const status = getRowStatus(row);
    if (status !== "\u041D\u043E\u0432\u044B\u0439" && status !== "\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D") continue;
    const title = normalizeText2(titleNode.getAttribute("title") || titleNode.textContent);
    if (!title) continue;
    const clickTarget = titleNode.closest(".n1d-b8a") ?? titleNode;
    if (!isElementVisible2(clickTarget)) continue;
    usedRows.add(row);
    candidates.push({ row, clickTarget, title, status });
  }
  return candidates;
}
function pickNextCandidate() {
  const candidates = getVisiblePendingCandidates().filter((candidate) => !triedTitlesInCycle.has(candidate.title));
  return candidates[0] ?? null;
}
function getOpenReviewModal() {
  const cards = findReviewCards();
  return cards[0] ?? null;
}
function hasModalOpen() {
  return Boolean(getOpenReviewModal());
}
function isModalFullyLoaded(modal) {
  const reviewText = normalizeText2(extractCommentTextFromModal(modal));
  const input = findReplyInput(modal);
  return Boolean(reviewText && input);
}
function extractCommentTextFromModal(modal) {
  const rows = Array.from(modal.querySelectorAll(".n1d-l7"));
  for (const row of rows) {
    const text = normalizeText2(row.innerText);
    if (!text.includes("\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439")) continue;
    const body = row.querySelector(".n1d-m");
    const value = normalizeText2(body?.innerText ?? "");
    const cleaned = value.replace(/^Комментарий\s*/i, "").trim();
    if (cleaned) return cleaned;
  }
  const raw = normalizeText2(modal.innerText);
  const match = raw.match(/Комментарий\s+(.+?)\s+Оценки/si);
  return normalizeText2(match?.[1] ?? null) || null;
}
async function openCandidate(candidate) {
  if (hasModalOpen()) {
    throw new Error("\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u043E");
  }
  setAutoStatus(`\u041E\u0442\u043A\u0440\u044B\u0432\u0430\u044E \u043E\u0442\u0437\u044B\u0432: ${truncate(candidate.title, 56)}...`);
  triedTitlesInCycle.add(candidate.title);
  await clickElement(candidate.clickTarget);
  const opened = await waitUntil(() => Boolean(getOpenReviewModal()), 7e3, 120);
  if (!opened) {
    throw new Error("\u041D\u0435 \u043E\u0442\u043A\u0440\u044B\u043B\u043E\u0441\u044C \u043E\u043A\u043D\u043E \u043E\u0442\u0437\u044B\u0432\u0430");
  }
  await sleepRange(2e3, 3e3);
  const modal = getOpenReviewModal();
  if (!modal) {
    throw new Error("\u041C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F");
  }
  const ready = await waitUntil(() => {
    const currentModal = getOpenReviewModal();
    if (!currentModal) return false;
    return isModalFullyLoaded(currentModal);
  }, 5e3, 150);
  if (!ready) {
    throw new Error("\u041C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u043E\u0442\u043A\u0440\u044B\u043B\u043E\u0441\u044C \u043D\u0435 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E");
  }
  const readyModal = getOpenReviewModal();
  if (!readyModal) {
    throw new Error("\u041C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u043F\u0440\u043E\u043F\u0430\u043B\u043E \u043F\u043E\u0441\u043B\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438");
  }
  return readyModal;
}
function findSendReplyButton(modal) {
  const textarea = modal.querySelector("#AnswerCommentForm");
  const allButtons = Array.from(modal.querySelectorAll('button[type="submit"]')).filter(isElementVisible2);
  const disallowedTexts = ["\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "\u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C \u043D\u0430 \u043E\u0442\u0437\u044B\u0432", "\u041D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 \u0447\u0430\u0442", "\u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C", "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C"];
  const candidates = allButtons.filter((button) => {
    const text = normalizeText2(button.innerText);
    return !disallowedTexts.some((part) => text.includes(part));
  });
  if (!textarea) {
    return candidates[0] ?? null;
  }
  const textareaRect = textarea.getBoundingClientRect();
  const nearest = candidates.map((button) => ({ button, rect: button.getBoundingClientRect() })).filter(({ rect }) => rect.top >= textareaRect.top - 20 && rect.top <= textareaRect.bottom + 220).sort((a, b) => {
    const scoreA = Math.abs(a.rect.top - textareaRect.bottom) + Math.abs(a.rect.left - textareaRect.right);
    const scoreB = Math.abs(b.rect.top - textareaRect.bottom) + Math.abs(b.rect.left - textareaRect.right);
    return scoreA - scoreB;
  });
  return nearest[0]?.button ?? candidates[candidates.length - 1] ?? null;
}
function findPostedSellerReplyBlock(modal) {
  const blocks = Array.from(modal.querySelectorAll("div.n1d-p4")).filter(isElementVisible2);
  for (const block of blocks) {
    const text = normalizeText2(block.innerText);
    const hasDelete = text.includes("\u0423\u0434\u0430\u043B\u0438\u0442\u044C");
    const hasEdit = text.includes("\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C");
    const hasSellerReply = text.includes("\u041E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043B\u044C \u043F\u0440\u043E\u0434\u0430\u0432\u0446\u0430") || /ответ\s+/i.test(text) || text.includes("\u041D\u0430 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u0438");
    if ((hasDelete || hasEdit) && hasSellerReply) {
      return block;
    }
  }
  return null;
}
function hasPostedSellerReply(modal, expectedReply) {
  const block = findPostedSellerReplyBlock(modal);
  if (!block) return false;
  if (!expectedReply) return true;
  const blockText = normalizeText2(block.innerText);
  const expectedSample = normalizeText2(expectedReply).slice(0, 80);
  return !expectedSample || blockText.includes(expectedSample);
}
function findCloseModalButton(modal) {
  const exact = modal.parentElement?.querySelector("button.t7c80-a1.sc180-b5");
  if (exact && isElementVisible2(exact)) {
    return exact;
  }
  const allButtons = Array.from(
    (modal.parentElement ?? document).querySelectorAll('button[type="button"]')
  ).filter(isElementVisible2);
  return allButtons.find((button) => {
    const text = normalizeText2(button.innerText);
    if (text) return false;
    return button.querySelector("svg") !== null;
  }) ?? null;
}
function fireRealClick(target) {
  const common = { bubbles: true, cancelable: true, composed: true, view: window };
  try {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...common,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1
      })
    );
  } catch {
  }
  target.dispatchEvent(
    new MouseEvent("mousedown", {
      ...common,
      button: 0,
      buttons: 1
    })
  );
  try {
    target.dispatchEvent(
      new PointerEvent("pointerup", {
        ...common,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 0
      })
    );
  } catch {
  }
  target.dispatchEvent(
    new MouseEvent("mouseup", {
      ...common,
      button: 0,
      buttons: 0
    })
  );
  target.dispatchEvent(
    new MouseEvent("click", {
      ...common,
      button: 0,
      buttons: 0
    })
  );
  if (target instanceof HTMLElement) {
    target.click();
  }
}
function findModalBackdrop(modal) {
  const root = modal.parentElement ?? modal;
  const rightBackdrop = root.querySelector(".tc280-a1.tc280-a3") ?? root.querySelector(".tc280-a1.tc280-a2");
  if (rightBackdrop && isElementVisible2(rightBackdrop)) {
    return rightBackdrop;
  }
  return null;
}
async function closeOpenModalStrictly() {
  const modal = getOpenReviewModal();
  if (!modal) return;
  const closeButton = findCloseModalButton(modal);
  if (!closeButton) {
    throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043E\u043A\u043D\u0430");
  }
  setAutoStatus("\u0417\u0430\u043A\u0440\u044B\u0432\u0430\u044E \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E...");
  fireRealClick(closeButton);
  let closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
  if (closed) {
    await sleep(1e3);
    return;
  }
  const closeSvg = closeButton.querySelector("svg");
  if (closeSvg) {
    fireRealClick(closeSvg);
    closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
    if (closed) {
      await sleep(1e3);
      return;
    }
  }
  const currentModal = getOpenReviewModal();
  if (currentModal) {
    const backdrop = findModalBackdrop(currentModal);
    if (backdrop) {
      fireRealClick(backdrop);
      closed = await waitUntil(() => !getOpenReviewModal(), 2500, 150);
      if (closed) {
        await sleep(1e3);
        return;
      }
    }
  }
  throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u043D\u0438 \u043F\u043E \u043A\u0440\u0435\u0441\u0442\u0438\u043A\u0443, \u043D\u0438 \u043F\u043E \u0444\u043E\u043D\u0443");
}
async function recoverByReload(reason) {
  setAutoStatus(`${reason}. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443...`, "warn");
  await setPersistentAutoModeEnabled(true);
  await sleepRange(900, 1600);
  window.location.reload();
  throw new Error(reason);
}
async function processCandidate(candidate) {
  const modal = await openCandidate(candidate);
  const review = await extractReview(modal);
  const input = findReplyInput(modal);
  if (!normalizeText2(review.reviewText) || !input) {
    await recoverByReload("\u041E\u0442\u0437\u044B\u0432 \u043E\u0442\u043A\u0440\u044B\u043B\u0441\u044F \u043D\u0435 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E");
  }
  const root = mountUiRoot(modal, getReviewSignature(modal));
  await generateAndInsertForCard(modal, root);
  const actualInput = findReplyInput(modal);
  const insertedText = actualInput instanceof HTMLTextAreaElement || actualInput instanceof HTMLInputElement ? normalizeText2(actualInput.value) : normalizeText2(root.dataset.generatedReply);
  if (!insertedText) {
    throw new Error("\u041E\u0442\u0432\u0435\u0442 \u043D\u0435 \u0432\u0441\u0442\u0430\u0432\u0438\u043B\u0441\u044F \u0432 \u043F\u043E\u043B\u0435");
  }
  await sleepRange(400, 900);
  const sendButton = findSendReplyButton(modal);
  if (!sendButton) {
    throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u043E\u0442\u0432\u0435\u0442\u0430");
  }
  setAutoStatus(`\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E \u043E\u0442\u0432\u0435\u0442: ${truncate(candidate.title, 50)}...`);
  await clickElement(sendButton);
  await sleepRange(2e3, 3e3);
  const replyAppeared = await waitUntil(() => {
    const currentModal = getOpenReviewModal();
    if (!currentModal) return false;
    return hasPostedSellerReply(currentModal, insertedText);
  }, 2e4, 2e3);
  if (!replyAppeared) {
    throw new Error("\u041F\u043E\u0441\u043B\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0432 \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u043C \u043E\u043A\u043D\u0435 \u043D\u0435 \u043F\u043E\u044F\u0432\u0438\u043B\u0441\u044F \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442");
  }
  setAutoStatus(`\u041E\u0442\u0432\u0435\u0442 \u043F\u043E\u044F\u0432\u0438\u043B\u0441\u044F: ${truncate(candidate.title, 50)}. \u0417\u0430\u043A\u0440\u044B\u0432\u0430\u044E \u043E\u043A\u043D\u043E...`, "success");
  await sleep(1e3);
  await closeOpenModalStrictly();
  return true;
}
async function startAutoMode() {
  if (!extensionEnabled) {
    setAutoStatus("\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.", "warn");
    return;
  }
  if (autoState.running) return;
  autoState.enabled = true;
  autoState.stopRequested = false;
  autoState.batchTarget = randomInt(10, 15);
  autoState.processedInBatch = 0;
  autoState.refreshedWithoutWork = false;
  triedTitlesInCycle.clear();
  await setPersistentAutoModeEnabled(true);
  setAutoStatus("\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u0437\u0430\u043F\u0443\u0449\u0435\u043D.");
  updateAutoControls();
  void runAutoModeLoop();
}
async function stopAutoMode(reason = "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.") {
  autoState.enabled = false;
  autoState.stopRequested = true;
  await setPersistentAutoModeEnabled(false);
  setAutoStatus(reason);
  updateAutoControls();
}
async function runAutoModeLoop() {
  if (autoState.running) return;
  autoState.running = true;
  updateAutoControls();
  try {
    await ensureWaitingFilterActive();
    while (extensionEnabled && autoState.enabled && !autoState.stopRequested) {
      ensureAutoControls();
      if (hasModalOpen()) {
        setAutoStatus("\u0416\u0434\u0443 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043E\u043A\u043D\u0430...");
        const closed = await waitUntil(() => !hasModalOpen(), 8e3, 150);
        if (!closed) {
          throw new Error("\u041C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u0435 \u043E\u043A\u043D\u043E \u043D\u0435 \u0437\u0430\u043A\u0440\u044B\u043B\u043E\u0441\u044C \u0432\u043E\u0432\u0440\u0435\u043C\u044F");
        }
        await sleep(1e3);
      }
      if (autoState.processedInBatch >= autoState.batchTarget) {
        await refreshWaitingFilter();
      }
      const candidate = pickNextCandidate();
      if (!candidate) {
        if (autoState.refreshedWithoutWork) {
          await stopAutoMode("\u041F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043E\u0442\u0437\u044B\u0432\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B.");
          break;
        }
        autoState.refreshedWithoutWork = true;
        await refreshWaitingFilter();
        continue;
      }
      autoState.refreshedWithoutWork = false;
      try {
        const success = await processCandidate(candidate);
        if (success) {
          autoState.totalProcessed += 1;
          autoState.processedInBatch += 1;
          setAutoStatus(
            `\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E ${autoState.totalProcessed}. \u0412 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0446\u0438\u043A\u043B\u0435 ${autoState.processedInBatch}/${autoState.batchTarget}.`,
            "success"
          );
          await sleep(1e3);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442\u0430";
        setAutoStatus(message, "error");
        if (hasModalOpen()) {
          try {
            await closeOpenModalStrictly();
          } catch (closeError) {
            console.warn("[Finerox Auto Reply] failed to close modal after error", closeError);
          }
        }
        await sleepRange(1200, 2200);
      }
    }
  } finally {
    autoState.running = false;
    updateAutoControls();
  }
}
async function initAutoMode() {
  if (!extensionEnabled || !isReviewPage()) return;
  ensureAutoControls();
  const enabled = await getPersistentAutoModeEnabled();
  if (!enabled) return;
  autoState.enabled = true;
  autoState.stopRequested = false;
  setAutoStatus("\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438...");
  updateAutoControls();
  window.setTimeout(() => {
    void runAutoModeLoop();
  }, 1400);
}
async function init() {
  initObserver();
  try {
    const settings = await sendMessage({ type: "GET_SETTINGS" });
    await applyExtensionEnabledState(settings.enabled ?? true);
  } catch (error) {
    console.warn("[Finerox Auto Reply] failed to load extension state", error);
    extensionEnabled = true;
    runExtensionUiBoot();
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, "enabled")) {
      return;
    }
    const nextValue = changes.enabled?.newValue;
    void applyExtensionEnabledState(typeof nextValue === "boolean" ? nextValue : true);
  });
}
void init();
//# sourceMappingURL=content.js.map
