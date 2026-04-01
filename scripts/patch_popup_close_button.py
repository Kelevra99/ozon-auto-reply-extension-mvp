from pathlib import Path
import sys

path = Path("src/popup.html")
text = path.read_text(encoding="utf-8")

if 'id="closeButton"' not in text:
    css_marker = ".wrap {\n        padding: 14px;\n      }\n"
    css_insert = """.wrap {
        padding: 14px;
        position: relative;
      }
      .topbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
      }
      .close-btn {
        border: 0;
        background: transparent;
        color: #64748b;
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 999px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }
      .close-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
"""
    if css_marker not in text:
        print("Не найден CSS marker в popup.html", file=sys.stderr)
        sys.exit(1)
    text = text.replace(css_marker, css_insert, 1)

    html_marker = '<div class="wrap">'
    html_insert = """<div class="wrap">
      <div class="topbar">
        <button id="closeButton" class="close-btn" type="button" aria-label="Закрыть">✕</button>
      </div>"""
    if html_marker not in text:
        print("Не найден HTML marker в popup.html", file=sys.stderr)
        sys.exit(1)
    text = text.replace(html_marker, html_insert, 1)

path.write_text(text, encoding="utf-8")
print("src/popup.html updated")
