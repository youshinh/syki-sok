# v2 P2 実装計画: ヘッダー・フッターのオーバーレイ、行番号、透過、自動非表示、Zen

状態: **計画（2026-10-04、読み取りだけで作成。ソース・テスト・CSS は変更していない）**。設計は `v2-visual-2026-10.md`（§3・4.4・4.5・4.7・6・7）、規則は `v2-implementation-contract.md`（§1.5 の互換性を含む）。P3（`v2-plan-P3.md`）・P4/P5（`v2-plan-P4-P5.md`）が P2 に求めている名前に合わせる（下の §0.2）。

前提: P1a（直書きの色→トークン、`tokens.css`）と P1b（紙と墨、`config.appearance` の器）が**先に統合済み**であること。P2 はそれらの上に載る。P1a が `style.css` を編集中のため、P2 の新しい CSS は新規ファイル `frontend/css/chrome.css` に置き、`style.css` の旧規則を消すのは最後の 1 手（S7）にまとめる。

## 0. 要約

### 0.1 設計の骨格（結論）

1. **レイアウトを動かさない**。`#header` と `#status-bar` を `#app` の直接の子のまま `position: absolute`（上端・下端）にし、`#workspace` は窓いっぱい（`#app` は縦 flex のまま、フロー内の子が `#workspace` だけになるので `flex: 1` で 100% になる）。本文が下をくぐれるように、**スクロールする箱の `padding-top/bottom` にバーの高さを足す**（`#editor`・`#editor-secondary`・`#ghost-overlay`・`#line-numbers` の 4 種と、`#preview-pane`・`.secondary-preview-pane`）。textarea には `scroll-padding-top/bottom` も付ける。表示・非表示は**不透明度だけ**（レイアウト・再計算を起こさない）。
2. **自動非表示は 1 つの小さなモジュール**（`frontend/js/chrome_overlay.js`、`window.ChromeOverlay`、`PanelFade` と同じ流儀: DOM を `create()` に注入、Node でテスト可、未使用なら何も作らない）。状態は SHOWN と AWAY の 2 つだけ。AWAY では `body.chrome-faded` を付ける。`:has()` は使わず（契約 §1.5）、保つ条件は CSS の `:focus-within` と、JS が付ける `data-pin` 属性で表す。
3. **現行の 2 つの Zen を整理する**: `body.zen-active`（入力中に 0.12 に薄める）は新しい「自動非表示」に吸収されて消える。`body.zen-mode`（Shift+F11、永続）は残し、「バーは AWAY のまま、ポインタの移動では戻らず上端・下端のホットゾーンと F6 でだけ戻る」「通知（`#stat-message`）を出さない（ただし失敗は `important` で出す）」「余白を消す」ものにする。**「窓の余白」の意味は未決**（§6 の O1）。
4. **設定は `config.appearance`**: `bars`（`solid` / `light` / `glass`、既定は `light`（S8 の測定で確定、5.6））と `autoHide`（真偽、既定 `true`）。Go は `config.json` を素通しで持つので Go の変更は要らない（§4.8 で確認）。読み込み 2 経路（`loadLocalConfigSync`・`syncBackendConfig`）に読み込みを足さないと保存で消える。
5. **互換性**: macOS 10.15（Safari 15.6）で使えない `color-mix()`・`@container`・CSS ネスト・`:has()` の新規使用を避ける。バーの色は**チャンネルのトークン**（`--bar-top-rgb: 37 37 38` と `rgb(var(--bar-top-rgb) / var(--bar-a))`）で作る。すりガラスは `-webkit-backdrop-filter` を併記し、`@supports` で無ければ `light` に落とす。

### 0.2 他の段との名前の約束

| 名前 | 意味 | 出し手 → 使い手 |
| --- | --- | --- |
| `--ov-top` / `--ov-bottom` | ヘッダー（38px）・フッター（24px）の高さ。`#header`・`#status-bar` の `height` もこれ | P2 → P3（`--tab-strip-top/bottom`）、P4/P5（紙の上下の `padding`、バッジ・印刷ボタン、パネル） |
| `--ov-inset-top` / `--ov-inset-bottom` | 本文が確保する上下の余白。S1 では `0px`（見た目不変）、S2 で `var(--ov-top)` / `var(--ov-bottom)` | P2 の内部 |
| `--pad-top-extra` | 表示ごとの追加分（既定 `0px`）。`--editor-pad-top: calc(var(--ov-inset-top) + var(--pad-y) + var(--pad-top-extra, 0px))` | P4/P5 が要求 → P2 が式に入れる |
| `body.chrome-faded` | バーが AWAY のとき付く。P4 の右ペインの小さな帯も同じクラスで消える | P2 → P4 |
| `window.ChromeOverlay` | `show()` / `away()` / `insets()` / `setZen()` / `focusBar()` / `FOOTER_PINS`（§4） | P2 → app.js、docshots、テスト |
| `body[data-bars]` | `solid` / `light` / `glass` | P2 |
| `--bar-top-rgb` / `--bar-bottom-rgb` / `--text-muted-rgb` | チャンネルのトークン（`37 37 38` の形）。**`tokens.css` に置く**（P2 が足す。紙の値は P1b が入れる） | P2 → P1b |

P5 の「S1: 位置の定数をオーバーレイ対応に」（`--panel-top`、`--panel-modal-top`、Jev の `bottom`、`dockPanelBar`）は、P2 の S2 で**先に**やらないとオーバーレイがパネルに重なって壊れる。P2 がやる前提で、P5-S1 は付箋の見た目だけにしてよい（統括役に知らせる）。

## 1. 実測で確かめたこと（2026-10-04、隔離した Edge 154 = Chromium 154、プロファイルは一時、終了時に破棄）

スクラッチ（リポジトリ外）の `p2spike.html` / `p2spike.mjs` / `p2perf2.mjs` / `p2toggle.mjs`。**WebView2 の実アプリでの確認ではない**（S0 で再確認する）。

| # | 調べたこと | 結果 | 計画への効き方 |
| --- | --- | --- | --- |
| E1 | textarea（300 行、`padding: 50px 14px 36px`）の `scrollHeight` | 6803。内容 6720 + 上 50 + 下 36 = 6806（誤差 3）。**`padding-bottom` はスクロール範囲に入る** | 最後の行がフッターの上までスクロールできる。textarea の外側に余白用の要素は要らない |
| E2 | キャレットを `ArrowDown` で下へ（ブラウザ自身のスクロール） | `scroll-padding` なし: キャレットの行は窓の下端にぴったり（-3px、フッターに隠れる）。`scroll-padding-bottom: 36px`: 下端から 33px。上向きも `scroll-padding-top: 38px` で 36px | **`scroll-padding-top/bottom` は Chromium のキャレット追従に効く**。CSS だけで済み、JS の計算は要らない |
| E3 | ポインタを静止したままホイール 2 回、続けて入力 | ホイールで `scroll` は 2 回、`pointermove` は 0 回。入力は `input`（`isTrusted: true`）だけ | この環境では合成の `pointermove` は来ない。実機では来うるので**座標の差（デッドゾーン 6px）**で判断する |
| E4 | IME（`keydown` の `key` が `Process`、`imeSetComposition`） | `keydown(Process)` → `compositionstart` → `compositionupdate` → `input`（`isComposing: true`）。`compositionstart` も `input` も来る | 設計どおり `input` と `compositionstart` で入力を検出する。`keydown` は見ない |
| E5 | textarea のスクロールバーを押す | `pointerdown` と `mousedown` が textarea に届き、続けて `scroll` | スクロールバーのドラッグを「ユーザーのスクロール」と見分けられる（§4.2） |
| E6 | 8 万行の textarea の上に半透明のバー（1120px × 38 と 24）を重ねて 4 秒スクロール（合成テキスト、AMD 780M、ハードウェア GPU） | フレーム間隔の p50/p95 は 18.2 / 19 ms でバー無し・不透明・すりガラス（blur 14px、30px）・すりガラス+非表示のどれも**同じ**。GPU プロセスの CPU 時間は 281〜578 ms で**差がノイズ（±100 ms）に埋もれる** | ハードウェア GPU では、すりガラスの費用は測れなかった（実アプリで再測定） |
| E7 | 同じ測定を `--disable-gpu`（ソフトウェア合成。RDP・VM の最悪ケース） | フレームは 16.7 ms を保つ。GPU プロセスの CPU 時間（4 秒）: バー無し 453/625、不透明 516/531、**すりガラス 719/891**、**blur 30px 984/1125**、**すりガラス+opacity 0 は 625/438（バー無しと同じ）** | ソフトウェア合成ではすりガラスが +50%（blur 30px で +100%）。**`opacity: 0` の間は費用が出ない**＝自動非表示でスクロール中はバーが消えるので、実使用ではほぼ払わない |
| E8 | 8 万行の textarea で `body` のクラスを 40 回切り替え、`padding-top` を変更 | クラス切り替えは 0.018 ms/回、レイアウト 0 回（スタイル再計算 40 回、0 ms）。`padding-top` の変更後の強制レイアウトは 0.1 ms | 自動非表示の切り替えは textarea を再レイアウトしない。余白の変更（設定・Zen）も安い |

付記: この環境のスクロールバー幅は 15px（`offsetWidth - clientWidth`）。WebView2（Windows 11）は細いスクロールバーかもしれない（S0 で実測）。E8 の同じページで 1 打鍵（`Input.insertText` と強制レイアウト）を測ると 6 秒台だった。合成ページの条件（巨大な 1 本のテキスト、強制レイアウト）が実アプリ（既存の記録で 1 打鍵 50〜115 ms）と違うので**参考にしない**。1 打鍵の費用は S8 で実アプリを測る。

## 2. 棚卸し（高さ・余白・行番号の幅に依存するもの）

セレクタ・id・関数名で書く（行番号は他の担当の編集でずれる）。「どうなるか」は**オーバーレイ化したあとに必要なこと**。

### 2.1 マークアップ（`frontend/index.html`）

| 要素 | 今 | 必要なこと |
| --- | --- | --- |
| `#app` | `display: flex; flex-direction: column; height: 100vh` | `position: relative` を足す。他は変えない |
| `<header id="header">` | `#tabs-bar`（`#tabs-scroll > #tabs-list`、`#btn-new-tab`、`#btn-all-tabs`）と `#header-actions`（ボタン 16 個と `.header-divider`、`chrome_layout.js` が並べ替え・非表示） | `#app` の直接の子のまま（`print.css` が `#app > *:not(#workspace)` で隠すため。F4）。**P2 ではタブ帯を残す**（P3 まで）。先頭に `<div id="header-title" aria-hidden="true">` を足し、P3 がタブを出すまで `display: none`（§3 S6） |
| `<main id="workspace">` | 検索バー・質問バー・コマンドバー・`#editor-pane`・`#pane-resizer`・`#secondary-pane`・`#preview-pane`・`#preview-badge`・`#btn-preview-print` | 窓いっぱいになるが、**DOM は変えない**。`#workspace` は `position: relative; overflow: hidden` のままパネル類の包含ブロック |
| `<footer id="status-bar">` | `.status-left`（`#stat-cursor` `#stat-chars` `#stat-selection`）、`.status-center`（`#stat-ambient-container` `#stat-llm-indicator` `#stat-message`）、`.status-right`（`#stat-recording` `#stat-tasks` `#stat-gitsync` `#stat-ime` `#stat-ai` `#stat-autosave` `#stat-encoding`） | `#app` の直接の子のまま。**設計書は右を Git・IME・文字コードと書くが、AI・Autosave・タスク・録音のチップは機能なので残す**（O4 で確認） |
| `#editor-pane` > `#line-numbers`、`#editor-wrapper` > `#cursor-aura`・`#ghost-overlay`・`#editor` | 横並び | 構造は変えない。4 つの箱の上下 `padding` が同じ式を使う |
| `#secondary-pane` > `#secondary-pane-header`（32px）、`#secondary-editor-pane` > `#secondary-line-numbers`・`#secondary-editor-wrapper` > `#editor-secondary`、`#secondary-preview-pane` | 右ペイン | P2 の暫定: `#secondary-pane` に `padding-top: var(--ov-inset-top)`（自分の 32px の帯はオーバーレイの下に出す）。P4 が帯を小さな浮き帯に作り直す |
| `<link>` と `<script>` | `style.css`、`print.css`（`media="print"`） | `chrome.css`（`media="screen"`、`style.css` の後）、`js/appearance.js`・`js/chrome_overlay.js`（`panel_fade.js` の近く、`app.js` の前）を足す |

