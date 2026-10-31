# syki::sok — CLAUDE.md (Claude Code entry point)

@AGENTS.md

> `scraps/` で Claude Code を起動したら、このファイル経由で `AGENTS.md`（Knowledge Compiler Directive）を自動読み込みする。
> 指令の正本は `AGENTS.md`。矛盾が生じた場合は `AGENTS.md` を優先し、以下は最小要約のみ従う。

## 最小要約（Quick Contract）

1. 「scrapを吸収して」（Absorb）または「wikiを点検して」（Lint: 孤立ノート・リンク切れ・矛盾の修復）で `scrap_dir` ルート直下の `.md` をスキャン（`AGENTS.md`/`CLAUDE.md`/`INDEX.md` 除外、`<!-- syki:absorbed ... -->` または空白のみは完全無視、未吸収内容ゼロなら即停止）。
2. `INDEX.md` を読んで既存 `wiki/` トピック・タグを把握。
3. 既存ノートへ統合 / 新トピックは `wiki/YYYY-MM-DD-slug.md`（1行目 `<!-- tags: tag1, tag2 -->`）/ 一時ものはアーカイブのみ。
4. `wiki/` 内を相対リンクし、関連理由を1文で明記。
5. `INDEX.md` を更新（1ノート1行、`<=150` 行厳守）。
6. 原文を `archive/YYYY-MM/<filename-with-timestamp>.md` へコピー → 当日分は削除せずインプレースで `<!-- syki:absorbed YYYY-MM-DDTHH:mm:ss -->` 1行上書き → 過去日分と Google Drive 競合コピー（`YYYY-MM-DD (*).md`）は削除。
