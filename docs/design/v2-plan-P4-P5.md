# v2 実装計画: P4（ページ・分割・プレビュー）と P5（付箋のパネル）

作成 2026-10-04（アーキテクト）。設計は `docs/design/v2-visual-2026-10.md` §3・§4.1・§4.2・§4.6・§4.7・§6・§7、決まりは `docs/design/v2-implementation-contract.md`。これは**計画**で、ソース・テスト・CSS は変えていない。

読んだ場所: worktree `syki-v2`（ブランチ `v2`、HEAD `24da27b`）の `frontend/index.html`、`frontend/css/style.css`・`print.css`、`frontend/js/app.js` と関連モジュール、`tests/`、`tests/smoke/`、`tools/docshots/`。P1a が `style.css`・`tokens.css`・`index.html` を並行して書き換えるので、**行番号は書かず、セレクタ・id・関数名で参照する**（これらは変わらない）。

---

## 0. 先に: コードで確かめた事実（設計書・契約との食い違いを含む）

| # | 事実 | 影響 |
|---|---|---|
| F1 | **リサイザーのキーボード操作は、現行に無い。** `#pane-resizer` は素の `div`（`role`・`tabindex` なし）で、`initPaneResizer`（app.js）は `pointerdown` のドラッグ（15%〜85% にクランプ）と `dblclick`（50:50）しか付けていない。設計書 §4.2 の「キーボードでも操作できる現行の挙動を落とさない」は、落とすものが無い | P4 で**新設**する（a11y の前進）。矢印・Home/End・Enter を足す（§2.2.6） |
| F2 | `splitRatio` は**保存されない**（セッション JSON `getSessionData` にも `config` にも無い）。閉じて開き直したときに前の比率が残るのはメモリ上の変数が残っているだけ（GIF の `widenPreviewPane` がこれに頼っている） | 保存は P4 の範囲外とし、未決（Q7）にする。セッション JSON は「分割前後で**バイト同一**」を検査するテストがあり、足すと両方を直す必要がある |
| F3 | プレビューの窓（`#preview-pane`・`#secondary-preview-pane`）の中身は、`renderMarkdownContentTo` と `renderHtmlPreviewTo` が `innerHTML` で**毎回全部入れ替える**（`togglePreview`・`closeSecondaryPane` も空にする） | 窓の**中に**装飾の子要素を置けない。紙の見た目は、窓自身の背景・影・疑似要素と、**兄弟**要素だけで作る |
| F4 | `print.css` は DOM の親子を前提にしている: `body > #app > #workspace > #preview-pane`、`#workspace > #secondary-pane > #secondary-preview-pane`（「それ以外を隠す」書き方）。`tests/print_style_test.mjs` が**同じセレクタ文字列**を正規表現で検査する。`#header`・`#status-bar` も `#app` の直接の子であることに頼っている | 紙のラッパー要素を足してはいけない。P2 は header/footer を `#workspace` の中へ移してはいけない |
| F5 | Ctrl+J のパネル（`#jev-action-panel`、`jev_action.js` の `createJevPanelDOM`）は **`#editor-wrapper` の子**（`overflow: hidden`、左ペインの中だけ）。他の 5 つは `#workspace` かフル画面の `.modal-backdrop` の子 | 分割中は Ctrl+J だけ左ペインの中央に出る。影が wrapper の縁で切れる（現行でも `0 8px 24px` が下 16px で切れている）。P5 で是正する（§3.3） |
| F6 | パネルの位置は**ヘッダー高さ前提の定数**: `--panel-top: 16px`、`--panel-modal-top: 53px`（＝ヘッダー 38px + 15px。`.quick-pick-modal` が `.modal-backdrop`（`position: fixed`）の中で使う）、`dockPanelBar` の `16 + 高さ + 8`、Jev の `bottom: var(--panel-top)` | P2 でヘッダー・フッターがオーバーレイになると全部ずれる。P5 の最初の手で直す（§3.3 S1） |
| F7 | `syncBackendConfig` と `loadLocalConfigSync` は**既知のキーだけ**を `config` に写し、`savePersistentConfig` は `config` 全体を書き戻す。`config.appearance` を明示的に写さないと、**次の保存で消える**（`config.semantic` と同じ罠。`semantic` の行に理由のコメントが残っている）。それを守るテストは今は無い | P1b の `appearance` の器に、写す行と、往復のテスト（§2.3 S7）を必ず入れる |
| F8 | `app.js` を手作りの DOM で読むテストが **64 本**ある。モックには `style.setProperty` や `dataset`、`setAttribute` が無いものがある（`tests/second_panel_test.mjs` は `style` が素のオブジェクト） | 新しい `getElementById`・`style.setProperty`・`dataset`・`setAttribute` は**全部ガードする**（無ければ何もしない） |
| F9 | `style.css` のソースを正規表現で検査するテストが **19 本**。P5 の面の差し替えで一斉に赤くなるもの: `panel_template_test`（`border: 1px solid var(--border-color)`・`border-radius: 8px`・`box-shadow: var(--panel-shadow)`）、`status_ai_test`（`.status-ai-pop` の 3 行）、`tab_overflow_wiring_test`（`.tab-list-panel` の 3 行）、`about_privacy_test`、`first_run_polish_test`、`first_run_welcome_test`、`preview_frame_test`（`--bg-preview`・`border: 2px solid var(--accent-hover)`）。**P1a でも**赤くなるもの（`rgba(255, 255, 255, 0.07)` の直書きを検査する行: `panel_template_test`・`first_run_welcome_test`） | 誰がどの行を直すかを段の境で決める（§4）。P5 の担当は、P1a が直したあとの形から始める |
| F10 | `forced-colors` の記述は無い。`prefers-reduced-motion` は末尾に `*` の全体規則（animation を 0.01ms、transition を 0s）があり、個別の規則も 4 か所ある | 新しい動き（付箋が降りる）は全体規則で止まる。`panel_fade.js` は JS 側で別に扱う（変えない） |
| F11 | `calm toolbar`（既定のヘッダー）は `btn-toggle-split`・`btn-preview-side` を**隠す**（`chrome_layout.js` の `CALM_TOOLBAR_HIDDEN`）。切り替えの入口は、新規ユーザーではパレットと `Ctrl+\`・`Ctrl+Alt+V`・`Ctrl+P` | 4 つの表示の確認は、ボタンではなくショートカットと RPC `ui.set_view` で行う（スモーク 87・90 が既にそうしている） |

---

## 1. 他の段に求める契約（P4・P5 を始める前に、実コードで確かめる）

名前は仮。P2・P3 が別の名前で出荷していたら、そちらに合わせる。

| 出し手 | 契約 | P4・P5 が使うところ |
|---|---|---|
| P1a・P1b | トークン `--wall --page --sheet --ink --ink-2 --hair --shade`（設計書 §4.1）に加えて、**チャンネルのトークン `--accent-rgb`・`--ink-rgb`・`--shade-rgb`**（`85 107 47` の形。契約 §1.5: `color-mix()` は使えないので、薄い色は `rgb(var(--accent-rgb) / 0.10)` で作る。自分で指定したアクセントは JS が `--accent-rgb` だけを `body` に流せばよい）、`body.look-paper`、`config.appearance` の器（既定値・`syncBackendConfig`・`loadLocalConfigSync`・保存・設定画面のスナップショット／取り消し・設定パッケージ。`appearance` は設定パッケージの「その他」に自動で入る＝`config_pack.js` の `keys: null`）。**`.markdown-body` の色（h1〜h4、code、blockquote、th、行の縞、`.katex-error`、`.mermaid-card` の枠）が紙の地でも値を持つこと**（今は暗色向けの `#4ec9b0`・`#569cd6`・`#ce9178` の直書き） | P4 S4 で白い紙に切り替える前に必要。無いと白い紙に暗色向けの色が載る |
| P2 | `--ov-top`・`--ov-bottom`（ヘッダー・フッターの高さ、px）。`#workspace` が窓いっぱい（ヘッダーの下に潜る）。エディタ・行番号・ゴーストの `padding-top/bottom` の式（`--ov-top` を含む）。オーバーレイ群の自動非表示のクラス（仮: `body.chrome-faded`）。`#header`・`#status-bar` は `#app` の直接の子のまま（F4） | 紙の上下いっぱい、右ペインの帯、プレビューのバッジ・印刷ボタンの位置、パネルの位置（F6） |
| P3 | 左・右のタブ帯が占める幅の変数（仮: `--tab-inset-left`・`--tab-inset-right`、表示ごとに値が変わる）。**表示の判定に `body[data-view]`（§2.2.1）を使う** | 左右ページの右端（スクロールバーとの競合）、見開きプレビューは左だけ |
| P1b/P2 に依頼 | `padding-top` の式に、表示ごとの追加分 `--pad-top-extra`（既定 0）を足してもらう（§2.2.5）。P2 が先に出荷済みなら、P4 S5 で足す | 右ペインの小さな帯と、左右の本文の頭をそろえる |

`body[data-view]` の導入（P4 S1）は**見た目が変わらず小さい**ので、P2 や P3 より**先に**入れてよい（P3 のタブの出し分けが同じ判定を要る）。順序を前倒しするかは統括役が決める。

### 1.1 互換性: macOS の最低は 10.15（WKWebView は Safari 15.6 まで）— 契約 §1.5

この計画の CSS・JS は、次の制約で書く。**使わないもの**: `color-mix()`（Safari 16.2〜）、`@container`・`container-type`・`cqw`/`cqi`（Safari 16〜。初版の方式 A は `cqw` に頼っていたので**取り下げた**、§2.2.4）、CSS ネスト、`:has()` の**新しい**使い方（設定画面・`panel_template_test` が見る既存の 1 か所は現状維持）、`scrollbar-gutter`（Safari 18.2〜）、`aspect-ratio`（使っていない）。**薄い色**はチャンネルのトークンで作る（`rgb(var(--accent-rgb) / 0.10)`）か、あらかじめ計算した別トークンにする。

使うものと、根拠（Safari / Chromium の対応版。**コードに入れるときに caniuse で再確認してコメントに書く**。ここにある版は計画時の記憶で、まだ照合していない）:

| 構文 | 使う場所 | Safari / Chromium（記憶） | 注 |
|---|---|---|---|
| `clip-path: polygon(… calc() …)` | 付箋の紙 `::before`（根には使わない） | 13.1 / 55 | 接頭辞なし |
| `mask-image: linear-gradient(…)` | ノドのドットの薄れ | `-webkit-mask-image` は Safari 全版、接頭辞なしは 15.4 / Chromium 120 | **両方書く**（`-webkit-` を先に） |
| `inset: 0`、`isolation: isolate`、`:focus-within`、`pointer-events` | 疑似要素、根 | 14.1 / 87、11 / 41、10.1 / 60 | |
| `max()`・`min()`・`calc()` の中の `max()` | 紙の幅・余白、バッジの位置 | 11.1 / 79 | `%` は包含ブロックの幅 |
| `rgb(r g b / a)` とチャンネルのカスタムプロパティ | 付箋の紙・粘着帯・ドット・影 | 12.1 / 65 | `rgb(var(--accent-rgb) / 0.10)` |
| `var(--x, 並び, 並び)` | エディタの書体 | 9.1 / 49 | フォールバックはカンマ区切りの並びごと |
| `body[data-view]` などの属性セレクタ、`role="separator"` | 表示の判定 | すべて | |
| `@media (forced-colors: active)` | 強制色の規則 | **Safari は未対応（偽になるだけで無害。macOS に強制色は無い）** / Chromium 89 | Windows のハイコントラストで効く |
| `@media (prefers-reduced-motion)`、`(max-width)` | 動き、狭い窓 | 10.1 / 74 | 既存 |

`filter: drop-shadow` と `backdrop-filter` は Safari 15.6 でも使えるが、**この計画では使わない**（付箋の文字の鮮明さと費用のため、§3.5 R2）。P2 のすりガラスは `-webkit-backdrop-filter` を併記（P2 の範囲）。`content-visibility: auto`（既存の `#preview-pane`）は Safari 15.6 で**効かない**（無視されるだけ。既存の挙動）。

機械で止める: P4・P5 が足す規則に `color-mix(`・`@container`・`container-type`・`cqw`・`scrollbar-gutter` が**無い**ことを、`split_view_style_test.mjs` と `panel_template_test.mjs`（新 §5）が検査する。全体の検査（`tests/css_compat_test.mjs`）を P1a/統括役が持つなら、そちらに寄せる。

---

# P4 — ページ・分割・プレビュー

## 2.1 棚卸し

### 2.1.1 要素（`frontend/index.html`、`#workspace` の中）

| id / クラス | 役割 | 状態・切り替え |
|---|---|---|
| `main#workspace` | 4 つの表示の親。`display: flex`（行）、`position: relative`、`overflow: hidden`。ここに `.split-mode` が付く | 分割（左右ページ・見開きプレビューの両方）で `.split-mode` |
| `#editor-pane.pane` | 左のページ。子: `#line-numbers`、`#editor-wrapper`（`#cursor-aura`、`#ghost-overlay`、`#editor`） | プレビューのみで `.hidden`。**分割中は `#workspace.split-mode #editor-pane { display: flex !important }` で隠せない**。`.pane-focused` |
| `#pane-resizer.pane-resizer` | 仕切り。幅 5px、`border-left: 1px`、hover / `.resizing` で背景がアクセント | 分割の外では `.hidden`。ドラッグ中 `.resizing` |
| `#secondary-pane.secondary-pane-container` | 右のペイン（縦 flex）。`min-width: 150px` | `.hidden`、`.pane-focused` |
| `#secondary-pane-header.pane-header`（32px） | `#secondary-pane-title` と `.pane-actions`: `#btn-secondary-sync`、`#btn-secondary-print`（`hidden` 属性）、`#btn-secondary-mode`、`#btn-secondary-close` | print は `secondaryViewMode === 'preview'` のときだけ表示。sync は `secTab.id === activeTabId` のときだけ（`updateSecondaryPane`） |
| `#secondary-editor-pane`（`#secondary-line-numbers`、`#secondary-editor-wrapper`、`#editor-secondary`） | 右のエディタ（ゴースト・カーソルオーラは**無い**） | プレビュー表示中は `.hidden` |
| `#secondary-preview-pane.secondary-preview-pane.markdown-body` | 右のプレビュー（見開きプレビューの紙になる） | `.hidden`、`.html-mode`（HTML ノート: padding 0、白、iframe 100%） |
| `#preview-pane.pane.markdown-body` | 全画面プレビュー | `.hidden`、`.html-mode` |
| `#preview-badge`、`#btn-preview-print` | `#preview-pane` の**直後の兄弟**。`#workspace` を基準に `position: absolute`（badge は `top: 7px; right: 24px`、print は `top: 5px; right: 108px`） | CSS の `~` 兄弟セレクタ（`#preview-pane:not(.hidden):not(.html-mode) ~ …`）だけで出し入れ。JS は触らない |
| 入口 | `#btn-toggle-split`（`Ctrl+\`）、`#btn-preview-side`（`Ctrl+Alt+V`）、`#btn-toggle-preview`（`Ctrl+P`）、右クリックの `ctx-open-to-side`・`ctx-toggle-preview`、パレット、Alt+タブのクリック（`handleTabClick`） | `.active` |

### 2.1.2 CSS（`style.css`、セレクタ名）

`#workspace`、`.pane`、`#workspace.split-mode`、`#workspace.split-mode #editor-pane`（`.pane-focused`: 青い 1px の outline）、`.pane-resizer`（`:hover`・`.resizing`）、`#secondary-pane`、`#workspace.split-mode #secondary-pane`（`.pane-focused`）、`.pane-header`・`.pane-title`・`.pane-actions`・`.btn-pane-icon`（`[hidden]`・`:disabled`・`:hover`・`.active`）、`.secondary-editor-pane`（`.line-numbers`・`.editor-wrapper`）、`#editor-secondary`、`.secondary-preview-pane`（`.html-mode`・`iframe`）、`#editor-pane`、`#line-numbers`、`.result-accent*`、`#editor-wrapper`、`#cursor-aura`、`#ghost-overlay`、`#editor`、`#preview-pane`（`.html-mode`・`iframe`）、`#workspace.split-mode #preview-pane.html-mode`、`.preview-badge`、`.preview-print-btn`、`.markdown-body …`、`body.zen-mode #editor`・`#line-numbers`。`print.css` は全体。

エディタの書体は **5 か所に直書き**（`#editor`・`#editor-secondary`・`#ghost-overlay`・`#line-numbers`・`.secondary-editor-pane .line-numbers`）。行番号の 2 つは `"Meiryo"` が**無い**（本文と食い違う）。

### 2.1.3 JS（`app.js` の関数）

切り替え: `togglePreview`、`openSplitEditor`、`openPreviewToSide`、`closeSecondaryPane`、`toggleSplitMode`、`updateSecondaryPane`、`updatePaneFocusClasses`、`selectTab`・`selectSecondaryTab`・`showTab`・`handleTabClick`。
仕切り: `applySplitRatio`（`editorPane.style.flex = '0 0 <pct>%'`、右は `1 1 0`、`invalidateCharPixelMirrors()`）、`initPaneResizer`（初期化の最後、`initApp` の末尾で 1 回）。
描画: `renderPreview`、`renderSecondaryPreview`、`renderMarkdownContentTo`、`renderHtmlPreviewTo`、`debouncedLivePreview`（再描画の待ちは描画費用の 3 倍、120ms〜2s）。
同期: `shouldSyncScroll` と `editorEl`・`secondaryPreviewPane` の `scroll` リスナー（**比率**で同期。40ms の抑止）、`window` の `message`（HTML プレビューの `previewScroll`）。
印刷: `startPrint`（`btnPreviewPrint` のクロージャ内）、`printTarget`、`document.body.dataset.printPane = 'secondary'`、`printPdfForRpc`。
行番号・測定: `updateSecondaryLineNumbers`、`applyFontSize`（localStorage `syki_font_size`。5 つの要素の `style.fontSize`、`invalidateCharPixelMirrors`、`FileAnchor.scheduleMarks`、`scheduleUpdateLineNumbers`）、`getCharPixelCoords`（`charMirrors`、幅と世代でキャッシュ）、`gutterResizeObserver`（`editorEl`・`editorSecondary`、80ms のデバウンス）、`syncGhostGutter`。
状態の保存・外部: `getSessionData`・`getSessionDataJson`・`restoreSessionFromData`、`rpcPreviewState`・`rpcUiState`・`setUiStateForRpc`（RPC `ui.state` / `ui.set_view`。`preview: off|full|side`、`split`）、`window.__testHelper`（`openPreviewToSide` など。docshots が使う）。
設定: `syncBackendConfig`、`loadLocalConfigSync`、`savePersistentConfig`、`restoreLiveConfigFromSnapshot`（設定画面で即時に反映した値を取り消しで戻す）、`config.general.splitViewOnStartup`（`restoreSession === false` のときだけ効く）。
パネルの位置: `dockPanelBar`（`editor.getBoundingClientRect()` と `workspaceEl.getBoundingClientRect()`）。

### 2.1.4 表示の切り替え方・状態・永続化

4 つの表示は、**1 つの状態名では持っていない**。次の変数の組み合わせで決まる:

| 表示 | `isSplitMode` | `secondaryViewMode` | `isPreviewMode` | DOM の目印 |
|---|---|---|---|---|
| 1 ページ | false | （無関係） | false | `#workspace` に `.split-mode` なし |
| 左右ページ | true | `'editor'` | false | `.split-mode`、`#secondary-editor-pane` 表示 |
| 見開きプレビュー | true | `'preview'` | false | `.split-mode`、`#secondary-preview-pane` 表示 |
| プレビューのみ | false | （無関係） | true | `#editor-pane.hidden`、`#preview-pane` 表示 |

- 変数: `isSplitMode`、`secondaryViewMode`、`isPreviewMode`、`activePane`（`'primary'|'secondary'`）、`secondaryTabId`、`splitRatio`、`syncScrollEnabled`。
- 永続: セッション（`localStorage syki_session_v1` と `backend.saveSession`）に `isSplitMode`・`secondaryTabId`・`secondaryViewMode`・`activePane`・`isPreviewMode` が入る。復元は `restoreSessionFromData` が `openPreviewToSide` / `openSplitEditor` / `togglePreview` を呼ぶ。**`splitRatio` は入らない**（F2）。
- 設定: `config.general.splitViewOnStartup`（セッション復元オフのときだけ）。
- 外部: RPC `ui.state`（`splitMode`・`secondaryTabId`・`preview`）と `ui.set_view`、CLI の同名。**4 つの表示は RPC の形（`preview: off|full|side` と `split`）にそのまま写る**ので、RPC の契約は変えない。

### 2.1.5 幅に依存するもの（仕切りを動かす・窓を変える・余白を足すと動く）