### 2.2 CSS（`style.css` のセレクタ）

| セレクタ | 今 | 必要なこと |
| --- | --- | --- |
| `body.dark-theme` の `--panel-top: 16px`、`--panel-modal-top: 53px` | ヘッダー 38px + 15px の定数 | `--panel-top` は `16px` のまま（テストが見る）。`--panel-modal-top: calc(var(--ov-top) + 15px)`（値は 53px で同じ） |
| `#header` | `position: relative; z-index: 100; height: 38px; background-color: var(--bg-header); border-bottom: 1px solid var(--border-color); transition: opacity 0.3s` | `position: absolute; top: 0; left: 0; right: 0; height: var(--ov-top)`。背景は `rgb(var(--bar-top-rgb) / var(--bar-a))`。`transition: opacity 0.2s` |
| `#status-bar` | `height: 24px; background: var(--bg-statusbar); transition: opacity 0.3s` | `position: absolute; bottom: 0; left: 0; right: 0; z-index: 100; height: var(--ov-bottom)`。背景は `rgb(var(--bar-bottom-rgb) / var(--bar-a))` |
| `#tabs-bar`、`#tabs-scroll`（マスクのフェード）、`.tab-item`（`height: 100%`、不透明な背景） | ヘッダー内 | 暫定: ヘッダーの高さに従うだけで変更なし。半透明のバーの上に不透明なタブが載る（見た目は P3 まで我慢。O6） |
| `#workspace`、`.pane`、`#workspace.split-mode` | `flex: 1; overflow: hidden; position: relative` | 変更なし（窓いっぱいになる） |
| `#editor`、`#editor-secondary` | `padding: 12px 14px`（`body.zen-mode #editor` は `24px 32px`） | `padding: var(--editor-pad-top) var(--pad-x) var(--editor-pad-bottom)`、`scroll-padding-top: var(--ov-inset-top)`、`scroll-padding-bottom: calc(var(--ov-inset-bottom) + 8px)` |
| `#ghost-overlay` | `inset: 0; padding: 12px 14px`（`right` は JS が `syncGhostGutter` で上書き） | **textarea と同じ `padding`**（同じ変数）。ずれるとゴーストがキャレットから外れる |
| `#line-numbers`、`.secondary-editor-pane .line-numbers` | `width: 44px; padding: 12px 6px; background: var(--bg-line-num); border-right: 1px solid var(--border-color); overflow: hidden; position: relative` | `padding: var(--editor-pad-top) 6px var(--editor-pad-bottom)`（**textarea の上余白と同じ**。`updateResultAccent` が `padding-top` を読んで結果ブロックの帯を置く）。背景なし・`border-right` なし・文字は `rgb(var(--text-muted-rgb) / 0.55)` |
| `.result-accent`、`.result-accent-bar` | ガターの中、`top` は JS が `padTop` で置く | 変更なし（上の `padding` に追従する） |
| `.secondary-preview-pane`、`#preview-pane` | `padding: 20px 24px` / `24px 36px`、`border: 2px solid var(--accent-hover)`（プレビュー）、`.html-mode` は `padding: 0 !important; overflow: hidden !important` | 上下に `calc(var(--ov-inset-top) + 24px)` / `calc(var(--ov-inset-bottom) + 24px)` を足す。**`.html-mode` は iframe がスクロールするので下をくぐれない**: `padding: var(--ov-inset-top) 0 var(--ov-inset-bottom) !important` にして iframe をバーの間に置く（O7）。`print.css` の `!important` の `padding: 0` が印刷を守る |
| `.preview-badge`（`top: 7px; right: 24px`）、`.preview-print-btn`（`top: 5px; right: 108px`） | プレビューの右上 | `top: calc(var(--ov-top) + 7px)` / `+ 5px`。バーのアイコン列と重ならないように |
| `.find-replace-bar` | `top: 8px; right: 24px; z-index: 60`（`#workspace` 内） | `top: calc(var(--ov-top) + 8px)` |
| `.inline-prompt-bar`、`.inline-prompt-bar.panel-dock-bottom` | `top: var(--panel-top, 16px)` / `bottom: var(--panel-top, 16px)`（`#workspace` 内） | `top: calc(var(--ov-top) + var(--panel-top, 16px))` / `bottom: calc(var(--ov-bottom) + var(--panel-top, 16px))`（`#cli-filter-bar` も同じクラス） |
| `.quick-pick-modal`（palette・search・tag-pick・lesson） | `.modal-backdrop`（`position: fixed`、窓座標）の中で `top: var(--panel-modal-top)` | 数値は変わらない（53px）。`--panel-modal-top` が `--ov-top` に従うだけ |
| `.jev-action-panel` | `bottom: var(--panel-top, 16px)`（`#editor-wrapper` の子） | `bottom: calc(var(--ov-bottom) + var(--panel-top, 16px))`。JS（`jev_action.js` の `dockPanel`）が `top`/`bottom` に `16px` を直書きしているので、そちらも（§2.4） |
| `.status-ai-pop`、`.running-tasks-panel` | `position: fixed; right: 16px; bottom: 30px`（24px のフッターの 6px 上） | `bottom: calc(var(--ov-bottom) + 6px)`。**開いている間フッターが消えてはいけない**（`#stat-ai[aria-expanded]` を pin に） |
| `.tab-list-panel`、`.help-menu`、`#context-menu`、`#slot-run-button`、`#slot-quick-selector` | `position: fixed/absolute`、JS が座標を置く | 変更なし（ポインタ・ボタンの矩形から計算。`.help-menu` と `.tab-list-panel` は `aria-expanded` を持つトリガーが**ヘッダーの中**にあるので、開いている間ヘッダーを保つ） |
| `.ghost-diff-band`、`.find-match-layer`/`.find-match-inner`/`.find-match-rect` | wrapper 内の絶対配置、`top` は `mirror の top − scrollTop`（上 padding 込み） | 変更なし（padding の式が変わっても mirror が計算済み padding を読む） |
| `#cursor-aura` | `z-index: 1`、`mix-blend-mode: screen` | 変更なし。バー（z-index 100）の下に隠れてよい |
| `body.zen-active #header` / `#status-bar`（0.12 / 0.15。戻す条件は `:has(...)` の 5 本と `:focus-within`、`:hover`） | 入力中に薄める | **削除**（自動非表示に置き換え。S5/S7） |
| `body.zen-mode #header` / `#status-bar`（`height: 0; opacity: 0; visibility: hidden; pointer-events: none`）、`body.zen-mode #line-numbers`（opacity 0.3）、`body.zen-mode #editor`（`padding: 24px 32px`） | 永続の Zen | **置き換え**（§4.6）。`height: 0` は使わない（レイアウトを動かさない） |
| `.clickable-badge`（高さ 24px、`::before` のピル） | フッター右のチップ | 高さは `var(--ov-bottom)` と同じ 24px のまま。ピルの凹み（影は上と左だけ）は P1b |
| `@media (prefers-reduced-motion: reduce)`（末尾の全体規則: `transition-duration: 0s !important`） | あり | フェードは自動的に即時になる。自動非表示そのものは動き続ける（動かすのは不透明度だけ） |
| 狭い窓・モバイル用のレイアウト | **無い**（`@media (max-width: 760px)` は印刷パネルだけ、`(hover: none)` は Mermaid の色ボタンだけ。ウィンドウの最小サイズも設定していない） | 変更なし。幅が足りないとき `#header-actions`（約 580px）は縮まない（今のまま）。`#header-title` は `min-width: 0` と省略記号 |
| `forced-colors` | 記述なし | `chrome.css` に `@media (forced-colors: active)` を最初から入れる（バーは不透明・`border-bottom: 1px solid CanvasText`・`backdrop-filter: none`）。仕上げは P6 |

`print.css`（変更しない）: `body > *:not(#app)`、`#app > *:not(#workspace)` を隠し、`#app`・`#workspace` を `position: static !important`、`#preview-pane` の `padding: 0 !important`。**`#header`・`#status-bar` が `#app` の直接の子であること、`#workspace` の外にあることに頼っている**（`tests/print_style_test.mjs`、スモーク 97・101）。`chrome.css` を `media="screen"` で読めば、印刷に絶対配置が出ない。

### 2.3 `app.js` の関数・箇所

