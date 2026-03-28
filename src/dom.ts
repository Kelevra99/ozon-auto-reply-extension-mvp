import type { ExtractedReview } from './types';

const REPLY_INPUT_SELECTORS = [
  'textarea#AnswerCommentForm',
  'textarea[id*="AnswerComment"]',
  'textarea',
  '[contenteditable="true"]',
  'div[role="textbox"]',
  'input[type="text"]'
];

const UI_ROOT_CLASS = 'ozon-auto-reply-root';
const HIDDEN_NATIVE_AI_ATTR = 'data-ozon-auto-reply-hidden';

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function textOf(node: Element | null | undefined): string | null {
  const value = node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return value || null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanTextCandidate(value: string | null): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function dedupeNested(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element, index, array) => {
    return !array.some((other, otherIndex) => otherIndex !== index && other.contains(element));
  });
}

function isElementVisible(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findClosestModalRoot(start: Element | null): HTMLElement | null {
  let current = start instanceof HTMLElement ? start : start?.parentElement ?? null;

  while (current && current !== document.body) {
    const text = normalizeText(current.innerText);
    const hasHeader = text.includes('Отзыв на товар');
    const hasReplyField = Boolean(current.querySelector('textarea#AnswerCommentForm, textarea[id*="AnswerComment"]'));
    const hasProduct = Boolean(current.querySelector('a[href*="/product/"]'));
    const hasReviewBlock = Boolean(current.querySelector('[reviewuuid]'));

    if (hasHeader && hasReplyField && hasProduct && hasReviewBlock) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function findElementsByExactText(root: ParentNode, text: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div, span, label, button, a')).filter(
    (element) => normalizeText(element.textContent) === text
  );
}

function findValueByLabel(root: HTMLElement, label: string): string | null {
  const labelNodes = findElementsByExactText(root, label);

  for (const labelNode of labelNodes) {
    let current: HTMLElement | null = labelNode;

    while (current && current !== root) {
      const parent = current.parentElement;
      if (!parent) break;

      const children = Array.from(parent.children) as HTMLElement[];
      const ownIndex = children.findIndex((child) => child.contains(labelNode));

      if (children.length >= 2 && ownIndex !== -1) {
        const siblingTexts = children
          .filter((_, index) => index !== ownIndex)
          .map((child) => normalizeText(child.innerText))
          .map((value) => value.replace(new RegExp(`^${label}:?\\s*`, 'i'), '').trim())
          .filter(Boolean)
          .filter((value) => value !== label);

        if (siblingTexts.length) {
          return siblingTexts[0] ?? null;
        }
      }

      current = parent;
    }
  }

  return null;
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findValueByInlineLabel(root: HTMLElement, label: string): string | null {
  const rawText = root.innerText ?? '';
  const escaped = escapeRegExp(label);
  const match = rawText.match(new RegExp(`${escaped}:\\s*([^\\n\\r]+)`, 'i'));
  return cleanTextCandidate(match?.[1] ?? null);
}

function pickProductName(modal: HTMLElement): string | null {
  const linkText = cleanTextCandidate(textOf(modal.querySelector('a[href*="/product/"] div, a[href*="/product/"]')));
  if (linkText) return linkText;

  const headingCandidates = Array.from(modal.querySelectorAll<HTMLElement>('div'))
    .map((element) => normalizeText(element.innerText))
    .filter(Boolean)
    .filter((value) => value !== 'Отзыв на товар')
    .filter((value) => !value.startsWith('Номер заказа:'))
    .filter((value) => !value.startsWith('Артикул:'))
    .filter((value) => !value.startsWith('Рейтинг товара:'));

  return headingCandidates[0] ?? null;
}

function countDirectSvgChildren(node: HTMLElement): number {
  return Array.from(node.children).filter((child) => child.tagName.toLowerCase() === 'svg').length;
}

function countStarCluster(root: HTMLElement): number | null {
  let best = 0;
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];

  for (const node of nodes) {
    const directSvgCount = countDirectSvgChildren(node);
    if (directSvgCount >= 1 && directSvgCount <= 5) {
      best = Math.max(best, directSvgCount);
    }
  }

  return best || null;
}

function pickRating(modal: HTMLElement): number | null {
  const ratingLabel = findElementsByExactText(modal, 'Оценка')[0] ?? null;
  if (ratingLabel) {
    let current: HTMLElement | null = ratingLabel;

    while (current && current !== modal) {
      const parent = current.parentElement;
      if (!parent) break;

      const children = Array.from(parent.children) as HTMLElement[];
      const ownIndex = children.findIndex((child) => child.contains(ratingLabel));

      if (children.length >= 2 && ownIndex !== -1) {
        for (const sibling of children.filter((_, index) => index !== ownIndex)) {
          const cluster = countStarCluster(sibling);
          if (cluster) return cluster;

          const nestedSvgCount = sibling.querySelectorAll('svg').length;
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

function parseVisibleDate(raw: string | null): string | null {
  if (!raw) return null;

  const iso = raw.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];

  const ruDots = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (ruDots) {
    const [, dd, mm, yyyy] = ruDots;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const ruWords = raw.match(/\b(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (ruWords) {
    const [, dd, monthRaw, yyyy] = ruWords;
    const monthMap: Record<string, string> = {
      января: '01',
      февраля: '02',
      марта: '03',
      апреля: '04',
      мая: '05',
      июня: '06',
      июля: '07',
      августа: '08',
      сентября: '09',
      октября: '10',
      ноября: '11',
      декабря: '12'
    };
    const month = monthMap[monthRaw.toLowerCase()];
    if (month) {
      return `${yyyy}-${month}-${dd.padStart(2, '0')}`;
    }
  }

  return raw.trim();
}

function slugifyPart(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;
}

async function sha1Hex(value: string): Promise<string> {
  const buffer = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildReviewExternalId(fields: {
  productName: string | null;
  authorName: string | null;
  reviewDate: string | null;
  reviewText: string | null;
  nativeId?: string | null;
}): Promise<string> {
  if (fields.nativeId) {
    return `ozon::native::${fields.nativeId}`;
  }

  const fingerprintBase = [
    fields.productName ?? '',
    fields.authorName ?? '',
    fields.reviewDate ?? '',
    (fields.reviewText ?? '').slice(0, 120)
  ].join('||');

  const hash = (await sha1Hex(fingerprintBase)).slice(0, 12);
  const product = slugifyPart(fields.productName, 'unknown-product');
  const author = slugifyPart(fields.authorName, 'unknown-author');
  const date = slugifyPart(fields.reviewDate, 'unknown-date');
  return `ozon::${product}::${author}::${date}::${hash}`;
}

function extractDomContext(modal: HTMLElement): Record<string, unknown> {
  const article = findValueByInlineLabel(modal, 'Артикул');
  const orderNumber = findValueByInlineLabel(modal, 'Номер заказа');
  const productRatingRaw = findValueByInlineLabel(modal, 'Рейтинг товара');
  const productRating = productRatingRaw?.match(/([0-9]+(?:[.,][0-9]+)?)/)?.[1]?.replace(',', '.') ?? null;
  const productUrl = modal.querySelector<HTMLAnchorElement>('a[href*="/product/"]')?.href ?? null;

  const labels = unique(
    Array.from(modal.querySelectorAll('button, span, a, div'))
      .map((el) => cleanTextCandidate(textOf(el)))
      .filter((value): value is string => Boolean(value))
      .filter((value) => value.length <= 80)
      .slice(0, 30)
  );

  return {
    article,
    orderNumber,
    productRating,
    productUrl,
    labels
  };
}

export function isReviewPage(): boolean {
  if (/\/reviews?(?:[/?#]|$)/i.test(location.href)) {
    return true;
  }

  const pageText = (document.body?.innerText ?? '').toLowerCase();
  return pageText.includes('отзывы') && pageText.includes('отзыв на товар');
}

export function findReviewCards(): HTMLElement[] {
  const rootsFromInputs = Array.from(document.querySelectorAll(REPLY_INPUT_SELECTORS.join(',')))
    .map((input) => findClosestModalRoot(input))
    .filter((value): value is HTMLElement => isElementVisible(value));

  const fallbackRoots = Array.from(document.querySelectorAll<HTMLElement>('div')).filter((element) => {
    if (!isElementVisible(element)) return false;
    const text = normalizeText(element.innerText);
    return (
      text.includes('Отзыв на товар') &&
      text.includes('Текст ответа') &&
      Boolean(element.querySelector('a[href*="/product/"]')) &&
      Boolean(element.querySelector('[reviewuuid]'))
    );
  });

  return dedupeNested(unique([...rootsFromInputs, ...fallbackRoots]));
}

export function getReviewSignature(card: HTMLElement): string {
  const nativeId = card.querySelector('[reviewuuid]')?.getAttribute('reviewuuid');
  if (nativeId) return `native:${nativeId}`;

  const productName = pickProductName(card) ?? 'unknown-product';
  const authorName = cleanTextCandidate(findValueByLabel(card, 'Покупатель')) ?? 'unknown-author';
  const reviewDate = parseVisibleDate(cleanTextCandidate(findValueByLabel(card, 'Дата публикации'))) ?? 'unknown-date';
  return `fallback:${productName}::${authorName}::${reviewDate}`;
}

export async function extractReview(card: HTMLElement): Promise<ExtractedReview> {
  const nativeId = card.querySelector('[reviewuuid]')?.getAttribute('reviewuuid') || null;

  const productName = pickProductName(card);
  const authorName = cleanTextCandidate(findValueByLabel(card, 'Покупатель'));
  const reviewDate = parseVisibleDate(cleanTextCandidate(findValueByLabel(card, 'Дата публикации')));
  const reviewText = cleanTextCandidate(findValueByLabel(card, 'Комментарий'));
  const rating = pickRating(card);
  const replyInput = findReplyInput(card);
  const existingSellerReply =
    replyInput instanceof HTMLTextAreaElement || replyInput instanceof HTMLInputElement
      ? cleanTextCandidate(replyInput.value)
      : null;

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

export function findReplyInput(card: HTMLElement): HTMLElement | null {
  for (const selector of REPLY_INPUT_SELECTORS) {
    const input = card.querySelector<HTMLElement>(selector);
    if (input) return input;
  }

  return null;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
}

export function insertReplyIntoInput(target: HTMLElement, value: string): void {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    setNativeValue(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
    target.focus();
    return;
  }

  if (target.isContentEditable) {
    target.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  throw new Error('Неподдерживаемый тип поля ответа');
}

function findAnswerSection(card: HTMLElement): HTMLElement | null {
  const replyInput = findReplyInput(card);
  if (!replyInput) return null;

  let current = replyInput.parentElement as HTMLElement | null;
  while (current && current !== card) {
    const text = normalizeText(current.innerText);
    if (text.includes('Текст ответа')) {
      return current;
    }
    current = current.parentElement;
  }

  return replyInput.parentElement;
}

function findReplyEditorFrame(card: HTMLElement): HTMLElement | null {
  const replyInput = findReplyInput(card);
  if (!replyInput) return null;

  let current = replyInput.parentElement as HTMLElement | null;
  while (current && current !== card) {
    if (current.hasAttribute('data-replicated-value')) {
      return current;
    }

    const hasDirectInput = Array.from(current.children).some((child) => {
      if (!(child instanceof HTMLElement)) return false;
      return (
        child.tagName.toLowerCase() === 'textarea' ||
        child.getAttribute('contenteditable') === 'true' ||
        child.getAttribute('role') === 'textbox'
      );
    });

    if (hasDirectInput) {
      return current;
    }

    current = current.parentElement;
  }

  return replyInput.parentElement;
}

function findNativeAiContainer(card: HTMLElement): HTMLElement | null {
  const editorFrame = findReplyEditorFrame(card);
  if (!editorFrame) return null;

  const exact = editorFrame.querySelector<HTMLElement>(':scope > .ct680-c3');
  if (exact) return exact;

  const directChildren = Array.from(editorFrame.children) as HTMLElement[];
  for (const child of directChildren) {
    if (child.querySelector('textarea, [contenteditable="true"], [role="textbox"]')) continue;

    const text = normalizeText(child.innerText);
    const hasGenerate = text.includes('Сгенерировать');
    const hasAi = text.includes('AI');
    const hasQuota = text.includes('генераций') || text.includes('Доступно');

    if (hasGenerate || (hasAi && hasQuota)) {
      return child;
    }
  }

  return null;
}

function hideNativeAiContainer(card: HTMLElement): void {
  const nativeAi = findNativeAiContainer(card);
  if (!nativeAi) return;
  if (nativeAi.getAttribute(HIDDEN_NATIVE_AI_ATTR) === 'true') return;

  nativeAi.style.display = 'none';
  nativeAi.style.visibility = 'hidden';
  nativeAi.style.pointerEvents = 'none';
  nativeAi.style.height = '0';
  nativeAi.style.minHeight = '0';
  nativeAi.style.margin = '0';
  nativeAi.style.padding = '0';
  nativeAi.style.overflow = 'hidden';
  nativeAi.setAttribute(HIDDEN_NATIVE_AI_ATTR, 'true');
}

function findUiMountTarget(card: HTMLElement): { target: HTMLElement; mode: 'after-editor' | 'append' } {
  const editorFrame = findReplyEditorFrame(card);
  if (editorFrame) {
    return { target: editorFrame, mode: 'after-editor' };
  }

  const answerSection = findAnswerSection(card);
  if (answerSection) {
    return { target: answerSection, mode: 'append' };
  }

  return { target: card, mode: 'append' };
}

export function mountUiRoot(card: HTMLElement, reviewSignature?: string): HTMLDivElement {
  const signature = reviewSignature ?? getReviewSignature(card);
  let root = card.querySelector<HTMLDivElement>(`.${UI_ROOT_CLASS}`);

  if (root && root.dataset.reviewSignature !== signature) {
    root.remove();
    root = null;
  }

  if (!document.getElementById('ozon-auto-reply-styles')) {
    const style = document.createElement('style');
    style.id = 'ozon-auto-reply-styles';
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
    root = document.createElement('div');
    root.className = UI_ROOT_CLASS;
    root.innerHTML = `
      <div class="ozon-auto-reply-panel">
        <div class="ozon-auto-reply-left">
          <div class="ozon-auto-reply-badge">ChatGPT</div>
          <div class="ozon-auto-reply-status" data-role="status"></div>
        </div>
        <button type="button" class="ozon-auto-reply-btn" data-role="generate">Сгенерировать ответ</button>
      </div>
      <div class="ozon-auto-reply-meta" data-role="meta"></div>
    `;
  }

  root.dataset.reviewSignature = signature;

  hideNativeAiContainer(card);

  const mountTarget = findUiMountTarget(card);

  if (mountTarget.mode === 'after-editor') {
    if (root.previousElementSibling !== mountTarget.target) {
      mountTarget.target.insertAdjacentElement('afterend', root);
    }
  } else if (root.parentElement !== mountTarget.target) {
    mountTarget.target.append(root);
  }

  return root;
}

export function resetUi(root: HTMLElement): void {
  const meta = root.querySelector<HTMLElement>('[data-role="meta"]');
  const status = root.querySelector<HTMLElement>('[data-role="status"]');

  if (meta) meta.textContent = '';
  if (status) {
    status.textContent = '';
    status.className = 'ozon-auto-reply-status';
  }
}
