# v2 トークン台帳（P1a・P1b、2026-10-04）

`docs/design/v2-visual-2026-10.md` §7 の P1a（直書きの色をトークンへ寄せる。**見た目は変えない**）の成果物。P1b で紙（ライト）の値を入れる人が、このファイルを見ればどのトークンに何を入れるかが分かるようにする。P1a では「紙の値」の列は空だった。**P1b で埋めた（§6）**。「墨の値」「紙の値」の列は `tokens.css` から機械で埋めたもの（テーマで変わるトークンは Dark Olive のときの値。全アクセントは §6.4。「同じ」は両方の見た目で同じ値）。

## 1. 仕組み

- 色の定義はすべて **`frontend/css/tokens.css`**（`index.html` で `style.css` の前に読む。Go の `//go:embed frontend/*` と docshots の静的サーバは、フォルダごと配るので追加の登録は要らない）。
- 定義の置き場: `:root`（下地 `--canvas-bg` / `--canvas-fg`）、`body.dark-theme`（**墨**の値。全トークンの基準。`<body class="dark-theme theme-olive">` から外れない）、`body.theme-blue|olive|forest|charcoal`（アクセント 5 つ組と `--aura-gradient`、Blue だけ `--status-*`）、結果ブロックの帯（テーマごと）。P1b の `body.look-paper` は同じ名前に別の値を与える。**`var(--名前, 代わりの色)` の「代わりの色」は P1a で全部外した**（基準のブロックが常に名前を定義するので、効いていなかった）。基準のブロックを持たない見た目を作るときは、全トークンを定義すること。
- `style.css` に残る変数は寸法の `--panel-width` / `--panel-top` / `--panel-modal-top` だけ（`tests/panel_template_test.mjs` が見る）。`style.css`・`index.html` のインライン style・`frontend/js` の `style.` には色の直書きがない。`tests/css_tokens_test.mjs` が鍵を掛けている（許す例外は理由つきの許可リストに 1 行ずつ）。
- 命名: 面・文字・線は役割の名前（`--bg-*`、`--text-*`、`--border-*`、`--line-*`）。**意味が違うものは値が同じでも別のトークン**にした（例: `--text-active` は「中立の面の上の強調」、`--text-on-accent` は「アクセントの塗りの上の文字」。紙では前者が濃い墨、後者は白のまま）。薄膜は `--veil-NN`（白、NN は不透明度 %）と `--shade-NN`（黒）。状態の色は色相の名前（`--coral`、`--rose`、`--amber`、`--caution`、`--crimson`、`--ok-*`、`--fail-*`）に不透明度 % を付ける。影は値全体（`0 4px 16px rgba(...)`）を 1 つのトークンにした（紙では影の形も変えられる）。`url("data:...")` の山形アイコンも値全体。
- 見た目を変えない証明: (1) 置き換えのたびに「トークンの墨の値 = 元の直書きの値」を機械で確かめた。(2) 変更前後の `style.css` の全宣言 3181 件を、5 つのテーマ（既定・olive・blue・forest・charcoal）それぞれで `var()` を解決して比べ、**差 0**。(3) docshots の英語 69 枚が画素一致（`tools/docshots/compare_dirs.py`）。

## 2. トークン表

「使用数」は `var(--名前)` の数（`style.css`、`index.html`、`frontend/js`）。P1a の時点で 180 トークン、879 参照（`style.css` の中は 747）。P1b で 51 トークンを足して、**全部で 231 トークン**（足した分の「使用数」は、他の段が使う名前を先に作ったので 0 が多い）。

### 下地（`:root`）とカーソルのオーラ

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--canvas-bg` | `<html>` と `<body>` の下地（描画の前から効く。`style.css` の `html, body`） | `#0e0f17` | 1 | `#fbfbf9` |
| `--canvas-fg` | 下地の文字色 | `#dcdde3` | 1 | `#16171b` |
| `--aura-gradient` | カーソルのオーラ（放射状のグラデーション。アクセントごと。以前は app.js が計算していた） 〔テーマごとに値が違う〕 | `radial-gradient(circle, rgba(138, 154, 91, 0.15) 0%, rgba(85, 107, ...` | 1 | `radial-gradient(circle, rgba(85, 107, 47, 0.14) 0%, rgba(85, 107, 4...` |

### 面・文字・線（P1a より前からあったトークン）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--panel-shadow` | 浮かぶパネル（ask・rewrite・コマンド・検索・パレット・ポップオーバー）の影 | `0 8px 24px rgba(0, 0, 0, 0.55)` | 8 | `0 8px 28px rgba(20, 22, 30, 0.16), 0 1px 3px rgba(20, 22, 30, 0.1)` |
| `--panel-line` | パネル内の区切り線 | `rgba(255, 255, 255, 0.08)` | 19 | `rgba(22, 23, 27, 0.09)` |
| `--bg-main` | ウィンドウの主な面 | `#0e0f17` | 3 | `#fbfbf9` |
| `--bg-header` | ヘッダーとタブ帯（ヘッダー自身の面は P2b から `--bar-top-rgb` に `--bar-a` を掛けた色。残る使用は他の 2 か所） | `#12141e` | 2 | `#e6e6e1` |
| `--bg-tab` | 非選択のタブ | `#191c29` | 1 | `#ecece7` |
| `--bg-tab-active` | 選択中のタブ | `#0e0f17` | 2 | `#fbfbf9` |
| `--bg-tab-hover` | ホバー中のタブ | `#212435` | 2 | `#f3f3ef` |
| `--bg-editor` | エディタの面 | `#0e0f17` | 6 | `#fbfbf9` |
| `--bg-line-num` | （使われなくなった）行番号のガター。P2b で行番号は余白に直接置かれ、面を持たない。トークンは残してある | `#0e0f17` | 0 | `#fbfbf9` |
| `--bg-modal` | モーダル・パネル・ポップオーバー・メニューの面 | `#181a26` | 15 | `#ffffff` |
| `--bg-input` | 入力欄 | `#1f2230` | 14 | `#f2f2ee` |
| `--bg-btn` | 副ボタン | `#232637` | 10 | `#eeeee9` |
| `--bg-btn-hover` | 副ボタンのホバー | `#2f3348` | 9 | `#e4e4de` |
| `--bg-context` | コンテキストメニューの面 | `#181a26` | 1 | `#ffffff` |
| `--bg-statusbar` | ステータスバーの色の元（アクセントのテーマごと）。P2b から CSS は `--bar-bottom-rgb`（同じ色のチャンネル）に `--bar-a` を掛けて使う。値の一致はテストで縛る 〔上書き: blue, charcoal, forest, olive〕 | `#3b442b` | 0 | `#ecece7` |
| `--bg-context-hover` | メニュー項目のホバー（アクセントのテーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#424e30` | 5 | `#e8eed9` |
| `--accent-color` | アクセントの塗り（主ボタン、印、枠。テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#556b2f` | 74 | 同じ |
| `--accent-hover` | 明るいほうのアクセント（枠、リング、リンク。テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#6b843d` | 47 | `#46592a` |
| `--accent-label` | 文字としてのアクセント（見出しラベル、バッジ。テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#a6c26a` | 15 | `#3f5226` |
| `--accent-active-bg` | 選択・有効の行やボタンの塗り（テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#424e30` | 22 | `#dfe7cc` |
| `--bg-preview` | Markdown プレビューの色付きの面（テーマごと）。**P4 から CSS は使わない**（プレビューは `--sheet` の紙）。定義は残してある 〔上書き: blue, charcoal, forest, olive〕 | `#1e2227` | 0 | `#fafbf6` |
| `--text-main` | 本文の文字 | `#dcdde3` | 81 | `#16171b` |
| `--text-muted` | 補助の文字 | `#8b8d99` | 115 | `#62636b` |
| `--text-active` | 中立の面の上の強調・ホバー・選択の文字 | `#ffffff` | 49 | `#0b0c10` |
| `--border-color` | 通常の枠線 | `rgba(255, 255, 255, 0.1)` | 96 | `rgba(22, 23, 27, 0.14)` |

### 結果ブロックの帯

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--result-open` | 結果ブロックの帯: 開く行（テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#7fd14a` | 1 | `#3f9a22` |
| `--result-body` | 結果ブロックの帯: 結果の行（テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#a9cf8b` | 1 | `#55993a` |
| `--result-close` | 結果ブロックの帯: 閉じる行（テーマごと） 〔上書き: blue, charcoal, forest, olive〕 | `#45772d` | 1 | `#2e6b1d` |

### 文字

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--text-on-accent` | アクセントの塗りの上の文字（主ボタン、実行ボタン、ambient ピルのホバー） | `#ffffff` | 5 | 同じ |
| `--text-on-danger` | 破壊的な赤の上の文字（タブを閉じるホバー） | `#ffffff` | 1 | 同じ |
| `--text-on-statusbar` | ステータスバーの上の文字とフォーカスの輪（バーは全テーマでアクセント色） | `#ffffff` | 3 | `#33343a` |
| `--text-soft` | 小さな件数・チップの文字 | `#c0c2cd` | 3 | `#44454c` |
| `--text-editor` | 2 つのエディタに打つ文字 | `#e2e3e8` | 2 | `#16171b` |
| `--text-placeholder` | 入力欄のプレースホルダ | `#7d7f8e` | 5 | `#6f7079` |
| `--text-badge` | PREVIEW バッジの文字（アクセントの塗りの上） | `#ffffff` | 1 | 同じ |
| `--text-key` | 設定のショートカット表のキー表記 | `#aeb0bd` | 1 | `#55565e` |
| `--text-key-empty` | 設定のショートカット表の未割り当てのキー表記 | `#70727f` | 1 | `#85868e` |
| `--text-ambient` | ambient ピルの文字 | `#c5d4bc` | 1 | `#4a5a3a` |
| `--text-dim` | プレビューの読み込み中の文字（app.js が書く） | `#7d7f8d` | 1 | `#7a7b84` |
| `--text-code-preview` | コマンドバーの実行内容プレビューの文字 | `#9cdcfe` | 1 | `#1f5f8b` |
| `--text-error` | 落ち着いた赤の文字（エラー、一覧の警告。CSS に名前だけあって未定義だった） | `#cca0a5` | 4 | `#a6414c` |
| `--text-error-hover` | 落ち着いた赤の文字のホバー（タスクの取消） | `#e5b2b7` | 1 | `#8a2f3a` |
| `--text-ok` | 成功の文字（app.js が書く。Git 接続テストなど） | `#73c991` | 2 | `#1d7a44` |
| `--text-warn-orange` | コマンドバーのバッジの警告の文字（app.js） | `#f0ad4e` | 2 | `#9a5b00` |
| `--text-danger-badge` | コマンドバーのバッジの危険の文字（app.js） | `#f26d6a` | 1 | `#b3261e` |
| `--text-danger-hint` | フォームのヒントの危険の文字（app.js、「Git が無い」帯） | `#ff6b6b` | 3 | `#b3261e` |
| `--text-recipe-tag` | Quick Actions 一覧の [RECIPE] 印（slot_agent.js） | `#e5c07b` | 1 | `#8a5a00` |