| もの | 依存のしかた | P4 での注意 |
|---|---|---|
| エディタの折り返し・行番号 | `LineGutter.rowsFor`（`editor.clientWidth`、キャッシュの署名に幅と `fontFamily` を含む）、`gutterResizeObserver`（80ms） | ノドを広げる・余白を足すと幅が変わる。再計測は既存のデバウンスで足りる |
| 文字位置の測定 | `getCharPixelCoords` の `charMirrors`（`clientWidth` と `charMirrorGeneration` で作り直し） | 書体を変えたら `invalidateCharPixelMirrors()`（`applySplitRatio`・`applyFontSize` と同じ） |
| ゴースト | `#ghost-overlay` は `#editor-wrapper` と同じ箱。`syncGhostGutter`（`offsetWidth - clientWidth` = スクロールバー幅） | 本文の左右 padding を変えるなら、textarea と overlay の**両方**（`padding: 12px 14px`）。書体は変数を両方に |
| 検索の印・リンクの下線 | `FileAnchor`（`editor.getBoundingClientRect()`、`offsetWidth - clientWidth`）、検索の印の層（`layer.style.width = editor.offsetWidth`） | 書体・padding を変えたら、これらは**計算済みスタイルを読む**ので追従する（要確認の対象に入れる） |
| カーソルオーラ | `#editor-wrapper` 基準の座標 | 影響なし（左ペインだけ） |
| パネルの位置 | `dockPanelBar`（エディタ矩形と `#workspace` 矩形の差）、F6 | P5 |
| プレビューの描画 | Mermaid（SVG の `max-width: Npx` ＋ `width: 100%`）、表（`width: 100%`、折り返しの工夫なし）、`pre`（`overflow-x: auto`）、KaTeX（`.katex-block` は横スクロール）、HTML ノート（iframe の幅 = 窓の幅。狭いとモバイル表示になるページがある） | 紙は 800px（本文の幅は 800 − 72 = 約 730px）。**広い表がはみ出す**（R5）。HTML ノートは余白なしの全幅にする（Q5） |
| スクロール同期 | 比率（`scrollTop / (scrollHeight - clientHeight)`）なので幅には依存しないが、`scrollHeight` は幅で変わる | 紙の上下の padding を足しても比率は保たれる。**両方の窓に同じ上下 padding を足す** |
| 印刷 | 画面の幅に依存しない（`print.css` が全部上書き）。印刷パネルの `stage.clientWidth` はモーダル内 | 紙の影・余白・最大幅を `print.css` で必ず打ち消す（S4） |

### 2.1.6 影響するテスト・スモーク・docshots・GIF

- **JS ユニット（`node tools/run_js_tests.mjs`）**: `tests/preview_frame_test.mjs`（`--bg-preview`・`border: 2px solid var(--accent-hover)`・badge の規則・マークアップの隣接）→ **書き換え**。`tests/print_style_test.mjs`（`print.css` のセレクタ文字列・バッジと印刷ボタンの兄弟関係）→ マークアップと `print.css` の構造を変えないので**そのまま通る**が、追加行の検査を足す。`tests/second_panel_test.mjs`・`session_restore_test.mjs`・`rpc_write_tabs_test.mjs`（`pane-focused` クラス、分割の遷移、復元）・`zen_active_test.mjs`・`tab_overflow_wiring_test.mjs` → クラス・id・`hidden` の意味を**変えない**ので通る。64 本の app.js ロードテストは F8 のとおりガード。
- **スモーク（`node tests/smoke/run.mjs`）**: `01_main_path`、`08_tab_overflow`、`63_palette_acts_on_focused_pane`、`83_find_gutter_and_panes`（分割の両側で同じノート）、`87_preview_to_side_shortcut`（`#secondary-pane` の `hidden` の意味）、`89_rpc_cursor`、`90_rpc_ui_state_and_panels`（`ui.set_view` で 4 つの表示を往復）、`91_rpc_tab_info_and_tasks`、`97_print_preview`・`98_print_panel`・`99_print_on_a_mac`・`100_rpc_print_pdf_and_search_panel`・`101_print_side_preview`（`#btn-secondary-print` が `#secondary-pane-header` の矩形内にあること、印刷メディアで `#secondary-pane` が `display: block; position: static`、`#secondary-preview-pane` が白・`overflow-y: visible`・**`border-top-width: 0`**）。
- **docshots（`tools/docshots/shots.json`）**: `split-preview`（マーカー: `#editor-pane`、`#secondary-pane-header`、`#secondary-preview-pane svg`、`#btn-secondary-sync`、**`#pane-resizer`**）、`print-panel`（`setups.printPanel` が全画面プレビューを開いて **`#btn-preview-print` をクリック**する）、`ui-map`（`#editor-pane`）、`header-calm`・`zen-mode`・ほぼ全図（ページの色）。**左右ページ（エディタ 2 つ）を撮る図は今は無い**ので、新規に 1 枚足す（`split-editor`）。
- **GIF（`tools/docshots/gifs/scenarios.mjs`）**: `livePreview`（Ctrl+Alt+V → 入力 → Ctrl+P）、`mermaidAi`（`widenPreviewPane` が **`#pane-resizer` の中心をつかんでドラッグ**する）。仕切りの中心が掴めること、`#secondary-pane` の `hidden` の意味が変わらないことが条件。

## 2.2 設計

### 2.2.1 表示の判定を 1 か所に: `body[data-view]`

```
viewOf({ isSplitMode, secondaryViewMode, isPreviewMode }) → 'page' | 'pair' | 'side' | 'preview'
  isPreviewMode              → 'preview'
  isSplitMode && secondaryViewMode === 'preview' → 'side'
  isSplitMode                → 'pair'
  それ以外                   → 'page'
```

- `applyViewMode()` が `document.body.dataset.view` を設定し、`togglePreview`・`openSplitEditor`・`openPreviewToSide`・`closeSecondaryPane` の**状態が確定したあと**（`renderTabs()` の前）で呼ぶ。初期値は `page`。`restoreSessionFromData` はこの 4 つを呼ぶので追加の呼び出しは要らない。
- 純粋関数は小さなモジュール `frontend/js/view_layout.js`（`viewOf`、`ratioAfterDrag`、`ratioAfterKey`、`safeFontFamily`。`panel_fade.js` と同じ作り: `window.ViewLayout` と `module.exports`）に置き、`frontend/js/view_layout_test.js` で試験する。**起動時に 1 ファイル増える**ので、起動の時間を測り、0.5ms 以上増えるなら app.js に入れる。
- ガード（F8）: `if (document.body && document.body.dataset) …`。
- CSS はすべて `body[data-view="pair"] …` の形で書く。ヘッダー・フッター・タブ・パネルも同じ属性で出し分けられる（`#workspace` の属性だと `#header` から見えない）。
- RPC・セッションの形は変えない。

### 2.2.2 4 つの表示の構造

| 表示 | 地 | 左 | 仕切り | 右 |
|---|---|---|---|---|
| `page` | `--page` | `#editor-pane`（`--page`）全幅 | 無し | 無し |
| `pair` | `--page` | `#editor-pane`（`--page`） | `#pane-resizer` = **ノド**（幅 `--gutter-w` = 24px。中央に横方向の影、両側へ薄れるドット） | `#secondary-pane`（`--page`）に `#secondary-editor-pane` |
| `side` | 左 `--page`、右 `--wall`（机） | `#editor-pane`（`--page`） | `#pane-resizer` = **つかみしろだけ**（幅 6px、透明。hover・ドラッグ・フォーカスでアクセントの細線）。机の色の段差が仕切り | `#secondary-pane`（`--wall`）。`#secondary-preview-pane` が**紙**（`--sheet`、左右に `--desk-margin` = 34px の余白、影、枠なし、上下は窓いっぱい） |
| `preview` | `#workspace` が `--wall` | `#editor-pane` は `.hidden` | 無し | `#preview-pane` が**紙**: `width: min(var(--sheet-max), 100% - 2 * var(--desk-margin))`（`--sheet-max` = 800px）、`margin: 0 auto`、`--sheet`、影、枠なし、上下いっぱい |

トークン（`docs/design/v2-tokens.md` に追記）: `--gutter-w`（24px、細線は 5px）、`--gutter-shade`（`--shade` を 0→中央→0 のグラデーション。`--shade` が `rgb(var(--shade-rgb) / …)` の形であること）、`--gutter-dot`（`rgb(var(--ink-rgb) / 0.14)` 程度。地ごとに係数だけ変える）、`--desk-margin`（34px）、`--sheet-max`（800px）、`--sheet-shadow`（`0 0 18px rgb(var(--shade-rgb) / …)` の 2 段）、`--pane-focus`（§2.2.7）。**`color-mix()` は使わず**、`--ink-rgb`・`--shade-rgb` のチャンネルのトークンを P1b から受ける（§1.1）。

HTML ノートの窓（`.html-mode`）は**紙にしない**: 余白なし・影なし・全幅の iframe（Q5）。バッジと印刷ボタンは今も出さない。

### 2.2.3 ノド（`pair`）

- `#pane-resizer` 自身を使う（DOM を増やさない。F4・F8 のとおり、`#workspace > *:not(#preview-pane)` で印刷から外れる）。背景は `linear-gradient(to right, transparent, var(--shade), transparent)`、ドットは `::before`（`radial-gradient` を 8px 周期で敷き、`mask-image: linear-gradient(to right, transparent, #000 35%, #000 65%, transparent)`、`-webkit-mask-image` も）。**静的**（スクロールで再描画されない）で、ドラッグ中は箱が動くだけ。
- ノドの両側はテキストエリアの外（スクロールバーとは重ならない）。
- 設定 `appearance.splitBoundary`: `gutter`（既定、上のとおり）/ `shade`（影だけ、`::before` なし）/ `line`（`--gutter-w: 5px`、`border-left: 1px solid var(--hair)`、現行の細い線。hover はアクセント）。`body[data-boundary]` で切り替える。`side` では常に「段差＋つかみしろ」で、`line` のときだけ 1px の `--hair` を足す。
- hover・`.resizing`・`:focus-visible`: ノドの中央に幅 2px のアクセント（`--accent-hover`）の縦線を出す（つかめる印）。

### 2.2.4 紙（`preview` と `side`）: 窓自身が紙（方式 B だけ）

**窓自身が紙**（F3・F4 のため、ラッパーを足さない）。窓の箱が紙の大きさで、`margin`（`preview` は `0 auto`、`side` は `0 var(--desk-margin)`）と `box-shadow` で浮かせる。机の色は親（`#workspace` / `#secondary-pane`）の背景。`#preview-pane`・`#secondary-preview-pane` が引き続きスクロールの箱なので、スクロール同期・`scrollIntoView`（docshots）はそのまま。

- **短所と対策**: スクロールバーが紙の右端に出る。机の部分の上でホイールを回しても紙が動かない → `body[data-view="preview"|"side"]` のときだけ `#workspace` に `wheel` リスナーを付け（入るとき付け、出るとき外す。未使用なら無コスト）、机の上のホイールを紙の `scrollTop` に流す（10 行ほど、パッシブ。紙の上のホイールは何もしない）。
- **取り下げた案（初版の方式 A）**: 窓を全幅にして、紙を窓の `background` のグラデーションと左右の `padding` で描く案。スクロールバーが窓の端に出て、机の上でもホイールが効く利点があったが、紙の端の位置を `padding` の `%`（包含ブロックの幅）とグラデーションの `%`（スクロールバーを除く padding box の幅）で揃えるのに `cqw`（`@container` 系、Safari 16〜）が要り、**macOS 10.15 の WKWebView（Safari 15.6）では使えない**（契約 §1.5）。`scrollbar-gutter` も Safari 15 に無い。JS で px を計算して変数に流す手もあるが、`ResizeObserver` で窓幅に追従する常駐の処理が増え、「未使用なら無コスト」に反する。**採らない**。
- **残る課題**: スクロールバーの見た目が紙の端で気に入らない場合は、細いスクロールバー（`scrollbar-width: thin` は Chromium 121 / Safari 18.2 なので、WebKit 側は `::-webkit-scrollbar` の幅・色を指定する。`::-webkit-scrollbar` は既存の `#tabs-scroll` が使っている）で目立たなくする（Q8）。
- B の利点: CSS が単純でテストしやすく、`print.css`・`preview_frame_test` の読み替えが小さい。`box-shadow` が本物。`content-visibility: auto`（Chromium だけで効く既存の挙動）はそのまま。

