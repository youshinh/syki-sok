# v2 P3 実装計画: タブを窓の端の細い索引にする（2026-10-04、設計担当）

状態: **計画。コードは変えていない。** 設計書 `v2-visual-2026-10.md`（§3 の 2・3、§4.2、§4.3、§6、§7）と `v2-implementation-contract.md` に従う。ここに書いたコードの場所は、関数名・id・セレクタで指す（P1a が `style.css` / `index.html` / JS の色を書き換えている最中で、行番号は動くため）。現行の挙動は、worktree `syki-v2`（branch `v2`、v1.14.0 と同じ見た目）のコードを読んで確かめた。**実アプリでは動かしていない**（読んだだけ）。

---

## 0. 先に読む 10 行

1. タブのモデルは**すでに「ページごとに自分のタブ」を持っている**。全ノートの順序つき配列 `tabs[]` が 1 本、左のページが映すタブ `activeTabId`、右のページが映すタブ `secondaryTabId`。右の帯は `secondaryTabId` を、左の帯は `activeTabId` を「選択中」にするだけで足りる（§1.2）。モデルの変更はいらない。
2. ただし**クリックの行き先**は今「押した帯」ではなく、`activePane`（どちらのペインにフォーカスがあるか）で決まる。v2 では「左の帯＝左のページ、右の帯＝右のページ」に変える。`handleTabClick(tabId, altKey)` に `pane` を足す小さな変更（§2.4）。
3. 見開きプレビュー（`secondaryViewMode === 'preview'`）は、`selectTab` が `secondaryTabId` を左のタブに揃える（プレビューは左に付いてくる）。帯が左だけになるので、**「別のノートをプレビューに出す」操作は帯から消える**（今は「プレビューにフォーカス→タブをクリック」で可能）。決めてほしい点 D5。
4. 依頼文にあった**ピン留め、タブ名の変更、中クリックで閉じる、Ctrl+1..9 での切り替えは、現行にない**（§1.4）。`Ctrl+1` / `Ctrl+2` は「左／右のペインにフォーカス」で、タブ番号ではない。`Ctrl+Tab` は常に**次**へ進み、`Ctrl+Shift+Tab` でも戻らない（既存の癖）。P3 でこれらを足さない。
5. 今のタブは**キーボードで着けない**（`tabindex` なし、`.tab-item.focus()` は false。`docs/testing/sessions/2026-09-30-c13-keyboard-a11y.md` の p2・p3）。v2 の「フォーカスで広がる」は新規の実装で、しかもエディタが Tab を奪う（C13-12、未修正）ため、**帯へ入るキー**を決める必要がある（D10）。
6. **DOM の契約（id・class・`data-tab-id`）を保てば**、帯に触れる単体テスト 9 本とスモーク 14 本、docshots の準備判定の大半が書き換えずに通る（§1.5）。保つ。逆に、`renderTabs` のソース文字列・`#tabs-bar` / `#tabs-scroll` の CSS・`app.js` の文を直接検査するテストが 4 ファイル、描き方（要素ごとのリスナ、`innerHTML` の細工）に依存するテストが 2 ファイルあり、それは直す（§1.5 の表）。
7. 「+」（`#btn-new-tab`）と「すべてのタブ」（`#btn-all-tabs`）は、**設計書のどこにも行き先がない**。推奨は左の帯の足元（D1・D2）。一覧のパネル（`#tab-list-panel`）とパレットの「Show all tabs」、RPC の `ui.open_panel all_tabs` は残す。
8. 互換: macOS の最小は 10.15（WKWebView は Safari 13 相当）。`color-mix()` は Safari 16.2 からで、現行の `style.css` に 1 つもない。**濃淡は疑似要素の `opacity` ＋ CSS 変数 `--d`（距離）で作る**（画面案の `color-mix` は持ち込まない）。
9. レイアウトの罠が 3 つ（§5.1）: ① `#workspace` に余白を足すと `initPaneResizer` の割合計算がずれる、② 結果ブロックの帯（`.result-accent`、行番号の左端 3px）と左の帯 6px が重なる、③ 右端のスクロールバー幅は 9px と決め打ちできない（textarea は OS 標準のスクロールバーで、幅の指定が CSS にない）。
10. 性能: キー入力ごとの帯の更新は**ない**（未保存の印は「初めて汚れた瞬間」だけ DOM を触る）。ただし `renderTabs()` は約 40 か所から呼ばれ、毎回 DOM を作り直す。新しい描画は**キー付きの更新**（同じ id の要素を使い回し、変わった項目だけ書く）にして、フォーカスが落ちないようにする。展開は**重ね描き**（エディタを再レイアウトしない）にする。

---

## 1. 現行の棚卸し（読んで確かめたもの）

### 1.1 タブのモデル

`app.js` の IIFE 内の状態（関数名・変数名で指す）:

| 状態 | 意味 |
| --- | --- |
| `tabs[]` | 全ノート。順序がそのまま帯の並び。**ペインごとの配列は無い** |
| `activeTabId` | 左（primary）のペインに映すタブ。`#editor` の中身 |
| `secondaryTabId` | 右（secondary）のペインに映すタブ。`isSplitMode` が真のときだけ意味がある。分割を閉じても値は残る |
| `isSplitMode` / `secondaryViewMode` | 分割の有無 / `'editor'`（左右ページ）か `'preview'`（見開きプレビュー） |
| `activePane` | `'primary'` / `'secondary'`。フォーカスのあるペイン（クリック・focus・キー入力で書き換わる） |
| `isPreviewMode` | プレビューのみ（`#preview-pane`）。分割とは排他（`togglePreview` は分割を閉じ、`openSplitEditor` / `openPreviewToSide` はプレビューのみを閉じる） |

タブ 1 つの形（`createTab`）: `id, title, isAutoTitle, path, content, isDirty, encoding, cursorPos`、後から付くもの `diskSig, eol, diskConflict, saveFailed, closePrompt, isScrap`。セッションに保存するのは `id, title, path, content, isDirty, encoding, cursorPos, diskSig, eol` と、頭の `activeTabId, tabCounter, isSplitMode, secondaryTabId, secondaryViewMode, activePane, isPreviewMode`（`getSessionDataJson`）。**Go 側はこの JSON を中身を見ずに保存・返すだけ**（`SaveSession` / `GetSession`、`app_files.go`）。帯の DOM を触る Go のコードは無い（`tabs-list` などの文字列は `*.go` に 0 件）。RPC は JS 側の `getTabs`（`tab.list`。`pane: 'primary' | 'secondary' | null` を返す）と `getUiState`（`ui.state`: `active_tab_id`, `split`, `secondary_tab_id`, `preview: off|full|side`）を呼ぶだけで、DOM は読まない。

### 1.2 「右のページに出すタブ」のデータの流れ

書き込み（`secondaryTabId` を変える所）:

- `openSplitEditor(tabId?)`: 指定がなければ「アクティブ以外の最初のタブ」（1 枚しかなければアクティブ自身）。`secondaryViewMode='editor'`、`activePane='secondary'`。タブの Alt+クリックと右クリックメニュー「Open to the Side」（`ctx-open-to-side`。`contextMenuTargetTabId || activeTabId`）、Ctrl+\（`toggleSplitMode`）の入口。
- `openPreviewToSide(tabId?)`: 指定がなければ `activeTabId`。`secondaryViewMode='preview'`、`activePane='primary'`。
- `selectSecondaryTab(id)`: 分割中に、`activePane==='secondary'` でタブをクリックしたとき（`handleTabClick` 経由）。
- `selectTab(id)`: 見開きプレビュー中は `secondaryTabId = id`（プレビューが左に付いてくる）。
- `removeTab(id)`: 閉じるタブが `secondaryTabId` なら、残りの**先頭**のタブ（隣ではない）にして `updateSecondaryPane()`。残りが無ければ `closeSecondaryPane()`。
- `restoreSessionFromData`: 保存値を検証（存在しなければ「アクティブ以外の最初」）して `openPreviewToSide` / `openSplitEditor` を呼ぶ。
- `updateSecondaryPane()`: `secondaryTabId = (getTab(secondaryTabId) || getActiveTab()).id` と、自己修復する。

読み出し: `updateSecondaryPane`（`#secondary-pane-title` と本文）、`focusedTabId()`、`getActiveTab()` / `getActiveEditor()`、`onEditorInput`、`getTabs`（`pane`）、`getUiState`。