### Markdown プレビュー

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--md-heading` | プレビューの h2〜h6 の見出し | `#569cd6` | 1 | `#1f5f9f` |
| `--md-h1` | プレビューの h1 の見出し | `#4ec9b0` | 1 | `#0b7a68` |
| `--md-quote` | 引用ブロックの文字 | `#9cdcfe` | 1 | `#35566e` |
| `--md-th` | 表の見出し行の文字 | `#9cdcfe` | 1 | `#1f5f8b` |
| `--md-code` | インラインコードの文字 | `#ce9178` | 1 | `#9a3f1c` |
| `--bg-md-block` | 引用ブロックとコードブロックの面 | `#13151e` | 2 | `#f4f4f0` |
| `--bg-md-stripe` | 表の偶数行の縞 | `#151822` | 1 | `#f7f7f3` |
| `--bg-md-inline` | インラインコードの面 | `#11131b` | 1 | `#eeeeea` |
| `--bg-md-th` | 表の見出し行の面 | `#1a1d2a` | 1 | `#eeeeea` |
| `--bg-html-page` | プレビューに出す HTML ページの紙（常に白） | `#ffffff` | 6 | 同じ |
| `--bg-mermaid-light` | 明るい調子で描く図のカードの面 | `#ffffff` | 1 | 同じ |
| `--border-mermaid-light` | そのカードの枠 | `#d0d7de` | 1 | 同じ |
| `--text-mermaid-light` | そのカードの文字 | `#24292f` | 1 | 同じ |

### 面

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--bg-icon-hover` | ヘッダーのアイコンボタンのホバー | `#1d2030` | 1 | `#d9d9d3` |
| `--bg-hover-subtle` | 検索バー・コマンドバー・ショートカットキーの小ボタンのホバー | `#232637` | 4 | `#ebebe6` |
| `--bg-field` | パネルに沈んだ入力欄（検索の入力、コマンドのプレビュー） | `#0e0f17` | 2 | `#f3f3ef` |
| `--bg-table` | ショートカット表の外枠と見出しセル | `#0e0f17` | 2 | `#fafaf8` |
| `--bg-table-head` | ショートカット表の見出しとカテゴリ行 | `#181a26` | 2 | `#f1f1ed` |
| `--bg-key` | ショートカット表のキーのボタン（通常とホバー） | `#1f2230` | 2 | `#f1f1ed` |
| `--bg-btn-action` | 検索バーの実行ボタン | `#262a3b` | 1 | `#ecece7` |
| `--bg-btn-action-hover` | 検索バーの実行ボタンのホバー | `#313649` | 1 | `#e1e1db` |
| `--bg-print-stage` | 印刷プレビューの背後の灰色の台 | `#1b1d29` | 1 | `#d4d4ce` |
| `--bg-scrim` | モーダルの背後の暗幕 | `rgba(0, 0, 0, 0.6)` | 1 | `rgba(22, 23, 27, 0.26)` |
| `--bg-danger-solid` | 破壊的な赤のベタ（タブを閉じるホバー） | `#c72e2e` | 1 | 同じ |
| `--bg-qr` | QR コードを描くカード（常に白） | `#ffffff` | 1 | 同じ |
| `--icon-knob-fill` | 設定アイコンのつまみの抜き | `#0e0f17` | 1 | `#fbfbf9` |

### 線・輪郭・リング

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--line-row` | 一覧の行と行の区切り | `rgba(255, 255, 255, 0.06)` | 6 | `rgba(22, 23, 27, 0.07)` |
| `--border-input` | 入力欄・キーボタン・ホバー中のヘッダーアイコンの枠 | `rgba(255, 255, 255, 0.14)` | 3 | `rgba(22, 23, 27, 0.26)` |
| `--border-button` | 枠だけのボタンの枠 | `rgba(255, 255, 255, 0.22)` | 5 | `rgba(22, 23, 27, 0.28)` |
| `--border-btn-action` | 検索バーの実行ボタンの枠 | `rgba(255, 255, 255, 0.16)` | 1 | `rgba(22, 23, 27, 0.22)` |
| `--outline-pane-focus` | 分割表示でフォーカスのあるペインの輪郭。**P4 から使わない**（上端の `--pane-focus` の線に置き換えた） | `rgba(0, 122, 204, 0.4)` | 0 | `rgba(0, 105, 176, 0.45)` |
| `--ring-focus-input` | 設定の入力欄のフォーカスリング | `rgb(var(--accent-rgb) / 0.35)` | 1 | `rgb(var(--accent-rgb) / 0.3)` |

### スイッチ

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--switch-track` | スイッチの溝 | `#3a3e52` | 3 | `#b4b4ad` |
| `--switch-thumb` | オフのスイッチのつまみ | `#dcdde3` | 3 | `#ffffff` |
| `--switch-thumb-on` | オンのスイッチのつまみ | `#ffffff` | 3 | 同じ |

### 影（値全体をトークンにした）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--shadow-menu` | コンテキストメニューの影（値全体） | `0 4px 16px rgba(0, 0, 0, 0.6)` | 1 | `0 6px 20px rgba(20, 22, 30, 0.16), 0 1px 3px rgba(20, 22, 30, 0.1)` |
| `--shadow-modal` | モーダルのカードの影（値全体） | `0 8px 24px rgba(0, 0, 0, 0.6)` | 1 | `0 12px 36px rgba(20, 22, 30, 0.2), 0 2px 6px rgba(20, 22, 30, 0.1)` |
| `--shadow-bar` | 検索・置換バーの影（値全体） | `0 4px 14px rgba(0, 0, 0, 0.6)` | 1 | `0 4px 16px rgba(20, 22, 30, 0.14), 0 1px 2px rgba(20, 22, 30, 0.1)` |
| `--shadow-popover` | Quick Actions セレクタの影（値全体）。**P5 から使われない**（セレクタは付箋になった。定義は残してある） | `0 8px 24px rgba(0, 0, 0, 0.55)` | 0 | `0 8px 28px rgba(20, 22, 30, 0.18), 0 1px 3px rgba(20, 22, 30, 0.1)` |
| `--shadow-button` | Quick Actions の実行ボタンの影（値全体） | `0 2px 8px rgba(0, 0, 0, 0.4)` | 1 | `0 2px 6px rgba(20, 22, 30, 0.18)` |
| `--shadow-tasks` | 実行中タスクのパネルの影（値全体） | `0 10px 30px rgba(0, 0, 0, 0.5)` | 1 | `0 10px 30px rgba(20, 22, 30, 0.18)` |
| `--shadow-tooltip` | 画像リンクのツールチップの影（file_anchor.js、値全体） | `0 4px 16px rgba(0, 0, 0, 0.35)` | 1 | `0 4px 14px rgba(20, 22, 30, 0.18)` |
| `--shadow-indicator` | 音声入力インジケータの影（voice_input.js、値全体） | `0 2px 8px rgba(0, 0, 0, 0.3)` | 1 | `0 2px 8px rgba(20, 22, 30, 0.16)` |

### 中立の薄膜（白 = veil、黒 = shade。数字は不透明度 %）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--veil-03` | 白の薄膜: 行のホバー、ごく薄いカードの塗り | `rgba(255, 255, 255, 0.03)` | 4 | `rgba(22, 23, 27, 0.025)` |
| `--veil-04` | 白の薄膜: 静かなカードの塗り | `rgba(255, 255, 255, 0.04)` | 3 | `rgba(22, 23, 27, 0.035)` |
| `--veil-05` | 白の薄膜: 表のかすかな罫線、弱いバッジの塗り | `rgba(255, 255, 255, 0.05)` | 3 | `rgba(22, 23, 27, 0.045)` |
| `--veil-06` | 白の薄膜: 枠だけのボタンのホバー | `rgba(255, 255, 255, 0.06)` | 3 | `rgba(22, 23, 27, 0.055)` |
| `--veil-07` | 白の薄膜: チップ・淡いボタンの塗り | `rgba(255, 255, 255, 0.07)` | 7 | `rgba(22, 23, 27, 0.06)` |
| `--veil-08` | 白の薄膜: ambient ピルの塗り、小さなバッジの塗り | `rgba(255, 255, 255, 0.08)` | 3 | `rgba(22, 23, 27, 0.07)` |
| `--veil-10` | 白の薄膜: キーの印字・待機バッジの塗り | `rgba(255, 255, 255, 0.1)` | 5 | `rgba(22, 23, 27, 0.08)` |
| `--veil-12` | 白の薄膜: 淡いボタンのホバー | `rgba(255, 255, 255, 0.12)` | 2 | `rgba(22, 23, 27, 0.1)` |
| `--veil-15` | 白の薄膜: 選択件数の塗り、ambient ピルの枠 | `rgba(255, 255, 255, 0.15)` | 2 | `rgba(22, 23, 27, 0.12)` |
| `--veil-25` | 白の薄膜: CLI スピナーの輪 | `rgba(255, 255, 255, 0.25)` | 1 | `rgba(22, 23, 27, 0.18)` |
| `--veil-30` | 白の薄膜: スピナーの輪 | `rgba(255, 255, 255, 0.3)` | 1 | `rgba(22, 23, 27, 0.22)` |
| `--veil-45` | 白の薄膜: 録音ピルの中の区切り | `rgba(255, 255, 255, 0.45)` | 1 | `rgba(22, 23, 27, 0.35)` |
| `--shade-25` | 黒の陰: ステータスバーのバッジの下の板 | `rgba(0, 0, 0, 0.25)` | 1 | `rgba(22, 23, 27, 0.07)` |
| `--shade-30` | 黒の陰: 設定の進捗バーの溝 | `rgba(0, 0, 0, 0.3)` | 1 | `rgba(22, 23, 27, 0.1)` |
| `--shade-35` | 黒の陰: 無効なバッジのホバーの板 | `rgba(0, 0, 0, 0.35)` | 1 | `rgba(22, 23, 27, 0.12)` |
| `--shade-40` | 黒の陰: タスクのピルのホバーの板 | `rgba(0, 0, 0, 0.4)` | 1 | `rgba(22, 23, 27, 0.12)` |
| `--shade-45` | 黒の陰: バッジのホバーの板 | `rgba(0, 0, 0, 0.45)` | 1 | `rgba(22, 23, 27, 0.11)` |
| `--shade-55` | 黒の陰: 印刷の状態表示の下地 | `rgba(0, 0, 0, 0.55)` | 1 | `rgba(255, 255, 255, 0.88)` |