紙の上下: `padding-top: calc(var(--ov-top) + 24px + var(--pad-top-extra, 0px))`、`padding-bottom: calc(var(--ov-bottom) + 24px)`（P2 のオーバーレイの下に潜るので、最初の行がバンドの下から始まる）。横の padding は今のまま（`preview` 36px、`side` 24px）。

バッジと印刷ボタンは兄弟のまま、`preview` では紙の右上に合わせる: `right: calc(max(var(--desk-margin), (100% - var(--sheet-max)) / 2) + 24px)`、`top: calc(var(--ov-top) + 7px)`。**バッジは残す**（Q4）。印刷ボタンは機能なので必ず残す（`setups.printPanel` が `#btn-preview-print` をクリックする。オーバーレイの下に隠れないこと）。

Mermaid の枠（`pre.mermaid-card`）は、紙の地（白）で暗色トーンの図が重く見える。**既定のトーンを地に従わせる**のは P1b の設定の話で、P4 では「紙の上でトーン `dark` が読めること」だけを確かめる（Q9）。

### 2.2.5 右ペインの帯（`#secondary-pane-header`）

オーバーレイになったヘッダー（P2）と、右ペインの 32px の帯（タイトル＋同期・印刷・モード・閉じる）が、窓の上端で**ぶつかる**（どちらも右上にボタンが並ぶ）。推奨:

- `pair` と `side` では、左右のページの本文の頭に**同じ追加分** `--pad-top-extra`（28px）を足す（`#editor`・`#ghost-overlay`・`#line-numbers`・`#editor-secondary`・`#secondary-line-numbers`・プレビューの窓の `padding-top`）。`getCharPixelCoords` は計算済みの `padding` を読むので追従する。
- `#secondary-pane-header` は `position: absolute; top: var(--ov-top); right: 12px; height: 28px` の**小さな帯**（背景は透明に近い、枠なし、タイトルは `--ink-2`、ボタンは `hover` / `:focus-within` で濃くなる）。`#secondary-pane` を `position: relative` にする。追加分の中に収まるので本文と重ならない。P2 のオーバーレイ群の自動非表示にも**入れる**（同じクラスで消える、`:focus-within` で戻る）。
- id・クラス・ボタンの id は変えない（スモーク 101 は `#btn-secondary-print` が `#secondary-pane-header` の矩形内にあることを見る。docshots のマーカーも同じ id）。
- 見出しのファイル名は、右のタブ帯（P3）と二重になる。小さく残す（読み上げと、サイドプレビューが別のノートを見せることがあるため）。

### 2.2.6 リサイザー: ドラッグ・ダブルクリック・**キーボード（新設、F1）**

- マークアップ（`index.html` の属性だけ。id は同じ）: `role="separator" aria-orientation="vertical" tabindex="0" aria-valuemin="15" aria-valuemax="85" aria-valuenow="50"`。名前は既存の `title`（`tipPaneResizer`）。
- 比率の計算を**ノドの幅を引いた残り**に対する割合にする（`gutterW = paneResizer.getBoundingClientRect().width`）。`applySplitRatio`: `editorPane.style.flex = '0 0 calc((100% - var(--gutter-w, 5px)) * ' + ratio.toFixed(4) + ')'`、ドラッグの `ratio = currentLeft / (total - gutterW)`。これで 24px のノドでも、ダブルクリックで左右が**同じ幅**になる（今の 5px は誤差だが 24px は目に見える）。クランプ 15〜85% は維持。
- キー（`keydown`、リサイザーにフォーカスがあるときだけ）: `←`/`→` で ±2 ポイント、Shift で ±10、`Home`/`End` で 15 / 85、`Enter` で 50（ダブルクリックの代わり）。`aria-valuenow` を更新。IME 変換中は `e.isComposing` で無視。**ドラッグ・ダブルクリックは今の挙動のまま**。
- `tipPaneResizer` の英日の文を更新（「ドラッグか矢印キーで幅を変更 / ダブルクリックか Enter で 50:50 に戻す」）。`tests/i18n_test.mjs`・`english_ui_strings_test.mjs` の規則（同じ `{placeholder}`、英語に日本語を混ぜない）。
- ドラッグ中の描画: `applySplitRatio` は 1 move ごとに両テキストエリアのレイアウトと `invalidateCharPixelMirrors()`（既存と同じ）。ノドを広げても**増えるのは 24px 幅の静的な層だけ**。

### 2.2.7 ペインのフォーカス表示

今の `.pane-focused` は 1px の青い outline（`rgba(0, 122, 204, 0.4)`、色の直書き）で、「枠線を無くす」v2 と合わない。クラス（`pane-focused`）は**残す**（`rpc_write_tabs_test`・`second_panel_test` が見る）。見た目は、**フォーカスのあるページの上端に 2px のアクセント線**（`--pane-focus`）を、`pair` と `side` のときだけ出す（`1 ページ` では出さない）。強制色では 2px の `Highlight` の outline に戻す。

### 2.2.8 エディタのフォント設定（`appearance.editorFont`）

- 5 か所の書体を `font-family: var(--editor-font-user, <今の並び>)` にする（`var()` のフォールバックは**カンマ区切りの並びをそのまま**書ける）。行番号の 2 か所は今の並び（`Meiryo` なし）を**そのまま**フォールバックにして、見た目を変えない。
- `applyEditorFont()`: 設定が空なら `document.documentElement.style.removeProperty('--editor-font-user')`（**何もしない**）、あれば `setProperty('--editor-font-user', safeFontFamily(name) + ', ' + 今の並び)`。そのあと `invalidateCharPixelMirrors()`、`hideCursorAura(true)`、`triggerCursorAuraDebounced()`、`FileAnchor.scheduleMarks()`、`scheduleUpdateLineNumbers()`、`scheduleUpdateSecondaryLineNumbers()`（`applyFontSize` と同じ手順）。大きさは今の `applyFontSize`（localStorage）のまま。
- `safeFontFamily(name)`（純粋関数、テスト対象）: 前後の空白を除く、80 文字まで、制御文字と `" ' \ ; { } ( ) < > :` を含むなら**空を返す**（無効扱い）、通ったら `"名前"` と二重引用符で囲む。日本語のフォント名（`"BIZ UDゴシック"`）は通す。CSS 注入にならないこと（`setProperty` は 1 つの宣言の値としてしか解釈しない）を試験する。
- 起動時: `loadLocalConfigSync` の `applyTheme()` の隣で 1 回だけ（設定が空なら何もしない）。**同梱はしない**。
- 設定画面: P1b の「外観」に `<input id="cfg-editor-font" list="…">`（空 = 既定。プレースホルダーに既定の名前）と、「既定に戻す」。保存前の即時反映と、取り消しで戻す（`restoreLiveConfigFromSnapshot` に 1 項目足す）。
- 注意: 書体を変えると、8 万行のノートでは**全行の再レイアウト**が走る（測る: §4）。

### 2.2.9 狭い窓（`@media (max-width: 900px)`）

今は分割・プレビューに狭い窓向けの規則が無い（`min-width: 150px` だけ）。`--desk-margin` を 12px、`--gutter-w` を 12px に、`--sheet-max` は `100%` に。600px 幅で、左右ページが読めること（各ペインが 150px を割らない）を確かめる。

### 2.2.10 強制色（`@media (forced-colors: active)`）

`pair`: ノドの背景・ドット・影を無効にして、`border-left: 1px solid CanvasText`（幅 5px）。`side` / `preview`: 紙に `border: 1px solid CanvasText`、`box-shadow: none`、地と紙は両方 `Canvas`（枠が段差の代わり）。`.pane-focused` は `outline: 2px solid Highlight`。リサイザーの `:focus-visible` は `Highlight`。

## 2.3 手順（各段のあともアプリが動く）

各段の終わりに共通: `node tools/run_js_tests.mjs` が全件通る、`node tests/smoke/run.mjs` が通る（少なくとも `--only` で 63・83・87・90・97・98・101）、実アプリ（隔離）で 4 つの表示を目で確かめる。追加した CSS/JS のバイト数を報告。