**同じタブを両方のペインに出せる**（`secondaryTabId === activeTabId`）。そのとき入力は 2 つのエディタの間でミラーされる（`onEditorInput` / `#editor-secondary` の input）。2 本の帯が同じノートを「選択中」にするのは許す（矛盾しない）。

クリックの行き先（現行）: `handleTabClick(tabId, altKey)`。Alt+クリックは `openSplitEditor(tabId)`。分割していなければ `selectTab`。分割中は `activePane` が `secondary` なら `selectSecondaryTab`、そうでなければ `selectTab`。つまり**帯は 1 本で、フォーカスのあるペインが受け取る**。

### 1.3 タブの DOM・CSS に触れる場所（全部）

**マークアップ（`frontend/index.html`）**: `<header id="header">` の中の `#tabs-bar` > `#tabs-scroll` > `#tabs-list`（タブは JS が入れる）、その横の `#btn-new-tab`（`data-i18n-title="newTabTitle"`）と `#btn-all-tabs`（最初 `hidden`、`aria-haspopup="dialog"`）。`<script src="js/tab_overflow.js?v=…">` は `app.js` の前。右側の `#header-actions` は `chrome_layout.js` のツールバー。`<main id="workspace">` の子は、検索バー・質問バー・コマンドバー・`#editor-pane`・`#pane-resizer`・`#secondary-pane`・`#preview-pane`・`#preview-badge`・`#btn-preview-print`。

**CSS（`style.css`。セレクタで）**: `#header`（38px、`z-index: 100`、`transition: opacity`）、`#tabs-bar`、`#tabs-scroll` と `.tabs-fade-left` / `.tabs-fade-right`（マスクのフェード）、`#tabs-list`、`.tab-item`（`:hover`、`.active`＝上に 2px、`.split-active`＝下に 2px、`.active.split-active`、`.focused-tab`、`#workspace.split-mode .tab-item:not(.focused-tab)`、`.dragging`、`.drag-over-left/right`）、`.tab-title`、`.tab-dirty-dot`、`.tab-conflict-mark`、`.tab-close`（`::before` が見えない当たり判定 `inset: -6px -5px`、`:hover` が赤）、`#btn-new-tab`、`#btn-all-tabs`、`#btn-new-tab, #btn-all-tabs`、`.btn-header-icon svg, #btn-new-tab svg`、`.tab-list-panel` と `.tab-list-*`（一覧のパネル。パネル雛形に従う）、Zen の `body.zen-active #header` / `body.zen-mode #header`（**今のタブは Zen でヘッダーごと消える**）。直書きの色のうち帯に関わるもの: 焦点の `#ffffff`、未保存の点 `#e2c08d`、競合の印 `#f48771`、×のホバー `#c72e2e`（P1a がトークンにする。P3 の CSS は**色の直書きを持たない**）。`print.css` は帯を個別に扱っていない（`#workspace > *:not(#preview-pane)` を隠すので、`#workspace` の子にすれば印刷に出ない。`body` 直下に付く `#tab-list-panel` も `body > *:not(#app)` で隠れる）。

**`app.js`（関数名で）**:

| 関数・箇所 | 役割 | P3 での扱い |
| --- | --- | --- |
| `renderTabs()`（約 40 か所から呼ぶ） | `tabsListEl.innerHTML = ''` から全タブを作り直す。`class` は `tab-item` + `active` / `split-active` / `focused-tab`、`data-tab-id`、`title = path \|\| title`、`contextmenu` で `contextMenuTargetTabId` を記録、`pointerdown` の並べ替え兼クリックの処理、`.tab-title`、`tab.isDirty` なら `.tab-dirty-dot`（`●`）、`tab.diskConflict \|\| (tab.saveFailed && tab.isDirty)` なら `.tab-conflict-mark`（`!`）、`.tab-close`（`×`、`data-i18n-title="closeTabTitle"`）。最後に `renderAutosaveStatus()` と `notifyTabOverflow()` | **キー付きの更新に置き換える**（S2）。末尾の 2 呼び出しの順序は保つ |
| `refreshTabActiveClasses()` | エディタのクリック・フォーカスで、クラスだけ付け替える。DOM の数が `tabs.length` と違えば `renderTabs()` | 帯に「どちらにフォーカスがあるか」の見た目を付けないので、`activeTabId` / `secondaryTabId` が変わったときだけ書く（早期 return） |
| `focusedTabId()` | 分割中に `activePane==='secondary'` なら `secondaryTabId`、そうでなければ `activeTabId`。`tab_overflow` が「見える所へ出す」タブを決める | 帯ごとに自分の選択中タブを持つ形にする |
| `getTabOverflow()` / `notifyTabOverflow()` | `TabOverflow.create({scrollEl:'tabs-scroll', listEl, newBtn, allBtn, getTabs, getActiveId: focusedTabId, onSelect: handleTabClick, focusFallback, label})`。初回使用時に作る | 帯 2 本に対応（S6） |
| `onEditorInput`（左）と `#editor-secondary` の input（右） | **最初に汚れた瞬間だけ**、`tabsListEl.querySelector('.tab-item[data-tab-id=…]')` を探して `.tab-dirty-dot` を `.tab-title` の後ろに足す。自動タイトルが変わったら `.tab-title` の文字を書き換える（`querySelector`）。2 か所に同じコードがある | 1 つの関数（例 `patchTabItem(tabId)`）にまとめ、両方の帯を更新する（S2）。`querySelector` ではなく id→要素の Map を引く |
| `afterRpcTabEdit` / `writeTabText` / `commitSave` / 保存の各所 | `renderTabs()` を呼ぶ（RPC の書き込み 1 回ごとに全再描画） | そのまま。キー付き更新で安くなる |
| 並べ替え（`renderTabs` 内の `pointerdown`） | ポインタ方式の自前エンジン: 4px 動いたらドラッグ、`setPointerCapture`、`pointermove` で `clientX` からタブを探し左右の半分で前後を決め `.drag-over-left/right`、`pointerup` で `tabs.splice` → `renderTabs()` → `saveSessionDebounced()`。動かなければ `handleTabClick(tab.id, e.altKey)`。**クリックは `click` ではなく `pointerup` で起きる** | 縦軸（`clientY`）へ移す（S4）。HTML5 の `draggable` は使わない（コメントに「WebView2 で確実」とある。窓全体の `dragover` / `drop` が `preventDefault` しているため干渉の恐れもある） |
| `closeTab(tabId, e)` / `removeTab` | ×の `onclick`。未保存なら Save / Don't save / Cancel（`askToSaveBeforeClosing`）。`Ctrl+W` は `activeTabId` を閉じる（分割で右にフォーカスなら**右ペインを閉じる**。最後の 1 枚なら窓を閉じる） | 変更なし |
| 右クリック | タブ専用のメニューは無い。タブ上の `contextmenu` が `contextMenuTargetTabId` を記録し、`window` の `contextmenu` が**エディタ共通のメニュー**を出す。「Open to the Side」が `contextMenuTargetTabId \|\| activeTabId` を使う。**`contextMenuTargetTabId` は一度入ると消えない**（エディタ上の右クリックでも前に右クリックしたタブが使われる、既存の小さな不具合） | 帯で同じ記録をし、帯の外の右クリックで消す（S4 で直す） |
| キー | `Ctrl+Tab`＝次のタブ（`activePane==='secondary'` なら右の分を回す。Shift を見ない）、`Ctrl+W`、`Ctrl+N`（`newTab`）、`Ctrl+1` / `Ctrl+2`＝左／右のペインにフォーカスして `renderTabs()` | 変更なし（`Ctrl+1/2` は帯の aria-label に書ける） |
| ファイルのドロップ | `window` の `drop`: エディタ上でなければ（帯・ヘッダーを含む）、テキストファイルを `createTab` で開く（`looksLikeTextFile`）。帯に固有の処理は無い | 帯は窓の一部なので変更なし。ただし**帯の上でドロップしても新しいタブになる**ことをスモークで確かめる |
| `restoreSessionFromData` | 起動時に `renderTabs()` → `selectTab()`（→ `renderTabs()`）→ 分割なら `openSplitEditor` / `openPreviewToSide`（→ `renderTabs()`） | 起動の最初の描画で帯が揃う。測る（§5） |
| `applyLanguage` | `[data-i18n-title]` を訳し直す（×のツールチップ）。`btnNewTab.title` は別の行で `newTabTitle (Ctrl+N)` を組む | 新しい文字列は両言語に（§2.7） |
| 公開 API | `window.__testHelper.createTab / openSplitEditor / openPreviewToSide / closeSecondaryPane / toggleSplitMode`、`__sykiRPC`（`getTabs`、`switchTab`＝左のペインだけ、`openTab`、`closeTabChecked`、`getUiState`、`setUiState`、`openPanel('all_tabs')`）、`SykiBridge.getActiveTab` | 変更なし。`switchTab` は引き続き左（`selectTab`）。右のタブを RPC で変える入口は元から無い（`ui.set_view` の `split` / `preview` のみ） |