| 関数・箇所 | 今の前提 | 必要なこと |
| --- | --- | --- |
| `dockPanelBar(bar, editor, index)` | `cursorY = (editorRect.top - workspaceRect.top) + (coords.top - editor.scrollTop)`、`barBottom = 16 + (bar.offsetHeight \|\| 74) + 8`（バーは `#workspace` の上端から 16px） | `cursorY` は変わらない（`#workspace` と編集箱の上端が同じ 0 のまま）。`barBottom = ov.top + 16 + ... + 8`（`ov = ChromeOverlay.insets()`）。**式 `keepCoordsInView(getCharPixelCoords(index, editor), editor)` は変えない**（`tests/huge_note_perf_test.mjs` が文字列で見る） |
| `goToMatch(index)` | `topReserved = 85`（検索バー + 余白）、可視判定 `charTop >= scrollTop + topReserved` と `charBottom <= scrollTop + viewHeight - 20` | `topReserved = ov.top + 85`、下は `viewHeight - ov.bottom - 20`。`getCharPixelTop` は上 padding 込みの値なので他は変えない |
| `gotoLineNumber`、`rpcRevealOffset` | `targetScroll = top - floor(viewHeight / 3)`、`rpcRevealOffset` の「すでに見えている」判定が `[scrollTop, scrollTop + viewHeight]` | `gotoLineNumber` はそのまま。`rpcRevealOffset` は `[scrollTop + ov.top, scrollTop + viewHeight - ov.bottom]` で判定（バーの下に隠れた行を「見えている」と数えない）。`tests/smoke/89_rpc_cursor.mjs` を確認 |
| `getCharPixelCoords`、`invalidateCharPixelMirrors`、`charMirrorGeneration` | mirror が `style.padding` を写す。幅・世代が変わったときだけ再コピー | 余白が変わる操作（`applyAppearance`、Zen の切り替え）で `invalidateCharPixelMirrors()` を呼ぶ |
| `keepCoordsInView(coords, editor)` | 推定 `top` を `[scrollTop, scrollTop + clientHeight - lineHeight]` に収める | `[scrollTop + ov.top, scrollTop + clientHeight - ov.bottom - lineHeight]`（任意の磨き） |
| `showCursorAura`、`hideCursorAura`、`triggerCursorAuraDebounced` | `y < 0 \|\| y > editor.clientHeight` なら隠す | 変更不要（オーラはバーの下に隠れる）。任意: `y < ov.top` なら出さない |
| `renderGhostText`、`syncGhostScroll`、`syncGhostGutter` | `ghostInnerEl` を `translate(-scrollLeft, -scrollTop)`、`ghostOverlayEl.style.right = スクロールバー幅` | 変更不要。**CSS の `padding` が textarea と一致していること**だけを守る（テスト: 両者の computed padding が等しい） |
| `renderLineGutter(el, lines, rows)` | 5 桁以上で `el.style.minWidth = calc(13px + Nch)` | 桁が変わったとき、ガターの実幅を `--gutter-w` に流す（`#header-title` の左位置用。§3 S6）。`el.style.minWidth` の形は変えない（`tests/editor_find_paste_fixes_test.mjs` が見る） |
| `updateLineNumbers`、`updateResultAccent`、`gutterRowPitch` | `padTop = parseFloat(getComputedStyle(gutter).paddingTop)` で帯を置く | 変更不要（上 padding が textarea と同じなら帯は合う）。テスト: 結果ブロックの帯が該当行と同じ y（スモーク） |
| `editorEl.addEventListener('scroll', ...)`（`lineNumbersEl.scrollTop = editorEl.scrollTop`）、プレビュー同期の 2 つ、`showFindMark` の `follow` | ガターは `scrollTop` を写す。同期は `scrollHeight - clientHeight` の比 | 変更不要（`padding` は両側に同じだけ入る）。**ガターの `scrollHeight` が textarea と同じになる**ことを確かめる（下余白を両方に入れる） |
| `showFindMark` / `findMarkRects` | 層を `editor.offsetTop/offsetLeft/offsetWidth/offsetHeight` に置き、箱は mirror の座標 | 変更不要 |
| `applyFontSize` | `editorEl`・`ghostOverlayEl`・`lineNumbersEl`・副の 2 つに `fontSize` を直接設定 | 変更不要（余白は px の変数で、フォントに依存しない） |
| `onEditorInput` の `triggerZenModeActive()`、`editorEl` の `compositionstart`、`endZenModeActiveIfEditorLost`（`editorEl` と `editorSecondary` の `blur`）、`toggleZenMode`、`isNoteEditorFocused` | `zen-active` の付け外し | **すべて削除**し、`ChromeOverlay` に置き換える。副エディタの `input` は今 `triggerZenModeActive` を呼ばない（今のすき間）。文書レベルの捕捉で直る |
| `showMessage(msg, duration, opts)`（`opts.quiet`）、`window.showMessage` | `data-quiet` で「静かな通知」は薄いバーを戻さない | `opts.important` を足す（§4.6）。153 か所の呼び出しは変えない |
| `document` の `keydown` の Escape の優先順（文脈メニュー → ゴースト → 質問バー → コマンドバー → 検索バー → 行へ移動 → 設定 → パレット → Mobile Drop → Zen） | 最後が Zen の解除 | Zen の前に「フォーカスがバーの中なら本文へ戻す」を足す |
| `DEFAULT_SHORTCUTS_WIN` / `_MAC`、`matchShortcut`、設定の `renderShortcutsTable`（`labelKey: 'shortcutActionZenMode'` の並び） | 両方の表のキーが一致 | `focusChrome`（既定 Windows `F6`、Mac は O5）を足し、`i18n.js` の en/ja に名前（`WebView2` は `PutAreBrowserAcceleratorKeysEnabled(false)` なので F6 はページに届く） |
| `loadLocalConfigSync`、`syncBackendConfig`、`applyImportedConfig`、`savePersistentConfig`、`openSettings`、設定の保存ハンドラ、`applyTheme` | トップレベルのキーを**1 つずつ**読む（読まないキーは次の保存で消える。`semantic` の前例） | §4.8 |
| `openHelpMenu` / `closeHelpMenu`、`#stat-ai` の popover（`status_ai.js`）、`#btn-all-tabs`（`tab_overflow.js`） | `aria-expanded="true"` を付ける | 同じ印を「保つ条件」に使う（既存の仕組みに乗る） |
| `isFullscreenNow` / `syncFullscreenState` | `body.is-fullscreen` | 変更不要 |
| `openSplitEditor`、`openPreviewToSide`、`closeSecondaryPane`、`#pane-resizer` のドラッグ（`workspaceEl.getBoundingClientRect().width`） | 幅だけを見る | 変更不要。分割中の主エディタのスクロールバー（窓の中ほど）の上端はヘッダーに隠れる（O8、小） |

### 2.4 他の JS モジュール

| ファイル | 依存 | 必要なこと |
| --- | --- | --- |
| `jev_action.js` | `dockPanel(edge)` が `top = '16px'` / `bottom = '16px'`、`repositionPanel` が `gap = 16`、`bottomDockTop = wrapRect.height - gap - panelH`、`topDockBottom = gap + panelH`（`wrapRect` は `#editor-wrapper`＝窓いっぱいになる） | `ov = ChromeOverlay.insets()`（無ければ 0）。`top = calc(ovTop + 16px)`、`bottomDockTop = height - ovBottom - gap - panelH`、`topDockBottom = ovTop + gap + panelH`。`jev_action_test.js` に追加 |
| `line_gutter.js` | `measure`/`rowsFor` が `cs.padding` を写し、`sig` に `cs.padding` を含める | 変更不要（余白が変われば `sig` が変わりキャッシュが捨てられる） |
| `file_anchor.js` | `copyMetrics`（`cs.padding`）、`checkHoverLegacy`（`rect.top` と `scrollTop` から座標。`coords.top` は padding 込み） | 変更不要。`applyAppearance` で余白が変わったら `FileAnchor.scheduleMarks()` を呼ぶ |
| `ghost_diff.js` | 帯の `top = box.top - scrollTop`（padding 込み） | 変更不要 |
| `slot_agent.js` | ビューポート座標（`Math.min(window.innerHeight - 40, ...)`）、`getCharPixelCoords` | 変更不要 |
| `status_ai.js` | popover を `trigger.getBoundingClientRect()` から置く、Esc で閉じる | 変更不要。開いている間フッターを保つ（`aria-expanded`） |
| `tab_overflow.js` | `panelPosition(anchorRect, ...)`、`scrollEl.getBoundingClientRect()` | 変更不要 |
| `chrome_layout.js` | `#header-actions` の子（`button[id]`、`.header-divider`）だけ | **触らない**。`#header-actions` の DOM を保つ |
| `a11y.js` | `markLiveRegions`（`#stat-message`、`#stat-llm-indicator` を `role=status` / `aria-live=polite`）、`markStatusToggles`（`#status-bar .clickable-badge`） | 変更不要。**フッターを `display: none` / `visibility: hidden` にしない**（読み上げから外れる） |
| `panel_fade.js` | フォーカス基準で 4 つの入力パネルを閉じる | 変更不要（§4.5） |
| `voice_input.js`（`#stat-recording`）、`task_manager.js`（`#stat-tasks`） | フッターのチップ | 変更不要。フッターを保つ条件に入れる |
| `config_pack.js` | `CONFIG_SECTIONS`（`general` の `keys: ['general']`）。知らないトップレベルのキーは `other`（`keys: null`）に入る | `appearance` を `general` の `keys` に足す（好みの設定なので）。足さなくても `other` で動く |
| `i18n.js`（CRLF） | en/ja の表 | 設定の文言・ショートカット名を両言語に。`tests/i18n_test.mjs`・`english_ui_strings_test.mjs` が揃いを見る |

### 2.5 Go・設定

- `SaveConfig(configJSON)` は JSON をそのままファイルへ書く（`os.WriteFile`）。キーの検証・既知キーの絞り込みは**無い**。`GetConfig` はファイルの中身をそのまま返す。差分で再初期化するのは `scraps` / `action`（Jev）/ `discordBridge` / `inbox` だけ。
- `config.get`（RPC・CLI、`cli.ConfigGet`）は `RedactConfig(cfg.Values)` で秘密だけ隠して**任意のキー**を返す（`syki config get appearance` が自動で動く）。
- `pkg/configpack` は設定をそのまま通し、セクション名だけを検証する。`appearance` は秘密を持たない。
- **Go の変更は要らない**。ただし `main.go` の `//go:embed frontend/*` は `css/` と `js/` を再帰で含むので、新しいファイルは自動で入る（`*_test.js` も入っている、今と同じ）。

### 2.6 テスト・ツール・ドキュメントで古い形を前提にしているもの

| ファイル | 前提 | 対応 |
| --- | --- | --- |
| `tests/zen_active_test.mjs` | `app.js` の「Zen Mode」節をマーカー文字列で切り出し、`triggerZenModeActive` を実行 | **書き直し**（`frontend/js/chrome_overlay_test.js` と `tests/chrome_overlay_wiring_test.mjs` に分ける）。静かな通知がバーを戻さないという趣旨は残す |
| `tests/status_ai_test.mjs`（`body.zen-active #status-bar:has(probe)` を 4 本と `:focus-within`）、`tests/first_run_polish_test.mjs`（同 3 本） | CSS の文字列 | `ChromeOverlay.FOOTER_PINS`（セレクタの配列）が同じ 4 つ（`#stat-message:not(:empty):not([data-quiet])`、`#stat-llm-indicator:not(.hidden)`、`#stat-tasks:not(.hidden)`、`#stat-ai[aria-expanded="true"]`）に `#stat-recording:not(.hidden)` を含むことを見る形へ |
| `tests/smoke/74_zen_chrome_takes_no_focus.mjs` | 「Zen の隠したバーは Tab を受けない（`visibility: hidden`）」「入力中の薄化は薄いだけで Tab を受ける」 | 新しい方針（§4.6: 隠れていてもフォーカスで出る）に書き直す。「Tab で入るとバーが出る」「フォーカスが見える」を確かめる |
| `tests/panel_template_test.mjs` §1 | `--panel-top: 16px`、`.panel-dock-bottom { bottom: var(--panel-top ...` | `--panel-top: 16px` は残す。`bottom` の式を `calc(var(--ov-bottom) + var(--panel-top` に更新し、`top` が `--ov-top` を含むことを足す |
| `tests/result_blocks_wiring_test.mjs` | `#line-numbers { ... padding: 12px 6px; text-align: right }` | 新しい式に更新（`padding: var(--editor-pad-top) 6px var(--editor-pad-bottom)`） |
| `tests/editor_find_paste_fixes_test.mjs` | `#line-numbers { width: 44px }` と副ガターの同じ値 | 幅は変えない（変更不要）。確認だけ |
| `tests/huge_note_perf_test.mjs` | `dockPanelBar` の中に `keepCoordsInView(getCharPixelCoords(index, editor), editor)` が文字列である | その式を保つ |
| `tests/rev3_wiring_test.mjs`、`calm_toolbar_test.mjs`、`chrome_layout_wiring_test.mjs`、`tab_overflow_wiring_test.mjs` | `index.html` の `<div id="header-actions">` から `</header>`、`<div id="tabs-bar">` から `<div id="header-actions">` を切り出す | `#header-title` は `#tabs-bar` の**前**に置けば壊れない。構造を変えない |
| `ai_correction_test.mjs`、`second_panel_test.mjs`、`session_restore_test.mjs`、`notes_data_integrity_test.mjs` など（`app.js` を手作りの DOM で動かす） | 知っている id だけを返す DOM | `window.ChromeOverlay` が無くても動くこと（`window.PanelFade && ... ? ... : null` の書き方に合わせる）。`getElementById('header')` が null でも落ちない |
| `tests/smoke/97_print_preview.mjs`、`101_print_side_preview.mjs` | 印刷で `#header`・`#status-bar` が `display: none` | 変更なし。`chrome.css` が `media="screen"` であること |
| `tools/docshots/run.mjs`（撮影前に `document.body.classList.remove('zen-active')`）、`setups.mjs`（`zenMode`、`#editor{color:transparent!important} #line-numbers{visibility:hidden}` の注入、`ctx.type` で本文に入力する多数の setup）、`mock/backend.js`（`D.scrollToLine`、`D.isReady` が `#stat-message` の空を待つ）、`shots.json`（`zen-mode` の説明、`#header-actions` のマーカー） | 旧ジオメトリ・旧 Zen | 撮影前に `ChromeOverlay.show()`（`zen-active` を外す代わり）。入力した直後の図でバーが消える問題はこれで直る。`zen-mode` の図は新しい Zen に合わせて撮り直し。**全図の撮り直しは P6** |
| `docs/design/panel-template.md`（「ヘッダーの下 16px」）、`docs/design/ux-review-2026-09.md`（B8）、`docs/features*.md`・`manual*.html`（Zen の記述 各 10 か所前後）、`tools/MACOS_CHECKLIST_JA.md` | 旧 Zen・旧位置 | S7 で更新。Mac のチェックリストに「すりガラス・`scroll-padding`・下余白・F6」を足す |

