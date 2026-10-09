import os
import re
from bs4 import BeautifulSoup, NavigableString, Tag

def tag_to_markdown(elem):
    if isinstance(elem, NavigableString):
        return str(elem)
    
    tag_name = elem.name
    
    # Ignore decorative elements
    if tag_name in ['script', 'style', 'nav', 'button', 'img', 'svg']:
        return ""

    # Code block
    if tag_name == 'pre':
        code = elem.find('code')
        lang = ""
        if code and code.get('class'):
            for c in code['class']:
                if c.startswith('language-'):
                    lang = c.replace('language-', '')
        content = elem.get_text()
        return f"\n```{lang}\n{content.strip()}\n```\n"

    # Inline code
    if tag_name == 'code':
        return f"`{elem.get_text().strip()}`"

    # Bold / Strong
    if tag_name in ['strong', 'b']:
        inner = "".join(tag_to_markdown(child) for child in elem.children).strip()
        return f"**{inner}**" if inner else ""

    # Headings
    if tag_name == 'h1':
        return f"\n\n# {elem.get_text().strip()}\n\n"
    if tag_name == 'h2':
        return f"\n\n## {elem.get_text().strip()}\n\n"
    if tag_name == 'h3':
        return f"\n\n### {elem.get_text().strip()}\n\n"
    if tag_name == 'h4':
        return f"\n\n#### {elem.get_text().strip()}\n\n"

    # Paragraph
    if tag_name == 'p':
        inner = "".join(tag_to_markdown(child) for child in elem.children).strip()
        return f"\n\n{inner}\n\n" if inner else ""

    # Blockquote
    if tag_name == 'blockquote':
        inner = "".join(tag_to_markdown(child) for child in elem.children).strip()
        lines = inner.split('\n')
        quoted = "\n".join(f"> {line}" for line in lines)
        return f"\n\n{quoted}\n\n"

    # List
    if tag_name in ['ul', 'ol']:
        res = []
        is_ol = tag_name == 'ol'
        for i, li in enumerate(elem.find_all('li', recursive=False)):
            prefix = f"{i+1}. " if is_ol else "- "
            inner = "".join(tag_to_markdown(child) for child in li.children).strip()
            res.append(f"{prefix}{inner}")
        return "\n" + "\n".join(res) + "\n"

    # Table
    if tag_name == 'table':
        rows = []
        for tr in elem.find_all('tr'):
            cols = []
            for th_or_td in tr.find_all(['th', 'td']):
                cell_text = "".join(tag_to_markdown(child) for child in th_or_td.children).strip()
                cell_text = cell_text.replace('\n', ' ')
                cols.append(cell_text)
            if cols:
                rows.append(cols)
        if not rows:
            return ""
        
        # Format as Markdown table
        header = rows[0]
        md_table = "\n\n| " + " | ".join(header) + " |\n"
        md_table += "| " + " | ".join(["---"] * len(header)) + " |\n"
        for row in rows[1:]:
            padded = row + [""] * (len(header) - len(row))
            md_table += "| " + " | ".join(padded[:len(header)]) + " |\n"
        return md_table + "\n"

    # Default: process children
    return "".join(tag_to_markdown(child) for child in elem.children)