**`a11y.js`**: `markTabs` が `#tabs-list` を **id で決め打ち**して `role="tablist"`、`aria-label`（`allTabsHead`）を付け、`.tab-item` ごとに `role="tab"`、`aria-selected`（`.active`）、`aria-label`（`.tab-title` の文字＋未保存なら「Unsaved changes」）、`.tab-close` に `role="button"` と「Close <name>」を付ける。`MutationObserver`（childList・subtree・`class` 属性）で再適用。言語切り替えで `A11y.refresh()`。**タブに `tabindex` は付かない**。

**`tab_overflow.js`（377 行）**:
- 純関数（Node でテスト可）: `measure(view)`、`scrollTargetFor(view, tab, peek)`、`rowsFor(tabs, activeId)`、`stepIndex(index, delta, count)`、`panelPosition(anchor, viewport)`。**軸の名前（`scrollLeft`, `clientWidth`, `scrollWidth`）以外は軸に依存しない**ので、縦にも使える。
- `create(opts)` → `{ update, openList, closeList, toggleList, isListOpen, _run, _state }`。`opts`: `doc, win, scrollEl, listEl, newBtn, allBtn, getTabs, getActiveId, onSelect, label, focusFallback, raf, ResizeObserver`。`scrollEl` / `listEl` が無ければ `null`。
- 横軸に固定の部分: `viewOf()`（`scrollLeft` ほか）、`revealFocused()`（`r.left - s.left + scrollLeft`）、ホイールの縦→横変換、`tabs-fade-left/right` クラス、`panelPosition`（ボタンの下・右端そろえ）。**「すべてのタブ」ボタンはあふれたときだけ表示、一覧が開いている間も表示**。`ResizeObserver` で `scrollEl` と `listEl` を見る。
- 一覧（`#tab-list-panel`、`role="dialog"`、`#tab-list-rows` が `listbox`）は初回に作る。`document.body` の末尾に付く。矢印・Home/End・PageUp/PageDown・Enter/Space・Esc・Tab（ボタンへ戻してブラウザに任せる）。外側の `mousedown` と窓のリサイズで閉じる。
- コスト設計: タブが収まるなら何も描かない。キー入力ごとの処理は無い。

**`chrome_layout.js`**: ツールバー（`#header-actions` のボタンと `.header-divider`）と右クリックメニューの並べ替え・非表示だけ。**`#btn-new-tab` は意図的にレイアウトの外**（`calm_toolbar_test.mjs`: 「New は帯の横の + で、常にある」。`toolbarIds` に含まれず、`index.html` に id がある）。P3 で触らない。ただし「+」を `#header-actions` に移すとこの規則とテストに反するので、**移さない**（D1）。

**Go 側**: 帯・セッションの復元とも JS のみ。変更なし。

### 1.4 依頼の想定と現行の差

| 想定 | 現行 |
| --- | --- |
| ピン留めされたタブ | **無い**（`pin` の語が `app.js` に無い）。P3 でも足さない（D3） |
| タブ名の変更（ダブルクリック等） | **無い**。タイトルは自動（`isAutoTitle`: 1 行目から）かファイル名。ペインの仕切りの `dblclick` だけ存在 |
| 中クリックで閉じる | **無い**（`auxclick` も `button === 1` も無い）。足さない |
| Ctrl+1..9 でタブ切り替え | **無い**。`Ctrl+1` / `Ctrl+2` は左／右の**ペイン**にフォーカス |
| Ctrl+Shift+Tab で前のタブ | **戻らない**（`Ctrl+Tab` の分岐が Shift を見ない）。P3 のついでに直すか決める（任意、D11） |
| タブへのファイルのドロップ | 帯固有の処理は無い。窓全体の `drop` が新しいタブで開く |
| タブがキーボードで着く | **着かない**（`tabindex` なし）。Tab 順は 「+」→ ヘッダー → エディタ。帯のタブは `Ctrl+Tab` か「すべてのタブ」一覧でのみ |

### 1.5 テスト・ツールの棚卸し（帯に触れるもの全部）