| 段 | 内容 | 触るファイル | 追加・更新するテスト | 完了の確認 |
|---|---|---|---|---|
| **S0** | 前提の確認（§1）。基準の測定: 8 万行のノートで、`side` と `preview` のスクロール・ドラッグ（`tools/perf/v2_perf.mjs` に、この 3 つの場面が無ければ**追加を依頼**）。docshots の基準（`split-preview`・`print-panel`・`ui-map`） | なし | なし | P1b のトークン・P2 の `--ov-*` が実在する |
| **S1** | `viewOf` と `applyViewMode()`、`body[data-view]`。見た目は変えない | `frontend/js/view_layout.js`（新）、`frontend/js/app.js`（4 関数に 1 行ずつ）、`frontend/index.html`（`<script>` 1 行） | `frontend/js/view_layout_test.js`（4 つの表示の判定表）、`tests/view_layout_wiring_test.mjs`（4 関数が呼ぶ、`restoreSessionFromData` 経由でも `data-view` が正しい、モックでも落ちない） | 全図が基準と画素一致 |
| **S2** | リサイザーの a11y とキーボード、比率の計算を `--gutter-w` 基準に。`--gutter-w` の既定は 5px で**見た目は変わらない** | `frontend/index.html`（属性）、`frontend/js/app.js`（`initPaneResizer`・`applySplitRatio`）、`frontend/js/view_layout.js`（`ratioAfterDrag`・`ratioAfterKey`）、`frontend/js/i18n.js`（英日、CRLF を保つ） | `view_layout_test.js` に比率の表（クランプ、ノドの幅の控除）、新規スモーク `108_pane_resizer.mjs`（Tab でフォーカス、`←`→`aria-valuenow` が 2 動く、Shift で 10、Home/End、Enter で 50、ダブルクリック、ドラッグ。左右の幅が 50:50 で等しい） | スモーク 83・87・63 が通る。GIF の `widenPreviewPane` が動く |
| **S3** | `pair` の見た目: ノド（24px、影、ドット）、地、`.pane-focused` の置き換え、`body[data-boundary]` の 3 値（まだ設定画面は無く、既定 `gutter`） | `style.css` | 新規 `tests/split_view_style_test.mjs`（`body[data-view="pair"]` の規則、`--gutter-w`、`mask-image` と `-webkit-mask-image`、強制色の規則がある）。`rpc_write_tabs_test`・`second_panel_test` は `pane-focused` クラスの有無だけなので通る | 目視（墨・紙）。`ui-map`・新規 `split-editor` の図 |
| **S4** | `preview` の紙: 机、中央 800px、影、枠なし、上下の padding、バッジ・印刷ボタンの位置、ホイールの転送、`.html-mode` の例外、`print.css` の打ち消し（`box-shadow: none !important`、`max-width: none !important`、`border-radius: 0`、`width: auto`）。**P1b の `.markdown-body` の紙の値を前提にする** | `style.css`、`print.css`、`frontend/js/app.js`（`applyViewMode` 内で、`preview`・`side` に入ったときだけホイールの転送を付け、出たら外す） | `tests/preview_frame_test.mjs` を**書き換え**（枠・`--bg-preview` → 紙・机・影・`--sheet-max`）、`tests/print_style_test.mjs` に打ち消し行の検査を足す（既存の正規表現は通る）、新規スモークに「紙の左右の余白が等しい（中央）、幅が 800 以下、`html-mode` は余白 0、`scrollTop = 0` で最初の行が見える、机の上のホイールで紙が動く」 | スモーク 97・98・99・100・90。`print-panel` の図（紙・黒い文字は印刷の側で変わらない） |
| **S5** | `side` の紙と右ペインの帯（§2.2.5）、つかみしろだけのリサイザー | `style.css`、`print.css`（`body[data-print-pane="secondary"]` の打ち消し） | スモークに「紙の左右の余白が 34px、紙の上端が `#workspace` の上端（上下いっぱい）、`#btn-secondary-print` が帯の矩形内（スモーク 101 のまま）、ドラッグできる」 | スモーク 101・87・90。`split-preview` の図（マーカーの位置を直す）、GIF 2 本 |
| **S6** | 狭い窓、`--pad-top-extra`、強制色、細部 | `style.css` | `split_view_style_test.mjs` に `@media (max-width: 900px)` と `forced-colors` の検査。CDP `Emulation.setEmulatedMedia`（`forced-colors: active`）で実アプリを撮る | 600px・1120px・強制色で目視 |
| **S7** | エディタのフォント（§2.2.8）と `appearance` の往復 | `style.css`（5 か所）、`frontend/js/app.js`（`applyEditorFont`、`syncBackendConfig`・`loadLocalConfigSync` の `appearance` の行、`restoreLiveConfigFromSnapshot`）、`frontend/js/view_layout.js`（`safeFontFamily`） | `view_layout_test.js`（`safeFontFamily` の表: 通る名前、注入を試みる名前、空）、`tests/appearance_roundtrip_test.mjs`（**F7**: `config.json` に `appearance.splitBoundary`・`editorFont` があっても `syncBackendConfig` → `savePersistentConfig` で消えない）、`tests/editor_font_wiring_test.mjs`（5 つの規則が `var(--editor-font-user, …)`、`applyFontSize` と同じ無効化の列） | 実アプリでフォントを変えて、ゴースト・行番号・検索の印・折り返しが**ずれない**（目視＋既存スモーク 83） |
| **S8** | 設定画面に「分割の境界」（`<select id="cfg-split-boundary">`）と「エディタのフォント」。即時反映・取り消しで戻る・保存。i18n 英日 | `frontend/index.html`、`frontend/js/app.js`、`frontend/js/i18n.js` | `tests/settings_differential_save_test.mjs`・`settings_group_fixes_test.mjs` の更新、新規スモーク（選ぶと即反映、取り消しで戻る、保存して再読込で残る） | docshots の `settings-general`（P1b の「外観」の節）を撮り直す |
| **S9** | 仕上げ: マニュアル・features・skills の記述（キーボード操作・設定 2 つ）、docshots（`split-preview` の撮り直し・`split-editor` の追加）、GIF 2 本、`docs/design/v2-visual-2026-10.md` §4.2 の「現行のキーボード操作」の記述を事実に直す、測定の報告 | `docs/`、`tools/docshots/` | `python tools/check_manual.py`、`docs/maintenance/after-a-big-change.md` の項目 | 全図の目視（両方の地、日英） |

S2・S3・S4・S5 は互いに独立に近い（S1 だけが前提）が、同じ `style.css` を触るので**直列に**進める。

## 2.4 リスク（P4）

| # | リスク | 対策 |
|---|---|---|
| R1 | 紙の**ラッパー**を足すと印刷が壊れる（F4）、プレビューの中身の入れ替えで装飾の子が消える（F3） | ラッパーも子も足さない。窓自身の背景・影・疑似要素と兄弟だけ（§2.2.4） |
| R2 | P2 のオーバーレイと右ペインの帯・バッジ・印刷ボタンの**衝突** | `--ov-top`・`--pad-top-extra`（§2.2.5）。S0 で P2 の出荷物を確認し、**スクリーンショットで**位置を決める。`setups.printPanel` が `#btn-preview-print` をクリックできること |
| R3 | 80,000 行のノートの**描画性能**: 紙の `box-shadow`（大きなぼかし）が背の高い窓に付く、`content-visibility: auto` との相性、ノドの `mask-image` | 影は**静的**なので再描画はスクロールで起きない（`filter`・`backdrop-filter`・`will-change` は使わない）。測る: `side`・`preview` で 8 万行をスクロール（フレーム時間 p50・p95・17ms 超の枚数、GPU、メモリ）を基準と比べる。**プレビュー切替の 7 秒**（既知の残課題）が悪化しないこと。悪化したら影のぼかしを減らす |
| R4 | ドラッグ中のレイアウト（既存）。ノドを広げても増えない | S2 のあと、8 万行でドラッグしてフレーム時間を基準と比べる |
| R5 | 紙の幅 800px で**広い表・コード・図がはみ出す**（表は折り返しの工夫が無い。`.markdown-body table` は `width: 100%` のまま） | 紙の内側の本文幅は約 730px。まず実物で確かめ、はみ出すなら `--sheet-max` を 880px に（Q5）。表を `display: block; overflow-x: auto` にするのは見た目の副作用が大きいので最後の手段 |
| R6 | 紙の窓がスクロールの箱なので、スクロールバーが紙の右端に出る、机の上のホイールが効かない | ホイールの転送（S4）。見た目は `::-webkit-scrollbar` で目立たなくする（Q8）。全幅の窓＋グラデーションの案は `cqw` が要り Safari 15.6 で使えないので取り下げ（§2.2.4） |
| R7 | **macOS 10.15（Safari 15.6）で使えない構文を入れてしまう**（`color-mix()`・`@container`/`cqw`・`scrollbar-gutter`・新しい `:has()`）。`mask-image` は接頭辞なしが Safari 15.4 から、`-webkit-mask-image` が必要。`clip-path`・`inset`・`max()` は可 | §1.1 の表。`split_view_style_test.mjs` が禁止の構文を grep で止める。`-webkit-mask-image` を先に書く。**Mac の実機（10.15 / 現行）は未確認**。Mac は P6 |
| R8 | 強制色で枠が消えて、ページ・机・紙が区別できない | §2.2.10。CDP のエミュレーションで撮る（実機の Windows ハイコントラストは未確認） |
| R9 | モックの DOM のテスト（F8） | すべてのガード。S1 のテストが `dataset`・`setProperty` の無いモックで通ること |
| R10 | 書体の指定による**注入**、存在しないフォント名 | `safeFontFamily` ＋ 今の並びを後ろに連結（存在しなければ今の見た目に落ちる） |
| R11 | `appearance` が保存で消える（F7） | S7 の往復テスト。P1b の担当に最初に伝える |
| R12 | `print.css` の打ち消し漏れで、印刷に影・余白・最大幅が出る | S4・S5 で印刷メディアの computed style をスモーク（`101` と同じ方法）で確かめる |
| R13 | docshots の全図が撮り直しになる（設計書 §6）。マーカー（`#editor-pane at tl dx/dy`）がずれる | S9。P4 の図は `split-preview`・`print-panel`・新規 `split-editor` |

## 2.5 未決（P4）— オーナーへの質問と推奨

| # | 質問 | 推奨 |
|---|---|---|
| Q1 | 見開きプレビューにもノドを出すか | **出さない**。机の色の段差が仕切り。つかみしろだけ。`line` 設定のときだけ細線 |
| Q2 | 右ペインの帯（同期・印刷・モード・閉じる、ファイル名）の置き場 | 本文の頭に**追加分 28px** を左右同じに足し、右ペインの帯を小さな浮き帯にして P2 のオーバーレイ群に入れる（§2.2.5）。ボタンをメインのヘッダーに移すのは、`chrome_layout.js`（ツールバーの編集）への影響が大きいので避ける |
| Q3 | どちらのページに入力しているかの印 | 上端 2px のアクセント線（§2.2.7）。クラスは残す |
| Q4 | `Preview` のバッジを残すか | **残す**（紙の右上に小さく）。机の上の紙だけでも状態は分かるが、バッジは `aria-hidden` の飾りで、削ると `preview_frame_test` と兄弟セレクタの設計を壊す。落とすなら P6 |
| Q5 | 紙の最大幅 800px と、HTML ノートの扱い | 800px で始めて実物で確かめ、広い表がはみ出すなら 880px。HTML ノートは余白なし・全幅 |
| Q6 | ノドの幅 24px と設定の値の名前 | 24px。キー `appearance.splitBoundary` = `gutter` / `shade` / `line` |
| Q7 | 分割の比率を保存するか | **今は保存しない**（F2。セッション JSON のバイト同一の試験を直す必要）。要望が出たら別件 |
| Q8 | 紙のスクロールバーが紙の右端に出る（窓の端には出せない: 窓を全幅にする案は Safari 15.6 で作れない、§2.2.4）。許すか | **許す**。机の上のホイールは転送で補い、`::-webkit-scrollbar` の細い見た目にする。窓の端に出したいなら、紙の幅を JS で計算して変数に流す手（常駐の `ResizeObserver` が要る）しか無く、「未使用なら無コスト」に反するので推奨しない |
| Q9 | 紙の地での Mermaid の既定トーン | 設定値に `auto`（地に従う）を足すのは P1b。P4 は `dark` トーンが白い紙で読めることだけ確認 |
| Q10 | 設定のフォント名の入力: 一覧から選ぶか | **入力のみ**（`list` で候補を数個）。システムのフォント一覧を列挙する API は WebView に無く、列挙は重い |

---

# P5 — 付箋のパネル

## 3.1 棚卸し

### 3.1.1 パネルの一覧（`docs/design/panel-template.md` と `index.html`、各 JS で確認）