## 3. 実装計画（ステップ）

各ステップの終わりで**アプリは動く**。各ステップで JS 全件（`node tools/run_js_tests.mjs`）、該当するスモーク（`node tests/smoke/run.mjs --only ...`）を回し、S2 以降は隔離した実アプリのスクリーンショットを自分の目で見る（契約 §2.1）。

### S0. 実機での前提確認（製品の変更なし）

`v2-base.exe` を隔離して起動し、CDP で §1 の E1〜E5 を再確認する: textarea の `padding-bottom` がスクロール範囲に入る、`scroll-padding` がキャレット追従に効く、`pointerdown` がスクロールバーで届く、`F6` が `keydown` として届く、スクロールバーの幅（WebView2 の細いスクロールバーか）。結果を §6 に書き戻す。Mac の確認項目（下余白・`scroll-padding`・`-webkit-backdrop-filter`・opacity の切り替えでぼかしが消えないか）を `tools/MACOS_CHECKLIST_JA.md` の案に追記する。

### S1. 余白の変数化（見た目は変えない）

- 内容: `chrome.css`（新規）に `:root` / `body` の `--ov-top: 38px; --ov-bottom: 24px; --ov-inset-top: 0px; --ov-inset-bottom: 0px; --pad-x: 14px; --pad-y: 12px; --pad-top-extra: 0px; --editor-pad-top; --editor-pad-bottom` を定義し、`#editor`・`#editor-secondary`・`#ghost-overlay`・`#line-numbers`・`.secondary-editor-pane .line-numbers` の `padding` を同じ変数で上書きする（同じ詳細度で後から読むので勝つ）。`<link rel="stylesheet" href="css/chrome.css" media="screen">` を足す。
- 変更: `frontend/css/chrome.css`（新規）、`frontend/index.html`（link 1 行）。
- テスト: 新規 `tests/chrome_overlay_wiring_test.mjs` に「4 つの箱の computed に相当する `padding` が同じ変数式」を静的に確認。**docshots を撮り直して基準と画素一致**（`compare_dirs.py`）。
- 状態: 見た目は同じ（`--ov-inset-*` が 0）。

### S2. オーバーレイへ切り替え（バーは常に見える・不透明）

- 内容: `chrome.css` に `#app { position: relative }`、`#header`・`#status-bar` の絶対配置（§2.2）、`--ov-inset-top: var(--ov-top)`・`--ov-inset-bottom: var(--ov-bottom)`、`scroll-padding`、プレビュー・副ペイン・バッジ・印刷ボタン・検索バー・質問バー・コマンドバー・Jev・popover の位置式（§2.2）。`app.js` の `dockPanelBar` と `goToMatch`、`rpcRevealOffset`、`jev_action.js` の `dockPanel`/`repositionPanel` を `ChromeOverlay.insets()` に（`chrome_overlay.js` は `insets()` だけ先に出す。DOM の `offsetHeight` を読み、未読み込みなら 0）。旧 Zen の規則（`zen-active`・`zen-mode`）は**そのまま**（`zen-mode` の `#editor { padding: 24px 32px }` は一時的に上の余白を食うが、バーが隠れている間だけなので許容。S5 で消す）。
- 変更: `frontend/css/chrome.css`、`frontend/js/chrome_overlay.js`（`insets()` のみ）、`frontend/js/app.js`、`frontend/js/jev_action.js`、`frontend/index.html`（script 1 行）。
- テスト: `panel_template_test.mjs`・`result_blocks_wiring_test.mjs` を更新。`jev_action_test.js` に上下の余白の計算を追加。新規スモーク `110_chrome_overlay.mjs`（下の「スモーク」）。既存スモーク 04・05・06・62・63・67・81・83・89・90・97・101 を回す。
- 状態: 本文がバーの下をくぐる（不透明なので見た目は今に近い）。バーは消えない。旧 Zen の薄化はまだ動く。
- 確認: ゴースト（`#ghost-overlay` の接尾辞がキャレットの行に出る）、行番号の位置、結果ブロックの帯、検索の現在の一致、行へ移動、分割（右ペインの帯がバーの下に出る）、プレビュー・バッジ、`html-mode`、フルスクリーン。

### S3. 自動非表示（`chrome_overlay.js` の本体）

- 内容: §4 の状態機械。`ChromeOverlay.create({...})` を `app.js` で 1 回呼ぶ（`window.PanelFade` と同じ守り: `window.ChromeOverlay` が無ければ何もしない）。`triggerZenModeActive` / `endZenModeActiveIfEditorLost` とその呼び出し・リスナーを削除。`chrome.css` に `body.chrome-faded` の規則（§4.3）。`F6`（`focusChrome`）と Escape の優先順への 1 行。設定がまだ無いので `autoHide` は常に `true`（S4 で設定に）。
- 変更: `chrome_overlay.js`、`app.js`、`chrome.css`、`i18n.js`（ショートカット名）、`DEFAULT_SHORTCUTS_*`。
- テスト: 新規 `frontend/js/chrome_overlay_test.js`（状態機械）、`tests/chrome_overlay_wiring_test.mjs`、スモーク 74 の書き直し、`tests/zen_active_test.mjs` の置き換え、`status_ai_test.mjs`・`first_run_polish_test.mjs` の更新。
- 状態: 入力・スクロールでバーが消え、ポインタ・フォーカス・F6 で戻る。Zen（`zen-mode`）は旧実装のまま。

### S4. 透過（`bars`）と設定

- 内容: `appearance.js`（正規化・既定値）、`config.appearance` の読み込み 2 経路・保存・設定パッケージ、設定画面の行（`#cfg-bars`、`#cfg-auto-hide`。既存の「外観 & ウィンドウ」の節 `sectionAppearance`）、`applyAppearance()`（`body[data-bars]` と `ChromeOverlay.configure({autoHide})`）、`chrome.css` の `body[data-bars="light"|"glass"]`、チャンネルのトークン（`tokens.css` に `--bar-top-rgb` `--bar-bottom-rgb` `--text-muted-rgb`）。
- CSS の形（値は初期案。実アプリで見て決める。`color-mix()` は使わず、チャンネルのトークンで作る）:

  ```css
  body { --bar-a: 1; }                                  /* solid */
  body[data-bars="light"] { --bar-a: 0.80; }
  body[data-bars="glass"] { --bar-a: 0.55; }
  #header { background: rgb(var(--bar-top-rgb) / var(--bar-a)); }
  #status-bar { background: rgb(var(--bar-bottom-rgb) / var(--bar-a)); }
  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    body[data-bars="glass"] #header, body[data-bars="glass"] #status-bar {
      -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
    }
  }
  @supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    body[data-bars="glass"] { --bar-a: 0.80; }          /* falls back to light */
  }
  body.chrome-faded #header:not(:focus-within):not([data-pin]),
  body.chrome-faded #status-bar:not(:focus-within):not([data-pin]) { opacity: 0; pointer-events: none; }
  ```
- 変更: `appearance.js`（新規）、`app.js`、`index.html`（設定の 2 行）、`i18n.js`（CRLF。`git ls-files --eol` で確認し、Edit ツールで）、`config_pack.js`（`general` の `keys` に `appearance`）、`chrome.css`、`tokens.css`。
- テスト: `frontend/js/appearance_test.js`、`config_pack_test.js` に 1 件、`tests/chrome_overlay_wiring_test.mjs`（チャンネルのトークンが 16 進のトークンと同じ色であること、`@supports` のフォールバック、`-webkit-backdrop-filter` の併記、`color-mix` が `chrome.css` に無いこと）、`tests/settings_*` の既存を回す、`i18n_test.mjs`。
- 状態: 設定で 3 段階を選べる。既定は `light`（S8 の測定で確定、5.6）。

### S5. Zen（`zen-mode`）の新しい意味

- 内容: §4.6。`setZen()`、ホットゾーン、`showMessage` の `important`、`#stat-message` の見た目の抑制、「余白」（O1 の回答で確定）。旧 `body.zen-mode` の規則と `body.zen-active` の規則を `style.css` から**削除**する（この時点で P1a が統合済みなので衝突しない）。
- テスト: スモーク `111_chrome_zen.mjs`、`chrome_overlay_test.js` に Zen、`settings_group_fixes_test.mjs`（Shift+F11 が Zen）と RPC `ui.state.zen` / `ui.set_view {zen}`（スモーク 90）を回す。

### S6. 行番号を余白に（薄く）とヘッダーのタイトル

- 内容: `#line-numbers`・副ガターの背景と `border-right` を消し、文字を `rgb(var(--text-muted-rgb) / 0.55)`（`opacity` ではなく色のアルファ。8 万行の巨大な要素に `opacity` を付けると中間の描画面ができるのを避ける）。`#header-title`（ファイル名のみ。`getActiveTab().title`。`renderTabs` と `onEditorInput` の自動タイトルの 2 か所で更新。未保存の印は付けない）を作り、P3 まで `display: none`。`--gutter-w` を `renderLineGutter` が更新。
- テスト: コントラストの計算（紙と墨の両方。P1b の値が入ってから）、スモーク 83（5 桁のガター）、結果ブロックの帯。
- 状態: 見た目が v2 に近づく。