| ファイル | 触れている所 | P3 の影響 |
| --- | --- | --- |
| `frontend/js/tab_overflow_test.js`（468 行） | 純関数 10 件、横軸のハーネス（`scrollLeft` など）でのコントローラ 19 件（一覧・`ResizeObserver` なしを含む） | **軸の既定を `'x'` のまま足す**ので既存は通る。縦軸・配置の新規テストを足す（S1・S6） |
| `tests/tab_overflow_wiring_test.mjs` | `#tabs-bar` の中に `#tabs-scroll` > `#tabs-list`、その後ろに「+」「All tabs」のマークアップ順。CSS: `#tabs-bar` に `overflow` 無し、`#tabs-scroll` の `overflow-x:auto` など、`#tabs-list` の `width:max-content`、`#btn-new-tab,\n#btn-all-tabs` の `flex-shrink:0`、`tabs-fade-*` のマスク、`.tab-list-panel` 系のトークン。`app.js` のソースに `renderTabs` の末尾が `notifyTabOverflow(); }`、`focusedTabId` の**関数の文面そのもの**、`getTabOverflow` の中の `getElementById('tabs-scroll')` と `'btn-all-tabs'`。公開 API のキー一覧 `['PANEL_WIDTH','PEEK','create','measure','panelPosition','rowsFor','scrollTargetFor','stepIndex']` | **S1・S2・S6 で書き換える**（9 項目のうち 5 つ: マークアップ、帯の CSS、フェードの CSS、`app.js` の配線、公開キー）。`<script>` の読み込み順、一覧パネルの CSS、文字列、「読み込んだだけでは何もしない」は残る |
| `tests/startup_settings_a11y_fixes_test.mjs` | C2-09: `renderTabs` のソースを切り出し、`tab.diskConflict \|\| (tab.saveFailed && tab.isDirty)`、`t(tab.diskConflict ? 'diskConflictTabTitle' : 'saveFailedTabTitle')`、末尾 `renderAutosaveStatus(); … notifyTabOverflow(); }`。C13-11: `a11y.js` を VM で走らせ、`#tabs-list` の `.tab-item` / `.tab-title` / `.tab-close` / `.tab-dirty-dot` から aria を検査。C13-10: `tab_overflow.js` の `case 'Tab': closeList(true); handled = false` | C2-09 は「要素を作る関数」の名前を指すよう直す。C13-11 は a11y の持ち場所を決めてから直す（§2.6）。C13-10 は変更なし |
| `tests/language_and_keyboard_fixes_test.mjs` B29 | `app.js` の `closeEl.className = 'tab-close';` から 400 文字を切り出し、`closeEl.setAttribute('data-i18n-title', 'closeTabTitle')` | 要素を作る関数に移す場合は切り出し位置を直す |
| `tests/first_run_polish_test.mjs` | `.tab-close::before { inset: … }`（見えない当たり判定）の存在 | ×を帯の展開時に残す限り通る。作り直すなら同じ規則を新しいセレクタに |
| `tests/calm_toolbar_test.mjs` | `btn-new-tab` が `#header-actions` に**無く**、`index.html` に id がある | 「+」を帯へ移しても通る（ヘッダーの外のまま） |
| `tests/second_panel_test.mjs`（手作りの DOM） | `elements.get('tabs-list').children[i]`、`dataset.tabId`、各要素に `pointerdown` → `window` の `pointerup`（**要素ごとのリスナ**。偽の DOM はバブリングしない）、`btn-new-tab` の `click`、分割の各動作 | **要素ごとのリスナを保つ**（委譲にしない）。`tabs-list` の直下の子はタブだけにする（「+」は外） |
| `tests/rpc_write_tabs_test.mjs` | `env.el('tabs-list').children.length >= 2`、`innerHTML` の setter が投げる細工で「画面の更新が失敗しても書き込みは成功と返す」を確かめる | **後者は描き方が変わると空振りする**: 新しい描画が確実に投げる細工（例: `appendChild`）に直す |
| `tests/ai_correction_test.mjs` と `tests/fixtures/slot_env.mjs`（偽の DOM） | id の一覧に `'tabs-list'`, `'btn-new-tab'`。**偽の DOM は未知の id を自動で作る**（`getElementById`）。`querySelectorAll` は空、`querySelector` は `#id` のみ | 新しい id は自動で作られるので安全。新しい描画は `querySelector(All)` に頼らず、`children` と Map で動く形にする |
| `tests/smoke/08_tab_overflow.mjs` | 14 枚で「+」が画面内、`#btn-all-tabs` が出る、`#tabs-scroll` の `scrollWidth > clientWidth`、一覧、End/Enter、`#tabs-list .tab-item.active` が `#tabs-scroll` の矩形内、Esc で `btn-all-tabs` にフォーカス、パレット、幅 4400px で消える | **書き直し**（縦のあふれ。`scrollHeight > clientHeight`）。流れは同じ |
| `tests/smoke/81_keyboard_exits.mjs` | 14 枚、`btn-all-tabs` にフォーカス→Tab/Shift+Tab、一覧から Tab、最後に「`btn-new-tab` ではない（ページの先頭ではない）」 | 一覧の挙動は同じ。「先頭ではない」の判定対象を新しい構造に合わせて直す |
| `tests/smoke/01, 10`（「+」をクリック）、`89`（`btn-new-tab` を「フォーカスを置く場所」に使う）、`32`（`.tab-close` の title）、`61, 66, 67, 91, 98, 104`（`.tab-item[data-tab-id]` をクリック、`.tab-conflict-mark`）、`86`（`#tabs-list .tab-item.active .tab-conflict-mark`）、`90`（`all_tabs` パネル）、`explore README`（「+」を使う） | id・class・`data-tab-id` が同じで、**実マウスのクリックが箱を持つ要素に当たる**限り通る（`lib.click` は中心を押し、箱が 0 だと失敗する） | 6px の帯でも**当たり判定の箱**を持たせる（§2.5）。「+」は帯の足元で、収縮時も箱がある |
| `tools/docshots/setups.mjs` | `openManyTabs`（`#tabs-list .tab-item` の個数を待つ。Ctrl+N と最初の行で名前を付ける）、`tabsOverflow`、`tabsOverflowNarrow`、`tabsAllList`（`#btn-all-tabs` を実クリック）、`headerCalm`、2 か所の `#tabs-list .tab-item` の個数待ち | ボタンの場所が変わる。`tabsAllList` の導線を直す（S6）。「個数を待つ」セレクタは id 維持で通る |
| `tools/docshots/shots.json` | `ui-map` の番号 1（`#btn-new-tab`）、`welcome` の番号 1（`.tab-item.active`）、`tabs-overflow`（`#tabs-scroll` / `#btn-new-tab` / `#btn-all-tabs`、`requires: ["btn-all-tabs"]`）、`tabs-overflow-narrow`、`tabs-all-list`、`header-calm` / `header-calm-narrow`（`requires`）、`zen-mode`（「toolbar, tabs and status bar hidden」）。`requires` は `index.html` に id の文字列があるかだけを見る（無いと**撮影が飛ばされる**） | 説明文と矢印の向きを直す。**帯を見せる全図（`size: full` が 57 枚）は P6 で撮り直し**（設計 §6）。P3 では上の 7 図の定義だけ更新し、新しい図を足す（展開、左右、数が多い） |
| `tools/docshots/mock/backend.js` の `D.isReady` | `document.querySelectorAll('#tabs-list .tab-item').length >= 1` を**全図の「準備完了」の条件**に使う | id と class を保てば変更不要。**変えると全図が止まる**ので S7 まで触らない |
| `tools/docshots/gifs/scenarios.mjs` | `#tabs-list .tab-item` が 4 つ以上 | 同上 |
| 文書 | `manual.html`（8 か所）、`manual_ja.html`（7）、`skills/syki/references/interfaces.md` の §4.11「Toolbar defaults and the tab strip」（`#tabs-scroll` などの記述と、`each tab is still one .tab-item … inside #tabs-list` の明記）と 560 行・736 行目、`troubleshooting.md`（1）、`img/manual/shots.md`（生成物）、`docs/design/ux-review-2026-09.md`（経緯、直さない） | S7 で更新（`docs/maintenance/after-a-big-change.md` のチェックリスト） |

`tests/smoke` の新しい流れの番号は **108 以降**（107 まで使用済み）。`smoke_suite_shape_test.mjs` が「番号の重複なし、`t.step(` を使う、固定 sleep なし、絵文字なし」を見る。ドラッグの実マウスは、`tools/docshots/cdp.mjs` の `page.move` と `page.cdp.send('Input.dispatchMouseEvent', …)`（`buttons` を付ける）。

---

## 2. 設計（P3 で作るもの）

### 2.1 DOM と名前（契約を保つ）

**保つもの**（テスト・docshots・文書・スモークが依存）: `#tabs-list`（左の帯のタブの親。直下の子はタブだけ）、`#tabs-scroll`（その外側のスクロール箱）、`.tab-item` + `data-tab-id`、`.active`、`.tab-title`、`.tab-dirty-dot`（文字 `●`）、`.tab-conflict-mark`（文字 `!`）、`.tab-close`（文字 `×`、`data-i18n-title`）、`#btn-new-tab`、`#btn-all-tabs`、`#tab-list-panel` 系。

**新規**:

```html
<main id="workspace">
  <div id="tab-index-left" class="tab-index" data-side="left">      <!-- position:absolute; left:0 -->
    <div id="tabs-scroll">                                           <!-- 縦のスクロール箱 -->
      <div id="tabs-list" role="tablist" aria-orientation="vertical"> <!-- 直下はタブだけ -->
        <div class="tab-item active" data-tab-id="…" role="tab" tabindex="0" style="--d:0">
          <span class="tab-title">…</span><span class="tab-dirty-dot">●</span>
          <span class="tab-conflict-mark">!</span><span class="tab-close">×</span>
        </div>
      </div>
    </div>
    <div class="tab-index-foot"><button id="btn-new-tab">…</button><button id="btn-all-tabs" class="hidden">…</button></div>
  </div>
  <div id="tab-index-right" class="tab-index" data-side="right" hidden> <!-- #tabs-scroll-right > #tabs-list-right -->
  …（既存の子: 検索バー、#editor-pane、#pane-resizer、#secondary-pane、#preview-pane …）
```

- 帯は `#workspace` の子（`#header` の外）。`#workspace` は `position: relative; overflow: hidden` なので、展開（200px）がはみ出さず、`print.css` の `#workspace > *:not(#preview-pane)` で印刷にも出ない。`#preview-pane ~ .preview-badge` の兄弟セレクタを壊さないよう、右の帯は `#secondary-pane` の直後、`#preview-pane` の前に置く。
- ヘッダーから `#tabs-bar` を外すと、`#header` の `justify-content: space-between` で操作アイコンが左に寄る。**`#header-actions { margin-left: auto }`** を足す（P2 がヘッダーを作り直すまでのつなぎ）。
- 右の帯は `#tabs-scroll-right` / `#tabs-list-right`（`role="tablist"`、`aria-label` は左右で別）。右の帯には「+」「すべてのタブ」を置かない。
- `class` は帯のタブに `.tab-item`、`.active`（その帯のペインが映すタブ）。**`.split-active` と `.focused-tab` は廃止**（どちらのペインにフォーカスがあるかは、既存の `.pane-focused` の輪郭が示す。D12）。右の帯の要素には `data-pane="secondary"` を付けて、クリックの行き先をそこから読む。

### 2.2 寸法の CSS 変数（`style.css` の帯のブロックの先頭）

