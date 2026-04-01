from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

def replace_once(pattern: str, replacement: str, name: str):
    global text
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        print(f"Не удалось заменить блок {name}. Совпадений: {count}", file=sys.stderr)
        sys.exit(1)
    text = new_text

replace_once(
    r"""function getRowStatus\(row: HTMLElement\): 'Новый' \| 'Просмотрен' \| 'Обработан' \| null \{.*?return null;\n\}\n\nfunction uniqueElements""",
    """function getRowStatus(row: HTMLElement): 'Новый' | 'Просмотрен' | 'Обработан' | null {
  const text = normalizeText(row.innerText);

  if (text.includes('Обработан')) return 'Обработан';
  if (text.includes('Просмотрен')) return 'Просмотрен';
  if (text.includes('Новый')) return 'Новый';

  return null;
}

function rowContainsOnlyRatingWithoutText(row: HTMLElement): boolean {
  const text = normalizeText(row.innerText);
  return (
    text.includes('Только оценка без текста') ||
    text.includes('В отзыве есть только оценка без текста')
  );
}

function modalContainsOnlyRatingWithoutText(modal: HTMLElement): boolean {
  const text = normalizeText(modal.innerText);
  return (
    text.includes('В отзыве есть только оценка без текста') ||
    text.includes('Только оценка без текста')
  );
}

function hasVisibleOnlyRatingWithoutTextRows(): boolean {
  for (const statusNode of getVisibleStatusNodes()) {
    const row = findCandidateRowRootFromStatusNode(statusNode);
    if (!row) continue;
    if (rowContainsOnlyRatingWithoutText(row)) {
      return true;
    }
  }

  return false;
}

function getPendingListSnapshot(): string {
  const candidates = getVisiblePendingCandidates();
  return candidates
    .slice(0, 8)
    .map((candidate) => `${candidate.status}:${truncate(candidate.title, 40)}`)
    .join(' | ');
}

async function waitForWaitingFilterDomRebuild(timeoutMs = 10000): Promise<boolean> {
  const startedAt = Date.now();
  let previousSnapshot = '';
  let stableHits = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const button = findWaitingFilterButton();
    const active = Boolean(button && isWaitingFilterActive(button));
    const hasOnlyRatingRows = hasVisibleOnlyRatingWithoutTextRows();
    const snapshot = `${active}|${hasOnlyRatingRows}|${getPendingListSnapshot()}`;

    if (active && !hasOnlyRatingRows) {
      stableHits = snapshot === previousSnapshot ? stableHits + 1 : 1;
      if (stableHits >= 2) {
        return true;
      }
    } else {
      stableHits = 0;
    }

    previousSnapshot = snapshot;
    await sleep(1000);
  }

  return false;
}

async function recoverWaitingFilterList(reason: string, maxAttempts = 2): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    setAutoStatus(`${reason} Обновляю фильтр (${attempt}/${maxAttempts})...`, 'warn');
    await refreshWaitingFilter();

    const hasCandidates = getVisiblePendingCandidates().length > 0;
    if (hasCandidates && !hasVisibleOnlyRatingWithoutTextRows()) {
      return true;
    }
  }

  return false;
}

function uniqueElements""",
    "helpers after getRowStatus"
)

replace_once(
    r"""async function ensureWaitingFilterActive\(\) \{.*?\n\}\n\nasync function refreshWaitingFilter\(\) \{""",
    """async function ensureWaitingFilterActive() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('Не найдена кнопка "Ждут ответа"');
  }

  if (!isWaitingFilterActive(filterButton)) {
    setAutoStatus('Включаю фильтр "Ждут ответа"...');
    await clickElement(filterButton);

    const activated = await waitUntil(() => {
      const current = findWaitingFilterButton();
      return Boolean(current && isWaitingFilterActive(current));
    }, 7000, 140);

    if (!activated) {
      throw new Error('Не удалось включить фильтр "Ждут ответа"');
    }
  }

  setAutoStatus('Жду обновления списка отзывов...');
  const rebuilt = await waitForWaitingFilterDomRebuild(10000);

  if (!rebuilt) {
    setAutoStatus('Список отзывов обновился не полностью. Продолжаю с перепроверкой.', 'warn');
  }

  await sleepRange(300, 700);
}

async function refreshWaitingFilter() {""",
    "ensureWaitingFilterActive"
)