| 区分 | 要素 | 開く操作 | 親・位置 | 殻 |
|---|---|---|---|---|
| **雛形の 6 つ** | `#inline-prompt-bar`（Ask と Rewrite は**同じ要素**。`inline-prompt-rewrite` クラスは付くが CSS は無い） | `Ctrl+L`・`Ctrl+K` | `#workspace` の子、`top: var(--panel-top)`、下に避ける `.panel-dock-bottom` | `.inline-prompt-bar` |
| | `#cli-filter-bar` | `Ctrl+E` | 同上 | `.inline-prompt-bar`（同じ殻） |
| | `#jev-action-panel`（`jev_action.js` が作る） | `Ctrl+J` | **`#editor-wrapper` の子**（F5）、`bottom: var(--panel-top)` | `.jev-action-panel` |
| | `#quick-pick-modal > .quick-pick-modal`（コマンドパレット） | `Ctrl+Shift+P` | `.modal-backdrop`（fixed、暗幕 0.6）の中、`top: var(--panel-modal-top)` | `.quick-pick-modal` |
| | `#scraps-search-modal > .quick-pick-modal.scraps-search-dialog` | `Ctrl+Shift+F` | 同上 | 同上 |
| **同じ殻（雛形の 6 つの外）** | `#tag-pick-modal > #tag-pick-card.quick-pick-modal.tag-pick-card` | パレット: タグを付ける・外す | 同上 | `.quick-pick-modal` |
| | `#lesson-modal > #lesson-card.quick-pick-modal.lesson-card`（`role="dialog"`、フォーム・チェック・textarea を含む） | タスクカードの Lessons | 同上 | `.quick-pick-modal` |
| | `#tab-list-panel.tab-list-panel`（`tab_overflow.js`） | All tabs | `position: fixed`、body の子 | 独自（雛形に倣う） |
| | `#status-ai-pop.status-ai-pop`（`status_ai.js`） | ステータスバーの AI | `position: fixed`、body の子 | 独自（雛形に倣う） |
| | `#slot-quick-selector`（`slot_agent.js`。スニペットの選択） | `{{` / パレット | `position: absolute`、body の子、キャレットの近く。`pointer-events: none`（`.active` で有効） | 独自 |
| **付箋にしない（理由は §3.4・§3.6）** | `#find-replace-bar`（`border-radius: 4px`、`0 4px 14px`）、`.help-menu`、`#context-menu`、`.running-tasks-panel`、`.modal-card` 系ダイアログ（`#settings-modal`、`#about-modal`、`#pack-modal`、`#confirm-modal`、`#goto-line-modal`、`#mobile-drop-modal`、`#deep-search-modal`、`#print-modal`） | | | |

### 3.1.2 規則（v1.10.5、**保つ**）と、その実装・試験の場所

| 規則 | 実装 | 試験 |
|---|---|---|
| 幅 560px（狭いと左右 16px の余白）、全パネル同じ | `--panel-width`、`width: min(var(--panel-width, 560px), calc(100% - 32px))`（`.inline-prompt-bar`・`.quick-pick-modal`・`.jev-action-panel`）。`.scraps-search-dialog { max-width: none }`。`#cli-filter-bar` は幅を持たない | `panel_template_test` §1 |
| 位置: ヘッダーの下 16px・水平中央。例外: 対象が上端にあるときだけ下端 | `--panel-top`、`.inline-prompt-bar { left: 0; right: 0; margin: 0 auto }`、`dockPanelBar`（app.js。`.panel-dock-bottom`） | §1・§3（`dockPanelBar(inlinePromptBar,` と `dockPanelBar(cliFilterBar,`、インライン座標を使わない） |
| 開く: 120ms のフェード + 4px 上から。閉じる: 200ms のフェード | `promptFadeIn`、`.panel-fading { opacity: 0; transition: opacity 0.2s ease-out }` | `panel_fade_test` §8 |
| フォーカスが外へ出たら猶予 0.4 秒のあとフェードして閉じる。入力が残っているときは閉じない。ウィンドウが非アクティブになっただけでは閉じない。動きを減らす設定ではフェードなし | **`frontend/js/panel_fade.js`（変えない）** | `panel_fade_test` 全部 |
| 入力欄に枠も背景も付けない（パネル全体が箱）。ヘッダー 44px、文脈 28px、行 36px、ヒント 28px | `#inline-prompt-input, #cli-filter-input { background: transparent; border: 0 }`、`.quick-pick-input`、`.inline-prompt-row { height: 44px }`、`.quick-pick-input-wrap { height: 44px }` | `panel_template_test` §2 |
| **フォーカスがパネルの中にあるあいだ、枠だけがアクセント色** | `.inline-prompt-bar:focus-within`・`.quick-pick-modal:focus-within`・`.tab-list-panel:focus-within` の `border-color` | （枠の規則の中で検査） → **付箋では置き換える**（§3.2.5） |
| ラベル（バッジ）は塗りなし・枠なし、言葉（Ask / Rewrite / Command / Suggest / Search / Commands）。主ボタンは 1 つだけ | `.inline-prompt-badge`、`.jev-badge` | `first_run_polish_test` |
| `role=dialog`・`aria-modal`・フォーカストラップは `a11y.js`（`.modal-backdrop > .modal-card` に付く。`.quick-pick-modal` は対象外） | | `a11y_modal_refocus_test` |

### 3.1.3 位置に関わる定数（F6）

`--panel-top: 16px`、`--panel-modal-top: 53px`、`dockPanelBar` の `16 + (bar.offsetHeight || 74) + 8` と `workspaceRect`、`.jev-action-panel { bottom: var(--panel-top) }`、`.status-ai-pop { bottom: 30px }`（フッター 24px の上）、`.tab-list-panel`・`#slot-quick-selector` は JS が座標を決める。

### 3.1.4 影響するテスト・docshots・GIF

- **ユニット**: `panel_template_test`（§1・§2・§4 を書き換え）、`panel_fade_test`（§8 の `.panel-fading` は変えない）、`status_ai_test`（`.status-ai-pop` の `background`・`border-radius: 8px`・`box-shadow: var(--panel-shadow` の 3 行、`@media (prefers-reduced-motion` の 1 行）、`tab_overflow_wiring_test`（`.tab-list-panel` の `background`・`border`・`border-radius: 8px`・`box-shadow`、`:focus-within` の `border-color`）、`about_privacy_test`（`#about-modal .modal-card` の幅）、`first_run_polish_test`・`first_run_welcome_test`（`.inline-prompt-bar .btn-action` の色、`btn-pale` の塗りの直書き）、`quick_pick_icons_test`、`ask_and_command_bar_test`、`jev_action_test.js`（`jev-action-panel` が作られる。**親を `#workspace` に変えるなら**モックの更新）、`zen_active_test`。
- **スモーク**: `04_command_bar`、`05_palette`、`06_search`、`08_tab_overflow`、`11_status_ai`、`12_ask_undo`、`67_ask_bar_and_panels`、`81_keyboard_exits`、`103_search_filter`、`104_tag_edit`、`105_lessons`、`106_tag_context_menu`、`107_tag_subtree`、`93_meaning_search`。
- **docshots（約 20 枚×日英）**: `inline-ai`、`ask-bar-error`・`-choice`・`-consent`・`-record`、`cli-bar`、`ai-cli-bar`、`risky-command-confirm`、`quick-actions`、`snippet-picker`、`scraps-search`、`search-filter`、`scraps-meaning`、`tag-picker`・`tag-picker-tree`、`command-palette`、`lessons-dialog`、`tabs-all-list`、`status-ai-popover`・`status-ai-unset`。マーカーは `#jev-action-panel .jev-header`、`.jev-slot-card`、`#slot-quick-selector .slot-selector-header`・`.slot-selector-item` など**内側のセレクタ**なので、クラス名を変えなければ生きる。
- **GIF**: Ask AI（Ctrl+L）、Command bar、Quick Actions、Search scraps、AI correction ほか、パネルが出る全部。

## 3.2 設計: 付箋の面

面だけを変える。位置・幅・フェード・入力の規則・JS（`panel_fade.js`・`dockPanelBar` の考え方）・マークアップ・id・クラスは**変えない**（Jev の親だけ §3.3 S5）。

### 3.2.1 構造: 2 つの疑似要素と、余白の帯

対象の根（§3.1.1 の「雛形の 6 つ」と「同じ殻」の 10 個）に共通のブロックを **1 か所**に書く（セレクタを列挙）。

```
根:  background: transparent;  border: 0;  border-radius: 0;
     box-shadow: var(--note-shadow);          /* 長方形の影（2 段）*/
     padding-bottom: var(--note-fold);        /* 折り目の帯。子は決してここに描かれない */
     isolation: isolate; （既に position + z-index があり、積み重ねの文脈は有る）
::before  紙。inset: 0; z-index: -1; pointer-events: none;
          background: linear-gradient(var(--note-tape), var(--note-tape)) top / 100% 6px no-repeat,   /* 粘着帯: rgb(var(--accent-rgb) / 0.35) */
                      linear-gradient(var(--note-tint), var(--note-tint)),                            /* 薄いアクセント: rgb(var(--accent-rgb) / 0.10) */
                      var(--sheet);                                                                  /* 紙の下地 */
          clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--note-fold)), calc(100% - var(--note-fold)) 100%, 0 100%);
::after   折り返し。right: 0; bottom: 0; width/height: var(--note-fold); pointer-events: none;
          background: linear-gradient(to bottom right, var(--note-flap) 50%, transparent 50%);   /* --note-flap: rgb(var(--shade-rgb) / 0.14)（紙の上に重ねて少し暗く） */
```

- 切り欠き（右下の三角）と折り返し（その鏡像）は、右下の `var(--note-fold)`（14px）の正方形の**中に収まる**: 左上半分が折り返し、右下半分が切り欠き。
- **根に `clip-path` も `filter: drop-shadow` も使わない**（理由は §3.5 R1・R2）。影は根の長方形の `box-shadow`。切り欠きの 14px の三角には影が描かれず、その下の面が見える。これは折り目の見え方として自然で、角の周りの影の途切れは 14px に収まる。
- 余白の帯（`padding-bottom: 14px`）は、切り欠きに**子の背景（選択行の色など）が描かれる**のを防ぐ。パネルの高さが各 14px 増える。最後の子の右端の文字（ヒントの右寄せ、`.scraps-match-item` の右の `meta`）が折り返しに触れない。
- 既存の疑似要素との衝突は**無い**（根 10 個に `::before`・`::after` の規則は無いことを確認済み）。
- `.status-ai-pop`・`.tab-list-panel`・`#slot-quick-selector` も同じブロックに入れる。

### 3.2.2 粘着帯とフォーカス（枠の代わり）