| 変数 | 初期値 | 意味 |
| --- | --- | --- |
| `--tab-strip-w` | `6px` | 塗る幅（設計: 実アプリで見て決める） |
| `--tab-hit-w` | `12px` | 収縮時の当たり判定の幅（見えない。タブ要素そのものがこの幅） |
| `--tab-open-w` | `200px` | 展開時の幅 |
| `--tab-h` / `--tab-h-min` | `30px` / `20px` | タブの高さ（画面案は 30px）と、詰めたときの下限 |
| `--tab-strip-gap-right` | `9px` | 右の帯と窓の右端の間（スクロールバーの分）。**実測で決める**（§5.1） |
| `--tab-strip-top` / `--tab-strip-bottom` | `0px` | 帯の上下の余白。P2 がヘッダー／フッターのオーバーレイの高さを入れる |
| `--tab-open-ms` / `--tab-open-delay` | `220ms` / `120ms` | 展開の長さと、開く前の待ち（通り過ぎで開かない。閉じる側は待たない） |
| `--tab-mix-floor` / `--tab-mix-base` / `--tab-mix-step` | `0.2` / `0.68` / `0.12` | 濃淡の式の定数（設計の `max(20%, 68% − 12% × 距離)`） |

### 2.3 濃淡（距離）

- JS は各タブに `--d`（その帯の選択中タブからの**インデックス距離**。選択中は 0）だけをインラインで書く。値が変わった要素だけ書く。
- CSS: `.tab-item::before { background: var(--tab-accent); opacity: var(--tab-o); }`、`--tab-o: max(var(--tab-mix-floor), calc(var(--tab-mix-base) - var(--tab-mix-step) * var(--d)))`、`.tab-item.active { --tab-o: 1 }`。`max()` と `calc()` に単位なしの数を使う（Safari 11.1 以降で動く）。**`color-mix()` は使わない**（macOS 10.15 の WKWebView に無い。現行の CSS に 1 つもない）。
- 塗るのは疑似要素。タブ要素そのものは透明で、背景には `--tab-base`（地に溶ける中間色。トークンとして `tokens.css` に頼む）だけを置く。これで展開時に文字が薄まらない（`opacity` を要素自体にかけない）。
- 文字色は、塗りが濃いタブ（距離 0 と 1 ＝ 塗り 56% 以上。画面案の `.hi`）だけ `--tab-ink-hi` にする。JS は `--d` と一緒に `.hi` を切り替える。紙と墨の両方でコントラストを測る（設計 §6）。
- 強制色（`@media (forced-colors: active)`）: 塗りは使えないので、非選択は `1px solid CanvasText` の枠、選択中は `2px solid Highlight`、未保存の印は `ButtonText` の形で区別する。システム色のキーワードは P1a の「色の直書きなし」検査の許可リストに 1 行ずつ理由つきで入れる。

### 2.4 モード別の出し分けと、クリックの行き先

- 表示の状態は 4 つを `workspaceEl` の属性 1 つにまとめる: `data-tabs="left"`（1 ページ・見開きプレビュー）、`"both"`（左右ページ。`isSplitMode && secondaryViewMode === 'editor'`）、`"none"`（プレビューのみ。`isPreviewMode`）。値の計算は純関数（`tab_strip.js` の `stripsFor({ isPreviewMode, isSplitMode, secondaryViewMode })`）。CSS が `[data-tabs]` で左右の帯の `display` を決め、**`none` の帯は `hidden`／`inert` 相当（`visibility: hidden`）にして Tab 順と読み上げから外す**。
- 呼ぶ場所: `renderTabs()` の末尾、`togglePreview()`（`renderTabs` を呼ばない）、`updateSecondaryPane()`（`#btn-secondary-mode` の切り替えが通る）。`openSplitEditor` / `openPreviewToSide` / `closeSecondaryPane` は `renderTabs()` を呼ぶので足りる。`ui.set_view`（RPC）はこれらの関数を通る。
- クリックの行き先: `handleTabClick(tabId, altKey, pane)`。`pane` は押した帯（`'primary'` / `'secondary'`）。Alt+クリックは従来どおり `openSplitEditor(tabId)`（**「もう一方のページに開く」のまま**）。`pane` が無い呼び出し（`tab_overflow` の一覧の `onSelect`、`Ctrl+Tab`、`focusedTabId()`）は、1 つの関数 `paneForSelect()` で決める: `isSplitMode && activePane === 'secondary' && secondaryViewMode === 'editor'` なら `'secondary'`、それ以外は `'primary'`。**`secondaryViewMode === 'preview'` を含めないのが D5 の中身**（今は含めている）。
- 見開きプレビュー（左の帯だけ）: 左の帯のクリックは**常に左のペイン**を変え、プレビューは `selectTab` の既存の同期で付いてくる。プレビュー側にフォーカスがあっても同じ（推奨 D5）。`focusedTabId()` / `Ctrl+Tab` も、プレビュー側が「フォーカス」でも左を回す。
- 右の帯のクリック: `selectSecondaryTab`。同じタブが左にも出ているなら 2 つの帯で同じノートが選択中になる（ミラー編集は既存）。
- 閉じる（×、Ctrl+W）、並べ替え、未保存の印は、**全ノートの共通の `tabs[]`** に対して行う。2 本の帯は同じ順序・同じ未保存の印を示す。

### 2.5 展開と当たり判定

- **展開は重ね描き**: 帯は `position: absolute`。幅（`--tab-hit-w` → `--tab-open-w`）だけが変わり、`#editor-pane` の幅は変えない（8 万行のノートで再レイアウトを起こさない。`contain: layout paint` を帯に付ける）。塗り（`::before`）は `--tab-strip-w` → 100%。名前は `opacity: 0` → 1（`transition-delay` で塗りの後）。
- 展開の引き金: `.tab-index:hover`、`.tab-index:focus-within`（キーボード）。開く側だけ `--tab-open-delay` を待つ（マウスが端を通り過ぎて開かない）。マウスのボタンを押したまま別の場所から来たとき（テキスト選択のドラッグ）は `:hover` が付かない（Chromium）ので、選択中に勝手に開かない。ドラッグ中の帯はポインタキャプチャで開いたまま。
- **当たり判定**: タブ要素そのものが `--tab-hit-w` の幅（12px）で、塗りは疑似要素の 6px。見えない 6px は行番号（44px）の左端に重なるが、帯のタブの高さの範囲だけ。帯の空いている縦の範囲は `pointer-events: none`（エディタを押せる）。右の帯は当たり判定を**内側（本文側）**へ伸ばし、スクロールバー側へは伸ばさない。
- タッチ・`@media (hover: none)`: タップで展開（`:focus-within` で足りる）。幅 12px は WCAG 2.2 の最小ターゲット 24px に満たないが、**同じ機能の別経路**（`Ctrl+Tab`、パレットの「すべてのタブ」、展開後の 200px の行）がある。
- `prefers-reduced-motion: reduce`: 展開・名前のフェード・開く待ちをすべて 0（即時）。

### 2.6 キーボードと a11y

- 帯は `role="tablist"`（`aria-orientation="vertical"`、`aria-label` は「左のページのタブ」「右のページのタブ」。両言語。`Ctrl+1` / `Ctrl+2` を併記してよい）。タブは `role="tab"`、`aria-selected`、`aria-label`（ノート名＋未保存なら `allTabsUnsaved`。既存の `a11y.js` の `tabLabel` と同じ文面）。ローヴィング `tabindex`（選択中だけ 0、他は −1）。
- 操作は**手動の確定**: ↑↓・Home・End はフォーカスだけ動かす（`selectTab` は大きなノートで重いので、矢印のたびに切り替えない）。Enter / Space で確定（`handleTabClick`）、確定後はエディタへフォーカスを戻す（既存の `selectTab` の挙動）。Esc でエディタへ戻る。Delete で閉じる（任意。`closeTab` の保存確認は既存）。フォーカスが入ると `:focus-within` で帯が広がる。
- **帯へ入るキー**: エディタは Tab を奪い、Esc も F6 も何もしない（C13-12 未修正）。D10 の推奨に従い `F6` で左の帯の選択中タブへ（もう一度で右の帯、さらに押すとエディタ）。設定の「Shortcuts」に出して変えられるようにする（`DEFAULT_SHORTCUTS_WIN/MAC` に `focusTabStrip` を足す）。
- **キー付きの更新**でフォーカスのある要素を捨てない（`renderTabs` が全部作り直すと、帯にフォーカスがあるまま再描画されるたびに `body` へ落ちる）。構造が変わる（追加・削除・並べ替え）ときだけ、直前にフォーカスのあったタブの id を覚えて戻す。
- a11y の属性は**描く側が付ける**（`a11y.js` の `MutationObserver` に頼らない）。`a11y.js` の `markTabs` は、左右 2 つのリストを id で拾う形に直すか（C13-11 のテストをそのまま使える）、描く側に移して `markTabs` を外す（テストを移す）。**推奨は前者**（変更が小さく、言語切り替えの `A11y.refresh()` もそのまま使える）。
- Zen（`body.zen-mode`）: 帯は `visibility: hidden`（ヘッダーと同じ。Tab 順から外す）。`body.zen-active`（入力中の薄化）では帯は変えない（6px で目立たない）。
- 新しい文字列（`i18n.js`、両言語、絵文字なし、`english_ui_strings_test` / `i18n_test` の対象）: `tabIndexLeftAria`、`tabIndexRightAria`（、F6 を足すなら `shortcutActionFocusTabStrip`）。