### S7. 後始末・ドキュメント・ツール

- `style.css` の旧規則（`#header`・`#status-bar` の `position: relative`/`height`/`transition`、`#editor` などの旧 `padding`、`body.zen-*` の全部）を削除して `chrome.css` に一本化するか、`chrome.css` を `style.css` に畳む（P6 でもよい）。`docs/design/panel-template.md`、`ux-review-2026-09.md` の B8、`docs/features*.md`、マニュアル、`tools/docshots`（`run.mjs`・`setups.mjs` の `zenMode`・`shots.json`）、`tools/MACOS_CHECKLIST_JA.md`。`tools/check_manual.py`（RPC・CLI の書き忘れ検出）は新しい RPC を足さないので影響なし。
- 報告: 追加した CSS/JS のバイト数（見込みは §5.1）と起動の差。

### S8. 測定と既定の決定

§5。結果を `tools/perf/` の記録（`v2-p2-*.md`）と本書の §5.6 に書き、`appearance.js` の既定 1 行を確定する。**他のステップと並行して S2 の直後から測れる**（不透明の段階で基準との差を見る）。

### スモーク（新規）

- `tests/smoke/110_chrome_overlay.mjs`（番号は P3 以降と衝突しないよう 110 台を P2 が使う）:
  1. ジオメトリ: `#header` の矩形が窓の上端、`#editor` の矩形が窓いっぱい、先頭行の矩形 `top` がヘッダーの下端以上。`#line-numbers` の 1 の `top` と本文 1 行目の `top` が同じ。ゴーストが出ているとき接尾辞の矩形がキャレットの行と同じ y。
  2. 入力: 本文にフォーカスして実入力（`s.type`、`isTrusted`）で `body.chrome-faded`、`#header`・`#status-bar` の `opacity` が 0 に向かい `pointer-events: none`、`visibility` は `visible`（読み上げに残る）。**合成の `input` では隠れない**（AI の挿入・RPC 書き込みを区別）。
  3. IME: `compositionstart`（合成イベント）では隠れる設計なので、`Input.imeSetComposition`（CDP）が使えるなら実際に、使えなければ `keydown(Process)` だけ送って**隠れない**ことと、`compositionstart` で隠れることを分けて見る。
  4. 戻る: 6px 未満のポインタ移動では戻らず、6px 以上で戻る。`pointer-events` が戻り、ヘッダーのボタンが実クリックで押せる。
  5. フォーカス: AWAY のまま `#btn-find` に `focus()` するとヘッダーの `opacity` が 1。Tab で入れる。`F6` でヘッダー → フッター → 本文。Esc で本文へ。
  6. 保つ条件: `#stat-ai` の popover を開く間、フッターが消えない。`showMessage`（静かでない）でフッターが出る。静かな通知では出ない。
  7. スクロール: ホイールで AWAY。**タブをクリックしたあとのプログラムのスクロールでは隠れない**（ユーザーの操作が先に無い）。
  8. 分割: 右ペインの帯（`#secondary-pane-header`）がヘッダーの下に出て、`#btn-secondary-print` が押せる。
  9. `autoHide` オフ: 入力してもバーが残る。リスナーが付かない（`ChromeOverlay` の内部カウンタ）。
- `tests/smoke/111_chrome_zen.mjs`: §4.6 の項目（ポインタを動かしても戻らない、ホットゾーンで戻る、`important` で戻る、通常のメッセージは見えない、Esc で Zen を抜ける、`ui.state.zen`）。
- 74 の書き直し（§2.6）。

## 4. 自動非表示の状態機械、キーボード、設定

### 4.1 状態

- `SHOWN`: バーが見える（既定）。
- `AWAY`: `body.chrome-faded`。バー（`#header`・`#status-bar`）は `opacity: 0; pointer-events: none`。**`visibility` と `display` は変えない**（読み上げ・Tab から外さない）。
- `zen`（フラグ）: Zen のとき真。AWAY が基本で、戻る条件が狭くなる（§4.6）。
- 各バーに `data-pin`（JS が付ける）: そのバーだけ AWAY の間も見せる。

### 4.2 イベントと遷移（`autoHide` が真のとき）

リスナーは**状態に応じて付け替える**（SHOWN では入力・スクロールを聞き、AWAY ではポインタを聞く。同時には片方だけ）。`autoHide` が偽、または `ChromeOverlay` を作っていないときは 1 つも付けない。

| イベント（`document`、捕捉段階、`passive`） | 条件 | 遷移・動作 |
| --- | --- | --- |
| `input` | `e.isTrusted` かつ `e.target` が `#editor` / `#editor-secondary` | SHOWN → AWAY（アンカーのポインタ座標を覚える） |
| `compositionstart` | 同上 | SHOWN → AWAY（日本語 IME は `keydown` の `key` が `Process` なので `keydown` は使わない。E4） |
| `wheel`、`keydown`、`pointerdown`（対象がバーの外） | `e.isTrusted` | `intentAt = e.timeStamp`（ユーザーがスクロールしようとした印）。`pointerdown` はスクロールバー上（`clientX` が対象の `clientWidth` より右）でも同じ（E5） |
| `scroll` | `e.target` が `#editor` / `#editor-secondary` / `#preview-pane` / `#secondary-preview-pane` で、`intentAt` から 300ms 以内 | SHOWN → AWAY。**プログラムのスクロール（タブ切り替え、行へ移動の `scrollTop` 代入、同期スクロール）は意図の印が無ければ無視**する（さもないとタブをクリックした瞬間にヘッダーが消える）。iframe（`html-mode`）の `previewScroll` メッセージは `ChromeOverlay.scrolled()` を呼ぶ |
| `pointermove`（AWAY の間だけ聞く） | 非 Zen。アンカーからの距離（`|dx| + |dy|`）が 6px 以上 | AWAY → SHOWN。6px 未満は無視（合成の移動・手の震え） |
| `focusin`（バーの中） | — | 何もしない（`:focus-within` が CSS で見せる）。JS は触らない |
| `focusout`（本文から。AWAY の間だけ聞く） | 0ms 後に `document.activeElement` が本文のどちらでもない（質問バー・ダイアログへ移った） | AWAY → SHOWN（旧 `endZenModeActiveIfEditorLost` と同じ。本文の 2 ペイン間の移動では戻らない） |
| `keydown` が `focusChrome`（F6） | — | SHOWN にして、本文 → ヘッダー → フッター → 本文の順にフォーカス（Shift で逆）。Zen でも出す |
| 設定 `autoHide` が偽に | — | SHOWN にして全リスナーを外す |
| `configure()`、`setZen()` | — | §4.6 |

タイマーは**無い**（AWAY に時間切れは無い。入力が止まってもバーは戻らない＝旧 `zen-active` の「暗・明・暗」を避けた考えを引き継ぐ）。Zen のホットゾーンだけ例外（§4.6）。

### 4.3 バーを保つ条件（AWAY の間も見せる）

- 共通（CSS）: `:focus-within`。`body.chrome-faded #header:not(:focus-within):not([data-pin]) { opacity: 0; pointer-events: none }`（フッターも同じ）。
- ヘッダー（JS が `data-pin` を付ける）: 中に `[aria-expanded="true"]` がある間（`#btn-help` のメニュー、`#btn-all-tabs` の一覧）。
- フッター（JS）: `ChromeOverlay.FOOTER_PINS`（セレクタの配列）のどれかが一致する間。`#stat-message:not(:empty):not([data-quiet])`、`#stat-llm-indicator:not(.hidden)`、`#stat-tasks:not(.hidden)`、`#stat-recording:not(.hidden)`、`#stat-ai[aria-expanded="true"]`（旧 `zen-active` の `:has()` 規則の 6 本と同じ中身）。`MutationObserver` を**AWAY の間だけ**フッターに付ける（`attributes`: `class`・`aria-expanded`・`data-quiet`、`childList`+`characterData`: `#stat-message`）。SHOWN に戻れば外す。AWAY に入るときに 1 回同期で評価する。
- 静かな通知（`data-quiet`: 自動保存の "Saved"）は戻さない（旧仕様を保つ）。
- ポインタがバーの上にある間は、そもそもバーが SHOWN（ポインタを動かして戻したから）。

### 4.4 キーボード・スクリーンリーダー・IME

- 隠れているバーの中の部品にも Tab で入れる。入った瞬間に `:focus-within` で見える（旧 Zen の「見えないボタンに Enter で設定が変わる」問題は、**入るとバーが出る**ことで解消する。`visibility: hidden` は使わない）。
- `#stat-message`（`role=status`、`aria-live=polite`）と `#stat-llm-indicator` は隠さない。見た目だけ抑える Zen でも読み上げには残す（O2 で確認）。
- `F6` の既定（Windows）。他の機能が `F6` を使っていないことは確認済み（`DEFAULT_SHORTCUTS_WIN` に無い）。Mac は O5。設定の一覧に出す。
- 日本語 IME: `compositionstart` と `input` で検出（E4）。IME の確定の `Enter` などは `keydown` を見ないので影響しない。`finishImeRetype` などが `onEditorInput` を呼ぶ経路は、`isTrusted` な `input` だけを数えるので、アプリ側の補正で勝手に隠れない。
- AI の結果の挿入（`insertTextWithUndo` は `execCommand` で、`isTrusted` な `input` を出す）はバーを隠しうる。害は小さい（O9）。

### 4.5 `panel_fade.js` との関係

独立（フォーカス基準で 4 つの入力パネルを閉じるだけ）。接点は 2 つ:

1. パネルの位置はバーの高さ（`--ov-top` / `--ov-bottom`）から計算する（§2.2・2.3）。バーが AWAY でも位置は変えない（位置を変えるとレイアウトが動く）。
2. 質問バー・コマンドバーの入力欄に打つ入力は本文ではないので**バーを隠さない**（`e.target` が本文のときだけ）。パネルにフォーカスがある間、バーは SHOWN のまま。パネルがフォーカスを失って閉じ、本文に戻って打てば AWAY になる。

### 4.6 Zen（`body.zen-mode`、Shift+F11 / `ui.set_view { zen }` / `ui.state.zen` は今のまま）

| 項目 | 新しい動き |
| --- | --- |
| バー | 常に AWAY（`chrome-faded` を付ける）。ポインタの移動では戻らない。戻るのは (a) 窓の上端・下端 6px のホットゾーンにポインタが 150ms いる、(b) F6 または Tab でフォーカスが入る、(c) `important` なメッセージ、(d) フッターの保つ条件のうち**録音中**（O3）。ホットゾーンを出たら 700ms 後に AWAY（この 2 つのタイマーは Zen の中だけ作る） |
| 通知 | `#stat-message` は**見た目だけ抑える**（`.visually-hidden` と同じ。DOM と `aria-live` には残すので、読み上げ・`window.__explore.toasts`・RPC の `statusText` は今のまま）。保つ条件の `#stat-message` は Zen では無効（フッターを戻さない） |
| `important` | `showMessage(msg, ms, { important: true })` は Zen でもフッターを戻し、メッセージが消えるまで保つ。付けるのは**失敗だけ**: `configSaveFailed`、`configNotSavedUnreadable`、保存の失敗（`saveTabNow` の失敗）、`diskConflict*`、`startupFileFailed`、`sessionUnreadable`、`globalShortcutRegisterFailed`（おおむね 8 か所。呼び出しの総数 153 のうち）。タブの `!` 印と Autosave チップの "failed" はバーの中なので、Zen では見えない（O3） |
| 余白 | **決定（オーナー、2026-10-04）: 余白は消さない。現行どおり**: 本文の左右の余白を広げる（`--pad-x` を `32px`）、行番号は 30% に薄める（列は畳まない）。変更は 1 回の再レイアウトなので `invalidateCharPixelMirrors()` を呼ぶ。O1 は決着 |
| 解除 | Esc（フォーカスがバーの中ならまず本文へ戻す）、Shift+F11、右クリックメニュー、パレット（今のまま） |
| P3 のタブの帯 | `v2-plan-P3.md` の Zen の項どおり、Zen では帯を `visibility: hidden`（帯は `chrome-faded` では消さない）。P2 は触らない |