### 状態の色（色相の名前 + 不透明度 %）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--coral` | 暗い面の上のエラー文字（衝突印、KaTeX エラー、印刷エラー、Mermaid エラー、Git テストの失敗） | `#f48771` | 7 | `#b3261e` |
| `--coral-12` | KaTeX エラーの背後の淡い塗り | `rgba(244, 135, 113, 0.12)` | 1 | `rgba(179, 38, 30, 0.1)` |
| `--coral-50` | 印刷エラーの枠 | `rgba(244, 135, 113, 0.5)` | 1 | `rgba(179, 38, 30, 0.45)` |
| `--rose` | 失敗の文字（QR トンネル、パッケージのエラー） | `#e8777f` | 4 | `#b4373f` |
| `--rose-10` | バラ色の淡い塗り 10%（取消ボタン、パッケージのエラー枠） | `rgba(224, 108, 117, 0.1)` | 2 | `rgba(180, 55, 63, 0.08)` |
| `--rose-12` | バラ色の淡い塗り 12%（学びバナーのエラー） | `rgba(224, 108, 117, 0.12)` | 1 | `rgba(180, 55, 63, 0.1)` |
| `--rose-20` | バラ色の淡い塗り 20%（取消ボタンのホバー） | `rgba(224, 108, 117, 0.2)` | 1 | `rgba(180, 55, 63, 0.16)` |
| `--rose-25` | バラ色の枠 25%（取消ボタン） | `rgba(224, 108, 117, 0.25)` | 1 | `rgba(180, 55, 63, 0.25)` |
| `--rose-45` | バラ色の枠 45%（学びバナーのエラー、取消ホバー、パッケージのエラー） | `rgba(224, 108, 117, 0.45)` | 3 | `rgba(180, 55, 63, 0.45)` |
| `--red-12` | エラーの箱の塗り（AI の状態、ask バー） | `rgba(226, 75, 74, 0.12)` | 2 | `rgba(200, 40, 40, 0.1)` |
| `--red-50` | エラーの箱の枠 | `rgba(226, 75, 74, 0.5)` | 2 | `rgba(200, 40, 40, 0.45)` |
| `--crimson-38` | 録音ピルの板 | `rgba(229, 72, 77, 0.38)` | 1 | `rgba(211, 53, 58, 0.2)` |
| `--crimson-60` | 録音ピルの板（ホバー） | `rgba(229, 72, 77, 0.6)` | 1 | `rgba(211, 53, 58, 0.3)` |
| `--rec-dot` | 録音の赤い点 | `#ff5a5f` | 1 | `#d3353a` |
| `--amber` | ghost diff の琥珀の棒 | `#f59e0b` | 3 | `#d97706` |
| `--amber-12` | 注意の箱の塗り（要設定、学びバナー、同意） | `rgba(245, 158, 11, 0.12)` | 4 | `rgba(217, 119, 6, 0.1)` |
| `--amber-15` | ghost diff の光（終盤） | `rgba(245, 158, 11, 0.15)` | 1 | `rgba(217, 119, 6, 0.12)` |
| `--amber-18` | ghost diff の背景（60%） | `rgba(245, 158, 11, 0.18)` | 1 | `rgba(217, 119, 6, 0.16)` |
| `--amber-25` | ghost diff の光（開始） | `rgba(245, 158, 11, 0.25)` | 1 | `rgba(217, 119, 6, 0.22)` |
| `--amber-28` | ghost diff の背景（開始） | `rgba(245, 158, 11, 0.28)` | 1 | `rgba(217, 119, 6, 0.24)` |
| `--amber-40` | 注意の箱の枠 | `rgba(245, 158, 11, 0.4)` | 4 | `rgba(217, 119, 6, 0.35)` |
| `--caution` | 金色の注意（パッケージの警告、取消したタスクの文字と線） | `#c5a059` | 5 | `#7d5f1a` |
| `--caution-10` | 金色の淡い塗り 10%（パッケージの注意の箱） | `rgba(197, 160, 89, 0.1)` | 1 | `rgba(125, 95, 26, 0.1)` |
| `--caution-12` | 金色の淡い塗り 12%（パッケージの警告タグ） | `rgba(197, 160, 89, 0.12)` | 1 | `rgba(125, 95, 26, 0.12)` |
| `--caution-15` | 金色の淡い塗り 15%（取消したタスクのピル） | `rgba(197, 160, 89, 0.15)` | 1 | `rgba(125, 95, 26, 0.14)` |
| `--caution-45` | 金色の枠 45%（パッケージの注意の箱） | `rgba(197, 160, 89, 0.45)` | 1 | `rgba(125, 95, 26, 0.45)` |
| `--caution-50` | 金色の枠 50%（パッケージの警告タグ） | `rgba(197, 160, 89, 0.5)` | 1 | `rgba(125, 95, 26, 0.5)` |
| `--ok-line` | 完了したタスクの左の線 | `#6a9955` | 1 | `#3f8a3a` |
| `--ok-bg` | 完了したタスクのピルの塗り | `rgba(106, 153, 85, 0.15)` | 1 | `rgba(63, 138, 58, 0.12)` |
| `--ok-text` | 完了したタスクの文字、パッケージの OK アイコン | `#8ecf9e` | 2 | `#1f6b2f` |
| `--fail-line` | 失敗したタスクの左の線 | `#b86067` | 1 | `#b4414a` |
| `--fail-bg` | 失敗したタスクのピルの塗り | `rgba(184, 96, 103, 0.15)` | 1 | `rgba(180, 65, 74, 0.1)` |
| `--fail-text` | 失敗したタスクの文字 | `#cf8489` | 1 | `#9a2f3a` |
| `--cloud-mark` | クラウド送信の印（文字と左の線）。紙の値は P5 で `#a05f00` から `#985a00` に深くした（付箋の紙の上で 4.5:1 に届かなかった） | `#e8b04a` | 3 | `#985a00` |
| `--dirty-dot` | タブの未保存の点 | `#e2c08d` | 1 | `#a8650a` |
| `--salmon` | About ダイアログのエラー文字 | `#f28b82` | 2 | `#b3261e` |
| `--key-rec-border` | 記録中のショートカットキー: 枠 | `#e51400` | 1 | `#d12a1a` |
| `--key-rec-bg` | 記録中のショートカットキー: 塗り | `rgba(229, 20, 0, 0.15)` | 1 | `rgba(209, 42, 26, 0.1)` |
| `--key-rec-text` | 記録中のショートカットキー: 文字 | `#ff8888` | 1 | `#b3261e` |
| `--jump-link` | エディタ・VS Code へ飛ぶリンク | `#4ec9b0` | 1 | `#0b7a68` |
| `--jump-link-hover` | そのリンクのホバー | `#9cdcfe` | 1 | `#1f5f8b` |
| `--jump-link-bg` | そのリンクのホバーの塗り | `rgba(78, 201, 176, 0.15)` | 1 | `rgba(11, 122, 104, 0.12)` |
| `--flash-yellow-65` | スクラップの行のフラッシュ: 開始 | `rgba(255, 235, 59, 0.65)` | 1 | `rgba(250, 204, 21, 0.55)` |
| `--flash-yellow-50` | スクラップの行のフラッシュ: 光 | `rgba(255, 235, 59, 0.5)` | 1 | `rgba(250, 204, 21, 0.42)` |
| `--flash-yellow-35` | スクラップの行のフラッシュ: 終盤 | `rgba(255, 235, 59, 0.35)` | 1 | `rgba(250, 204, 21, 0.28)` |
| `--semantic-ok-line` | 意味検索の設定: OK の線 | `#6ab07f` | 1 | `#2f7d4a` |
| `--semantic-warn-line` | 意味検索の設定: 警告の線 | `#d9a441` | 1 | `#a8741a` |
| `--semantic-ok-text` | 意味検索の設定: OK の文字 | `#c8f0d4` | 1 | `#1d5f36` |
| `--semantic-warn-text` | 意味検索の設定: 警告の文字 | `#e0b050` | 1 | `#7a5200` |
| `--status-ok` | ステータスバーの OK（Blue テーマは明るいバーのため上書き） 〔上書き: blue〕 | `#73c991` | 1 | `#1a6f3d` |
| `--status-warn` | ステータスバーの警告（Blue テーマが上書き） 〔上書き: blue〕 | `#e2c08d` | 2 | `#7d5200` |
| `--status-error` | ステータスバーのエラー（Blue テーマが上書き） 〔上書き: blue〕 | `#f48771` | 2 | `#a8231b` |

### 設定のバッジ・帯、音声入力

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--text-idle` | 設定の待機バッジの文字（Ollama、SendTo） | `#aaaaaa` | 2 | `#62636b` |
| `--badge-ok-bg` | ステータスバッジ「動作中」の塗り（Ollama） | `rgba(46, 204, 113, 0.2)` | 1 | `rgba(26, 127, 70, 0.14)` |
| `--badge-ok-text` | ステータスバッジ「動作中」の文字（Ollama） | `#2ecc71` | 1 | `#176b3c` |
| `--badge-danger-bg` | ステータスバッジ「停止」の塗り（Ollama） | `rgba(231, 76, 60, 0.2)` | 2 | `rgba(179, 38, 30, 0.12)` |
| `--badge-danger-text` | ステータスバッジ「停止」の文字（Ollama） | `#f5705f` | 2 | `#b3261e` |
| `--badge-busy-text` | ステータスバッジ「確認中・起動中」の文字（Ollama） | `#f1c40f` | 1 | `#8a6500` |
| `--badge-git-warn-bg` | Git バッジ「リポジトリではない」の塗り | `rgba(255, 193, 7, 0.15)` | 1 | `rgba(180, 130, 0, 0.14)` |
| `--badge-git-warn-text` | Git バッジ「リポジトリではない」の文字 | `#ffc107` | 1 | `#8a6500` |
| `--badge-git-ok-bg` | Git バッジ「リモートにつながっている」の塗り | `rgba(40, 167, 69, 0.15)` | 1 | `rgba(30, 126, 52, 0.12)` |
| `--badge-git-ok-text` | Git バッジ「リモートにつながっている」の文字 | `#3fbf5c` | 1 | `#1b6f2f` |
| `--badge-git-idle-bg` | Git バッジ「リモートなし」の塗り | `rgba(108, 117, 125, 0.15)` | 1 | `rgba(90, 97, 105, 0.12)` |
| `--badge-git-idle-text` | Git バッジ「リモートなし」の文字 | `#adb5bd` | 1 | `#5a6169` |
| `--danger-banner-bg` | 設定の「Git が入っていない」帯の塗り | `rgba(220, 53, 69, 0.12)` | 1 | `rgba(200, 40, 50, 0.08)` |
| `--danger-banner-border` | 設定の「Git が入っていない」帯の枠 | `rgba(220, 53, 69, 0.3)` | 1 | `rgba(200, 40, 50, 0.3)` |
| `--crimson` | 音声入力インジケータの録音の赤 | `#e5484d` | 2 | `#d3353a` |
| `--crimson-16` | 音声入力インジケータの停止ボタンのホバー | `rgba(229, 72, 77, 0.16)` | 1 | `rgba(211, 53, 58, 0.12)` |