### 2.7 並べ替え（縦）

- 現行のポインタ方式をそのまま縦にする: `clientY` で行を探し、行の上半分／下半分で前後を決める。しきい値 4px、`setPointerCapture`、`pointerup` で `tabs.splice` → `renderTabs()` → `saveSessionDebounced()`。動かなければクリック。
- 目印は `.drag-over-top` / `.drag-over-bottom`（`box-shadow` か `::after` の 2px のアクセントの線）と `.dragging`。ドラッグ元の薄め（`opacity: 0.45`）は塗りの疑似要素にかける。
- 計算は純関数にして Node で試す（`tab_strip.js` の `dropTarget(rects, y, draggedId)`、`reorder(tabs, fromId, toId, after)`）。DOM の配線は `app.js`。
- 帯をまたぐドラッグ（左→右＝「右のページに開く」）は **P3 に入れない**（機能の追加）。必要なら P4 以降。
- 画面案の「濃淡が動く」は、ドロップ後の再計算（`--d`）で実現する。ドラッグ中の見た目は目印の線だけ（ライブの並べ替えは不要）。
- 帯の外でドロップ（または Esc）は取り消し。1 つの帯の中だけ。

### 2.8 20 枚を超えたとき

- 高さ: タブは `flex: 0 1 var(--tab-h)`、`min-height: var(--tab-h-min)`。収まらなければ**詰める**（30px → 20px）。それでも収まらなければ `#tabs-scroll`（`overflow-y: auto`、スクロールバーなし）で**スクロール**。展開の有無で高さを変えない（ポインタの下で行がずれて揺れるため）。
- `tab_overflow.js` を**縦にも使う**: `create` に `axis: 'x' | 'y'`（既定 `'x'`）を足し、`viewOf()` / `revealFocused()` / フェードのクラスだけ軸で分ける。`measure`・`scrollTargetFor`・`rowsFor`・`stepIndex` は軸の名前を借りたまま使える（既存テストを壊さない）。縦軸ではホイールの変換は要らない（ネイティブの縦スクロール）。フェードは `tabs-fade-top` / `tabs-fade-bottom`（縦のマスク）。
- 帯が 2 本ある場合、**一覧のパネルは 1 つ**（`#tab-list-panel` の id は 1 つ）。`create` は `strips: [{ scrollEl, listEl, getActiveId }]` を受けて、見える所へ出す処理を帯ごとに持ち、一覧とボタンは共有する（または帯ごとに「一覧なし」のコントローラを作る）。
- 一覧のパネルの位置: `panelPosition` に配置の指定（既定は今の「ボタンの下・右端そろえ」、新しく「帯の右隣・上端そろえ」）を足す。窓内に収める規則は同じ。
- 「+」と「すべてのタブ」: 左の帯の足元（`.tab-index-foot`）。収まるときは最後のタブの直後、あふれたら足元に固定。「すべてのタブ」はあふれたときだけ出る（今と同じ）。収縮時も当たり判定の箱を持つ。

---

## 3. 実装手順（各段の終わりでアプリは動く）

DOM の契約（§2.1）を保つので、**段の途中でスモーク・単体テスト・docshots の準備判定が通る**。各段の終わりに `node tools/run_js_tests.mjs` と、隔離した実アプリでの目視（`E2E/build.sh v2-tabs.exe` → `launch.ps1` → CDP のスクリーンショット）を行い、起動・常駐メモリ・8 万行のスクロール（`tools/perf/v2_perf.mjs`）の変化を数字で報告する。コミットは統括役。

### S1. 純関数と縦のあふれ（画面は変わらない）

- 新規 `frontend/js/tab_strip.js`（`window.TabStrip`、Node でも読める）: `stripsFor(state)`、`distanceOf(index, activeIndex)`、`mixFor(distance)`（定数は引数）、`dropTarget(rects, y, draggedId)`、`reorder(tabs, fromId, toId, after)`、`keyMove(key, index, count)`、`tabLabel(tab, words)`。DOM を触る関数は置かない（キー付きの更新だけ別に、偽の DOM で動く形で置く: `reconcile(listEl, tabs, makeItem, updateItem)`）。
- `tab_overflow.js`: `create` に `axis`（既定 `'x'`）と `strips`（既定は従来の `scrollEl` / `listEl` 1 組）、`panelPosition` に配置の指定。公開キーが増えるので `tab_overflow_wiring_test.mjs` の一覧を更新する。
- `index.html`: `<script src="js/tab_strip.js?v=1.0.0">` を `tab_overflow.js` の前に 1 行。
- テスト: 新規 `frontend/js/tab_strip_test.js`（距離と濃さ、モード→帯、並べ替え、ドロップ先、キー、ラベル）、`tab_overflow_test.js` に縦軸（`scrollTop` / `clientHeight` / `scrollHeight`）と配置の追加。
- 終わりの条件: 既存の全テストが通る。画面は 1 ピクセルも変わらない。

### S2. 帯の描画に置き換える（左 1 本、静的）

- `index.html`: `#tab-index-left`（§2.1）を `#workspace` の先頭に置き、`#tabs-bar`（`#tabs-scroll` / `#tabs-list` / 「+」「All tabs」）をヘッダーから**移す**（id は保つ）。右の帯のマークアップも置く（`hidden`、S5 まで空）。`#header-actions { margin-left: auto }`。
- `style.css`: 旧い帯の CSS（`#tabs-bar`、`#tabs-scroll` と横フェード、`.tab-item` 系の旧規則、`.split-active` / `.focused-tab`）を新しい帯のブロックに置き換える。**色はトークンのみ**（足りないものは `tokens.css` の担当へ依頼し、`v2-tokens.md` に載せる。§付録）。`#editor-pane` に左の余白（`padding-left: var(--tab-strip-w)`。`box-sizing: border-box`。分割時は既に border-box で、`splitRatio` の計算を壊さない。§5.1）。
- `app.js`: `renderTabs()` を「キー付きの更新」にする（`tab_strip.js` の `reconcile`）。要素を作る関数と、1 つの要素を更新する関数に分け、`id → 要素` の Map を持つ。未保存の印・競合の印・タイトルの更新は 1 つの関数にまとめ、左右 2 か所の input（と、将来の右の帯）から呼ぶ。`refreshTabActiveClasses` は変化があったときだけ書く。`notifyTabOverflow` と `renderAutosaveStatus` の順序を保つ。
- この段で**まだ動かさないもの**: 展開（S3）、縦のあふれ（S6）、モード別（S5）。左の帯は常時 6px で、クリックで切り替わる（現行どおり `activePane` で分岐）。並べ替えは機能を落とさないため、**S2 のうちに縦へ移す**（`clientX` → `clientY`、左右 → 上下は機械的。`.drag-over-top/bottom` の線と `.dragging` もこの段の CSS に含める）。S4 は取り消し・帯の外・テストと仕上げだけにする。
- テスト: `tab_overflow_wiring_test.mjs`（マークアップ、CSS、`renderTabs` の末尾、`focusedTabId`）、`startup_settings_a11y_fixes_test.mjs` の C2-09（作る関数を指す）、B29、`rpc_write_tabs_test.mjs`（失敗の細工）を更新。`second_panel_test.mjs` と `ai_correction_test` は変更なしで通ることを確かめる。新規 `tests/tab_index_wiring_test.mjs`（マークアップの順、CSS 変数の存在、色の直書きがないこと、`print.css` が帯を隠すこと）。
- 終わりの条件: JS 全件、スモーク全件（`node tests/smoke/run.mjs`、日英）、docshots の `isReady` が通る。目視: 1 ページで 6px の帯が左端にあり、濃淡と未保存の印が出る。

