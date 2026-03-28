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
  const text = normalizeText(modal.innerText);
  const article = text.match(/Артикул:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const orderNumber = text.match(/Номер заказа:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const productRating = text.match(/Рейтинг товара:\s*([0-9]+(?:[.,][0-9]+)?)/i)?.[1]?.replace(",", ".") ?? null;
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
async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F");
  }
  return response.data;
}
function scheduleScan() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void bindCards();
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
    console.warn("[OZON Auto Reply] Failed to report result", error);
  }
}
async function generateAndInsertForCard(card, root) {
  let review = null;
  try {
    setBusy(root, true);
    root.dataset.processing = "true";
    updateStatus(root, "\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0445...");
    updateMeta(root, "");
    review = await extractReview(card);
    updateStatus(root, "\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u043E\u0442\u0432\u0435\u0442\u0430...");
    const settings = await sendMessage({ type: "GET_SETTINGS" });
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
  } finally {
    root.dataset.processing = "false";
    setBusy(root, false);
  }
}
function bindCard(card) {
  const signature = getReviewSignature(card);
  const root = mountUiRoot(card, signature);
  const generateButton = root.querySelector('[data-role="generate"]');
  if (!generateButton) return;
  processedCards.set(card, signature);
  root.dataset.reviewSignature = signature;
  generateButton.onclick = async (event) => {
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
      console.error("[OZON Auto Reply] generate click failed", error);
    } finally {
      generateButton.dataset.busy = "false";
      generateButton.disabled = false;
    }
  };
}
async function bindCards() {
  if (!isReviewPage()) return;
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
void bindCards();
window.setTimeout(() => void bindCards(), 300);
window.setTimeout(() => void bindCards(), 1e3);
initObserver();
//# sourceMappingURL=content.js.map