### アイコン

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--icon-select-chevron` | 設定の選択ボックスの山形（線の色は補助の文字色。url() 全体） | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' v...` | 1 | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' v...` |

### P1b で足したトークン

### v2 の面・文字・線（設計書 §4.1。P1b で追加）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--wall` | 机（プレビューの余白、タブの下地）。ページの後ろ | `#06070a` | 2 | `#e6e6e1` |
| `--page` | 編集ページ（`--bg-editor` と同じ色） | `#0e0f17` | 0 | `#fbfbf9` |
| `--sheet` | プレビューの紙、付箋の下地（`--bg-modal` と同じ色） | `#181a26` | 2 | `#ffffff` |
| `--ink` | 本文の文字（`--text-main` と同じ色） | `#dcdde3` | 0 | `#16171b` |
| `--ink-2` | 補助の文字（`--text-muted` と同じ色） | `#8b8d99` | 0 | `#62636b` |
| `--hair` | 薄い罫線（ヘッダーとフッターの境など。文字色の 7〜9%） | `rgba(255, 255, 255, 0.07)` | 1 | `rgb(var(--ink-rgb) / 0.09)` |
| `--shade` | 影の色（`--shade-rgb` のチャンネル） | `rgb(var(--shade-rgb) / 0.5)` | 0 | `rgb(var(--shade-rgb) / 0.1)` |

### チャンネルのトークン（`color-mix()` の代わり。`rgb(var(--accent-rgb) / 0.14)` の形で使う）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--ink-rgb` | `--ink` のチャンネル | `220 221 227` | 0 | `22 23 27` |
| `--shade-rgb` | 影の色のチャンネル（墨は黒、紙は 20 22 30） | `0 0 0` | 0 | `20 22 30` |
| `--page-rgb` | `--page` のチャンネル | `14 15 23` | 1 | `251 251 249` |
| `--sheet-rgb` | `--sheet` のチャンネル | `24 26 38` | 1 | `255 255 255` |
| `--wall-rgb` | `--wall` のチャンネル | `6 7 10` | 0 | `230 230 225` |
| `--bar-top-rgb` | `--bg-header` のチャンネル（P2 の上のバー） | `18 20 30` | 0 | `230 230 225` |
| `--bar-bottom-rgb` | `--bg-statusbar` のチャンネル（P2 の下のバー。墨はアクセントごと、紙は中立。自分で選ぶ色のときは JS が置く） | `59 68 43` | 0 | `236 236 231` |
| `--text-muted-rgb` | `--text-muted` のチャンネル（行番号の色 = このチャンネル + `--linenum-a`） | `139 141 153` | 1 | `98 99 107` |
| `--linenum-a` | 行番号の濃さ（アルファ）。`opacity` ではなく色のアルファ（8 万行の巨大な要素に中間の描画面を作らないため）。Zen では `chrome.css` が 0.3（マウスを載せると 0.8）に上書き。ページに対して 3:1 を `look_contrast_test` が縛る | `0.68` | 1 | `0.74` |
| `--accent-rgb` | アクセントのチャンネル（墨は `--accent-hover`、紙は `--accent-color` の色。テーマごと。自分で選ぶ色のときは JS が置く） | `107 132 61` | 0 | `85 107 47` |

### タブ（P3）の色。値は別のトークンへの別名

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--tab-accent` | タブの塗り（`rgb(var(--accent-rgb))`） | `rgb(var(--accent-rgb))` | 0 | 同じ |
| `--tab-base` | 塗りの下の中間色（`--wall`） | `var(--wall)` | 0 | 同じ |
| `--tab-ink` | 選択中でないタブの名前（`--ink`。P3a で `--ink-2` から変えた: `--ink-2` は塗り 44% 以上の上で 4.5:1 に届かない） | `var(--ink)` | 0 | 同じ |
| `--tab-ink-hi` | 選択中のタブ（塗り 100%）の上の名前。Olive・Blue・Vermilion の墨は塗りが明るいので `var(--wall)`（4.8:1 以上）、Forest・Charcoal の墨と紙の全部は `var(--text-on-accent)`（白）。自分で選ぶ色の墨は `appearance.js` が塗り（`--accent-rgb`）に対して白／黒を選んで置く | `var(--text-on-accent)`（3 つのアクセントは `var(--wall)`） | 0 | `var(--text-on-accent)` |
| `--tab-hair` | 1px の仕切り（`--hair`） | `var(--hair)` | 0 | 同じ |
| `--tab-dirty` | 未保存の印（`--dirty-dot`） | `var(--dirty-dot)` | 0 | 同じ |
| `--tab-conflict` | 競合の印（`--coral`） | `var(--coral)` | 0 | 同じ |
| `--tab-close-hover-bg` | 閉じるのホバー（`--bg-danger-solid`） | `var(--bg-danger-solid)` | 0 | 同じ |
| `--focus-ring` | キーボードのフォーカスの輪（墨は `--accent-label`、紙は `--accent-hover`） | `var(--accent-label)` | 0 | `var(--accent-hover)` |

### 分割・プレビューの紙・付箋（P4・P5）の色。P1b で値を先に用意し、P4 と P5 が使い始めた（P5 の変更は §6.13）

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--gutter-shade` | ノドの影（`--shade` を 0 → 中央 → 0） | `linear-gradient(to right, transparent, var(--shade), tran...` | 1 | 同じ |
| `--gutter-dot` | ノドのドット | `rgb(var(--ink-rgb) / 0.14)` | 1 | `rgb(var(--ink-rgb) / 0.18)` |
| `--sheet-shadow` | プレビューの紙の影 | `0 0 18px rgb(var(--shade-rgb) / 0.35), 0 2px 6px rgb(var(...` | 2 | `0 0 18px rgb(var(--shade-rgb) / 0.12), 0 2px 6px rgb(var(...` |
| `--pane-focus` | フォーカスのあるページの上端の線 | `rgb(var(--accent-rgb))` | 1 | 同じ |
| `--note-tint-a` | 付箋の薄いアクセントの濃さ（係数）。自分で選ぶ色が明るすぎるとき（墨）は `appearance.js` が薄くした値を `<body>` に置く | `0.12` | 0 | `0.1` |
| `--note-tint` | 付箋の薄いアクセント（`--accent-rgb` と `--note-tint-a`） | `rgb(var(--accent-rgb) / var(--note-tint-a))` | 2 | 同じ |
| `--note-tape` | 付箋の粘着帯（フォーカスが外にあるあいだ） | `rgb(var(--accent-rgb) / 0.35)` | 1 | 同じ |
| `--note-tape-focus` | フォーカス中の粘着帯（墨は `--accent-label`、紙は `--accent-color`） | `var(--accent-label)` | 1 | `var(--accent-color)` |
| `--note-flap` | 付箋の折り返し。墨は紙より**明るい**三角（暗い紙の上の暗い三角は見えない）、紙は暗い三角（P5 で墨を `--shade-rgb` から `--ink-rgb` に変えた） | `rgb(var(--ink-rgb) / 0.12)` | 1 | `rgb(var(--shade-rgb) / 0.14)` |
| `--note-shadow` | 付箋の持ち上がった影（紙は P5 で `0.14 / 0.12` から `0.2 / 0.18` に濃くした: 淡い紙の上で付箋が持ち上がって見えるように） | `0 1px 2px rgb(var(--shade-rgb) / 0.3), 0 10px 24px rgb(va...` | 1 | `0 1px 3px rgb(var(--shade-rgb) / 0.2), 0 12px 28px rgb(va...` |
| `--bg-scrim-note` | モーダルな付箋（パレット・検索・タグ・教訓）の背後の暗幕。ダイアログの `--bg-scrim` より薄い（P5） | `rgba(0, 0, 0, 0.32)` | 1 | `rgba(22, 23, 27, 0.14)` |
| `--gutter-w` | ノドの幅（P4。長さ。両方の見た目で同じ） | `24px` | 1 | 同じ |
| `--desk-margin` | 紙の左右の机の余白（P4。長さ） | `34px` | 5 | 同じ |
| `--sheet-max` | 紙の最大の幅（P4。長さ） | `800px` | 3 | 同じ |
| `--note-fold` | 付箋の折り目の大きさ（P5。長さ。折り返しの正方形・切り欠き・下の余白の帯） | `14px` | 5 | 同じ |

### 外観の設定（P1b）で使う色

| トークン | 役割 | 墨の値 | 使用数 | 紙の値 |
| --- | --- | --- | ---: | --- |
| `--aura-blend` | カーソルのオーラの混ぜ方（墨は screen、紙は multiply。値は色ではなく混合モード） | `screen` | 1 | `multiply` |
| `--preview-frame` | Markdown プレビューの枠。**P4 から使わない**（枠は無く、影と机が縁） | `var(--accent-hover)` | 0 | `rgb(var(--accent-rgb) / 0.45)` |
| `--bg-mermaid-dark` | 暗い調子で描く図のカードの面（どちらの見た目でも暗い。Mermaid にも渡す） | `#13151e` | 1 | `#20222e` |
| `--border-mermaid-dark` | そのカードの枠 | `rgba(255, 255, 255, 0.1)` | 1 | `#3a3d4d` |
| `--text-mermaid-dark` | そのカードの文字（Mermaid の textColor にも渡す） | `#dcdde3` | 1 | `#dcdde3` |
| `--mermaid-primary` | Mermaid の暗い調子の主色（ノードの色。見た目で変えない） | `#007acc` | 0 | 同じ |
| `--swatch-olive` | 設定の色見本: Dark Olive（見た目で変えない。以下の 5 つも同じ） | `#556b2f` | 1 | 同じ |
| `--swatch-blue` | 色見本: Classic Blue | `#0074c2` | 1 | 同じ |
| `--swatch-forest` | 色見本: Forest Teal | `#2e6656` | 1 | 同じ |
| `--swatch-charcoal` | 色見本: Charcoal Monochrome | `#505050` | 1 | 同じ |
| `--swatch-vermilion` | 色見本: 朱 | `#b8472c` | 1 | 同じ |
| `--swatch-custom` | 色見本: 自分で選ぶ色（虹色。選んだ色は JS が見本の要素の `--swatch-custom` に置く） | `conic-gradient(from 0deg, #d9534f, #e8b04a, #6abf69, #4aa...` | 1 | 同じ |

## 3. 未対応と理由

