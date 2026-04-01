from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

def sub_once(pattern: str, replacement: str, name: str):
    global text
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        print(f"Не удалось заменить блок {name}. Совпадений: {count}", file=sys.stderr)
        sys.exit(1)
    text = new_text

sub_once(
    r"""function isReasonableTextTarget\(text: string\): boolean \{\s*return text\.length >= 10 && text\.length <= 320;\s*\}""",
    """function isReasonableTextTarget(text: string): boolean {
  return text.length >= 1 && text.length <= 320;
}""",
    "isReasonableTextTarget"
)

sub_once(
    r"""function getVisiblePendingCandidates\(\): ReviewRowCandidate\[\] \{[\s\S]*?return candidates;\s*\}""",
    """function getVisiblePendingCandidates(): ReviewRowCandidate[] {
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

  return candidates.sort(
    (a, b) => a.row.getBoundingClientRect().top - b.row.getBoundingClientRect().top
  );
}""",
    "getVisiblePendingCandidates"
)

sub_once(
    r"""function pickNextCandidate\(\): ReviewRowCandidate \| null \{\s*const candidates = getVisiblePendingCandidates\(\)\.filter\(\(candidate\) => !triedTitlesInCycle\.has\(candidate\.title\)\);\s*if \(!candidates\.length\) return null;\s*return candidates\[0\] \?\? null;\s*\}""",
    """function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates();

  if (!candidates.length) return null;

  return candidates[0] ?? null;
}""",
    "pickNextCandidate"
)

new_text, count = re.subn(
    r"""^\s*triedTitlesInCycle\.add\(candidate\.title\);\s*$\n?""",
    "",
    text,
    flags=re.M
)
if count < 1:
    print("Не удалось удалить triedTitlesInCycle.add(candidate.title);", file=sys.stderr)
    sys.exit(1)
text = new_text

path.write_text(text, encoding="utf-8")
print("src/content.ts updated")