- 粘着帯は紙の上端の全幅 6px の帯（`--note-tape` = `rgb(var(--accent-rgb) / 0.35)`）。**フォーカスがパネルの中にあるあいだ**は、同じ帯が不透明のアクセント（`--note-tape-focus`）になる: `根:focus-within::before` の `background-image` の差し替え。これが v1.10.5 の「枠だけがアクセント色になる」の置き換え。
- 墨の地で `--note-tape-focus` が紙と 3:1 以上のコントラスト（WCAG 1.4.11）を持つこと。Charcoal の墨では `accent-hover`（#666）が不足しうるので、**墨では `accent-label` の色**（`--accent-label-rgb`、または計算済みの別トークン）を使う。5 つのアクセント × 2 つの地で**計算する試験**を足す（§3.3 S2。アルファの重ね合わせも計算に入れる）。
- 入力欄にはキャレットがある（`outline: none` のまま）。帯だけに頼らない確認は、強制色の規則（§3.2.6）とスモークで行う。

### 3.2.3 色（トークン）

設計書 §4.6: 「薄いアクセント色の紙」。§4.1: `--sheet` は「プレビューの紙、**付箋の下地**」。

- 紙 = **`--sheet` の上に、そのテーマのアクセントを薄く重ねた色**。紙の地では**薄い色の紙**（白に近い）、墨の地では**暗い紙**（`--sheet` = `#181a26` がページ `#0e0f17` より明るい）。**墨でも明るい紙にはしない**（Q1）: 墨の画面で白に近い付箋は眩しく、中の文字色・チップ・ボタン（P1a のトークン）を地ごとに別系統にする必要が出る。
- **`color-mix()` は使えない**（macOS 10.15 = Safari 15.6、契約 §1.5）。混ぜるのは**色の計算ではなく背景の重ね**でやる: `::before` の背景に「粘着帯の層」「薄いアクセントの層 `linear-gradient(var(--note-tint), var(--note-tint))`」「`var(--sheet)`」の順に積む（§3.2.1）。`--note-tint = rgb(var(--accent-rgb) / var(--note-tint-a))`、`--note-tape = rgb(var(--accent-rgb) / 0.35)`、`--note-flap = rgb(var(--shade-rgb) / 0.14)`。**係数だけ**を地ごとに持つ（`--note-tint-a`: 紙 0.10、墨 0.12 程度。実物で決める）。したがって `tokens.css` に 5 テーマ分の紙の色を書く必要は無く、**自分で指定したアクセントも `--accent-rgb` 1 つで自動的に付箋の色になる**（P1b の JS は紙の色を計算しなくてよい）。
- `--note-shadow` = `0 1px 2px rgb(var(--shade-rgb) / 0.30), 0 10px 24px rgb(var(--shade-rgb) / 0.22)`（係数は地ごと）。墨の地では影がほとんど見えないので、「持ち上がり」は紙が地より明るいことと、上端の粘着帯で表す。
- 面の中の文字・チップ・ボタンは P1a のトークンをそのまま使う。**根のスコープで `--bg-modal: var(--note-paper)` に再定義**して、`var(--bg-modal)` を使っている中身（`.shortcuts-table th` など設定画面の中身は別）を紙に合わせる。
- 行の区切り（今は `#2e2e31`・`var(--panel-line)`）は、P1a が `--hair` 系のトークンにしている前提。

### 3.2.4 動き

開く: 既存の `promptFadeIn`（120ms、4px 上から）を**そのまま**使う（「付箋の降りる動き」は、すでにこの動き）。閉じる: `.panel-fading`（0.2s）。**全体規則の `prefers-reduced-motion`** で止まる（F10）。新しい `@keyframes` は足さない。

### 3.2.5 位置（F6）

- `--panel-top: calc(var(--ov-top, 0px) + 16px)`、`--panel-modal-top: calc(var(--ov-top, 0px) + 15px)`、Jev: `bottom: calc(var(--ov-bottom, 0px) + 16px)`、`.status-ai-pop { bottom: calc(var(--ov-bottom, 0px) + 6px) }`。値は `style.css` の 1 か所（`body` の変数）。
- `dockPanelBar`: 定数 `16` を、**バーの計算済み `top`**（`panel-dock-bottom` を外した状態の `getComputedStyle(bar).top`）に置き換える。`workspaceRect` との差は、`#workspace` が窓いっぱいになっても正しい（バーの top は `#workspace` 基準）。**`panel_template_test` §3 の検査（`dockPanelBar(inlinePromptBar,`・`dockPanelBar(cliFilterBar,`・座標のインラインが無い）はそのまま通る**。
- 折り目の帯で高さが 14px 増えるので、「下に避ける」判定の `barBottom` に自然に入る（`bar.offsetHeight`）。

### 3.2.6 強制色（`@media (forced-colors: active)`）

```
根:  border: 1px solid CanvasText;  background: Canvas;  box-shadow: none;  padding-bottom: 0;  clip-path: none;
根::before, 根::after:  display: none;
根:focus-within:  outline: 2px solid Highlight;  outline-offset: -2px;
```
（`filter` も `clip-path` も根に使っていないので、強制色で残る装飾は無い。粘着帯の代わりにフォーカスは `Highlight` の outline。）

### 3.2.7 大きなノート・性能

影は静的（`box-shadow` のみ）、`filter`・`backdrop-filter`・`will-change` を**使わない**。疑似要素 2 つと、開くときの 120ms のフェードだけ。8 万行のノートを開いたまま、各パネルを開いてフレーム時間と GPU を基準と比べる（§4）。テキストの鮮明さ（Windows の ClearType）を保つため、根に `filter`・`opacity` を常時付けない（`.panel-fading` のフェード中だけ `opacity`）。

## 3.3 手順（各段のあともアプリが動く）

共通: `node tools/run_js_tests.mjs` 全件、関連スモーク、実アプリ（隔離）で目視、追加バイト数の報告。

| 段 | 内容 | 触るファイル | テスト | 確認 |
|---|---|---|---|---|
| **S0** | 前提（§1）の確認。P1a の後の `style.css` / `tokens.css` の形を読む。基準の撮影（docshots の該当 20 枚）。**P1a が直した `panel_template_test` などの行を確認** | なし | なし | 基準の画像がある |
| **S1** | **位置の定数をオーバーレイ対応に**（F6）。`--panel-top`・`--panel-modal-top`・Jev の `bottom`・`.status-ai-pop` の `bottom`、`dockPanelBar` の定数 `16` を計算済み `top` に。見た目は P2 のあとの正しい位置になる | `style.css`、`frontend/js/app.js`（`dockPanelBar`） | `panel_template_test` §1（`--panel-top: 16px` の検査を `calc(var(--ov-top…) + 16px)` に更新）、新規スモークに「バーの上端がヘッダーの下端の 16px 下、フッターの上 16px に Jev」 | スモーク 04・05・06・67・81 |
| **S2** | `tokens.css` に `--note-tint`・`--note-tint-a`・`--note-tape`・`--note-tape-focus`・`--note-flap`・`--note-shadow`・`--note-fold`（14px）を追加（係数は地ごと、色はチャンネルのトークンから。`v2-tokens.md` にも）。**`color-mix()` は使わない** | `frontend/css/tokens.css`、`docs/design/v2-tokens.md` | 新規 `tests/note_surface_contrast_test.mjs`（`tokens.css` から 5 テーマ × 2 つの地の `--accent-rgb`・`--sheet`・係数を読み、**アルファの重ね合わせを計算して**紙の色を作り、本文 `--ink`・補助 `--ink-2`・`accent-label` が WCAG の閾値（4.5:1）、粘着帯のフォーカスが紙と 3:1 以上を満たす。満たさなければ具体的な組を出して落ちる） | テストが通る |
| **S3** | **面の差し替え**（§3.2.1〜3.2.3）: 共通ブロックを 1 か所に書き、根 10 個の `background`・`border`・`border-radius`・`box-shadow` を置き換え、`:focus-within` の枠を粘着帯に | `style.css` | `panel_template_test` §1・§2・§4 を**書き換え**（下表）、`status_ai_test`・`tab_overflow_wiring_test`・`about_privacy_test`・`first_run_polish_test` の 3〜5 行を新しい規則に更新 | 目視（墨・紙・5 テーマ）。20 枚の docshots |
| **S4** | 強制色・`prefers-reduced-motion` の確認・折り目の帯で隠れる要素の調整（最後の行の右端の余白、`.scraps-match-item` の meta、ヒント、`tag-pick-where`） | `style.css` | `panel_template_test` に §5「付箋」の検査（下表）、CDP の `forced-colors: active` で全パネルを撮って目視 | |
| **S5** | **Ctrl+J の親を `#workspace` に**（F5。影が切れる、分割時に左ペインの中央に出る不一致の是正）。`.jev-action-panel` は `#workspace` の `position: absolute` のまま | `frontend/js/jev_action.js`（`createJevPanelDOM` の 1 行）、`style.css`（必要なら） | `frontend/js/jev_action_test.js`・`tests/panel_fade_test.mjs` §8（`PanelFade.create(jevPanelEl, { watchFocus: false,` の検査は通る）、新規スモーク「分割中も Ctrl+J のパネルがウィンドウの水平中央」 | スモーク 67・`quick-actions` の図 |
| **S6**（任意） | **ダイアログの紙**（§3.4）: `.modal-card` を `--sheet`・枠なし・持ち上がった影（粘着帯・折り目なし）にし、`#settings-modal` に及ぼす | `style.css` | `panel_template_test` §4（設定の寸法の規則は残し、枠・影の行を更新）、`about_privacy_test`（幅） | 設定の全タブを docshots で撮り直す |
| **S7** | **雛形の文書の改訂**（試験と同時）: `docs/design/panel-template.md` の「共通の寸法とトークン」（背景・枠・角丸・影）を付箋の面に、「入力欄に枠も背景も付けない」「枠だけがアクセント色」を粘着帯に書き換え、「付箋の面」の節（§3.2.1 の構造・折り目の帯・根に `clip-path`/`filter` を使わない理由・強制色）を足す。`docs/design/settings-dialog.md` に「設定は紙」を 1 節。`docs/design/v2-visual-2026-10.md` §4.6 に「墨は暗い紙」「設定は紙」を反映 | `docs/design/` | 文書が試験の規則と一致している（試験のコメントから文書を引く） | |

**`panel_template_test` の改訂の中身**（S3・S4）:

- §1: 幅・`--panel-top`・`.panel-dock-bottom`・中央寄せ・`.scraps-search-dialog { max-width: none }` は**そのまま**。`border: 1px solid var(--border-color)`・`border-radius: 8px`・`box-shadow: var(--panel-shadow)` の 3 行は、`border: 0`・`border-radius: 0`・`box-shadow: var(--note-shadow)`・`background: transparent`・`padding-bottom: var(--note-fold)` に置き換える。
- §2: 入力欄の透明・枠なし、ヘッダー 44px は**そのまま**。
- §4（設定）: 幅 `min(var(--panel-width, 560px), calc(100vw - 32px))`・高さ・タブの規則は**そのまま**。S6 をやるなら、紙の背景（`var(--sheet)`）と「粘着帯なし」を足す。`rgba(255, 255, 255, 0.07)` の直書きの行は P1a が先に直している。
- 新 §5「付箋の面」: ①根のセレクタ列（10 個）が 1 つのブロックに入っている、②`::before` に `clip-path: polygon(` と粘着帯の背景、`::after` に折り返しのグラデーション、③**根自身に `clip-path`・`filter`・`backdrop-filter` が無い**（回帰を止める）、④`:focus-within::before` が `--note-tape-focus`、⑤`@media (forced-colors: active)` のブロックがあり `border: 1px solid CanvasText`・`::before, ::after { display: none }`、⑥`tokens.css` に `--note-*` があり、紙の色が `rgb(var(--accent-rgb) / …)` の重ねで作られている（**`color-mix(` が無い**）、⑦`.panel-fading` の規則と `panel_fade.js` の定数（400ms・200ms）が変わっていない（`panel_fade_test` が見る）。