| 場所 | 内容 | 理由と、P1b 以降の扱い |
| --- | --- | --- |
| `index.html` の `<meta name="theme-color" content="#1e1e1e">` | 1 か所 | `<meta>` は `var()` を持てない。墨の下地と同じ値。テストはこの 1 つだけ許す。**P1b**: `appearance.js` が見た目を変えるときに `<meta name="color-scheme">`（dark / light）と `theme-color`（`--canvas-bg` の値）を書き換える。`<html>` の `look-paper` が下地を紙にする。meta の初期値は墨の下地（`#0e0f17`）。 |
| `frontend/js/mermaid_tone.js` の `themeVariables`（`#252526`、`#007acc`、`#d4d4d4` の 3 つ） | Mermaid の配色 | Mermaid が色を自分で解析する（明暗の派生色を計算する）ので `var()` を渡せない。墨の調子の設定そのもの。**P1b で直した**: 暗い調子の 3 色は、`--bg-mermaid-dark`・`--mermaid-primary`・`--text-mermaid-dark`（見た目で変わらない色ではなく、暗い調子のカードの色）を描画の直前に `getComputedStyle` で読んで渡す（`app.js` の `readMermaidPalette`）。許可リストの 3 行は消えた。ledger の最初の案（`--bg-modal`・`--accent-color`・`--text-main` を読む）は採らなかった: `--accent-color` を読むと墨の見た目が Blue 以外で変わり、`--bg-modal` は紙で明るくなって「暗い調子」が成り立たない。 |
| `frontend/js/app.js` の AI 画像プロンプトの文章（`#0b57d0` などの 6 か所） | 文章 | 画面の色ではなく、AI に渡す英語・日本語の指示文。許可リストに理由つきで載せた。 |
| `frontend/css/print.css`（16 か所） | 紙の印刷用の色 | 契約により触らない。印刷は紙の見た目のまま。 |
| `frontend/vendor/katex.min.css` | 第三者の CSS | 色の直書きなし（文字色を継承する）。触らない。 |
| Go 側: `quickcapture_windows.go`（ポップアップの COLORREF）、`quickcapture.go`（アクセント）、`window_windows.go` / `window_darwin.go`（描画前のウィンドウの下地 `#1e1e1e`） | ネイティブの色 | CSS ではない。P1b で紙の見た目を入れるとき、ネイティブのポップアップと WebView の下地が見た目に従うかを決める必要がある。**P1b では変えていない**（§6.7）。 |
| `pkg/dropzone` のスマホ用ページ、docshots 用のページ、ルートの `index.html` / `manual.html`（サイト） | 別の CSS | アプリの画面ではないので触っていない。 |
| `skills/md-memo/references/interfaces.md` の「`--result-open` ... は `style.css` にある」 | 説明文 | 定義は `tokens.css` に移った。文章はまだ古い（P1a の担当外）。 |
| `transparent`（64 行）、`currentColor`（既存 4 か所 + マスク用に新規 8 か所）、システム色のキーワード | 色の直書きではない | 契約どおり対象外。タブのフェードのマスク（`mask-image`）の `#000` は `currentColor` に直した（マスクはアルファしか見ない。画素一致で確認）。 |

## 4. 統合の提案（見た目を変えないため、P1a では統合していない）

P1b で紙の値を決めるときに、先に束ねると台帳が小さくなる。

- **灰色の面**（値が 1〜数段しか違わない）: `#1e1e1e`（`bg-main`・`bg-editor`・`bg-line-num`・`bg-tab-active`・`bg-field`・`bg-table`・`icon-knob-fill`・`canvas-bg`）、`#252526`（`bg-header`・`bg-modal`・`bg-context`・`bg-md-block`・`bg-md-stripe`・`bg-table-head`）、`#2d2d2d`（`bg-tab`・`bg-md-inline`・`bg-md-th`）、`#333333`（`bg-tab-hover`・`bg-btn`・`bg-hover-subtle`）。さらに近い `#2a2a2a`（`bg-key`）、`#2a2d2e`（`bg-icon-hover`）、`#2b2b2e`（`bg-print-stage`）、`#3a3d41`（`bg-btn-action`）、`#3c3c3c`（`bg-input`）、`#444444`、`#4a4d51` は 6 段ほどの灰色の階段にできる。
- **線**: `#3e3e42`（`border-color`）、`#333336`（`panel-line`）、`#2e2e31`（`line-row`）、`#3c3c3c`（`border-input`）、`#4a4a4e`（`border-button`・`switch-track`）、`#4a4d51`（`border-btn-action`）は 3 段（弱・通常・強）で足りる。
- **文字**: `#d4d4d4`（`text-main`）、`#e0e0e0`（`text-editor`）、`#c8c8c8`（`text-soft`）、`#b5b5b5`（`text-key`）、`#9d9d9d`（`text-muted`）、`#8f8f8f`（`text-placeholder`）、`#858585`（`text-dim`）、`#aaaaaa`（`text-idle`）、`#77777b`（`text-key-empty`）は「本文・補助・薄い」の 3 段にできる。`#f2f2f2`（`text-badge`）は `--text-on-accent`（白）に寄せられる。
- **薄膜**: `veil-03〜08`（6 段）は 3 段（04・07・12 あたり）に、`shade-25〜55`（6 段）は 3 段にできる。影 8 種（`shadow-*`、`panel-shadow`）は「メニュー・モーダル・浮かぶ小物」の 3 つにできる。
- **赤**（11 種類の近い赤）: `coral`（`#f48771`）・`salmon`（`#f28b82`）・`rose`（`#e06c75`）・`text-error`（`#cca0a5`）・`text-danger-badge`（`#f26d6a`）・`text-danger-hint`（`#ff6b6b`）・`badge-danger-text`（`#e74c3c`）・`bg-danger-solid`（`#c72e2e`）・`red-*`・`crimson`・`rec-dot`・`key-rec-*`。文字・淡い塗り・枠・ベタの 4 つ組に寄せられる。`status-error` / `coral` / `dirty-dot` / `status-warn` は、`status-*` が Blue テーマの明るいバーのために別値を持つ点だけが違う。
- **黄・琥珀**（10 種類）: `amber`・`cloud-mark`（`#e8b04a`）・`caution`（`#c5a059`）・`semantic-warn-*`・`dirty-dot` / `status-warn`（`#e2c08d`）・`text-warn-orange`・`badge-git-warn-*`・`badge-busy-text`・`text-recipe-tag`。
- **緑**（8 種類）: `ok-*`・`semantic-ok-*`・`status-ok`（`#73c991`）・`text-ok`（同じ値）・`badge-ok-*`・`badge-git-ok-*`・`jump-link`（青緑）。`status-ok` と `text-ok` は値が同じ（別の役割のまま残した）。
- **同じ値の見出し**: `md-quote`・`md-th`・`text-code-preview`・`jump-link-hover` は `#9cdcfe`、`md-h1`・`jump-link` は `#4ec9b0`。

## 5. P1b への引き継ぎ（気づいた点）

- `#preview-pane.html-mode` と、プレビューに出す HTML ページの `iframe`（`--bg-html-page`）、QR のカード（`--bg-qr`）、Mermaid の明るい調子のカード（`--bg-mermaid-light*`）は、**紙の見た目でも白のまま**にするための専用トークン。紙の値は墨と同じでよい。
- `--text-on-statusbar` は、ステータスバーが全テーマでアクセントの濃い色だから白。紙でバーが明るくなるなら値を変える。フォーカスの輪（`.clickable-badge:focus-visible`）も同じトークン。
- `html, body` の下地は、以前は `index.html` の `<style>` の `!important` だった。いまは `style.css` の先頭の同じ規則で、`--canvas-bg` / `--canvas-fg`（`:root`）を読む。`body.look-paper` で下地を変えるなら `:root` 側に `html.look-paper` などの出し方が必要（`body` のクラスは `:root` の変数を変えられない）。
- カーソルのオーラは `app.js` の関数が `config.general.theme` から作っていた。いまは `--aura-gradient`（テーマごと）を `var()` で読むだけ（`applyTheme()` が `body` のクラスを `config.general.theme` から作る唯一の場所なので、実際の画面では同じ色。クラスを手で付け替えたときだけ、以前は設定の値、いまはクラスの値に従う）。
- 設定アイコンのつまみ（`#btn-settings circle`）の塗りは、`index.html` の属性から `style.css` の規則（`--icon-knob-fill`）に移した。
- テストの追従: トークンの定義が `tokens.css` に移ったので、`style.css` の色を見ていた 7 つのテスト（`about_privacy`、`first_run_polish`、`first_run_welcome`、`panel_template`、`preview_frame`、`result_blocks_wiring`、`status_bar_a11y`）は `tests/lib/css_tokens_lib.mjs` の `withTokens()` を通して読む（トークンを墨の値に戻して見るので、元の主張「淡い塗り」「アクセントの上の白」が残る）。

## 6. P1b: 紙と墨の値、アクセント、「外観」の設定（2026-10-04）

契約 `docs/design/v2-implementation-contract.md` §7 の成果。P1a の台帳（上）に、紙の値と墨の新しい値を入れ、v2 のトークンを足した。

### 6.1 仕組み