### S3. 展開・当たり判定・キーボード・a11y

- CSS: 展開（§2.5）、名前のフェード、`:focus-within`、見えない当たり判定、`prefers-reduced-motion`、`forced-colors`、`:focus-visible` の輪郭（トークン `--focus-ring`。現行は部品ごとの個別定義で共通のトークンが無い）。
- JS: ローヴィング `tabindex`、キー操作（§2.6）、フォーカスの保持、`a11y.js` の `markTabs` を 2 リスト対応に。F6（D10）を入れるなら `DEFAULT_SHORTCUTS_WIN/MAC`・設定の「Shortcuts」・`matchShortcut` 経由の処理・両言語の文字列・`mac_shortcut_display_test` の確認。
- テスト: キー操作の単体（偽の DOM）、新規スモーク `108_tab_index_expand.mjs`（実マウスで端へ動かすと帯の幅が `--tab-open-w` に近づく、離れると戻る、キーボードで着いて広がる、Esc でエディタ、reduced-motion で即時。`getBoundingClientRect().width` で判定し、絵は見ない）。
- 終わりの条件: スモーク（日英）、キーだけで帯のタブを選べる。**展開中に `Performance.getMetrics` の `LayoutDuration` が増えない**（8 万行のノートで）。

### S4. 並べ替え・×・コンテキストメニュー・Alt+クリック

- 縦のドラッグ（§2.7）の目印、取り消し、帯の外。×は展開した行でだけ見える／押せる（収縮時は `pointer-events: none`）。`contextMenuTargetTabId` を帯のタブで記録し、帯の外の右クリックで消す（既存の小さな不具合の修正）。Alt+クリックの確認。
- テスト: `tab_strip_test.js`（`dropTarget`、`reorder` は S1 で済み）、`second_panel_test.mjs` に Alt+クリック、新規スモーク `109_tab_index_reorder.mjs`（実マウスの押す・動かす・離す。`buttons: 1`。入れ替え後の順序と、セッションの保存）、帯の上へのファイルのドロップ（新しいタブになる）。
- 終わりの条件: 並べ替えの結果が `getTabs()` の順序と保存されたセッションに出る。

### S5. モード別の出し分けと右の帯

- `stripsFor` を配線（§2.4）、右の帯の描画（同じ `tabs[]`・自分の `secondaryTabId` を選択中に）、`handleTabClick` に `pane`、見開きプレビューでの規則（D5）、`Ctrl+Tab` / `focusedTabId` の見直し、`data-tabs` の切り替え、右の帯の `right: var(--tab-strip-gap-right)`。タイトルのパッチ（`#secondary-pane-title`）が帯と別の場所にあるので、1 つの関数にまとめる。
- テスト: `second_panel_test.mjs` に「右の帯のクリックは右のペインを変える」「左は左」「見開きプレビューでは右の帯がなく、左のクリックでプレビューが付いてくる」「プレビューのみは `data-tabs="none"`」を足す。`rpc_write_tabs_test.mjs`（分割中の書き込みと、両方の帯の更新）。既存スモーク（`63`、`83`、`87`）を日英で。新規 `110_tab_index_modes.mjs`（4 つの表示の切り替えで帯の数と `hidden` が変わる、セッションの復元で右の帯が出る、右のタブを閉じたときの `removeTab` の行き先）。
- 終わりの条件: 4 つの表示で帯が設計どおり。`ui.state` / `tab.list` の値は変わらない。

### S6. あふれ（縦）と「+」「すべてのタブ」

- `tab_overflow.js` を縦で配線（§2.8）。`#btn-new-tab` / `#btn-all-tabs` を足元へ。一覧のパネルの配置。フェード。ホイール。`getTabOverflow()` を `strips` で呼ぶ。
- テスト: `tab_overflow_wiring_test.mjs`（縦のあふれの CSS）、スモーク `08` を縦に書き直し、`81` の最後の判定、docshots の `tabsOverflow` / `tabsOverflowNarrow` / `tabsAllList` の導線とマーカー（`shots.json`）。
- 終わりの条件: 14 枚と 40 枚で窓からはみ出さない、見える所へ出る、一覧からの切り替え、パレットと RPC（`ui.open_panel all_tabs`）が動く。

### S7. 仕上げ

- 未使用になった CSS（横フェード、旧 `.drag-over-left/right`、`#tabs-bar` 関連）と JS（旧 `tab-fade-left/right` の分岐）を消す。`tab_overflow.js` の `axis: 'x'` の分岐を、使い道がなければ消す（テストも）。
- 文書: `manual.html` / `manual_ja.html`（8 + 7 か所）、`interfaces.md` §4.11 と 560・736 行目、`troubleshooting.md`、`shots.json` の 7 図と新しい図（展開、左右、数が多い）、`setups.mjs`。`docs/maintenance/after-a-big-change.md` のチェックリストを通す。全図の撮り直しは P6。
- 追加したバイト数（`tab_strip.js`、CSS の増減）を報告。

---

## 4. オーナーに決めてほしいこと（推奨つき）

| # | 問い | 推奨 | 理由 |
| --- | --- | --- | --- |
| D1 | 「+」（新規タブ）の行き先 | **左の帯の足元**（展開すると「+」が出る。収縮時も 12px の当たり判定。`#btn-new-tab` の id を保つ）。`Ctrl+N` とパレットは今のまま | 設計書に行き先がない。`#header-actions` へ入れると、非表示にできてしまう（`calm_toolbar_test` の「常にある」に反する）。P2 のヘッダーに置く案もあるが、ファイル名と並ぶので窮屈 |
| D2 | 「すべてのタブ」 | 一覧パネル・パレット・RPC は**残す**。ボタンは足元に置き、**あふれたときだけ**出す（今と同じ規則）。位置は帯の右隣 | `cmd_all_tabs` と `ui.open_panel all_tabs`（スモーク 90）が依存。20 枚超の逃げ道 |
| D3 | ピン留め・タブ名の変更・中クリックで閉じる | **P3 では足さない** | 現行にない（機能の追加は範囲外）。ピンは「濃淡が距離で決まる」設計と相性が悪い |
| D4 | 右のページのタブの選び方 | 左右とも**同じ全ノートの一覧と順序**。各帯が自分のペインの選択中を持つ。押した帯のペインが変わる。Alt+クリックは従来どおり「もう一方のページで開く」 | モデルがすでにそうなっている（§1.2）。帯をまたぐドラッグは入れない |
| D5 | 見開きプレビューで左の帯をクリックしたとき（プレビュー側にフォーカスがあっても） | **常に左のページを変え、プレビューは付いてくる**。「別のノートをプレビューに出す」操作は帯から無くなる | 設計は「見開きプレビューは左だけ」。今の「プレビューにフォーカス→クリック」は目に見えない癖。必要なら Alt+クリックの別動作で後から |
| D6 | プレビューのみ（帯なし）での切り替え | 設計どおり**帯なし**。`Ctrl+Tab`、パレットの「すべてのタブ」、RPC は使える | 設計 §3 の 3。端にホバーで出す案は、設計の「なし」と矛盾 |
| D7 | 20 枚を超えたとき | 30px → 20px まで**詰め**、なお超えたら**縦スクロール**（ホイール）。選択中は必ず見える所へ。一覧が逃げ道 | 展開の有無で高さを変えない（ポインタの下で揺れる） |
| D8 | 幅（6px・当たり判定 12px・展開 200px）と右の帯の `9px` | **変数のまま**始め、実アプリのスクリーンショットで決める。右は実機でスクロールバーの幅を測ってから | 設計の未決 1。textarea は OS 標準のスクロールバーで幅が環境で変わる |
| D9 | 未保存の印の形 | 画面案どおり**丸（5px）**。収縮時は 6px の帯の中央、展開時は名前の右 | 「角は直角」は帯の話。印は点 |
| D10 | 帯へ入るキー | **`F6`**（エディタ → 左の帯 → 右の帯 → エディタ）。設定の「Shortcuts」で変えられる。Esc で戻る | エディタは Tab を奪い（C13-12）、帯がキーボードで着けない。F6 は未使用。Mac は fn が要る（実機で未確認） |
| D11 | `Ctrl+Shift+Tab` を「前のタブ」に直すか | **直す**（1 行。Shift を見る）。ただし P3 の本筋ではなく別の小さな修正として | 現行の癖。帯の見た目と無関係 |
| D12 | 帯に「どちらのペインにフォーカスがあるか」の見た目 | **付けない**（`.pane-focused` の輪郭が既にある）。`.split-active` / `.focused-tab` は廃止 | 帯が目立たなくなるため。P4 でページの見た目が決まってから足せる |
| D13 | Zen | 帯は**ヘッダーと同じく消す**（`visibility: hidden`）。入力中の薄化は帯には掛けない | 今のタブは Zen でヘッダーごと消える |