def clean_markdown(text):
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def build_llms_txt():
    with open('manual_ja.html', 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    for s in soup(['script', 'style', 'nav', 'header', 'footer']):
        s.decompose()

    main = soup.find('main') or soup.find('body')
    sections = main.find_all('section')

    manual_md_parts = []
    for sec in sections:
        md = tag_to_markdown(sec)
        md = clean_markdown(md)
        if md:
            manual_md_parts.append(md)

    manual_body = "\n\n---\n\n".join(manual_md_parts)

    system_header = """# syki::sok — Complete Specification, Manual & Machine-Readable Knowledge Base

> **System Profile**: An instant, featherweight desktop Markdown scratchpad with AI right at your cursor.
> **Architecture**: Go core + OS native WebView (Windows: WebView2, macOS: WKWebView; Electron-free).
> **Performance**: Idle Memory: 5–15 MB. Summon latency: < 15 ms.
> **Storage & Security**: 100% Local POSIX plain Markdown files (`scraps/YYYY-MM-DD.md`). Zero vendor lock-in. Full offline support. Background Git auto-sync.
> **Target Role**: Zero-resistance buffer before opening heavy knowledge vaults (Obsidian / Notion).

---

## Quick Reference / AI System Instructions (このファイルを読み込んだAIへの指示)

When answering questions about `syki::sok`, follow these rules:
1. **Always specify both platforms**: Provide Windows and macOS shortcuts together (e.g., `Ctrl+L` / `Cmd+L`, `Ctrl+Alt+M` / `Opt+Cmd+M`).
2. **Prioritize 3 Core Verbs**: Guide users by categorizing their goals into:
   - **Write (書く)**: In-place AI (`Ctrl+L`), Proofread (`Alt+C`), Ghost-Text prediction (`Tab`), Smart Paste / OCR (`Ctrl+V`), Voice Dictation (`Ctrl+Shift+R`).
   - **Execute (実行する)**: Command bar (`Ctrl+E`), AI shell generator (`Ctrl+E` -> `Tab`), terminal pipes (`cat log | syki`).
   - **Delegate (任せる)**: Auto selector (`Ctrl+Enter`), Agent slots (`{{ @claude ... }}`), task panel (`Alt+T`), Lessons engine.
3. **Safety First**: Never advise users to paste raw API keys into public files. Point to `config.json` while the app is closed, or the Settings GUI.
4. **Accurate & Concrete**: Provide exact shortcut combinations, note notations, and CLI one-liners.

---

| Action (機能) | Windows | macOS | Description (概要) |
| :--- | :--- | :--- | :--- |
| **Instant Summon (前面復帰)** | `Ctrl+Alt+M` | `Opt+Cmd+M` | 15ms未満で前面復帰・キャレット位置維持 |
| **AI at Cursor (AIに質問)** | `Ctrl+L` | `Cmd+L` | 選択行の直下にストリーミング回答（元文保持） |
| **Proofread (ワンキー校正)** | `Alt+C` | `Cmd+Shift+C` | ワンキーで誤字・脱字・不自然表現をその場で修正 |
| **Ghost-Text (予測補完)** | `Tab` | `Tab` | ローカルモデル（Ollama/Qwen）の予測次文を1キー確定 |
| **Voice Dictation (音声入力)** | `Ctrl+Shift+R` | `Cmd+Shift+R` | AI推敲付きリアルタイム音声入力＆音声編集指示 |
| **Mobile Drop (スマホ連携)** | `Ctrl+Shift+U` | `Cmd+Shift+U` | QRコードでスマホの写真・音声・メモを直接転送 |
| **Command Bar (コマンドバー)** | `Ctrl+E` | `Cmd+E` | 選択行を `jq` や `sort` に流し込み。`Tab` でAI生成 |
| **Auto Selector (自動判定)** | `Ctrl+Enter` | `Cmd+Enter` | 行の意図を自動判別しLLM・シェル・エージェントを実行 |
| **Next Actions (候補提案)** | `Ctrl+J` | `Cmd+J` | 文脈から次の一手を最大3件提案（`Ctrl+1`〜`3`） |
| **Scraps Search (並列検索)** | `Ctrl+Shift+F` | `Cmd+Shift+F` | 数千のメモを全CPU並列スキャン（150ms以内） |
| **Split Editor (画面分割)** | `Ctrl+\\` | `Cmd+\\` | ノートを左右に2つ並べて編集 |
| **Mermaid Preview (プレビュー)** | `Ctrl+Alt+V` | `Cmd+Opt+V` | リアルタイムMarkdown＆Mermaid構文図解描画 |
| **Task Panel (タスク一覧)** | `Alt+T` | `Opt+T` | バックグラウンド自律タスクの進行確認・教訓登録 |
| **Quick Capture (即時メモ)** | `Ctrl+Shift+Q` | *(Win only)* | デスクトップ常駐ポップアップ＆画面キャプチャOCR |
| **Command Palette (パレット)** | `Ctrl+Shift+P` | `Cmd+Shift+P` | すべての機能・コマンドの検索と実行 |

---
"""

    full_content = system_header + "\n\n" + manual_body

    with open('llms.txt', 'w', encoding='utf-8') as f:
        f.write(full_content)
    
    with open('llm.txt', 'w', encoding='utf-8') as f:
        f.write(full_content)

    print(f"Generated complete comprehensive llms.txt! Length: {len(full_content)} chars")

if __name__ == '__main__':
    build_llms_txt()