- **クラス**: `body.dark-theme`（**常に付く**。全トークンの基準で墨。`style.css` の `body.dark-theme` はページの寸法や文字も持っているので外さない）、`body.look-paper`（紙。`<html>` にも付く。`:root` の下地 `--canvas-bg` が紙になる）、`body.theme-olive|blue|forest|charcoal|vermilion`（アクセント）。自分で選ぶ色は `body.theme-custom` と、`appearance.js` が計算して `<body>` の style に置く 10〜12 個のカスタムプロパティ。契約の §7.1 は紙を `light-theme` と書いていたが、設計書・台帳・P4/P5 の計画書が使う **`look-paper`** にした（`dark-theme` は構造のクラスでもあるので、紙のときに外せない）。
- **`tokens.css` の順序は契約**: ① 基準（墨）→ ② 墨のアクセント（`body.theme-*`）→ ③ 紙（`body.look-paper`）→ ④ 紙のアクセント（`body.look-paper.theme-*`）。同じ重みなら後ろが勝つので、紙は墨の後ろに置く。**紙のブロックは、墨のアクセントのブロックが設定するトークンを全部設定する**（足りないと墨のアクセントの値が紙に漏れる）。`tests/look_contrast_test.mjs` の構造の検査が見張る。
- **`frontend/js/appearance.js`**（新規、約 16 KB）: 設定の正規化（未知のキーを残す）、`general.theme` との関係、フォント名の検査、自分で選ぶ色の HSL 計算、`apply()`（クラスと style を、**違うものだけ**書く）、`markerFor()`（起動時の印）。既定（墨・Dark Olive・フォントなし）は、ページの HTML がもう持っている状態なので **何も書かない**。自分で選ぶ色の計算とフォントの適用は、人がそれを選んだときだけ走る。
- **設定の保存先**: `config.appearance = { look, accent, accentCustom, editorFont, ...後の段のキー }`。`appearance` が無い設定（P1b より前に保存したもの）は `general.theme` がアクセント。保存するときは、アクセントを `general.theme` にも書く（古い版が読めるアクセントのとき。朱・自分で選ぶ色は前の値のまま）。
- **罠 F7**: `loadLocalConfigSync` と `syncBackendConfig` に `loadAppearanceGroup()` を足した（読み込みは許可リスト式で、書き戻しは全体なので、足さないと保存で消える）。往復のテスト `tests/appearance_roundtrip_test.mjs`（実物の読み込み関数を抜き出して動かす。片方の行を消すと落ちる）。設定パッケージ（`config_pack.js`）は `appearance` を `general` の節のキーとして扱う。Go は `config.json` を文字列のまま書く（`SaveConfig`）ので **変更なし**（`config.get` / RPC は秘密だけ隠して任意のキーを返す）。
- **設定画面**: 「外観 & ウィンドウ」の節に、見た目（墨/紙）、アクセント（選択欄＋色見本＋自分で選ぶ色の入力）、エディタのフォント（`<input list>`）を足した。**選ぶとすぐに画面に出る**（設定を書き換えずに `Appearance.apply` を呼ぶだけ）。キャンセル・×・Esc は `applyTheme()` で保存済みの設定を当て直す。保存で `config.appearance` と `general.theme` に書く。後の段の行は、`readAppearanceControls` と `showAppearanceControls` に 1 行ずつ足せば載る。
- **Mermaid**: トーンに `auto`（既定。見た目に従う: 墨は暗い、紙は明るい）を足した。暗い調子の 3 色は、`getComputedStyle` で `--bg-mermaid-dark`・`--mermaid-primary`・`--text-mermaid-dark` を描画の直前に読んで渡す。`tone-dark` のカードは紙でも暗いまま（`.markdown-body pre.mermaid-card.tone-dark`）。**以前の設定は `dark` を持っている**（保存のたびに書かれていた既定）ので、見た目を墨から紙へ変えて保存するとき、トーンの欄を触っていなければ `auto` にする（`MermaidTone.toneToSave`）。
- **エディタのフォント**: 5 つの規則（`#editor`、`#editor-secondary`、`#ghost-overlay`、`#line-numbers`、`.secondary-editor-pane .line-numbers`）の `font-family` を `var(--editor-font-user, 元の並び)` にした。設定すると `<html>` に `--editor-font-user: "名前", 元の並び` を置き、キャレットの測定・リンクの下線・折り返しの行番号を測り直す（文字の大きさを変えるときと同じ手順）。名前は `"` `'` `\` `;` `{` `}` `(` `)` `<` `>` `:` `,` と制御文字を含むと使わない。同梱はしない。

### 6.2 墨の新しい値（青みのある墨色）

設計書 §4.1 の面: `--wall #06070a`、`--page #0e0f17`、`--sheet #181a26`、`--ink #dcdde3`、`--ink-2 #8b8d99`、`--hair` 白 7%。古い名前の面は、この階段に寄せた。

| 役割 | 古い値 | 新しい値 |
| --- | --- | --- |
| エディタ・行番号・主な面・選択中のタブ・入力欄の沈んだ面 | `#1e1e1e` | `#0e0f17`（page） |
| ヘッダー | `#252526` | `#12141e` |
| モーダル・パネル・メニュー・表の見出し | `#252526` | `#181a26`（sheet） |
| 非選択のタブ、入力欄、ボタン、ボタンのホバー | `#2d2d2d` / `#3c3c3c` / `#333` / `#444` | `#191c29` / `#1f2230` / `#232637` / `#2f3348` |
| 本文・補助の文字 | `#d4d4d4` / `#9d9d9d` | `#dcdde3` / `#8b8d99` |
| 枠 | `#3e3e42` ほか（不透明の灰色） | 白の 10% / 14% / 22%（`--border-color` / `--border-input` / `--border-button`） |
| プレビューの面 | アクセント色の暗い面（`#272b21` など） | シートにアクセントを 10% 混ぜた面（`#1e2227` など） |

そのほか: 状態の色のうち、新しい面の上で 4.5:1 に足りなかった 3 つを明るくした（`--badge-danger-text`、`--badge-git-ok-text`、`--rose`）。**Classic Blue の墨の塗りは `#007acc` から `#0074c2` に深くした**（白い文字が 4.0:1 → 4.9:1。ステータスバーも同じ）。ステータスバーは墨ではこれまでどおりアクセント色の帯（P2 でオーバーレイになるときに作り直す）。`--ring-focus-input` は、墨の Dark Olive 以外のテーマでも olive の色だった不具合を、`rgb(var(--accent-rgb) / 0.35)` にして直した。

### 6.3 紙の値の方針

- 面は 3 段: 机 `#e6e6e1`（ヘッダー）< ページ `#fbfbf9` < 紙 `#ffffff`（モーダル・パネル・メニュー）。タブは机より少し明るい `#ecece7`、選択中のタブはページと同じ。枠は 14% の薄い罫線、影はやわらかい 2 段（`0 8px 28px rgba(20,22,30,.16), 0 1px 3px …`）。スクリムは 26%。
- 文字: `#16171b`、補助 `#62636b`（設計書の `#6a6b73` は机の上で 4.23:1 だったので、4.77:1 になるまで濃くした）。強調 `#0b0c10`。
- 薄膜（`--veil-NN`）は白の代わりに墨色の薄い膜、`--shade-NN`（ステータスバーの凹み）も墨色の薄い膜にした。**ステータスバーは紙では中立の帯**（`#ecece7`、文字 `#33343a`）にした。アクセント色の帯の上に白い字、は紙では重すぎるため。
- 状態の色（危険・警告・成功・リンク）は、墨では明るい色、紙では深い色の別の値（`--coral #b3261e`、`--rose #b4373f`、`--caution #7d5f1a`、`--text-ok #1d7a44` ほか）。薄い塗りと枠は同じ色相の 10〜14% / 45%。
- カーソルのオーラは `mix-blend-mode: var(--aura-blend)`（墨は screen、紙は multiply）。結果ブロックの帯は紙では深い緑（`#3f9a22` / `#55993a` / `#2e6b1d`）。
- 紙にだけ要る CSS（`style.css` の末尾、色ではなく描き方）: 実行ボタンの上のスピナーをボタンの文字色の弧にする、プレビューのリンクをアクセントにする。KaTeX の「読めない式」は KaTeX が `color:#cc0000` を直接書くので、`span.katex-error { color: var(--coral) !important }` で墨でも 4.5:1 にした。
- 印刷（`print.css`）は変えていない。印刷メディアで撮ると、紙の見た目のプレビューは白い紙・黒い字になる（墨と画素が違うのは暗い調子の図だけ。印刷パネルは図を明るい調子で描き直す）。

### 6.4 アクセント（墨と紙の、5 色）

`--accent-color`（塗り）/ `--accent-hover`（線・輪・リンク）/ `--accent-label`（文字）/ `--accent-active-bg`（選択の面）。`--accent-rgb` は墨が hover、紙が color のチャンネル。

| 見た目 | アクセント | color | hover | label | active-bg | preview の面 |
| --- | --- | --- | --- | --- | --- | --- |
| 墨 | `olive` | `#556b2f` | `#6b843d` | `#a6c26a` | `#424e30` | `#1e2227` |
| 墨 | `blue` | `#0074c2` | `#1f8ad2` | `#6cb6ff` | `#094771` | `#172131` |
| 墨 | `forest` | `#2e6656` | `#3d806d` | `#7fc8b0` | `#275246` | `#1a222b` |
| 墨 | `charcoal` | `#505050` | `#666666` | `#c8c8c8` | `#444444` | `#1e1f2a` |
| 墨 | `vermilion` | `#b8472c` | `#cf5c3c` | `#f1977c` | `#5a342a` | `#281f27` |
| 紙 | `olive` | `#556b2f` | `#46592a` | `#3f5226` | `#dfe7cc` | `#fafbf6` |
| 紙 | `blue` | `#0069b0` | `#005a96` | `#004f85` | `#d6e8f7` | `#f8fbfe` |
| 紙 | `forest` | `#2e6656` | `#25544a` | `#1f4a3d` | `#d7ebe4` | `#f7fbfa` |
| 紙 | `charcoal` | `#4a4a4a` | `#333333` | `#2b2b2b` | `#e2e2e2` | `#fafafa` |
| 紙 | `vermilion` | `#b8472c` | `#9a3a22` | `#8c321d` | `#f7ddd5` | `#fdf9f7` |

朱（`vermilion`）は案のとおり `#b8472c / #cf5c3c / #f1977c`（墨）。紙では塗りは同じ `#b8472c`（白い文字 5.3:1）で、線と文字は深い `#9a3a22` / `#8c321d`。

**自分で選ぶ色（`custom`）**: 選んだ色は塗りにそのまま使う（墨）。紙では、塗りは文字にも使われるので 4.5:1 になるまで暗くする。文字・線・薄い面は HSL で計算する: 墨は hover を 4.5:1 になるまで明るく、label を最も明るい面の上で 4.5:1、選択の面と帯を白い字で 7:1 以上に暗く。紙は label を最も暗い面の上で 4.5:1、選択の面とメニューのホバーを墨の字で 7:1 以上に明るく。塗りの上の文字（`--text-on-accent`）は白と黒の良いほう（どんな色でも 4.58:1 以上）。計算は決めた色の組（12〜23 色）× 2 つの見た目で `tests/look_contrast_test.mjs` と `frontend/js/appearance_test.js` が検査する。

### 6.5 コントラスト（`tests/look_contrast_test.mjs`）

5 つのアクセントすべてで測った最低の値（括弧は最悪の組）。検査する組は 63（文字の種類。それぞれ複数の面の上）。基準は本文 4.5:1、補助の文字は主な面で 4.5:1・入力欄とホバーで 3:1、線・輪は 3:1。

| 組 | 墨の最低 | 紙の最低 |
| --- | --- | --- |
| 本文（`--text-main`）の、主な 9 つの面の上 | 11.78:1（vermilion / preview） | 14.30:1（olive / header） |
| 強調の文字（`--text-active`）の、入力欄・ボタン・ホバー・選択の面の上 | 8.82:1（forest / accent-active-bg） | 15.09:1（charcoal / accent-active-bg） |
| 補助の文字（`--text-muted`）の、主な面の上 | 4.84:1（vermilion / preview） | 4.77:1（olive / header） |
| 補助の文字の、入力欄・ボタン・ホバーの上 | 3.77:1（olive / btn-hover） | 4.68:1（olive / btn-hover） |
| アクセントの文字（`--accent-label`）の、モーダル・ページ・ヘッダー・入力欄の上 | 7.11:1（vermilion / input） | 6.48:1（vermilion / header） |
| アクセントの塗りの上の文字（`--text-on-accent`） | 4.91:1（blue / accent-color） | 5.28:1（vermilion / accent-color） |
| ステータスバーの文字 | 4.91:1（blue / statusbar） | 10.47:1（olive / statusbar） |
| プレビューの見出し（`--md-heading`） | 5.41:1（vermilion / preview） | 6.28:1（vermilion / preview） |
| インラインコード（`--md-code`） | 7.01:1（olive / md-inline） | 5.82:1（olive / md-inline） |
| エラーの文字（`--coral`）、モーダルの上 | 7.04:1（olive / modal） | 6.54:1（olive / modal） |
| 成功の文字（`--text-ok`）、モーダルの上 | 8.64:1（olive / modal） | 5.36:1（olive / modal） |
| フォーカスの輪（`--focus-ring`）、ページ・モーダル・ヘッダーの上（3:1 が基準） | 7.79:1（vermilion / modal） | 5.59:1（vermilion / header） |
| アクセントの線・輪・ゴーストの文字（`--accent-hover`）、エディタの上（3:1 が基準） | 3.33:1（charcoal / editor） | 6.75:1（vermilion / editor） |