---

## 5. 性能とリスク

### 5.1 レイアウトの罠（実コードで確認したもの）

1. **分割の割合計算**: `initPaneResizer` は `workspaceEl.getBoundingClientRect().width`（余白込み）で割合を出し、`applySplitRatio` は `#editor-pane` に `flex: 0 0 <pct>%`（親の**内側の幅**に対する割合）を入れる。`#workspace` に左右の余白を付けると、ドラッグで仕切りがポインタからずれる（余白 × 割合の分）。→ 余白は `#workspace` ではなく**各ペイン**（`border-box`）に付ける。
2. **行番号の左端の帯**: 結果ブロックの帯（`.result-accent`、行番号 `#line-numbers` の左端 0〜3px、`updateResultAccent`）と、左の帯の塗り 6px が重なる。→ `#editor-pane` の左に `--tab-strip-w` の余白（S2）。右ペイン側は P4 で。
3. **右端のスクロールバー**: `#editor` / `#editor-secondary` は OS 標準のスクロールバー（CSS に `scrollbar-*` の指定なし）。画面案の 9px は決め打ちで、環境で幅が変わる。→ `--tab-strip-gap-right` を実機で測る。測るなら、右の帯が初めて出るときに 1 回だけ（起動時に強制レイアウトを足さない）。P1b / P4 で `scrollbar-width: thin` を決めれば幅が決まる。
4. **P2 との重なり**: ヘッダー／フッターがオーバーレイになると帯の上下と重なる。→ `--tab-strip-top/bottom`。P2 の担当に値を入れてもらう。
5. **P1b のトークン**: 帯が使う色は `--accent-color`（紙）/ `--accent-hover`（墨）の使い分けが `tokens.css` 側に入る。帯は専用トークンを参照するだけにする（付録）。

### 5.2 互換

- **macOS 10.15**（WKWebView は Safari 13 相当）: `color-mix()` 不可 → 疑似要素の `opacity`（§2.3）。`inset`（Safari 14.1）と `:has()`（15.4）は**現行の CSS がすでに使っている**ので、新しい条件ではない。Mac で Tab キーがボタンに止まらない設定（C13 の記録）が既定。`tabindex` の付いた要素が WKWebView でどう着くかは**実機で未確認**。
- **forced-colors**: 現行の CSS に対応が 1 つもない。帯は P3 で枠線に戻す規則を入れる（§2.3）。

### 5.3 性能（見積もり。実測は S2 以降に `tools/perf/v2_perf.mjs` で）

- **キー入力**: 帯の更新は、最初に汚れた瞬間 1 回と、自動タイトルが変わった瞬間だけ（今と同じ）。毎キーの処理を足さない。更新は Map の引き当て（`querySelector` を使わない）。
- **`renderTabs()` の全再描画**: 約 40 か所から呼ぶ。今は毎回 `innerHTML = ''` から全作り直し（タブ N 枚で DOM 4N 個、リスナ 3N 個）。**キー付きの更新**で、変わった要素の変わったプロパティだけ書く。N が 100 でも 1ms を大きく超えない見込み（未測定）。
- **a11y.js の `MutationObserver`**: 子の増減と `class` 属性の変化の**束ごとに**、全タブへ属性を書き直す（O(N)）。キー付きの更新で書き込みが減る。描く側が付ける形（§2.6 の後者）なら観察そのものが要らない。
- **起動**: マークアップに空の帯 2 つ、`tab_strip.js` が 1 ファイル（概算 8KB 前後）。`restoreSessionFromData` で最初の描画に N 枚の要素。変化は小さい見込みだが、`v2_perf.mjs` の起動の中央値で確かめる（基準は `tools/perf/baseline-v1.14.md`）。
- **8 万行**: 展開は重ね描きで、`#editor-pane` を再レイアウトしない。**ただし `#editor-pane` の左に 6px の余白を足す**ので、textarea の幅が 6px 変わり、折り返しの計測のキャッシュ（`lineRowsOf` の系）が一度無効になる。起動時に 1 回なので、8 万行を開く時間とスクロール・入力 50 回を `v2_perf.mjs` で確かめる。
- **フェード（マスク）とすりガラス**: 帯には `backdrop-filter` を使わない（設計 §6 の測定対象は P2 のヘッダー／フッター）。マスクは縦のフェードだけ。

### 5.4 リスクの一覧

| リスク | 内容 | 対策 |
| --- | --- | --- |
| 端にマウスを寄せると意図せず開く | スクロールバー・ウィンドウの端のリサイズに向かうときに通り過ぎる | 開く側に `--tab-open-delay`。右の帯の当たり判定は内側へ。実機で確かめる |
| 重なった要素がクリックを奪う | 帯の見えない 6px が行番号の左端を押せなくする | 帯のタブの高さの範囲だけ。空の縦の範囲は `pointer-events: none` |
| フォーカスが落ちる | 全再描画で、キーボード操作中の要素が消える | キー付きの更新、構造変化時のフォーカスの復元 |
| ソース文字列を検査するテスト | `renderTabs` の中身・`focusedTabId` の文面・CSS の文字列を直接見るテストが 4 ファイル（`tab_overflow_wiring`、`startup_settings_a11y_fixes`、`language_and_keyboard_fixes`、`first_run_polish`）、描き方に依存するのが 2 ファイル（`second_panel`、`rpc_write_tabs`） | S2 / S6 で同時に直す（§1.5）。作る関数に移したら切り出し位置を直す |
| 偽の DOM が貧弱 | `slot_env.mjs` / `second_panel_test.mjs` の偽の DOM は `querySelectorAll` が空、バブリングなし、`removeChild` なし | `children`・`appendChild`・`insertBefore`・`innerHTML = ''` だけで動く更新にする。**要素ごとのリスナ**を保つ |
| 全図の準備判定が止まる | `D.isReady` が `#tabs-list .tab-item` を数える | id・class を S7 まで保つ |
| `contextMenuTargetTabId` が残る既存の不具合 | 前に右クリックしたタブがエディタの右クリックで使われる | S4 で帯の外の右クリックで消す |
| 幅 12px の当たり判定 | WCAG 2.2 の 24px に満たない | 同じ機能の別経路（`Ctrl+Tab`、一覧、展開後の行）を残す |
| macOS の実機 | 展開（hover）、F6、Tab の着き方、スクロールバー幅 | 実機で未確認と書く（P6 の項目） |

---

## 付録 A. 帯が頼むトークン（`tokens.css` の担当へ。紙・墨の値は P1b）

`--tab-accent`（塗りの色。紙は `accent-color`、墨は `accent-hover`）、`--tab-base`（塗りの下の中間色）、`--tab-ink`、`--tab-ink-hi`（濃い塗りの上の文字）、`--tab-hair`（1px の仕切り）、`--tab-dirty`、`--tab-conflict`（既存の `#e2c08d` と `#f48771` に当たる）、`--tab-close-hover-bg`（既存の `#c72e2e`）、`--focus-ring`。値は P1a で「墨の値が元の値と等しい」ものにする。

## 付録 B. 変えない・触らないもの

`print.css`、Go のコード、`chrome_layout.js`、セッションの JSON の形、RPC の形（`tab.list` / `ui.state` / `ui.open_panel`）、`#tab-list-panel` の見た目（P5 のパネルの見直しの対象外のまま。一覧の中身は現行のパネル雛形）、`Ctrl+Tab` / `Ctrl+W` / `Ctrl+N` / `Ctrl+1` / `Ctrl+2` の意味。
