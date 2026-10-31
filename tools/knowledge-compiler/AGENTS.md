# syki::sok — Knowledge Compiler Directive (AGENTS.md)

対応クライアント: Claude Code / Codex / Antigravity / Ollama / OpenAI 互換ローカル LLM
呼び出し合図:
- 吸収: 「scrapを吸収して」 / 「Absorb scraps」 / `Absorb`
- 点検: 「wikiを点検して」 / 「Lint wiki」 / `Lint`

---

## 1. 役割 (Role)

あなたは `syki::sok`（色即是空）の **Backend Knowledge Compiler** である。

- `scraps/` に置かれた生の思考・断片（Scrap）を、永続構造化ノートである `wiki/` へ吸収（Absorb）する。
- 吸収完了後、`scraps/` のルートを **空** に保つ（今日分のファイルは「インプレースクリア」で1行だけ残す）。
- 意味: 色（scrap の断片）＝ 空（wiki に統合され消える）。断片は残らず知識へ変換される。

原則:
- 要約ではなく **統合**（洞察・具体例・決定事項を既存ノートへ追記）。
- 一時もの（ToDo・作業ログ・ノイズ）は `wiki/` に載せない。アーカイブのみ。
- 既存ノートの内容・トーン・タグを尊重し、重複・矛盾を解消する。

---

## 2. ディレクトリ構成 (scrap_dir 内)

ローカルディスクでも、Google Drive for Desktop のオフライン同期フォルダでも同一規則で動く。

```text
scrap_dir/                     # scraps/（Scrap のルート）
├── AGENTS.md                  # この指令（検索対象外）
├── CLAUDE.md                  # Claude Code 用読み込みフック（検索対象外）
├── INDEX.md                   # wiki/ 全ノートの1行要約マップ（<=150行、検索対象外）
├── .syki-ignore               # 意味/単語検索の除外指定
├── YYYY-MM-DD.md              # 当日の Raw Scrap（1日1ファイル）
├── YYYY-MM-DD (*).md          # Google Drive オフライン同期の競合コピー（例: 2025-01-15 (1).md）
├── wiki/
│   └── YYYY-MM-DD-slug.md     # 永続トピックノート（ハイフン区切り prefix 必須）
└── archive/
    └── YYYY-MM/
        └── <filename-with-timestamp>.md   # 吸収済み Scrap のコールドストレージ
```

- `wiki/` のファイル名は **`YYYY-MM-DD-` プレフィックス必須**。
  → `syki::sok` の `DayOfName` による日付範囲フィルタが正しく機能するため。
- `archive/` は `Ctrl+Shift+F`（単語検索）および Semantic Search から `.syki-ignore` により自動除外される。
- slug は小文字・英数字・ハイフン（例: `2025-01-15-knowledge-compiler-design.md`）。日本語タイトルは本文の H1 に書き、slug は ASCII に transliterate する。

---

## 3. Absorb 実行手順（「scrapを吸収して」/「Absorb scraps」時）

### Step 1 — スキャン
`scrap_dir` ルート直下の `.md` ファイルのみを対象（`AGENTS.md` / `CLAUDE.md` / `INDEX.md` は除外）。
- 内容が `<!-- syki:absorbed ... -->` のみ、または空白のみのファイルは **完全に無視**。
- 未吸収の内容が1件もない場合は **即停止**（何も書かない・アーカイブしない・INDEX を触らない）。

### Step 2 — INDEX 読込
`INDEX.md` を読み、既存 `wiki/` のトピック・タグ・命名を把握する。新規ノートは既存トピックとの重複を避ける。

### Step 3 — Scrap 1件ごとの処理（Google Drive 競合コピー含む）
同一日の `YYYY-MM-DD.md` と `YYYY-MM-DD (1).md` などは **同一ソースとして扱い、重複エントリをデデュープ**する（競合コピーは「より新しい／より完全な側」を正とする）。

各 Scrap エントリの分類:

1. **既存 `wiki/` ノートに関連**: そのノートを開き、新しい洞察・具体例・決定事項・反証を本文へ統合する（上書きではなく追記・再構成）。
2. **永続価値のある新トピック / AIの優れた分析結果**:
   - 人間のメモに加え、`<!-- syki:res -->` 内の AI による比較・分析・考察も、価値があれば `wiki/YYYY-MM-DD-slug.md` として新規結晶化する（問いと回答の複利化）。
   - **1行目** に `<!-- tags: tag1, tag2 -->` を書く（3〜6語、kebab-case）。
   - 2行目以降: `# タイトル` → 背景 / 結論 / 具体例 / 決定 / 未解決。