### 6.6 鍵（テスト）

| テスト | 見るもの |
| --- | --- |
| `tests/look_contrast_test.mjs` | 墨・紙 × 5 アクセントの文字のコントラスト、自分で選ぶ色のコントラスト、構造（紙の位置・漏れ・紙のアクセントが同じ組）、チャンネルのトークンが色と一致、v2 の面の値。各検査がミューテーションで落ちる |
| `tests/css_compat_test.mjs` | `color-mix(`・`@container`・CSS ネスト・`scrollbar-gutter`・新しい `:has(` が CSS・HTML・JS の style 文字列に無い（`file_anchor.js` の代替つきの 1 行だけ許可） |
| `tests/appearance_roundtrip_test.mjs` | F7 の往復、古い設定、設定画面の読み取り、フォントの規則、読み込みの行を消すと落ちる |
| `frontend/js/appearance_test.js` | 正規化・未知のキー・色の計算・フォント名・`apply` が書く量（18 のミューテーション確認つき） |
| `tests/look_boot_test.mjs` | `index.html` の最初のスクリプト（印を読んでクラスを付ける）と `rememberLook`（違うときだけ書く、既定で消す）。全部の見た目×アクセントで、`Appearance.markerFor` の印が `apply()` と同じクラスになる。壊すと落ちる |
| `tests/appearance_mutation_test.mjs` | `appearance.js` を 20 通りに壊して、`appearance_test.js` が全部落とすこと |
| `tests/smoke/108_appearance.mjs` | 設定画面の即時反映・キャンセル・保存・色・フォント（実ブラウザ） |
| `tests/lib/look_lib.mjs` | 上のテストと他のテスト（`first_run_polish`、`preview_frame`）が共有する、見た目ごとのトークンの解決と色の計算 |

規則の検査に直したもの: `first_run_polish_test`（補助の文字の値 → 4.5:1）、`preview_frame_test`（プレビューの面がエディタと違う、枠は `--preview-frame`）、`about_privacy_test`（枠の色）、`smoke/97_print_preview`（画面のプレビューの面はトークンの値）、`settings_differential_save_test`・`html_comments_wiring_test`（設定の読み書きの位置）、`css_tokens_test`（紙の下地 `:root.look-paper`、許可リストから Mermaid の 3 行を外し `appearance.js` の 1 行を足した）。`tests/lib/css_tokens_lib.mjs` の `withTokens()` は、値が `var()` の別名のトークンを名前のまま残す。

### 6.7 未対応と引き継ぎ

- **Go のネイティブの色**は変えていない（担当外）: `window_windows.go`（クラスのブラシ・WebView2 の下地・環境変数）と `window_darwin.go` の `#1e1e1e`。墨の新しい面は `#0e0f17` なので、起動の最初の 1 フレームだけ少し明るい灰色が見える。紙を選んだ人は、WebView が描くまで暗い窓が見える。直すなら、Go の下地を `#0e0f17` にし、紙のときは設定を先に読む（P6）。ポップアップ（Quick Capture）の色も同じ。
- **起動の最初の描画の前に見た目を当てる**: `index.html` の `<body>` の最初に、ごく小さな（400 文字ほど、ES5）インラインのスクリプトを置いた。`md_memo_look`（`paper|blue` のような小さな印）を読んで、`look-paper` と組み込みのアクセントのクラスを `<body>` と `<html>` に付ける。印は `app.js` の `applyTheme()` → `rememberLook()` が、見た目が既定（墨・Dark Olive）でないときだけ書く（既定のプロファイルは何も書かず、スクリプトは何もしない）。置かないと、`app.js`（ページの終わり）が走る前に最初の描画があり（実測: 最初の描画は 112〜128 ms、ページの解析の終わりは 150 ms 前後）、紙を選んだ人は毎回、墨の画面が一瞬見える。実機で、再読み込みの最初の描画の前にクラスが付いていることを 4/4 で確かめた。自分で選ぶ色は印に入れない（計算は `app.js` が走ってから。数十 ms は Dark Olive）。
- P2〜P5 のトークン（`--tab-*`、`--gutter-*`、`--note-*`、`--wall` ほか）は **値だけ**用意した。`--bar-*-rgb` と `--text-muted-rgb` は P2b で `chrome.css` が使い始めた（下の 6.8）。P2 の `--bar-a` は `tokens.css` のトークンではなく、`chrome.css` が二つのバーに置く層の変数（`<body data-bars>` で値が決まる。`<body>` に置くとページ全体の再計算になるため、バー自身に置く）。
- スマホ用ページ（`pkg/dropzone`）は別の CSS で、見た目の設定に従わない。
- `forced-colors`（強制色）は P6。紙の枠は `--border-color` の薄い罫線のまま。
- Mac（WKWebView）の実機確認は未。紙の `color-scheme: light`、`rgb(r g b / a)`、`mix-blend-mode` は Safari 15 で使える構文だけを使っている（`tests/css_compat_test.mjs`）。

### 6.8 P2b: 透過のバー、行番号、Zen（2026-10-04）

- バーの色は `rgb(var(--bar-top-rgb) / var(--bar-a))`（上）と `rgb(var(--bar-bottom-rgb) / var(--bar-a))`（下）。`--bar-a` は `chrome.css` が `#header` / `#status-bar` に置く（`solid` 1、`light` と、`backdrop-filter` の無い環境の `glass` が同じ値、`glass` はもう少し低く）。値と既定は `tools/perf/v2-p2-translucency.md`。`color-mix()` は使っていない。
- 行番号は `rgb(var(--text-muted-rgb) / var(--linenum-a, 0.7))`。背景と `border-right` は無し。トークンの `--bg-line-num` は CSS からは使われなくなった（結果ブロックの帯の下地は `--bg-editor` で測る）。
- Zen（`body.zen-mode`）は `--ov-inset-*` を 0、`--pad-x` 32px、`--pad-y` 24px、`--linenum-a` 0.3 に上書きするだけ（トークンの色は増えない）。

### 6.9 P3a: 窓の端の索引タブ（S1〜S3）

色のトークンは P1b のまま（上の表）。変えたのは `--tab-ink`（`--ink-2` → `--ink`）と、`--tab-ink-hi` を墨の Olive・Blue・Vermilion で `var(--wall)` にしたことだけ。理由は `tests/look_contrast_test.mjs` の「index tabs」の節（名前は 7 段階の塗りの上で 4.5:1、印は縁の色の上で、選択中のタブは収縮時にページの上で 3:1）。**色以外の変数**は `css/style.css` の `:root` にある（長さと時間と数。オーナーが実アプリを見て決める）:

| 変数 | 初期値 | 役割 |
| --- | --- | --- |
| `--tab-strip-w` | `6px` | 収縮時に塗る幅。`#editor-pane` の左の余白（`padding-left`）とヘッダーの題の左位置もこれを使う |
| `--tab-hit-w` | `12px` | 収縮時の帯の幅（狙える幅。塗りはその左の `--tab-strip-w`、残りは見えない） |
| `--tab-open-w` | `200px` | 展開時の幅 |
| `--tab-h` / `--tab-h-min` | `30px` / `20px` | タブの高さと、帯に収まらないときに詰める下限（それでも収まらなければ縦にスクロール） |
| `--tab-dot` | `5px` | 未保存の印の大きさ |
| `--tab-open-ms` / `--tab-open-delay` / `--tab-text-lag` | `220ms` / `120ms` / `60ms` | 展開の長さ / ポインタが止まってから開くまでの待ち（通り過ぎでは開かない。キーボードは待たない） / 塗りの後に名前を出すまで。`prefers-reduced-motion` では待ちを 0 に |
| `--tab-mix-floor` / `--tab-mix-base` / `--tab-mix-step` | `0.2` / `0.68` / `0.12` | 濃淡 `max(floor, base − step × 距離)`（選択中は 1）。`tab_strip.js` の `MIX_*` と同じ値（テストが比べる） |
| `--tab-strip-top` / `--tab-strip-bottom` | `var(--ov-top)` / `var(--ov-bottom)` | 帯の上下（ヘッダーとステータスバーの間） |
| `--d`（タブごと、`app.js` が書く） | `0`〜`12` | 選択中のタブからの距離（遠いものは 12 にまとめる） |
| `--tab-o`（タブごと、計算） | 上の式 | 塗り（`::before`）の不透明度。`color-mix()` は使わない |
| `--tab-hit`（Zen のとき `chrome.css` が帯に置く） | `none` | 帯が隠れている間、タブと「+」がポインタを受けない |

- 印: 未保存は丸（`--tab-dirty` を `--tab-base` の輪で囲む）、競合は四角（`--tab-conflict`）。収縮時は帯の中の `::after`、展開時は名前の右の `.tab-dirty-dot` / `.tab-conflict-mark`（`!` は `--tab-base` の地に載る）。
- キーボードの輪は `outline: 2px solid currentColor`（そのタブの文字色。塗りの上で 4.5:1 になるよう選んであるので、輪も読める）。
- 強制色では塗りを描かず、枠線（`CanvasText`、選択中は `Highlight`）で区別する。システム色のキーワードは `css_tokens_test` の対象外（色の直書きではない）。

### 6.10 P3b: 右の帯、4 つの表示、あふれ、後始末（S0、S4〜S7）