### 4.7 設定（`config.appearance`、JS 側）

| キー | 値 | 既定 | 備考 |
| --- | --- | --- | --- |
| `appearance.bars` | `'solid'`（不透明）/ `'light'`（うすい: 半透明、ぼかしなし）/ `'glass'`（すりガラス） | **`'light'`（S8 の測定で確定、5.6）**。決定は `appearance.js` の定数 1 行 | 不正な値は既定に戻す。Mac（Safari 15.6 まで）で `-webkit-backdrop-filter` が使えない・不安定なら `glass` は `light` に落ちる（CSS の `@supports not`） |
| `appearance.autoHide` | `true` / `false` | `true` | 設計の「Zen でなくても既定で働く」。UX レビュー B8 の「切る設定」にもなる。`false` ならリスナーを 1 つも付けない |

- P1b のキー（地 `ground`、アクセント `accent`、フォント `editorFont` など）は同じ `appearance` に入る。**`appearance.js` の正規化は知らないキーを捨てずに残す**（P1b・P4 が足したキーを P2 の保存で消さない）。
- 保存は、選んだ値を明示で書く（他の設定と同じ）。既定を後で変えても、触った人の値は動かない。
- 設定画面: 既存の「外観 & ウィンドウ」の節（`sectionAppearance`、`#cfg-theme` の下）に `#cfg-bars`（`<select>` 3 択）と `#cfg-auto-hide`（チェックボックス）。文言は en/ja の両方（`i18n.js`）。

### 4.8 `config` の読み書き（調べた結果）

- 読み込みは**許可リスト式**: `loadLocalConfigSync`（localStorage の `syki_config_v1`）と `syncBackendConfig`（`config.json`）が、`text`・`autocomplete`・`vision`・`voice`・`cli`・`image`・`scraps`・`discordBridge`・`inbox`・`action`・`autoSelector`・`general`・`shortcuts` などを**1 つずつ** `Object.assign` する。`semantic` は前例（「このページは全体を書き戻すので、読まないグループは次の保存で消える」）。→ **`appearance` を両方に足す**（足さないと保存で消える）。
- 保存は `JSON.stringify(config)` の全体（`savePersistentConfig`）。ローカルのコピーは `SecretStrip.saveLocalCopy`（秘密だけ空にして全体を書く）。→ `appearance` は自動で入る。
- 読み込み順: `loadLocalConfigSync` は**最初の描画の前**に同期で走る（`applyTheme()` の隣）。`applyAppearance()` もここで呼ぶ（バーの透過・自動非表示のちらつきを避ける）。`syncBackendConfig` の後で値が変わったときだけ再適用する（`applyTheme` と同じ「前の値と比べる」）。
- 設定画面: 開いたときのスナップショット（`openedConfigSnapshot`）と保存ハンドラ（`cfg-theme` の隣）に足す。取り消しで元に戻す。
- 設定パッケージ（`config_pack.js`）: 知らないトップレベルのキーは `other`（`keys: null`）に入る。**`general` の `keys` に `appearance` を足す**のを推奨（好みの設定なので「一般」と一緒に出し入れする）。`applyImportedConfig` はトップレベルのキーをそのまま `config` に入れるので、取り込んだ値は `appearance.js` の正規化を通す。
- Go: 検証なし・素通し（§2.5）。`syki config get appearance`・RPC `config.get` で見える。

### 4.9 互換性（macOS 10.15 = Safari 15.6 まで。契約 §1.5）

| 使うもの | Chromium / Safari | 備考 |
| --- | --- | --- |
| `rgb(r g b / a)`（スペース区切り + スラッシュ） | 65 / 12.1 | バーの色、行番号の色。`color-mix()` は**使わない**（Safari 16.2〜） |
| `max()` `min()` `clamp()` `calc()` | 79 / 11.1〜13.1 | 余白の式 |
| `scroll-padding-top/bottom` | 69 / 14.1 | **Chromium ではキャレット追従に効く（E2）。WebKit は未確認**。効かなくても、入力中はバーが消えるので害は小さい |
| `:focus-within` | 60 / 10.1 | 保つ条件の基本 |
| `backdrop-filter`（`-webkit-` 併記） | 76 / 9（接頭辞付き。接頭辞なしは 18） | `@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))` の中にだけ書き、無ければ `light` に落とす |
| `@media (forced-colors: active)` | 89 / 未対応（無視される） | 害なし |
| `@media (prefers-reduced-transparency)` | 118 前後 / 未対応のことが多い | 害なし（無視される） |
| `:has()` | 105 / 15.4 | **新規に使わない**（旧 `zen-active` の `:has()` 5 本は消え、JS の `data-pin` に置き換わる） |

**Safari 13〜15 で、大きなスクロール内容の上に重ねるすりガラス**（未確認。Mac 実機で確かめる。S0 のチェックリスト）:
- 接頭辞なしは Safari 18 から。15.6 では `-webkit-backdrop-filter` だけ。
- 不透明度（`opacity`）を切り替える要素に `backdrop-filter` を付けると、古い Safari で切り替えのあいだぼかしが消える・描き直されない報告がある。自動非表示は `opacity` の遷移なので当たる可能性が高い。**対策の候補**: Mac では `glass` を既定にしない（既定 `light`）、`glass` のときは `will-change: opacity`（独立した合成層）、それでも崩れるなら遷移を切って即時に消す。
- 大きなぼかし半径・広い面積は WebKit でも重い。バーの高さが 38px / 24px なので面積は小さい。
- textarea の外側で起きる再描画（スクロール中のぼかしの更新）の遅れは、Chromium では見えなかった（E6）が、WebKit の textarea のスクロールがメインスレッドか合成層かは確認していない。
- 下余白（`padding-bottom` がスクロール範囲に入る）と `scroll-padding` の追従も WebKit は未確認（E1・E2 は Chromium）。入らなかった場合の代替: 最後の行がフッターに隠れたままになる（入力中は消えるので実害は小さい）。それも許せなければ、textarea 自体を `margin-bottom: var(--ov-bottom)` で縮めて、下の帯だけは本文の下をくぐらない形に切り替える。

## 5. 性能計画

### 5.1 起動

- 足すもの: `chrome.css`（見込み 5〜6 KB、1 リクエスト）、`js/appearance.js`（約 2 KB）、`js/chrome_overlay.js`（約 8 KB）、i18n の追加（約 1 KB）。`app.js` は旧 Zen の約 30 行を消して配線を約 60 行足す（差し引きほぼ 0）。
- 起動時に重い処理を足さない: `ChromeOverlay.create()` は参照を持つだけで、**リスナーを付けるのは `configure()` が `autoHide: true` を受けたとき**（既定で付く。入力・スクロールの 3〜4 本の `passive` リスナー）。`MutationObserver` は AWAY の間だけ。`getComputedStyle` や `getBoundingClientRect` を起動時に呼ばない（`insets()` は呼ばれたときに `offsetHeight` を読む）。
- 測る: `v2_perf.mjs` の startup（ready まで、FCP、「app initialised」）、メモリ（アイドル 10 秒後の private working set）、アイドル CPU。基準 `baseline-v1.14.json` の min-max の内に収まること。

### 5.2 8 万行のノートで

| 懸念 | 回避 |
| --- | --- |
| 表示・非表示でレイアウトが走る | しない。切り替えは `opacity`/`pointer-events` だけ（E8: スタイル再計算 0.018 ms/回、レイアウト 0 回）。バーに `will-change: opacity`（合成層 2 枚）。**`height`/`display`/`visibility` を動かさない** |
| 1 打鍵ごとの余計な作業 | AWAY の間、入力・スクロールのリスナーは外れていて何も走らない。SHOWN のとき 1 打鍵目で 1 回クラスを付ける（0.02 ms）。打鍵ごとの `getBoundingClientRect`・`getComputedStyle` は無い |
| スクロールのリスナー | 捕捉の `passive` 1 本。`e.target` を 4 つの要素と比べて、意図の印が無ければ即 return。`wheel`/`keydown`/`pointerdown` も印を書くだけ |
| `backdrop-filter` | 範囲が小さい（1120×38 と 1120×24）。**`opacity: 0` の間は費用が出ない**（E7: すりガラス+非表示はバー無しと同じ）。自動非表示でスクロール中は消えるので、実使用ではほぼ払わない。払うのは `autoHide: false`、またはポインタを動かしながら読むとき。ソフトウェア合成では +50%（blur 14px）〜 +100%（30px）（E7、ノイズ ±100ms、合成テキスト）。`@supports` の外では書かない |
| 行番号のガター | 色のアルファ（`rgb(... / 0.55)`）で薄くする。`opacity` は使わない（80,000 行 × 22.4px の巨大な要素に中間の描画面を作る） |
| 余白の変更（設定・Zen） | `padding` の変更は 1 回の再レイアウト（E8: 0.1 ms。実ノートで要確認）。`invalidateCharPixelMirrors()` と `FileAnchor.scheduleMarks()` を 1 回 |
| 1 打鍵のレイアウト（既存の 50〜115 ms） | 変えない。textarea に新しいスタイルのクラス切り替えを当てない（`body.chrome-faded` の規則は `#header`・`#status-bar` とその子にしか効かないセレクタにする。`#editor` を含めない） |
| テキスト領域の `scroll-padding` | スクロール計算にだけ効く。再レイアウトを増やさないが、実ノートで確認 |

### 5.3 測定のチェックリスト（`tools/perf/v2_perf.mjs`、基準 `v2-base.exe` = v1.14.0、`baseline-v1.14.json`）

同じ条件（電源、他のアプリ、同じノートの sha256、同じ WebView2 ランタイム）で、**各構成を 2 回測る**。

構成（`appearance` を既定値の定数ではなく設定で切れるように、ハーネスに `--config-patch '{"appearance":{...}}'` を足してもらう。無ければ構成ごとに `v2-p2-*.exe` を作る。ハーネスの担当に依頼）:

| 構成 | `bars` | `autoHide` | 見るもの |
| --- | --- | --- | --- |
| A 基準 | （v1.14.0） | — | 比較の起点 |
| B | `solid` | `true` | 配置の変更だけの費用（余白・絶対配置） |
| C | `light` | `true` | 既定の候補 |
| D | `glass` | `true` | 実使用に近いすりガラス（スクロール中はバーが消える） |
| E | `glass` | `false` | **最悪**（バーが出たままスクロール） |
| F | `light` | `false` | 透過だけの費用 |
| G | `glass` / `false`、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu` | | ソフトウェア合成（RDP・VM） |

測るもの（`--steps startup,memory,open,scroll,typing`）:

1. **起動**: ready まで、FCP、「app initialised」の中央値が基準の min-max の内。
2. **メモリ**: アイドル 10 秒後の private working set の合計と、**GPU プロセスの内訳**（すりガラスの中間テクスチャが出るのはここ）。8 万行を開いた 3 秒後の値。
3. **アイドル CPU**: バーの遷移・リスナーが常駐の負荷になっていない（基準の範囲内）。
4. **8 万行の開く時間**: `open` の `TaskDuration` / `LayoutDuration`（余白の式の費用）。
5. **スクロール**: late frames、50ms 超のフレーム、`max`、`scroll.task_ms`（主スレッドの忙しさ）、`RecalcStyleDuration`（バーの切り替え）。**GPU プロセスの CPU 時間（種別ごと）を足してもらう**（E6・E7 でノイズ ±100ms だったので、各構成 2〜3 回）。
6. **入力**: 50 打鍵の p50/p95/max、キーハンドラが走るまでの遅れ。**最初の 1 打鍵（SHOWN → AWAY）だけ外れ値が出ないか**。
7. **自動非表示の動作時間**: 打鍵からバーの `opacity` が 0 になるまで、ポインタを動かしてから 1 に戻るまで（目で見る速さの確認。`transition` 0.15〜0.2 秒）。
8. **8 万行のノートで実際にスクリーンショット**（バーの下に文字が見える、読める）。

### 5.4 既定を決める規則（案）

`glass` を既定にするのは、次を**すべて**満たすときだけ。1 つでも外れたら `light`:

- D（実使用）が B・C に対して、late frames と 50ms 超のフレームが基準の範囲内、`scroll.task_ms` が +10% 以内、起動・メモリ（GPU プロセスを含む）が基準の min-max 内、打鍵の p95 が +2 ms 以内。
- E（最悪）でも、フレームの落ち方が基準の範囲内で、体感できる違いが出ない。
- G（ソフトウェア合成）で、GPU プロセスの CPU 時間が C の +30% 以内（E7 では +50%）。出なければ `glass` は設定の選択肢に留める。
- Mac での確認が済んでいること（Safari 15.6 までの問題が §4.9 のとおり未確認）。**済むまで Mac の既定は `light`**（プラットフォームごとの既定は `appearance.js` で分けられる）。

### 5.5 これまでの測定（参考。§1 の E6〜E8）

実アプリの測定ではない。結論の方向: **ハードウェア GPU では差が見えない。ソフトウェア合成では `opacity: 0` の間は費用ゼロ、見えているあいだは +50〜100%。** 既定は `light` が安全で、`glass` はポインタを動かしながら読む人向けの選択肢という見立て。実アプリ・実ノートの数字は S8 で本書に追記する。

### 5.6 S8 の結果と既定の決定（2026-10-04、P2b。隔離した実アプリ、8 万行、アニメーションあり、同じセッションで交互に）

数字・全表・各回の値・条件・再現手順は **`tools/perf/v2-p2-translucency.md`**（マトリクスの定義は `tools/perf/matrix-p2-*.json`）。ここには 5.4 の規則に当てた結論だけを書く。この PC はアニメーションを切る設定（`prefers-reduced-motion: reduce`）なので、全構成を CDP で `no-preference` にして測った（毎回 3 度確認）。

| 5.4 の項目 | 結果（D = glass、自動非表示あり。B = solid、C = light） | 判定 |
| --- | --- | --- |
| late frames・50ms 超のフレーム | 全構成で 0 / 0（フレームでは差が見えない PC） | 満たす |
| `scroll.task_ms` が +10% 以内 | D 1,367 ms、B 1,349、C 1,361（+1%） | 満たす |
| 起動 | 465 ms 前後（v1.14 の見た目 456 ms との差は P2a の分で、P2b は 0 ms） | 満たす |
| メモリ（GPU プロセスを含む） | 全プロセス合計は 3 MB 以内で重なる。**GPU プロセスは D 30.9 MB（30.8〜31.1）、B・C 29.3〜29.5 MB（29.2〜29.5）: 24 回と 42 回で一度も重ならない** | **外れる（+1.5 MB）** |
| 打鍵 p95 が +2 ms 以内 | D 148 ms、B 142、C 143。ただし同じ構成の測り直しでも 8〜20 ms 揺れ（v1.14 の見た目で 142〜162）、バーを出しっぱなしの E は 144 で S・F と同じ | 厳密には外れるが、揺れの内（系統的な差ではない） |
| E（最悪: 出しっぱなし）のフレーム | 0 / 0。GPU プロセスの CPU は、1 回目 E 742 ms 対 S（solid）484、2 回目 672 対 664 で、回の間の差のほうが構成の差より大きい | 差は言えない |
| G（ソフトウェア合成）で GPU プロセスの CPU が C の +30% 以内 | **G 992 ms（938〜1,109）対 solid 484、light 406 = 約 2 倍。G の 6 回は solid・light の 12 回のどれとも重ならず、2 回とも同じ向き。** GPU プロセスのメモリも 16.1 対 9.0 MB。フレームは落ちない（16.7 ms） | **外れる** |
| Mac で確認済み | 未 | 外れる |

**結論: 既定は `light`のまま（`appearance.js` の `DEFAULT_BARS = 'light'`、`index.html` の `data-bars="light"`）。`glass` は設定で選べる選択肢**（上の 3 つが外れる）。`light` は `solid` に対して、GPU メモリ・どのプロセスの CPU・フレーム・打鍵のどれも、測れる差が無い（ソフトウェア合成では `light` のほうが低い）。`will-change: opacity` は付けない（付けても GPU メモリ・CPU・フレームが同じ。`light`・`glass` の両方で測った）。`autoHide` の既定 `true` は費用ゼロ（バーが `opacity: 0` の間は描かれない: 自動非表示ありの D は C・B と、フレームと CPU のどの行も同じ）。

起動の「P2a で +7%」は、別の時刻に測った基準（483 ms）との比較だった。同じセッションで 4 回 x 4 回を交互に測ると、v1.14 の見た目 456 ms（445〜466）、P2a 465 ms（450〜486）、P2b 465 ms（452〜474）で **+9 ms（+2.0%）、P2b の分は 0**。増えたのはページ自身の分（152 → 166 ms）で、読み込むファイルが 43 → 47 になったことに対応する（`tokens.css`・`chrome.css`・`appearance.js`・`chrome_overlay.js`）。

## 6. リスクと未決（順位つき）

### 6.0 S0 結果（2026-10-04、P2a。隔離した実アプリ `v2-p1b.exe`、WebView2 154.0、窓 1050x720、スクリプトは scratchpad の `p2a/s0.mjs`）

§1 の E1〜E5 を実アプリで確かめ直した。**すべて Chromium の測定と同じ**で、計画の前提は WebView2 でも成り立つ。

| # | 結果（実アプリ） |
| --- | --- |
| E1 | textarea（300 行）に `padding: 50px 14px 36px` を当てると `scrollHeight` は 6741 → 6803（+62 = (50+36)-(12+12)）。**`padding-bottom` はスクロール範囲に入る**。一番下までスクロールすると最後の行の下に 36px が残る。プレビュー（`#preview-pane`、普通の div）も +62 で同じ |
| E2 | ↓キーでキャレットを下端へ動かすと、`scroll-padding` なしではキャレットの行の下端が窓の下端から **1px**、`scroll-padding-bottom: 36px` で **37px**（フッターの 24px の上）。↑キーで上端へ動かすと 1px → `scroll-padding-top: 38px` で **39px**（ヘッダーの 38px の下）。本文の末尾で Enter を 5 回打つと新しい行は下端から約 32px。**CSS だけでキャレット追従が効く（JS の計算は不要）** |
| E3 | ポインタを動かさずホイールを 2 回、続けて 1 打鍵: `wheel`・`scroll` は来て、`pointermove` は 0 回、`input` は `isTrusted` |
| E4 | IME: `keydown`（`key: "Process"`）→ `compositionstart` → `compositionupdate` → `input`（`isComposing: true`）。**`compositionstart` で検出できる**（`keydown` では検出できない） |
| E5 | スクロールバーの上を押すと `pointerdown` と `mousedown` が textarea に届き、続けて `scroll`（押した場所へページ送り） |
| F6 | `keydown`（`key: "F6"`）がページに届く。CDP の `Input.dispatchKeyEvent` でも、**実際のウィンドウメッセージ**（`WM_KEYDOWN` を `Chrome_RenderWidgetHostHWND` へ。Chromium のブラウザ側のキー処理を通る）でも届いた（F5 も同じ）。`window_windows.go` が `PutAreBrowserAcceleratorKeysEnabled(false)` を呼ぶため。OS レベルのキー（`keybd_event`）は、この作業セッションに前面の窓が無く（`GetForegroundWindow` が 0）送れなかったので未確認 |
| スクロールバーの幅 | **15px**（細い重ね表示ではなく従来型）。textarea は `offsetWidth - clientWidth` = 15。プレビューの div は 2px の枠が両側に付くので 19 |
| 付記 | この PC は `prefers-reduced-motion: reduce` が真（Windows のアニメーション設定）。アプリの全体規則で **`transition-duration` が 0s になり、フェードは即時**になる。フェードの時間は CDP の `Emulation.setEmulatedMedia` で `no-preference` にして測る |

Mac（WKWebView）で確かめる項目は `tools/MACOS_CHECKLIST_JA.md` の §8 に足した。

### 6.0b P2a の実装で計画から変えたところ

- **`ChromeOverlay.insets(el)` は幾何で読む**（`#header` と `#status-bar` の矩形と `el` の矩形の重なり）。CSS 変数を読まないので、右ペインの本文（自分の帯の下から始まる）は上が 0、Zen（高さ 0）も 0 になる。`--ov-inset-top` を右ペインで 0px に上書きしたのと同じ結果が、JS 側でも出る。
- **ポインタの位置は SHOWN の間だけ 2 つの数として覚える**（`pointermove` の passive な 1 本、中身は代入 2 つ）。AWAY に入ったときの位置がアンカーになる（計画 §4.2 は「アンカーのポインタ座標を覚える」とだけ書いて、どう覚えるかが無かった）。覚えていないとき（ページを開いてから最初の動き）は本物の動きとして戻す。テストや遠隔操作で「一気に飛んでクリック」しても、クリックがバーに届く。
- **タブ（`.tab-item`）はフォーカスを受けない**（`tabindex` が無い。役割は `role=tab` だけ）。F6 でヘッダーに入ると、最初に押せる部品（`+`）にフォーカスする。計画の「開いているタブにフォーカス」はできない（タブをキーボードで選べるようにするのは P3 の仕事）。
- **フォーカスが本文から出たら、バーは両方戻る**（旧 `endZenModeActiveIfEditorLost` と同じ）。`:focus-within` だけで片方のバーが出るのは、本文にフォーカスが無いまま消えたとき（ホイールでプレビューをスクロールしたあと、など）。
- **`will-change: opacity` は付けなかった**（計画 §5.2）。フェードは `opacity` の transition だけで、80,000 行のノートでも 40 回の切り替えで layout 0 回（`p2a/s3.mjs`）。付けるかどうかは S8 の測定で決める。
- **`body.zen-active` の CSS（`:has()` 5 本を含む）は P2a で `style.css` から消した**（S3 で使い手が無くなるため。S7 まで待たない）。`tests/css_compat_test.mjs` の `:has(` の上限は 6 → 1。
- 旧 Zen（`body.zen-mode`）は P2a では**そのまま**（S5 で作り直す）。

