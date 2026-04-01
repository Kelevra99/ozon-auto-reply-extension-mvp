from pathlib import Path
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

def replace_exact(old: str, new: str, name: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        print(f"Не удалось заменить блок {name}. Совпадений: {count}", file=sys.stderr)
        sys.exit(1)
    text = text.replace(old, new, 1)

replace_exact(
"""function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates().filter((candidate) => !triedTitlesInCycle.has(candidate.title));

  if (!candidates.length) return null;

  const poolSize = Math.min(candidates.length, 3);
  return candidates[randomInt(0, poolSize - 1)] ?? candidates[0] ?? null;
}
""",
"""function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates().filter((candidate) => !triedTitlesInCycle.has(candidate.title));

  if (!candidates.length) return null;

  return candidates[0] ?? null;
}
""",
"pickNextCandidate"
)

replace_exact(
"""  triedTitlesInCycle.add(candidate.title);
""",
"""""",
"remove triedTitlesInCycle.add from openCandidate"
)

replace_exact(
"""function hasPostedSellerReply(modal: HTMLElement, expectedReply?: string): boolean {
  const block = findPostedSellerReplyBlock(modal);
  if (!block) return false;

  if (!expectedReply) return true;

  const blockText = normalizeText(block.innerText);
  const expectedSample = normalizeText(expectedReply).slice(0, 80);

  return !expectedSample || blockText.includes(expectedSample);
}

function findCloseModalButton(modal: HTMLElement): HTMLButtonElement | null {
""",
"""function hasPostedSellerReply(modal: HTMLElement, expectedReply?: string): boolean {
  const block = findPostedSellerReplyBlock(modal);
  if (!block) return false;

  if (!expectedReply) return true;

  const blockText = normalizeText(block.innerText);
  const expectedSample = normalizeText(expectedReply).slice(0, 80);

  return !expectedSample || blockText.includes(expectedSample);
}

function hasModalProcessedStatus(modal: HTMLElement): boolean {
  const text = normalizeText(modal.innerText);
  return /Статус\\s+Обработанн?ый/i.test(text) || text.includes('Статус Обработан');
}

function hasReplySubmissionCompleted(modal: HTMLElement, expectedReply?: string): boolean {
  return hasModalProcessedStatus(modal) || hasPostedSellerReply(modal, expectedReply);
}

function findCloseModalButton(modal: HTMLElement): HTMLButtonElement | null {
""",
"add modal processed status helpers"
)

replace_exact(
"""function findModalBackdrop(modal: HTMLElement): HTMLElement | null {
  const root = modal.parentElement ?? modal;

  const rightBackdrop =
    root.querySelector<HTMLElement>('.tc280-a1.tc280-a3') ??
    root.querySelector<HTMLElement>('.tc280-a1.tc280-a2');

  if (rightBackdrop && isElementVisible(rightBackdrop)) {
    return rightBackdrop;
  }

  return null;
}

async function closeOpenModalStrictly() {
  const modal = getOpenReviewModal();
  if (!modal) return;

  const closeButton = findCloseModalButton(modal);
  if (!closeButton) {
    throw new Error('Не найдена кнопка закрытия модального окна');
  }

  setAutoStatus('Закрываю модальное окно...');

  fireRealClick(closeButton);

  let closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
  if (closed) {
    await sleep(1000);
    return;
  }

  const closeSvg = closeButton.querySelector('svg');
  if (closeSvg) {
    fireRealClick(closeSvg);
    closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
    if (closed) {
      await sleep(1000);
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
        await sleep(1000);
        return;
      }
    }
  }

  throw new Error('Не удалось закрыть модальное окно ни по крестику, ни по фону');
}
""",
"""function findModalBackdrop(modal: HTMLElement): HTMLElement | null {
  const root = modal.parentElement ?? document.body;

  const candidates = Array.from(root.querySelectorAll<HTMLElement>('div, section, aside'))
    .filter(isElementVisible)
    .filter((element) => element !== modal && !element.contains(modal) && !modal.contains(element))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.85;
    });

  return candidates[0] ?? null;
}

function clickOutsideModalByPoint(modal: HTMLElement): boolean {
  const rect = modal.getBoundingClientRect();
  const points = [
    {
      x: Math.max(8, Math.floor(rect.left / 2)),
      y: Math.max(8, Math.floor(rect.top + Math.min(rect.height / 2, 80)))
    },
    {
      x: Math.min(window.innerWidth - 8, Math.floor(rect.right + (window.innerWidth - rect.right) / 2)),
      y: Math.max(8, Math.floor(rect.top + Math.min(rect.height / 2, 80)))
    },
    {
      x: Math.max(8, Math.floor(rect.left / 2)),
      y: Math.max(8, Math.floor(rect.top / 2))
    }
  ];

  for (const point of points) {
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) continue;
    if (modal.contains(target)) continue;

    fireRealClick(target);
    return true;
  }

  return false;
}

async function closeOpenModalStrictly() {
  const modal = getOpenReviewModal();
  if (!modal) return;

  setAutoStatus('Закрываю модальное окно...');

  const backdrop = findModalBackdrop(modal);
  if (backdrop) {
    fireRealClick(backdrop);

    const closed = await waitUntil(() => !getOpenReviewModal(), 1800, 120);
    if (closed) {
      return;
    }
  }

  const currentModal = getOpenReviewModal();
  if (currentModal && clickOutsideModalByPoint(currentModal)) {
    const closed = await waitUntil(() => !getOpenReviewModal(), 1800, 120);
    if (closed) {
      return;
    }
  }

  throw new Error('Не удалось закрыть модальное окно кликом вне окна');
}
""",
"replace closeOpenModalStrictly"
)

replace_exact(
"""  await sleepRange(2000, 3000);

const replyAppeared = await waitUntil(() => {
  const currentModal = getOpenReviewModal();
  if (!currentModal) return false;
  return hasPostedSellerReply(currentModal, insertedText);
}, 20000, 2000);

  if (!replyAppeared) {
    throw new Error('После отправки в модальном окне не появился опубликованный ответ');
  }

  setAutoStatus(`Ответ появился: ${truncate(candidate.title, 50)}. Закрываю окно...`, 'success');

  await sleep(1000);
  await closeOpenModalStrictly();

  return true;
""",
"""  await sleep(1500);

  const replyAppeared = await waitUntil(() => {
    const currentModal = getOpenReviewModal();
    if (!currentModal) return false;
    return hasReplySubmissionCompleted(currentModal, insertedText);
  }, 20000, 1000);

  if (!replyAppeared) {
    throw new Error('После отправки не подтвердилось появление ответа в модальном окне');
  }

  setAutoStatus(`Ответ появился: ${truncate(candidate.title, 50)}. Закрываю окно...`, 'success');

  await closeOpenModalStrictly();
  triedTitlesInCycle.add(candidate.title);

  await waitUntil(() => isCandidateHandled(candidate), 6000, 350);

  return true;
""",
"replace send wait block"
)

replace_exact(
"""        await sleep(1000);
      }

      if (autoState.processedInBatch >= autoState.batchTarget) {
""",
"""        await sleep(250);
      }

      if (autoState.processedInBatch >= autoState.batchTarget) {
""",
"speed up loop after modal close"
)

replace_exact(
"""          await sleep(1000);
        }
      } catch (error) {
""",
"""          await sleep(350);
        }
      } catch (error) {
""",
"speed up loop after success"
)

path.write_text(text, encoding="utf-8")
print("src/content.ts updated")