replace_once(
    r"""async function refreshWaitingFilter\(\) \{.*?await sleepRange\(1200, 2200\);\n\}""",
    """async function refreshWaitingFilter() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('Не найдена кнопка "Ждут ответа"');
  }

  setAutoStatus('Обновляю список отзывов...');

  if (isWaitingFilterActive(filterButton)) {
    await clickElement(filterButton);

    await waitUntil(() => {
      const current = findWaitingFilterButton();
      return Boolean(current && !isWaitingFilterActive(current));
    }, 5000, 140);

    await sleepRange(500, 900);
  }

  const nextFilterButton = findWaitingFilterButton();
  if (!nextFilterButton) {
    throw new Error('Не удалось повторно найти кнопку "Ждут ответа"');
  }

  await clickElement(nextFilterButton);

  const activated = await waitUntil(() => {
    const current = findWaitingFilterButton();
    return Boolean(current && isWaitingFilterActive(current));
  }, 7000, 140);

  if (!activated) {
    throw new Error('Не удалось повторно включить фильтр "Ждут ответа"');
  }

  triedTitlesInCycle.clear();
  autoState.processedInBatch = 0;
  autoState.batchTarget = randomInt(10, 15);
  autoState.refreshedWithoutWork = false;

  const rebuilt = await waitForWaitingFilterDomRebuild(10000);

  if (!rebuilt) {
    setAutoStatus('После обновления фильтра список перестроился не полностью.', 'warn');
  }

  await sleepRange(350, 800);
}""",
    "refreshWaitingFilter"
)

replace_once(
    r"""function getVisiblePendingCandidates\(\): ReviewRowCandidate\[\] \{.*?return candidates\.sort\(\n    \(a, b\) => a\.row\.getBoundingClientRect\(\)\.top - b\.row\.getBoundingClientRect\(\)\.top\n  \);\n\}""",
    """function getVisiblePendingCandidates(): ReviewRowCandidate[] {
  const usedRows = new Set<HTMLElement>();
  const candidates: ReviewRowCandidate[] = [];

  for (const statusNode of getVisibleStatusNodes()) {
    const status = normalizeText(statusNode.innerText) as 'Новый' | 'Просмотрен';
    if (status !== 'Новый' && status !== 'Просмотрен') continue;

    const row = findCandidateRowRootFromStatusNode(statusNode);
    if (!row || usedRows.has(row)) continue;
    if (rowContainsOnlyRatingWithoutText(row)) continue;

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

  return candidates.sort(
    (a, b) => a.row.getBoundingClientRect().top - b.row.getBoundingClientRect().top
  );
}""",
    "getVisiblePendingCandidates"
)

replace_once(
    r"""async function processCandidate\(candidate: ReviewRowCandidate\): Promise<boolean> \{\n  const modal = await openCandidate\(candidate\);\n  const review = await extractReview\(modal\);""",
    """async function processCandidate(candidate: ReviewRowCandidate): Promise<boolean> {
  const modal = await openCandidate(candidate);

  if (modalContainsOnlyRatingWithoutText(modal)) {
    setAutoStatus('OZON показал отзыв только с оценкой. Обновляю фильтр...', 'warn');
    await closeOpenModalStrictly();
    await recoverWaitingFilterList('Список отзывов ещё не перестроился.', 1);
    return false;
  }

  const review = await extractReview(modal);""",
    "processCandidate only-rating modal"
)

replace_once(
    r"""const candidate = pickNextCandidate\(\);\n\n      if \(!candidate\) \{\n        await stopAutoMode\('Не найдены видимые отзывы со статусом "Новый" или "Просмотрен"\.'\);\n        break;\n      \}\n\n      autoState\.refreshedWithoutWork = false;""",
    """const candidate = pickNextCandidate();

      if (!candidate) {
        const recovered = await recoverWaitingFilterList(
          'Отзывы временно не видны. Перепроверяю список.',
          2
        );

        if (recovered) {
          await sleep(250);
          continue;
        }

        await stopAutoMode('Не найдены новые отзывы после двух обновлений фильтра.');
        break;
      }

      autoState.refreshedWithoutWork = false;""",
    "runAutoModeLoop no-candidate branch"
)

path.write_text(text, encoding="utf-8")
print("src/content.ts updated")