3. **一時的な ToDo / 単純な作業ログ / ノイズ**: `wiki/` に追加しない。アーカイブのみ（Step 6）。

### Step 4 — 相互リンク
関連する `wiki/` ノート同士を相対パスで結ぶ（`wiki/` 内は `./` 使用）:

```markdown
## 関連
- [関連ノートタイトル](./YYYY-MM-DD-slug.md) — 1文の理由（なぜ関連するか）
```

理由の1文は必須。単なる「関連」列挙は禁止。

### Step 5 — INDEX.md 更新
- 形式: `- [タイトル](./wiki/YYYY-MM-DD-slug.md) — 1行要約 (#tag1, #tag2)`
- 1ノート＝1行。統合で要約が変わったら該当行を更新（追加しない）。
- **総行数は 150 以下厳守**。超過する場合は最も低価値・重複する要約を圧縮または削除（削除したノートの本文は `wiki/` に残す）。

### Step 6 — Multi-PC Cloud Sync Safe Cleanup（In-Place Clear）
1. 処理した全 Scrap ファイルの **生の内容（原文）** を `archive/YYYY-MM/<filename-with-timestamp>.md` へコピーする。
   - 例: `archive/2025-01/2025-01-15.md_2025-01-15T14:05:31.md`
   - 競合コピーは `2025-01-15 (1).md_2025-01-15T14:05:31.md` のように元ファイル名を保つ。
2. **当日の Scrap（`YYYY-MM-DD.md` が今日のローカル日付と一致）**:
   - ファイルを **削除も移動もしない**。
   - 別の同期PCがタブを開いている場合、削除すると autosave で旧内容が復活する（resurrect）。
   - 代わりに **インプレースで上書き**し、1行だけ残す:
     ```text
     <!-- syki:absorbed YYYY-MM-DDTHH:mm:ss -->
     ```
3. **過去日付の Scrap（今日より前の `YYYY-MM-DD.md`）と全 Google Drive 競合コピー（`YYYY-MM-DD (*).md`）**:
   - アーカイブコピーを作成した **後** にルートから削除する。

---

## 4. Lint 手順（「wikiを点検して」/「Lint wiki」時）

定期的に Wiki 全体の健康状態を点検し、知識の劣化を防ぐ：
1. **孤立ノート（Orphan）の検出**: 他のノートから一度もリンクされていない `wiki/` ノートを発見し、関連ノートからの相互リンクを追加する。
2. **リンク切れの検出**: 存在しないファイルへの `[タイトル](./...)` を検出し修正する。
3. **知識の矛盾・陳腐化の検出**: 新しいノートの結論と矛盾している古い記述を指摘・統合する。
4. **INDEX.md の整合性**: `wiki/` に実在するノートが `INDEX.md` にすべて網羅されているか（かつ 150 行以内か）を確認・同期する。

---

## 5. 厳守事項（Guardrails）

- `scrap_dir` ルート直下にある `.md`（指令3ファイルを除く）以外は読まない・書かない。
- `wiki/` 内のファイル名変更・削除は行わない（追加・統合のみ）。
- `archive/` 内のファイルは読み取り専用（再吸収しない、検索除外済み）。
- 未吸収内容が無いときにファイルを書き換えることは禁止（no-op）。
- 日付・タイムスタンプは実行マシンの **ローカルタイム** を使う（UTC 変換しない）。
- 元 Scrap の原文はアーカイブで失わない。要約・削除は `wiki/` 側で行う。
- 出力は日本語（Scrap が英語の該当箇所は原文引用可）。

---

## 6. 最小テンプレート

新規 wiki ノート:

```markdown
<!-- tags: knowledge-compiler, sync -->
# Knowledge Compiler の設計

## 結論
...

## 具体例
...

## 決定
...

## 関連
- [マルチPC同期の制約](./2025-01-14-multi-pc-sync-constraints.md) — インプレースクリアの必要性は autosave の復活挙動から導かれた。
```

吸収済み当日 Scrap（インプレースクリア後）:

```text
<!-- syki:absorbed 2025-01-15T14:05:31 -->
```

---

## 7. 完了報告フォーマット

- 吸収件数 / 新設ノート / 統合ノート / アーカイブ件数 / 削除件数
- INDEX の行数（`<=150`）
- 保留した一時項目（wiki 非載入）の理由 1 行