- **色のトークンは増減なし**（P3a のまま）。タブの塗りは疑似要素の `opacity` のまま。S0 で、塗りを `rgb(var(--accent-rgb) / var(--tab-o))`（色のアルファ。下の線は `--tab-hair-rgb` と強さのトークンを足して同じ割合で薄める）にした版を作って測ったが、アイドル中の仕事量は変わらなかったので入れていない（`tools/perf/v2-p3-idle-cpu.md`）。入れる場合の差分はその文書に書いてある。
- **色以外の変数**（`css/style.css` の `:root`、長さ）: `--tab-strip-gap-right: 9px`（右の帯が右ページの右端から離れる最小。実際は `max(これ, --tab-scrollbar-w)`）、`--tab-strip-pane-head: 32px`（右ページの題の帯の高さ。右の帯の上端は `--tab-strip-top` にこれを足した所で、P4 がその帯を作り直すときに合わせる）。`--tab-scrollbar-w` は CSS には書かず、`app.js`（`measureStripGap`）が右の帯が初めて出るとき **1 回だけ**、使い捨ての箱でシステムのスクロールバーの幅を測って `#tab-index-right` にだけ置く（この PC の WebView2 では 15px。何も測らない起動は変わらない）。`css_tokens_test` の「他で置く」リストに入れた。
- **右の帯**（`.tab-index[data-side="right"]`）は左の帯の鏡: `flex-direction: row-reverse`、塗りは右端（`::before { left: auto; right: 0 }`）、名前は右寄せ、未保存の丸・競合の四角・×は名前の左。幅は `--tab-hit-w`（12px）から `--tab-open-w`（200px）へ左へ広がる。スクロールバーの左に立ち、右ページの題の帯の下から始まる。`#tabs-scroll-right` / `#tabs-list-right` は左と同じ規則（縦スクロール、スクロールバーなし、端のフェード）。
- **4 つの表示**は `#workspace` の `data-tabs`（`left` | `both` | `none`）。`none`（プレビューのみ）は `visibility: hidden`（Tab の順からも外れる）、右の帯は `both` のときだけ `hidden` が外れる。
- **ロックするテスト**: `tests/tab_index_pages_test.mjs`（2 ページの帯、クリックの行き先、ドラッグの取り消し、右クリックの名指し、ファイルのドロップ、セッションの復元）、`tests/second_panel_test.mjs`（隣のプレビューは左に付いてくる、プレビューのみは帯なし）、`tests/tab_index_wiring_test.mjs`（右の帯の CSS と配線、ミューテーション 13 件を追加）、`tests/smoke/109`、`113`、`114`。

### 6.11 P4a: ページ・見開き・プレビュー・ノド（2026-10-05）

P4 の色のトークンは P1b で用意した値のまま（上の表）。**使い始めた**もの: `--wall`（`side` と `preview` で `#workspace` の背景 = 机）、`--sheet`（プレビューの紙）、`--sheet-shadow`（紙の影）、`--gutter-shade` と `--gutter-dot`（ノド）、`--pane-focus`（フォーカスのあるページの上端の線）、`--hair`（`data-boundary="line"` の細い線）、`--page-rgb` と `--sheet-rgb`（右ページの名前の帯の下地。90%）、`--gutter-w` `--desk-margin` `--sheet-max`（長さ）。**使わなくなった**もの（定義は残してある）: `--bg-preview`、`--preview-frame`、`--outline-pane-focus`。

色以外の変数（`css/style.css` の `:root`、長さ。実アプリを見て決め直す）: `--grip-w: 6px`（プレビューの隣のつかみしろ）、`--pane-band-h: 28px`（右ページの名前の帯の高さ = 両ページの本文の頭に空ける追加分 `--pad-top-extra` = 右の索引タブの帯の上端 `--tab-strip-pane-head`。**1 つの数**）。`--split-w`（仕切りの実際の幅。`#editor-pane` と `.pane-resizer` に置く。ノド `var(--gutter-w)`、つかみしろ `var(--grip-w)`、細い線 `5px`）は、左ページの `flex-basis` の `calc((100% - var(--split-w)) * 比率)` と仕切りの `width` が同じ値を読むためのもの。

プレビューの紙（`#preview-pane`、`.secondary-preview-pane`）のスクロールバーは標準の `scrollbar-width: thin` と `scrollbar-color: rgb(var(--ink-rgb) / 0.5) transparent`（文字色の 50% で両方の見た目で紙に対して 3:1 以上）。`::-webkit-scrollbar` では描かない（Mac の重ねて出るスクロールバーを常時表示の棒にしてしまうため。Safari 15.6 は未対応で無視され、Mac は元のまま）。

`body[data-boundary]`（`shade` | `line`。無印 = ドット）は CSS だけ用意した。`appearance.splitBoundary` の正規化と `data-boundary` を書く処理、設定画面の項目は P4b（6.12）。`@media (max-width: 900px)` は `body.dark-theme` の `--desk-margin` と `--gutter-w` を 12px にする。

### 6.12 P4b: 仕切りの見た目の設定（2026-10-05）

**色のトークンは増減なし**（P4a のまま）。足したのは設定 `appearance.splitBoundary` と、それを `<body>` の属性にする処理だけ。

| 値 | `<body>` | ノド（`#pane-resizer`、2 つのエディタのとき） | 使うトークン |
| --- | --- | --- | --- |
| `dots`（既定） | 属性なし | 幅 `--gutter-w`（24px）。中央に影、両側へ薄れるドット | `--gutter-shade`、`--gutter-dot` |
| `shade` | `data-boundary="shade"` | 24px のまま、影だけ（`::before` のドットを消す） | `--gutter-shade` |
| `line` | `data-boundary="line"` | 5px の細い仕切りに 1px の線。影もドットも無い。2 つのページは 19px 広がる（左のページの basis は `--split-w` を読むので半分ずつは保たれる） | `--hair` |

- 隣にプレビューがあるとき（`data-view="side"`）は、どの値でも仕切りは 6px のつかみしろで、`line` のときだけ 1px の `--hair` が足される。
- **値の名前**: 計画書の初版は既定を `gutter` と書いたが、実装の値は `dots`（設計書 §4.7 の「ノド」）。保存された未知の値（`gutter` を含む）は既定（`dots`）として読む。正規化は未知のキーを保つ。
- **何も走らないこと**: `index.html` は `data-boundary` を持たない（既定 = 属性なし）。`Appearance.apply` は属性が今の値と違うときだけ書き、`dots` のときは付いている属性を外すだけ。起動時に既定の設定が来ても、何も書かない（`appearance_test.js` が書き込み 0 回を縛る）。
- 設定画面は「外観 & ウィンドウ」の節の、自動非表示の次、Mermaid の配色の前に `<select id="cfg-split-boundary">`。文字列は `splitBoundaryLabel` `splitBoundaryDots` `splitBoundaryShade` `splitBoundaryLine` `splitBoundaryHint`（英日）。保存前に即時反映し、取り消しで戻る（他の外観の項目と同じ経路: `previewAppearance` → `applyAppearance`、取り消しは `restoreLiveConfigFromSnapshot` の `applyTheme`）。署名（`Appearance.signature`）に入っているので、`config.json` が別の値のときの起動後の読み直しでも適用される。
- 設定パッケージ（`config_pack.js`）は `appearance` を `general` の節として扱うので、書き出し・読み込みに載る（`config_pack_test.js`、`config_pack_wiring_test.mjs`）。
- ロックするテスト: `frontend/js/appearance_test.js`（正規化・署名・`apply` の書き込み回数）と `tests/appearance_mutation_test.mjs`（38 件）、`tests/appearance_roundtrip_test.mjs`（保存 → 再読み込み → 保存、`config.json` だけが違うときの適用）、`tests/split_boundary_wiring_test.mjs`（`index.html`・i18n・`app.js`・CSS の名前の一致）、`tests/smoke/117_split_boundary.mjs`（3 つの見た目の幅、取り消し、保存、キーボードが効くこと）。

### 6.13 P5: 付箋のパネルとダイアログの紙（2026-10-05）

色のトークンは P1b で用意した `--note-*` を**使い始めた**。足したのは `--bg-scrim-note` の 1 つだけ。値を変えたのは `--note-flap`（墨）、`--note-shadow`（紙）、`--cloud-mark`（紙）。面の規則は `docs/design/panel-template.md` の「付箋の面」「ダイアログは紙」。

| 場所 | 内容 |
| --- | --- |
| `--note-tint` `--note-tape` `--note-tape-focus` `--note-flap` `--note-shadow` `--note-fold` | `style.css` の末尾「The sticky note」が使う（6 つの根: `.inline-prompt-bar`、`.quick-pick-modal`、`.jev-action-panel`、`.tab-list-panel`、`.status-ai-pop`、`#slot-quick-selector`）。紙は `::before` の背景 3 枚（粘着帯、`--note-tint`、`--sheet`）。`--note-strip` は `::before` の中だけの局所変数（`--note-tape` か `--note-tape-focus`）で、トークンではない |
| `--bg-scrim-note`（新） | モーダルな付箋（`#quick-pick-modal`、`#tag-pick-modal`、`#scraps-search-modal`、`#lesson-modal`）の暗幕。墨 0.32、紙 0.14（ダイアログの `--bg-scrim` は 0.6 / 0.26 のまま） |
| `--note-flap`（墨） | `rgb(var(--shade-rgb) / 0.14)` → `rgb(var(--ink-rgb) / 0.12)`。暗い紙の上の暗い三角は見えず、折り目に見えなかったため、墨では紙より明るい三角にした |
| `--note-shadow`（紙） | `0 1px 2px … / 0.14, 0 10px 24px … / 0.12` → `0 1px 3px … / 0.2, 0 12px 28px … / 0.18`。淡い紙の上で付箋が持ち上がって見えるように |
| `--cloud-mark`（紙） | `#a05f00` → `#985a00`。付箋の紙（薄いアクセントの重ね）の上で 4.5:1 に届かなかった（4.34〜4.43:1） |
| `--note-tint-a`（自分で選ぶ色、墨） | `appearance.js` の `customAccent` が、とても明るい色（純黄、白など）のときだけ、薄くした値（0.05〜0.11）を `<body>` に置く。明るい色の 12% を暗い紙に重ねると補助の文字（`--text-muted`）が 4.5:1 を割るため。普通の色は何も置かない |
| `--shadow-popover`、`--panel-shadow` | `--shadow-popover` はスニペットの選択が付箋になったので使われなくなった。`--panel-shadow` を使うのは `.help-menu` だけになった（どちらも定義は残してある） |
| `.modal-card` | 背景 `var(--sheet)`、枠なし、角は直角、影は既存の `--shadow-modal`。設定と About の `box-shadow: var(--panel-shadow)` は外した（`.modal-card` と同じにする）。`--panel-shadow` を使うのは `.help-menu` だけになった |

コントラストの鍵（`tests/look_contrast_test.mjs` の「sticky notes」）: 付箋の紙（`sheet+note-tint`）の上の本文・強調・補助・チップ・プレースホルダー・キー・アクセントのラベル・状態の色が 4.5:1（プレースホルダーは 3:1）、粘着帯（フォーカス中）が紙とページに 3:1（WCAG 1.4.11）、フォーカスなしの帯と 2:1。墨・紙 × 5 アクセントと、自分で選ぶ 12 色 × 2 つの見た目。**フォーカスなしの帯との 3:1 は満たさない**: 紙の自分で選ぶ色で 2.2〜3.0:1 になる。普段の帯の濃さ（35%）を保つ代わりに 2:1 を条件にした（WCAG 2.4.13 の AAA には届かない）。
