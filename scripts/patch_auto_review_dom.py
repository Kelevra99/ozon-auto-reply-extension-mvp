from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

def replace_once(pattern: str, replacement: str, flags=re.S) -> None:
    global text
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        print(f"Не удалось заменить блок:\\n{pattern[:120]}...", file=sys.stderr)
        sys.exit(1)
    text = new_text

replace_once(
    r"type ReviewRowCandidate = \{[\s\S]*?\n\};",
    """type ReviewRowCandidate = {
  row: HTMLElement;
  clickTargets: HTMLElement[];
  title: string;
  status: 'Новый' | 'Просмотрен';
};"""
)

replace_once(
    r"function findCandidateRowRoot\(titleNode: HTMLElement\): HTMLElement \| null \{[\s\S]*?function getOpenReviewModal\(\): HTMLElement \| null \{",
    """function uniqueElements<T extends HTMLElement>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function getVisibleStatusNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('div, span, td, p, a, button'))
    .filter(isElementVisible)
    .filter((element) => {
      const text = normalizeText(element.innerText || element.textContent);
      return text === 'Новый' || text === 'Просмотрен';
    });
}

function findCandidateRowRootFromStatusNode(statusNode: HTMLElement): HTMLElement | null {
  const structuralSelectors = ['tr', '[role="row"]', 'li', 'article'];

  for (const selector of structuralSelectors) {
    const row = statusNode.closest(selector) as HTMLElement | null;
    if (row && isElementVisible(row)) return row;
  }

  let current: HTMLElement | null = statusNode;

  while (current && current !== document.body) {
    const text = normalizeText(current.innerText);
    const hasStatus = text.includes('Новый') || text.includes('Просмотрен');
    const interactiveCount = current.querySelectorAll('a[href], button, [role="button"], [tabindex]').length;

    if (hasStatus && interactiveCount >= 1 && text.length <= 2500) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function looksLikeRatingText(text: string): boolean {
  return /\\b[1-5]\\b/.test(text) || /оценк/i.test(text);
}

function scoreCandidateTarget(element: HTMLElement): number {
  const text = normalizeText(element.innerText || element.textContent || element.getAttribute('title'));
  let score = 0;

  if (element.matches('a[href], button, [role="button"], [tabindex]')) score += 3;
  if (text.length >= 16) score += 4;
  if (text.length >= 40) score += 2;
  if (looksLikeRatingText(text)) score += 3;
  if (/отзыв|товар|комментар/i.test(text)) score += 2;

  return score;
}

function collectCandidateClickTargets(row: HTMLElement): HTMLElement[] {
  const directTargets = Array.from(
    row.querySelectorAll<HTMLElement>('a[href], button, [role="button"], [tabindex], [title]')
  )
    .filter(isElementVisible)
    .filter((element) => {
      const text = normalizeText(element.innerText || element.textContent || element.getAttribute('title'));
      if (!text) return false;
      if (text === 'Новый' || text === 'Просмотрен' || text === 'Обработан') return false;
      return text.length >= 3;
    });

  const textTargets = Array.from(row.querySelectorAll<HTMLElement>('div, span, p'))
    .filter(isElementVisible)
    .filter((element) => {
      const text = normalizeText(element.innerText || element.textContent);
      if (!text) return false;
      if (text === 'Новый' || text === 'Просмотрен' || text === 'Обработан') return false;
      if (text.length < 12 || text.length > 280) return false;
      return true;
    });

  return uniqueElements([...directTargets, ...textTargets])
    .sort((a, b) => scoreCandidateTarget(b) - scoreCandidateTarget(a))
    .slice(0, 8);
}

function extractCandidateTitle(row: HTMLElement): string {
  const titledElements = Array.from(row.querySelectorAll<HTMLElement>('[title]'));

  for (const element of titledElements) {
    const title = normalizeText(element.getAttribute('title'));
    if (title && title !== 'Новый' && title !== 'Просмотрен' && title !== 'Обработан') {
      return title;
    }
  }

  const text = normalizeText(row.innerText);
  return truncate(text, 80) || 'Отзыв';
}

function getVisiblePendingCandidates(): ReviewRowCandidate[] {
  const usedRows = new Set<HTMLElement>();
  const candidates: ReviewRowCandidate[] = [];

  for (const statusNode of getVisibleStatusNodes()) {
    const status = normalizeText(statusNode.innerText) as 'Новый' | 'Просмотрен';
    if (status !== 'Новый' && status !== 'Просмотрен') continue;

    const row = findCandidateRowRootFromStatusNode(statusNode);
    if (!row || usedRows.has(row)) continue;

    const clickTargets = collectCandidateClickTargets(row);
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
)

replace_once(
    r"async function openCandidate\(candidate: ReviewRowCandidate\): Promise<HTMLElement> \{[\s\S]*?\n\}\n\nfunction isCandidateHandled",
    """function buildWeightedTargets(targets: HTMLElement[]): HTMLElement[] {
  const weighted: HTMLElement[] = [];

  for (const target of targets) {
    const text = normalizeText(target.innerText || target.textContent || target.getAttribute('title'));

    if (text.length >= 20) {
      weighted.push(target, target, target);
      continue;
    }

    if (looksLikeRatingText(text)) {
      weighted.push(target, target);
      continue;
    }

    weighted.push(target);
  }

  return weighted;
}

function pickHumanClickTarget(targets: HTMLElement[], usedTargets: Set<HTMLElement>): HTMLElement | null {
  const available = targets.filter((target) => !usedTargets.has(target));
  if (!available.length) return null;

  const weighted = buildWeightedTargets(available);
  return weighted[randomInt(0, weighted.length - 1)] ?? available[0] ?? null;
}

async function clickReviewTarget(target: HTMLElement) {
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleepRange(180, 420);
  fireRealClick(target);
}

async function openCandidate(candidate: ReviewRowCandidate): Promise<HTMLElement> {
  if (hasModalOpen()) {
    throw new Error('Предыдущее модальное окно ещё не закрыто');
  }

  triedTitlesInCycle.add(candidate.title);
  const usedTargets = new Set<HTMLElement>();

  while (usedTargets.size < candidate.clickTargets.length) {
    const target = pickHumanClickTarget(candidate.clickTargets, usedTargets);
    if (!target) break;

    usedTargets.add(target);
    setAutoStatus(`Открываю отзыв: ${truncate(candidate.title, 56)}...`);

    await clickReviewTarget(target);

    const opened = await waitUntil(() => Boolean(getOpenReviewModal()), 3200, 120);
    if (!opened) {
      await sleepRange(250, 600);
      continue;
    }

    await sleepRange(1200, 2200);

    const modal = getOpenReviewModal();
    if (!modal) {
      continue;
    }

    const ready = await waitUntil(() => {
      const currentModal = getOpenReviewModal();
      if (!currentModal) return false;
      return isModalFullyLoaded(currentModal);
    }, 5000, 150);

    if (!ready) {
      const currentModal = getOpenReviewModal();
      if (currentModal) {
        try {
          await closeOpenModalStrictly();
        } catch {}
      }
      continue;
    }

    const readyModal = getOpenReviewModal();
    if (!readyModal) {
      throw new Error('Модальное окно пропало после загрузки');
    }

    return readyModal;
  }

  throw new Error('Не удалось открыть отзыв ни по одному элементу строки');
}

function isCandidateHandled"""
)

replace_once(
    r"const candidate = pickNextCandidate\(\);\s*if \(!candidate\) \{[\s\S]*?\}\s*autoState\.refreshedWithoutWork = false;",
    """const candidate = pickNextCandidate();

      if (!candidate) {
        await stopAutoMode('Не найдены видимые отзывы со статусом "Новый" или "Просмотрен".');
        break;
      }

      autoState.refreshedWithoutWork = false;"""
)

path.write_text(text, encoding="utf-8")
print("src/content.ts обновлен")