### 6.0c P2b（S4〜S8）の実装で計画から変えたところ・分かったこと

- **透過の値は計画の 0.80 / 0.55 ではなく `light` 0.86、`glass` 0.62。** バーの文字（`text-muted`・`text-main`・`text-on-statusbar`）が本文の上で読めるかを `tests/look_contrast_test.mjs` で計算して決めた（密度 15% の本文の上で 4.5:1、`light` はぼかさないので文字そのものの上でも 3:1。墨・紙・5 色のアクセントすべて）。値を変えるとテストが落ちる。
- **`--bar-a` は `<body>` ではなく二つのバー自身に置く**（`<body>` のカスタムプロパティが変わるとページ全体が再計算されるため）。`<body data-bars>` が値を選ぶ。`glass` の `backdrop-filter` は `@supports` の中だけで、接頭辞付き・なしの両方を書く。無い環境では `light` と同じ見た目。
- **計画に無かった追加**: `@media (forced-colors: active), (prefers-reduced-transparency: reduce)` ではバーを不透明にしてぼかしも切る（設定に関係なく）。設定画面のヒントに書いた。
- **Zen**（オーナー決定どおり）: バーは `body.zen-mode` の CSS でも消す（JS が付ける `chrome-faded` との二重。どちらかが無くても消える）。`ZEN_FOOTER_PINS` は失敗・録音中・ステータスの popover だけ（実行中のタスクや AI のインジケーターでは呼ばない）。余白は消さず `--pad-x` 32px、`--pad-y` 24px、行番号は 30%（マウスを載せると 80%）、結果ブロックの帯も 30% / 80%（小さい要素なので `opacity`）。ふつうのメッセージは `#stat-message` を 1px に畳む（visually-hidden。`aria-live` には残る。`window.__explore.toasts`・RPC の `statusText` は変わらない）。
- **`important` を付けた失敗**: 計画の 8 か所より広げて、保存・設定・ディスク衝突・起動のファイル・セッション・グローバルショートカットに加えて、貼り付け・画像の保存・書き出し・開く・印刷・AI の失敗・CLI のブロックとエラー・タグ編集・レッスン・深掘り検索・Git/Ollama/エージェント設定・設定パッケージの取り込み・音声入力の失敗（マイク・文字起こし・推敲・キャッシュ）・リンクを開けない/画像を取り込めない。**「失敗の i18n キーを持つメッセージで `important` が無いもの」は `tests/chrome_bars_zen_test.mjs` の lint が全スクリプトから見つける**（後から足した失敗の付け忘れを止める）。付けていないのは、失敗ではなく案内・警告のもの: コマンドの危険の警告（`isWarning`。コマンドバーに出る）、「Ctrl+Enter が何もしなかった理由」（`slot_agent.js` の `notifyNoAction`）、音声の「先にカーソルを」など。
- **行番号の濃さは固定の 0.55 ではなくトークン `--linenum-a`（墨 0.68、紙 0.74）。** 0.55 ではページに対して 3:1 に届かない（`look_contrast_test` が縛る）。背景と `border-right` は無し。`opacity` は使わない。
- **`#header-title`**: 作って内容を更新するところまで（`display: none` のまま。P3 が表示する）。左端は `--linenum-w`（ガターの幅。5 桁以上は `--linenum-digits` から式で出す）+ 本文の左余白。式は近似で、5 桁のとき実測 53px に対し式が 55px（2px 差）。P3 で表示するときは、実測の幅を `renderLineGutter` から流す形に直すとよい。
- **`will-change` は付けない**（5.6）。
- **既知の限界**: (1) HTML のプレビュー（iframe）が窓いっぱいに出ている Zen では、窓の端のポインタは iframe の中に入って親ページに届かず、ホットゾーンが働かない。F6 / Tab で出す。(2) `light` の透け方は、バーのアイコンの裏に本文の文字がうっすら見える（0.86）。気になる人は `solid`。(3) 起動の最初の 1 フレームは、保存した `bars` が既定と違っても既定（`light`）で描かれる（`syki_look` のような先読みの印は足していない。見た目の差が小さいため）。

### 6.1 リスク（大きい順）

1. **textarea の下をくぐる仕組みが WebKit（Mac）で成立するか未確認**。下余白がスクロール範囲に入る・`scroll-padding` がキャレット追従に効く・スクロールバーの上端下端がバーに隠れる、は Chromium 154 でしか確かめていない（E1・E2・E5）。Windows の WebView2 は S0 で実アプリを確認する。Mac は実機が要る。代替は §4.9 の末尾。
2. **幾何の切り替え（S2）の影響範囲が広い**: パネル 6 種、検索バー、プレビューのバッジ・印刷ボタン、右ペイン、Jev、ゴースト、行番号、結果ブロックの帯。→ S1（見た目不変の変数化、画素一致）で刻み、S2 のスモーク 110 でジオメトリを数値で縛る。`style.css` を P1a が編集中なので、P2 の CSS は `chrome.css` に置く。
3. **自動非表示が入力を横取りしないか**: スクロールの意図の判定（タブのクリックで消えない）、合成のポインタ移動、`pointer-events: none` の間にクリックが本文に落ちること（ポインタを動かして戻してから押す。CDP のクリックは先に `mouseMoved` を送るので通る）、右ペインの帯・`#btn-secondary-print`（スモーク 101）、フルスクリーン。
4. **Zen の意味が曖昧**（O1・O2・O3）。実装は暫定で進められるが、確定しないと S5 のテストが固まらない。
5. **すりガラスの既定**。Windows の測定（S8）と Mac の未確認 backdrop-filter（§4.9）。既定は `light`。
6. **タブ帯がヘッダーに残る間の見た目**: 半透明のバーの上に不透明なタブ（O6）。P3 で解消。
7. **テストの書き換えが多い**（§2.6 の 10 本前後。文字列照合が多い）。`tests/zen_active_test.mjs` と スモーク 74 は趣旨ごと書き直し。
8. **スクロールバーがバーに隠れる**: 窓の右端のスクロールバーの上端・下端（15px 幅の環境）。バーを `right: スクロールバー幅` で止める案は、分割時に主エディタのスクロールバーが窓の中ほどに来て成り立たない。→ バーはスクロールバーの上にも出す。つまみは上端・下端にあるときだけ隠れる（ホイール・キーで動かせる）。小。
9. **AI の挿入・RPC の書き込みがバーを隠す**: `insertTextWithUndo` は `isTrusted` な `input` を出す。害は小さい（結果を見ている間、バーが消える）。必要なら直前の `keydown` / `compositionstart` のあとだけ数える。
10. **`F6` が WebView2 / macOS で届くか**: Windows は `AreBrowserAcceleratorKeysEnabled(false)` で届く（`F11` と同じ）。Mac はファンクションキーが Fn 必須の機種がある（O5）。
11. **`opacity` と `backdrop-filter` の組み合わせ（Safari ≤ 15）**。§4.9。

### 6.2 オーナーに聞くこと（決める順）

- **O1. （決着 2026-10-04）** Zen の余白は**消さない**（現行どおり本文の左右を広げ、行番号は薄める）。§4.6 の表のとおり。O2・O3（失敗と録音中を Zen でも出す）は、オーナーに勧めた案（出す）で進める。
- **O2. Zen の「通知を出さない」の範囲。** `#stat-message` を見えなくする（読み上げには残す）でよいか。失敗（保存の失敗、設定が保存できない、ディスクの競合）は出す（`important`）でよいか。それとも Zen では何も出さないか。
- **O3. 録音中のインジケータ（`#stat-recording`）は Zen でも出すか。** 録音は第三者にも関わる状態で、今の Zen（バーが全部消える）では見えない。出すことを推奨。失敗の印（タブの `!`、Autosave の "failed"）も同じ問い。
- **O4. フッターのチップは Git・IME・文字コードだけか。** 設計書の §4.5 はそう書くが、AI（popover）・Autosave・タスク・録音は機能なので残す前提で進める。
- **O5. 戻すキー。** Windows の既定は `F6`（Windows の「ペインを巡る」の慣習）。Mac の既定は `Ctrl+Cmd+B`（案。要確認）か `F6`。設定で変えられる。
- **O6. タブ帯がヘッダーに残る P2〜P3 の間、ヘッダーのタイトル（ファイル名）は出さない**でよいか（タブと二重になるため。要素と更新処理は P2 で作り、P3 で表示する）。
- **O7. `html-mode` のプレビュー（iframe）はバーの下をくぐらせない**でよいか（iframe の中がスクロールするため）。バーの間に置く。
- **O8. 分割時、主エディタのスクロールバーの上端がヘッダーに隠れる**のを許すか（小）。
- **O9. バーの空白部分でホイール・クリックを本文へ通す**（`pointer-events: none` をバーに、子のボタン・タブにだけ `auto`）磨きを `light` / `glass` で入れるか。`solid` では見えない本文をクリックしてしまうので入れない。
- **O10. 自動非表示の既定を `true`（設計どおり）でよいか**。切る設定は `appearance.autoHide`。

## 7. 引き継ぎ・調整

| 相手 | 依頼・通知 |
| --- | --- |
| P1a・P1b | `tokens.css` に**チャンネルのトークン** `--bar-top-rgb`・`--bar-bottom-rgb`・`--text-muted-rgb`（`37 37 38` の形）を足す（P2 の S4）。値は既存の `--bg-header`・`--bg-statusbar`・`--text-muted` と同じ色（テストで一致を縛る）。紙の値と、自分で指定したアクセントのときの値は P1b。`appearance` の正規化は**知らないキーを残す** |
| P3 | `--ov-top` / `--ov-bottom` を `--tab-strip-top/bottom` に使える（S2 以降）。Zen の帯は P3 の計画どおり（P2 は触らない）。`#header-title` は P3 が `display` を変える。タブを `#header` から外すときの `#header-actions { margin-left: auto }` は P3 側 |
| P4/P5 | `--ov-top` / `--ov-bottom` / `--pad-top-extra` / `body.chrome-faded` を S2・S3 で出す。**P5-S1（位置の定数）は P2-S2 が先にやる**。右ペインの帯を小さな浮き帯にする（P4）まで、P2 は `#secondary-pane` の `padding-top` で逃げる。P4 の帯は `body.chrome-faded` で消える・`:focus-within` で戻る |
| 性能ハーネスの担当 | `--config-patch`、GPU プロセスの CPU 時間（種別ごと）、`--disable-gpu` の構成（§5.3）。8 万行のスクロールは「バーが出たまま」（`autoHide: false`）と「消える」の両方 |
| 統括役 | S0 の結果を §6 に反映。O1〜O10 をオーナーへ。P6 に `forced-colors` の仕上げ（`chrome.css` に最小の規則は入れる）、全図の撮り直し、Mac の実機確認 |