## 3.4 設定画面（`#settings-modal`）は付箋か、別の面か — **別の面（紙）にする**

回答: 付箋にはしない。**「紙」（`--sheet`）にする**（任意の S6）。理由:

1. 付箋は**一時的な呼び出し**（入力して選んで実行して、フォーカスが外れたら消える）。設定画面・About・保存確認などは**文書のように読んで直す**画面で、長いフォーム、48px のヘッダー、40px のタブの行、56px のフッターを持つ。上端の粘着帯がヘッダーの上端に乗り、折り目が Save / Cancel のフッターに触れる。
2. 同じ面を使い回すと、**付箋は軽い呼び出し、紙は本格的な画面**という階層が壊れる。設計書の語彙（付箋 / 紙・本 / 机）にも合う。
3. 必要な変更は小さい: `.modal-card` の `background: var(--sheet)`、枠なし、影を持ち上がったものに。粘着帯・折り目・疑似要素は**付けない**。暗幕（`.modal-backdrop` の `rgba(0,0,0,.6)`）は残す（モーダル）。
4. 寸法（560px、620px、48/40/36/28）・スイッチ・ボタンの 3 段階・`#settings-modal` の `:has()` の規則は**そのまま**。

注意: Settings の寸法の規則と、**`.modal-card` を共有する他のダイアログ**（about、pack、confirm、goto、mobile-drop、deep-search、print）も同時に紙になる。それでよい（P6 で全部見る）。

## 3.5 リスク（P5）

| # | リスク | 対策 |
|---|---|---|
| R1 | **根に `clip-path` で右下を切ると、`box-shadow` も切れる**（影は根の箱の外に描かれるため、クリップされて消える）。クリップの外へ広げた多角形は、切り欠きの斜めの線で影が硬く切れる | **根にはクリップしない**。切り欠きは**紙の疑似要素 `::before`** だけにかけ、影は根の長方形の `box-shadow`（§3.2.1）。切り欠きの三角（14px）には影が描かれず、下の面が見える |
| R2 | 代案の `filter: drop-shadow()` を根に付けると、**文字が灰色のアンチエイリアス**になり（Chromium はフィルターのある描画面で LCD テキストを使わない）、設計書の「文字の鮮明さを優先」に反する。再ラスタライズの費用もある。Jev の親 `#editor-wrapper` の `overflow: hidden` でも切れる | 使わない。試験で**根に `filter` が無い**ことを固定（§3.3 の新 §5 ③） |
| R3 | 折り目の切り欠きに**子の背景**（選択行のアクセントの塗り、最後の行の線）が描かれて、切り欠きが塞がる | `padding-bottom: var(--note-fold)` の帯（子は描かれない）。S4 で全パネルの最後の行と右端の文字を撮って確かめる |
| R4 | **強制色**で粘着帯・折り目・影が消え、パネルの縁が分からなくなる | 強制色の規則（枠 `CanvasText`、フォーカスは `Highlight` の outline、疑似要素は非表示）。CDP のエミュレーションで撮る。実機の Windows ハイコントラストは未確認 |
| R5 | 暗いテーマでの**フォーカスの印**（粘着帯のアクセントと暗い紙のコントラスト）が 3:1 に届かない（Charcoal） | S2 のコントラストの試験。墨では `accent-label` を使う |
| R6 | 墨の地で影が見えず、「持ち上がり」が伝わらない | 紙が地より明るいこと、粘着帯、上端のハイライト（紙の疑似要素の内側）。実物を見て調整（Q1） |
| R7 | 8 万行のノートでの**影・疑似要素の費用** | 影は静的、`filter`・`backdrop-filter`・`will-change` なし。基準と比べて数字で報告 |
| R8 | **Ctrl+J の親が `#editor-wrapper`**（F5）で、影が切れる、分割時に左ペインの中央 | S5 で `#workspace` の子へ。影の切れは、それまでは影のぼかしを 16px に収めて暫定対応 |
| R9 | **位置の定数**（F6）がオーバーレイでずれる、`dockPanelBar` の判定が狂う | S1 を最初に |
| R10 | 面を差し替えると、**19 本の style.css 検査テスト**が一斉に赤くなる（F9）。P1a の直書き→トークンでも同じ行が赤くなる | 段の境で担当を決める（§4）。S3 の前に、赤くなる行の一覧を作る |
| R11 | `clip-path` の `polygon` と `calc()`・斜めの縁のアンチエイリアス、Mac の WKWebView（Safari 15.6 でも `clip-path: polygon()` は 13.1 から可。接頭辞なし） | 実機未確認。Mac は P6。紙の色を `color-mix()` で作る案は、10.15 で付箋が透明になる（背景が無効）ので**使わない**（§3.2.3）。禁止の構文は `panel_template_test` 新 §5 が止める |
| R12 | 暗幕（palette・search・tag・lesson の `.modal-backdrop` の `rgba(0,0,0,.6)`）が紙の「持ち上がり」を殺す | Q4。実物で 0.3 前後を試す。ぼかしは**かけない**（全画面の `backdrop-filter` は重い） |
| R13 | 余白の帯で、パネルの高さが 14px 増え、スクロールするリストの `max-height: 324px` との合計が窓に収まらない（小さい窓） | 既存の `max-height`（`vh` 基準）を確認。小さい窓のスモーク |

## 3.6 未決（P5）— オーナーへの質問と推奨

| # | 質問 | 推奨 |
|---|---|---|
| Q1 | **墨（ダーク）の付箋は暗い紙か、明るい紙か** | **暗い紙**（`--sheet` に薄くアクセント）。設計書の台帳が「付箋の下地 = `--sheet`」と言っている。明るい紙は眩しく、中身の全トークンを 2 系統にする必要がある |
| Q2 | 付箋にする範囲 | 雛形の 6 つ、同じ殻の 4 つ（タグ・レッスン・全タブ・AI のポップオーバー）、スニペット選択。**ダイアログ・メニュー・ドロワー・検索バー（`#find-replace-bar`）は対象外**（検索バーは小さな工具で、紙の面だけ後で揃える） |
| Q3 | 設定画面は付箋か紙か | **紙**（§3.4）。任意の S6 |
| Q4 | 暗幕の濃さ | 0.6 → 0.3 前後。ぼかしなし。実物で決める |
| Q5 | フォーカスの印 | 粘着帯のアクセント（枠の置き換え）。強制色は outline |
| Q6 | 粘着帯の形 | **全幅の 6px の帯**。中央の短いテープ形は、上端の外へはみ出すので `overflow` と `#workspace` の上端・Jev の wrapper で切れる |
| Q7 | 折り目の帯（各パネル +14px）を許すか | **許す**。切り欠きに子が描かれないことを保証する最も確かな方法 |
| Q8 | `Ctrl+J` を `#workspace` の子へ移す（水平中央が他と同じになる） | **移す**（S5）。位置の規則「全パネルで同じ水平中央」を満たす |

---

## 4. 測定・報告・実機でしか確かめられないこと

### 4.1 各段の終わりに数字で（契約 §1・§5、`feedback_keep_features_light`）

- 起動時間（`tools/perf/v2_perf.mjs`、7 回の中央値・最小・最大）、常駐メモリ（アプリ＋`msedgewebview2`）、8 万行のノートを開く時間とメモリ、**スクロールの p50・p95・17ms 超の枚数**、入力 50 回の遅延。**基準は `tools/perf/baseline-v1.14.md`**。
- P4 固有（`v2_perf.mjs` に無ければ追加を依頼）: `side` と `preview` で 8 万行のスクロール、**ドラッグ中**のフレーム時間（`pointermove` で 2 秒）、**書体を変えたときの全行の再レイアウト時間**、プレビュー切替（既知の 7 秒）の前後。
- P5 固有: 8 万行のノートを開いたまま各パネルを開いた最初のフレームの時間と、閉じた後のメモリ。
- 追加したバイト数: `style.css`（P4 は概算 +3〜4KB、P5 は +2KB。**測って置き換える**）、`tokens.css`（`--note-*` の 10 組）、JS（`view_layout.js` 約 1.5KB、`app.js` 数十行）。`index.html` の読み込みは `view_layout.js` の 1 つ増。
- 条件（他のアプリ、電源）を書き、同じ条件で 2 回測って差を示す。

### 4.2 この環境で確かめられる

隔離した実アプリ（CDP、`E2E/launch.ps1`）でのスクリーンショット（4 つの表示 × 墨・紙 × 5 テーマ、全パネル）、CDP の `Emulation.setEmulatedMedia`（`forced-colors: active`、`prefers-reduced-motion: reduce`）、スモーク（`tests/smoke/`）、JS 全件、docshots（画素の比較は `tools/docshots/compare_dirs.py`）、コントラストの計算の試験。

### 4.3 実機でしか確かめられない（未確認と書く）

Mac の WKWebView（**最低の macOS 10.15 = Safari 15.6 と現行の両方**。`clip-path`・`-webkit-mask-image`・`rgb(var(--x) / a)`・`inset`。`content-visibility` と `forced-colors` は Safari 15.6 で効かないが無害）、Windows の**実際のハイコントラストテーマ**、ClearType の文字の鮮明さ（`filter` を使わないことで守る設計だが、目では見ていない）、Windows 10 / 11 の窓の角丸との二重（設計書 §6）。

### 4.4 他の段・他の担当への依頼（まとめ）

1. P1a/P1b: `.markdown-body` 系の紙の値、`appearance` の器と **F7 の写す行**、`panel_template_test`・`first_run_welcome_test` の `rgba(255, 255, 255, 0.07)` の行をどちらで直すか。
2. P2: `--ov-top`・`--ov-bottom`、`#header`・`#status-bar` は `#app` の直接の子のまま、右ペインの帯をオーバーレイ群の自動非表示に入れる、textarea の `padding-top` の式に `--pad-top-extra` を含める。
3. P3: `body[data-view]` を使う（P4 S1 を前倒しするなら P3 の前に入れる）、左右のタブ帯の幅の変数を `pair` の右端のスクロールバー避けに使う。
4. P6: Mac、強制色の実機、全図の目視、マニュアル。
