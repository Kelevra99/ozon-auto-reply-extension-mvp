from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

pattern = r"""async function closeOpenModalStrictly\(\) \{[\s\S]*?\n\}"""

replacement = """async function closeOpenModalStrictly() {
  const modal = getOpenReviewModal();
  if (!modal) return;

  setAutoStatus('Закрываю модальное окно...');

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
    },
    {
      x: Math.min(window.innerWidth - 8, Math.floor(rect.right + (window.innerWidth - rect.right) / 2)),
      y: Math.max(8, Math.floor(rect.top / 2))
    }
  ];

  for (const point of points) {
    const target = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    if (!target) continue;
    if (modal.contains(target)) continue;

    fireRealClick(target);

    const closed = await waitUntil(() => !getOpenReviewModal(), 1800, 120);
    if (closed) {
      return;
    }

    await sleep(120);
  }

  throw new Error('Не удалось закрыть модальное окно кликом вне окна');
}"""

new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    print("Не удалось заменить closeOpenModalStrictly()", file=sys.stderr)
    sys.exit(1)

path.write_text(new_text, encoding="utf-8")
print("src/content.ts updated")
