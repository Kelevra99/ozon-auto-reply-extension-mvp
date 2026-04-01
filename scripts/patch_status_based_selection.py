from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

pattern = r"""function findCandidateRowRoot\(titleNode: HTMLElement\): HTMLElement \| null \{[\s\S]*?function getOpenReviewModal\(\): HTMLElement \| null \{"""

replacement = """function getVisiblePendingStatusNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('div, span, td, p'))
    .filter(isElementVisible)
    .filter((element) => {
      const text = normalizeText(element.innerText || element.textContent);
      return text === 'Новый' || text === 'Просмотрен';
    });
}

function findCandidateRowRoot(statusNode: HTMLElement): HTMLElement | null {
  const directRow = statusNode.closest('tr') as HTMLElement | null;
  if (directRow) return directRow;

  let current = statusNode.parentElement as HTMLElement | null;

  while (current && current !== document.body) {
    const text = normalizeText(current.innerText);
    if (text.includes('Новый') || text.includes('Просмотрен') || text.includes('Обработан')) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getCenterX(rect: DOMRect): number {
  return rect.left + rect.width / 2;
}

function getCenterY(rect: DOMRect): number {
  return rect.top + rect.height / 2;
}

function hasVerticalOverlap(rect: DOMRect, statusRect: DOMRect): boolean {
  return rect.bottom >= statusRect.top - 18 && rect.top <= statusRect.bottom + 18;
}

function isIgnoredCandidateText(text: string): boolean {
  return ['Новый', 'Просмотрен', 'Обработан', 'Получен', 'Отменён', 'Отменен'].includes(text);
}

function isForbiddenRowTarget(element: HTMLElement): boolean {
  return Boolean(element.closest('a[href]'));
}

function scoreOpenTarget(element: HTMLElement, statusRect: DOMRect, side: 'left' | 'right' | 'any'): number {
  const rect = element.getBoundingClientRect();
  const text = normalizeText(element.innerText || element.textContent);
  const centerX = getCenterX(rect);
  const centerY = getCenterY(rect);

  const targetX =
    side === 'right'
      ? statusRect.right + 48
      : side === 'left'
      ? statusRect.left - 80
      : statusRect.left - 40;

  let score =
    Math.abs(centerY - getCenterY(statusRect)) * 3 +
    Math.abs(centerX - targetX);

  if (side === 'right') {
    if (/\\b[1-5]\\b/.test(text)) score -= 30;
    if (/[★☆]/.test(text)) score -= 15;
  }

  if (text.length > 140) score += 25;

  return score;
}

function findBestRowTarget(row: HTMLElement, statusNode: HTMLElement, side: 'left' | 'right' | 'any'): HTMLElement | null {
  const statusRect = statusNode.getBoundingClientRect();

  const candidates = Array.from(row.querySelectorAll<HTMLElement>('div, span, p, td, button'))
    .filter(isElementVisible)
    .filter((element) => element !== statusNode)
    .filter((element) => !isForbiddenRowTarget(element))
    .filter((element) => {
      const text = normalizeText(element.innerText || element.textContent);
      if (!text || isIgnoredCandidateText(text)) return false;

      const rect = element.getBoundingClientRect();
      if (!hasVerticalOverlap(rect, statusRect)) return false;

      const centerX = getCenterX(rect);

      if (side === 'left') {
        return centerX >= statusRect.left - 420 && centerX <= statusRect.left - 16;
      }

      if (side === 'right') {
        return centerX >= statusRect.right + 12 && centerX <= statusRect.right + 220;
      }

      return centerX >= statusRect.left - 420 && centerX <= statusRect.right + 220;
    })
    .sort((a, b) => scoreOpenTarget(a, statusRect, side) - scoreOpenTarget(b, statusRect, side));

  return candidates[0] ?? null;
}

function pickRowOpenTarget(row: HTMLElement, statusNode: HTMLElement): HTMLElement | null {
  return (
    findBestRowTarget(row, statusNode, 'left') ??
    findBestRowTarget(row, statusNode, 'right') ??
    findBestRowTarget(row, statusNode, 'any') ??
    null
  );
}

function buildCandidateTitle(row: HTMLElement, statusNode: HTMLElement): string {
  const rowText = normalizeText(row.innerText);
  const status = normalizeText(statusNode.innerText);
  return truncate(`${status} ${rowText}`, 120) || 'Отзыв';
}

function getVisiblePendingCandidates(): ReviewRowCandidate[] {
  const statusNodes = getVisiblePendingStatusNodes();
  const usedRows = new Set<HTMLElement>();
  const candidates: ReviewRowCandidate[] = [];

  for (const statusNode of statusNodes) {
    const row = findCandidateRowRoot(statusNode);
    if (!row || usedRows.has(row)) continue;

    const rowStatus = getRowStatus(row);
    if (rowStatus !== 'Новый' && rowStatus !== 'Просмотрен') continue;

    const clickTarget = pickRowOpenTarget(row, statusNode);
    if (!clickTarget || !isElementVisible(clickTarget)) continue;

    usedRows.add(row);
    candidates.push({
      row,
      clickTarget,
      title: buildCandidateTitle(row, statusNode),
      status: rowStatus
    });
  }

  return candidates.sort(
    (a, b) => a.row.getBoundingClientRect().top - b.row.getBoundingClientRect().top
  );
}

function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates();
  return candidates[0] ?? null;
}

function getOpenReviewModal(): HTMLElement | null {"""

new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    print("Не удалось заменить блок поиска кандидатов. content.ts отличается от ожидаемого.", file=sys.stderr)
    sys.exit(1)

old_line = "  triedTitlesInCycle.add(candidate.title);\n"
if old_line not in new_text:
    print("Не найдена строка triedTitlesInCycle.add(candidate.title);", file=sys.stderr)
    sys.exit(1)

new_text = new_text.replace(old_line, "", 1)

path.write_text(new_text, encoding="utf-8")
print("src/content.ts updated")
