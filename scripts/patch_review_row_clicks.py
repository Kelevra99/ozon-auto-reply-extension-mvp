from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

pattern = r"""function looksLikeRatingText\(text: string\): boolean \{[\s\S]*?function getOpenReviewModal\(\): HTMLElement \| null \{"""

replacement = """function isStatusChipText(text: string): boolean {
  return text === 'Новый' || text === 'Просмотрен' || text === 'Обработан';
}

function looksLikeRatingText(text: string): boolean {
  return /\\b[1-5]\\b/.test(text) || /★|звезд|оценк/i.test(text);
}

function getElementText(element: HTMLElement): string {
  return normalizeText(element.innerText || element.textContent || element.getAttribute('title'));
}

function getCenterX(rect: DOMRect): number {
  return rect.left + rect.width / 2;
}

function hasVerticalOverlap(rect: DOMRect, statusRect: DOMRect): boolean {
  return rect.bottom >= statusRect.top - 24 && rect.top <= statusRect.bottom + 24;
}

function isForbiddenProductLinkTarget(element: HTMLElement): boolean {
  return Boolean(element.closest('a[href]'));
}

function isReasonableTextTarget(text: string): boolean {
  return text.length >= 10 && text.length <= 320;
}

function collectReviewTextTargets(row: HTMLElement, statusNode: HTMLElement): HTMLElement[] {
  const statusRect = statusNode.getBoundingClientRect();
  const minX = statusRect.left - 360;
  const maxX = statusRect.left - 12;

  return uniqueElements(
    Array.from(row.querySelectorAll<HTMLElement>('div, span, p, td'))
      .filter(isElementVisible)
      .filter((element) => !isForbiddenProductLinkTarget(element))
      .filter((element) => {
        const text = getElementText(element);
        if (!text || isStatusChipText(text)) return false;
        if (!isReasonableTextTarget(text)) return false;

        const rect = element.getBoundingClientRect();
        if (!hasVerticalOverlap(rect, statusRect)) return false;

        const centerX = getCenterX(rect);
        return centerX >= minX && centerX <= maxX;
      })
      .sort((a, b) => getElementText(b).length - getElementText(a).length)
  ).slice(0, 6);
}

function collectRatingTargets(row: HTMLElement, statusNode: HTMLElement): HTMLElement[] {
  const statusRect = statusNode.getBoundingClientRect();
  const minX = statusRect.right + 12;
  const maxX = statusRect.right + 180;

  return uniqueElements(
    Array.from(row.querySelectorAll<HTMLElement>('div, span, p, td'))
      .filter(isElementVisible)
      .filter((element) => !isForbiddenProductLinkTarget(element))
      .filter((element) => {
        const text = getElementText(element);
        if (!text || isStatusChipText(text)) return false;
        if (!looksLikeRatingText(text)) return false;

        const rect = element.getBoundingClientRect();
        if (!hasVerticalOverlap(rect, statusRect)) return false;

        const centerX = getCenterX(rect);
        return centerX >= minX && centerX <= maxX;
      })
  ).slice(0, 4);
}

function collectCenteredFallbackTargets(row: HTMLElement, statusNode: HTMLElement): HTMLElement[] {
  const statusRect = statusNode.getBoundingClientRect();
  const minX = statusRect.left - 360;
  const maxX = statusRect.right + 180;

  return uniqueElements(
    Array.from(row.querySelectorAll<HTMLElement>('div, span, p, td'))
      .filter(isElementVisible)
      .filter((element) => !isForbiddenProductLinkTarget(element))
      .filter((element) => {
        const text = getElementText(element);
        if (!text || isStatusChipText(text)) return false;
        if (!isReasonableTextTarget(text)) return false;

        const rect = element.getBoundingClientRect();
        if (!hasVerticalOverlap(rect, statusRect)) return false;

        const centerX = getCenterX(rect);
        return centerX >= minX && centerX <= maxX;
      })
      .sort((a, b) => {
        const aDist = Math.abs(getCenterX(a.getBoundingClientRect()) - statusRect.left);
        const bDist = Math.abs(getCenterX(b.getBoundingClientRect()) - statusRect.left);
        return aDist - bDist;
      })
  ).slice(0, 4);
}

function collectCandidateClickTargets(row: HTMLElement, statusNode: HTMLElement): HTMLElement[] {
  const reviewTargets = collectReviewTextTargets(row, statusNode);
  const ratingTargets = collectRatingTargets(row, statusNode);

  if (reviewTargets.length || ratingTargets.length) {
    return uniqueElements([...reviewTargets, ...ratingTargets]).slice(0, 8);
  }

  return collectCenteredFallbackTargets(row, statusNode);
}

function extractCandidateTitle(row: HTMLElement): string {
  const text = normalizeText(row.innerText);
  return truncate(text, 140) || 'Отзыв';
}

function getVisiblePendingCandidates(): ReviewRowCandidate[] {
  const usedRows = new Set<HTMLElement>();
  const candidates: ReviewRowCandidate[] = [];

  for (const statusNode of getVisibleStatusNodes()) {
    const status = normalizeText(statusNode.innerText) as 'Новый' | 'Просмотрен';
    if (status !== 'Новый' && status !== 'Просмотрен') continue;

    const row = findCandidateRowRootFromStatusNode(statusNode);
    if (!row || usedRows.has(row)) continue;

    const clickTargets = collectCandidateClickTargets(row, statusNode);
    if (!clickTargets.length) continue;

    usedRows.add(row);
    candidates.push({
      row,
      clickTargets,
      title: extractCandidateTitle(row),
      status
    });
  }

  return candidates;
}

function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates().filter((candidate) => !triedTitlesInCycle.has(candidate.title));

  if (!candidates.length) return null;

  const poolSize = Math.min(candidates.length, 3);
  return candidates[randomInt(0, poolSize - 1)] ?? candidates[0] ?? null;
}

function getOpenReviewModal(): HTMLElement | null {"""

new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    print("Не удалось найти блок для замены. Файл content.ts отличается от ожидаемого.", file=sys.stderr)
    sys.exit(1)

path.write_text(new_text, encoding="utf-8")
print("content.ts patched successfully")
