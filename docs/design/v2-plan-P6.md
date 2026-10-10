# v2 P6 実装計画: 仕上げと 2.0.0 のリリース（2026-10-05、設計担当）

状態: **計画。コードは変えていない。** ブランチ `v2` の HEAD `fabb29c`（P1a〜P4b コミット済み）を読んで書いた。P5（付箋のパネル）は別の担当が実装中で、ここでは触れていない（P5 が済んでから P6 を始める。§8 の入口の条件）。設計書 `v2-visual-2026-10.md`（§6、§7 の P6）、契約 `v2-implementation-contract.md`、計画書 P2・P3・P4-P5、台帳 `v2-tokens.md` の 6.7 に従う。コードの場所は関数名・ファイル名・行番号（`fabb29c` 時点）で指す。**確認したこと**と**案**は分けて書いた（案には「推奨」と付けた）。

---

## 0. 先に読む 12 行

1. P6 は 6 つの作業束: **A** Go のネイティブの色と最初のフレーム、**B** 強制色・動き・コントラスト・a11y、**C** Mac、**D** 文書と図、**E** 2.0.0 のリリースと main への取り込み、**F** 性能ゲート。**コードを触るのは A と B だけ**で、A は **v2 で最初の Go の変更**（`git diff --name-only main v2` の 123 件に `.go` は 0 件）。A と B が終わったら「コード凍結」とし、D・F・C を並べて進め、E で出す。
2. ネイティブの色は **`#1e1e1e` が製品のコードで 6 か所・2 ファイル**（`window_windows.go` に 4、`window_darwin.go` に 2。ほかに試験 `shortcut_windows_test.go` に 1）。墨の地は `#0e0f17`、紙は `#fbfbf9`（`tokens.css` 冒頭の `--canvas-bg`）なので、**墨の人は一段明るい灰色が、紙の人は暗い窓が、最初のページが描かれる前に見える**（基準の実測: ページへの移動まで 331 ms、最初の描画は 445 ms。**窓が見えている時間はこの間のどこから**かは A0 で測る）。Quick Capture（`quickcapture_windows.go`、`#252526` など）と画面キャプチャの枠は**別の窓で別の色**。見た目に従わせず、そのまま残す（§2.1）。
3. Go は保存された見た目を**追加の I/O なしで**知れる。`config.json` は `InitScrapEngine`（`app_scrap.go:84`）が `readConfigCached()` で窓の前に読み込み済みで、`parseGlobalSummonShortcut`（`app_config.go:115`）と同じ形の純粋関数を 1 つ足すだけでよい。**墨が既定なので、文字列に `paper` が無ければ JSON を解析すらしない**（約 5 KB の `config.json` で 1 µs ほどの検索 1 回。見込みで、ベンチで確かめる）。
4. 設計は「**起動時は設定から、実行中は `SaveConfig` から**」。新しい bind も RPC も JS の変更も要らない（`SaveConfig` は設定画面・設定パッケージの取り込みのどちらでも通る）。Windows はタイトルバーも見た目に従わせる（`DWMWA_USE_IMMERSIVE_DARK_MODE` を紙で 0）。Mac のタイトルバーは OS に任せる。
5. **強制色**の規則は、バー（`chrome.css:289`）・タブの帯（`style.css:434`）・分割とプレビューの紙（`style.css:1243`）にはすでにある。**未確認**: 付箋のパネル（P5 後）、設定、スイッチ、アクセントの色見本、検索の一致、結果ブロックの帯、ゴースト、図（Mermaid）、チップ。一番安い監査は、docshots に `--media` を足して **70 の状態を強制色・動き減・紙/墨で一括で撮り**、目で見ること（§3.3）。実機のハイコントラストのテーマは、オーナーが 4 テーマを見る。
6. 開発 PC の Windows は `prefers-reduced-motion: reduce` を返す（P2 の測定条件）。**オーナーの普段の画面ではフェードも展開も動かない**。動きのある状態は CDP で `no-preference` にして確かめ、オーナーには「視覚効果をオンにして」見てもらう項目を作る（§3.4）。
7. Mac: CI の macOS ジョブが証明するのは、Obj-C のコンパイル、`go test`、JS 全件、`.app` が `--version` まで動くことだけ。**見た目と動き（WKWebView）は実機でしか分からない**。Safari 15.6 の見張りは CSS にだけテストがある（`tests/css_compat_test.mjs`）。JS は走査した 24 の新しい API・構文で未保護の使用が 0 件だったが、**テストが無い** → 小さな見張りを足す（§4.2）。10.15 の実機が無ければ「未確認」と書いて出す。
8. 文書と図: 図は **70 の状態 × 2 言語 + ネイティブ 2 × 2 = 144 枚**（今 142 枚。`split-editor` が未収録）、マニュアルが使うのは 65 × 2 = 130 枚、デモ GIF 11 本、ランディング用の手作りの 12 枚（`img/screen*.png`、別系統）。**マニュアルには墨（既定）の図を全部、紙は 4〜6 枚だけ**足すのを推奨（§5.3）。設定の章（`cfg-general`）に「外観」が**まるごと無い**のが最大の文書の穴。
9. **`git log v2..main` は 0 件**（`main` = `origin/main` = merge-base = `2fe2a2b`）。依頼文の「main に 8 コミット」は、**今は無い**。FF でそのまま出せる。出す直前にもう一度確かめる（§6.6）。
10. **GitHub Pages は `main` への push のたびにリポジトリ全体を公開する**（`static.yml`、`path: '.'`）。マニュアルと図は main に入った瞬間に公開されるので、**文書と図が完成してから main へ**、そして main へ出してすぐタグを打つ。
11. main の作業ツリー（他のセッション、未コミットの変更あり）には**触らない**。出すのは `git push origin v2:main`（FF）で、ローカルの `main` の参照を `update-ref` / `branch -f` で動かしてはいけない（作業ツリーと index が古いままなので、v2 の全変更を**取り消した**ように見える）。主ツリーの更新は、そちらのセッションが `git pull --ff-only` する（未追跡の `docs/design/v2-visual-2026-10.md` が邪魔になる）。
12. 最大のリスク（§10 の順位つき一覧の上位）: **Mac が未確認**、**タブの帯と自動非表示のバーは「慣れ」の壁**（最初に見えるのがそこ）、**文書と図が古いまま Pages に出る**、**Go の変更が実機でしか確かめられない**。

---

## 1. 確認した事実（読んで・実行して確かめたもの）

| # | 事実 | 根拠 |
| --- | --- | --- |
| F1 | v2 は Go・CI・packaging を 1 行も変えていない。変更 123 件の内訳: `frontend` 29、`tests` 55、`tools` 24、`docs` 10、`skills` 3、`manual*.html` 2。削除は `tests/zen_active_test.mjs` の 1 件 | `git diff --name-only main v2` |
| F2 | `main` = `origin/main` = merge-base = `2fe2a2b`。`git log v2..main` と `git log v2..origin/main` は空。`v2` は origin に**まだ無い**（`git branch -r` は `origin/main` だけ）。タグは `v1.14.0` が最新 | `git rev-parse`、`git log`（`git fetch` はしていない。**出す直前に必ず fetch して確かめる**） |
| F3 | 主ツリーの未コミット（セッション開始時のスナップショット）: `.gitignore` 変更、ルートの 8 本（`e2e_comprehensive_test.uws`、`run_test.bat`、`run_test_step.ps1`、`test_cli_runner.ps1`、`test_e2e_full_suite.uws`、`test_syki.uws`、`test_programmable_control.uws`、`test_programmable_gui.uws`）の削除、`tests/e2e/` 未追跡、`docs/design/v2-visual-2026-10.md` 未追跡。v2 の 123 件と**重なるのは最後の 1 件だけ**（v2 では `bac163b` で追跡済み）。`tests/e2e/` は v2 に無く、`run_js_tests.mjs` は `tests/*.mjs` を再帰しないので、取り込んでも競合しない | `git status`（会話の冒頭）と `git diff --name-only main v2` |
| F4 | `ci.yml` は**すべてのブランチの push** で走る（`push:`、`pull_request:`）。Windows ジョブ: `go vet`（注釈だけ）、`go build ./...`、`go test ./...`、macOS 向けの cgo なし型検査（`go vet` と `go test -c`）、**JS 全件**（`node tools/run_js_tests.mjs`）、exe と CLI の作成と検査、アーティファクト 14 日。macOS ジョブ: `go build ./...`（Obj-C の唯一のコンパイル）、`go test ./...`、`build_mac.sh`（universal の `.app`）、`plutil`・`lipo`・`--version` の起動検査、**JS 全件**、署名検査、`syki-macos-<sha>` のアーティファクト 14 日。**smoke（`tests/smoke`、Edge が要る）と性能（`tools/perf`）は CI に無い** | `.github/workflows/ci.yml` |
| F5 | `release.yml` は `v*` タグで走る。Windows は exe と CLI を zip、macOS は `go test -v ./...` → `build_mac.sh` → zip。公開されるリリースは本文が空でタイトルがタグ名のまま。`static.yml` は `main` への push で `path: '.'` を Pages に出す | `.github/workflows/*.yml` |
| F6 | 最小の macOS は 10.15（`build_mac.sh:9`）。WKWebView は Safari 15.6 まで。Windows の WebView2 は 154（P2 の測定条件） | `build_mac.sh`、`tools/perf/v2-p2-translucency.md` |
| F7 | 埋め込む `frontend/` は main の 6,823,961 バイトから **7,096,706 バイト（+272,745、+4.0%）**。`style.css` 150 KB、`tokens.css` 27 KB、`chrome.css` 12.6 KB、`appearance.js` 20.6 KB、`chrome_overlay.js` 24 KB。JS テスト 134 ファイル（`frontend/js/*_test.js` 39 + `tests/*.mjs` 95）、smoke 62 本 | `git ls-tree -l`、`ls` |
| F8 | 起動の最初の描画の前に見た目を当てる小さなスクリプト（P1b）: `frontend/index.html:22`。`<body>` の最初のインライン（ES5、400 文字ほど）が `localStorage['syki_look']`（`paper` と `blue` のような語を縦線でつないだ印）を読み、`look-paper` と `theme-*` のクラスを `<body>` と `<html>` に付ける。`:root.look-paper { --canvas-bg: #fbfbf9; color-scheme: light }`（`tokens.css`）が canvas を紙にする。印は `app.js` の `applyTheme()` → `rememberLook()`（`app.js:507`）が、**既定の見た目（墨・Dark Olive）でないときだけ**書く。自分で選ぶ色は印に入れない。実機で 4/4 確認済み（`v2-tokens.md` 6.7） | `index.html`、`appearance.js` の `markerFor`、`app.js` |
| F9 | 起動の順序（Windows）: `main.go` が `InitScrapEngine()` を呼ぶ（`readConfigCached()` で `config.json` を読む）→ HTTP サーバ（固定ポート 41739）→ `runPlatformWindow`。`runPlatformWindow` の最初で `globalApp = app`、環境変数 `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`（`window_windows.go:627`）、WH_CBT フック（:666-681）、`webview2.NewWithOptions`、`applyNativeDarkMode(w)`（:715）。`config.json` を読む既存の純粋関数は `parseGlobalSummonShortcut(raw)`（`app_config.go:115`）と `parseJevRelevantSettings` | `main.go:199-262`、`window_windows.go`、`app_config.go` |
| F10 | `SaveConfig(configJSON)`（`app_config.go:202`）は、設定画面の保存・設定パッケージの取り込み・状態バーのスイッチなど、設定が変わるすべての保存の通り道。書いたあと `invalidateConfigCache()` し、4 つの購読者（scrap・jev・discord・inbox）を、設定が変わったときだけ作り直す。UI スレッドへ渡す既存の道具は `a.w.Dispatch`（`dispatchEval`、`app.go:233`） | `app_config.go`、`app.go` |
| F11 | 強制色の規則（実在）: `chrome.css:280-296`（バーは不透明・`backdrop-filter` なし・上下に 1px の線。`prefers-reduced-transparency` と同じ塊）、`style.css:434-454`（タブ: 塗りなし、枠線、選択中は `Highlight`、印は `ButtonText`、焦点は `Highlight`）、`style.css:1243-1277`（仕切りは線、紙は枠、フォーカスのあるページは `Highlight`、`.pane-header`）。`prefers-reduced-motion`: `style.css` の全体規則（`transition-duration: 0s !important`、`animation-duration: 0.01ms !important`）と個別 5 か所、`panel_fade.js` の `matchMedia`。`prefers-contrast` の規則は**無い** | `grep` |
| F12 | 設計書 §4.1 の「窓の下の角と本の下の角 11px」は、**CSS に実装されていない**（`#app` に角丸が無い。`grep` で 0 件）。Windows 11 と macOS は OS が窓を丸める | `style.css`、`chrome.css` |
| F13 | マニュアルの設定の章（`manual.html` の `cfg-general`）は「Theme color: Dark Olive / VS Code Blue / Forest Teal / Charcoal」の 1 行のままで、**地（墨・紙）、朱、自分で指定する色、バーの透過、自動非表示、ページの間の仕切り、エディタのフォントが載っていない**。タブの帯・Zen・仕切り・F6 は P2〜P4 で書き込み済み。`split-editor` の図は `shots.json` にあるが、マニュアルに**まだ置いていない** | `grep`、`node` での突き合わせ |
| F14 | docshots: `shots.json` は 70 の状態（全面 58、切り抜き 12、狭い窓 4、スマホ 2）、マーカー 234 個。`img/manual/en` と `ja` に各 71 枚（70 − `split-editor` + ネイティブ 2）。マニュアルが参照するのは 63 状態 + ネイティブ 2 = 65 枚。`run.mjs` は `--look ink` と `--look paper` と `--accent` を持ち、`shot.boot.look` で状態ごとの上書きもできる（`new URLSearchParams({lang, look, accent, ...shot.boot})` の後勝ち）。マーカーの `selector` 233 部分を `frontend` と突き合わせて、**消えた id・class は 0 件**（スマホのページの 4 つと `is-info` は Go の HTML と動的なクラスで別の場所にある） | `tools/docshots/`、`scratchpad/p6/selcheck.mjs` |
| F15 | winget の PR `microsoft/winget-pkgs#438694`（`youshinh.syki` 1.12.0）は、検証は通り（`Azure-Pipeline-Passed`、`Validation-Completed`、`New-Package`）、`reviewDecision: REVIEW_REQUIRED` で**モデレーター待ち**のまま（`updatedAt` 2026-10-03）。Homebrew は `youshinh/homebrew-tap` の cask を版ごとに手で更新する | `gh pr view`、記録 |
| F16 | リリースの本文は 英語 → `---` → 日本語 の 2 部で、`### Added / Changed / Checked / Not verified`（日本語は 追加 / 変更 / 確認したこと / 未確認）。v1.14.0 の本文で確認 | `gh release view v1.14.0` |

---

## 2. 作業束 A: Go のネイティブの色と最初のフレーム

### 2.1 棚卸し（ネイティブの色のすべて）

| # | 場所 | 何の色か | 今の値 | P6 での扱い |
| --- | --- | --- | --- | --- |
| N1 | `window_windows.go:627` | 環境変数 `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`。WebView2 が**ページを描く前**に見せる下地（コントローラができる前から有効） | `0xFF1E1E1E` | **見た目に従う**（起動時） |
| N2 | `window_windows.go:668`、:672-675 | WH_CBT フックが、**この OS スレッドで作る窓すべて**のクラスの背景ブラシを替える（`SetClassLongPtrW`）。窓が WebView2 に覆われるまでの間と、リサイズで新しく現れた領域に見える | `CreateSolidBrush(0x001e1e1e)` | **見た目に従う**（起動時） |
| N3 | `window_windows.go:672-673`（フック内）、:422-423（`applyNativeDarkMode`） | `DwmSetWindowAttribute` の 20 と 19（`USE_IMMERSIVE_DARK_MODE`）= 1。**タイトルバーと窓枠が暗い** | 常に暗い | **紙では 0**（明るいタイトルバー） |
| N4 | `window_windows.go:425-430` | `applyNativeDarkMode` の中でもう一度、クラスのブラシ（`GCLP_HBRBACKGROUND` = -10） | `0x1e1e1e` | N2 と同じ関数に集約 |
| N5 | `window_windows.go:432-458` | `ICoreWebView2Controller2.PutDefaultBackgroundColor`（反射でコントローラを取り出す既存の方法） | `{255, 0x1e, 0x1e, 0x1e}` | **見た目に従う**（起動時と実行中） |
| N6 | `window_darwin.go:329-337` | `[win setBackgroundColor:]`（`setupMacWindowDelegate`、`colorWithCalibratedRed`） | `#1e1e1e` | **見た目に従う**。`colorWithSRGBRed:`（macOS 10.12+）に替える（ページの色は sRGB。calibrated は数段ずれる） |
| N7 | `window_darwin.go:346-355` | `[webView setUnderPageBackgroundColor:]`（macOS 12+、`@available` で保護済み）。WKWebView が描く白い下地の代わり | `#1e1e1e` | N6 と同じ値。macOS 10.15・11 には無いので、墨の人の白いちらつきは**今のまま**（紙の人には白でよい） |
| 他 | `quickcapture_windows.go:125-131` | Quick Capture のポップアップ（別の Win32 窓）: `colBg 0x262525`（`#252526`）、`colField 0x3c3c3c`、`colBtn 0x333333`、`colText 0xd4d4d4`、`colBorder`。85% の透け（`quickCaptureAlpha`） | 暗い | **変えない**。画面の端にどのアプリの上にも出る小窓で、見た目の設定の対象ではない（マニュアルは「暗い色で角が丸く」と書いている）。紙の人にも暗いまま。`docs/design/v2-tokens.md` 6.7 の「ポップアップの色も同じ」を「対象外」に直す |
| 他 | `imgcap_windows.go:71-72` | 画面キャプチャの選択枠（緑 `#22C55E` と濃い緑のバッジ） | 緑 | 変えない |
| 他 | `shortcut_windows_test.go:145` | WH_CBT フックの動作を確かめる試験用の窓（テスト内のコピー） | `0x001e1e1e` | 変えない（ブラシの値に依存しない試験） |
| 他 | `pkg/dropzone/html.go:24-97` | スマホ用のページ（別の CSS、`prefers-color-scheme` で暗い） | 独自 | 見た目の設定に従わない（`v2-tokens.md` 6.7 の既存の決定） |
| 他 | `print_pdf.go:146,152` | PDF のヘッダー・フッターの文字色 `#555` | 紙 | 変えない（印刷は紙） |
| 他 | Windows 11 のタイトルバーの色（`DWMWA_CAPTION_COLOR` = 35）、Mac の `NSAppearance` | 未設定（OS 任せ） | — | **設定しない**（§2.7、§10 O7） |

ページ側（確認済みで足りている）: `frontend/index.html:6-7` の `<meta name="color-scheme" content="dark">` と `theme-color #0e0f17` は `appearance.js` の `applyMeta` が紙で書き換える。`:root` の `--canvas-bg` が `html, body` の背景（`style.css:9-12`、`!important`）。

### 2.2 Go が保存された見た目を知る方法

`config.json` の `appearance.look` は JS が書く JSON の一部で、Go は文字列のまま持つ。**起動時に Go が知るための追加の I/O は無い**: `main.go` が `InitScrapEngine()` → `readConfigCached()` で窓より前に読んでおり（`app_scrap.go:84`）、`runPlatformWindow` の先頭で `globalApp.GetConfig()` が使える（`getInitialGlobalShortcut` が同じ形で使っている）。Mac の `runPlatformWindow` も `app.GetConfig()` が使える（`initialGlobalShortcut(app)`、`platform_darwin.go:98`）。

- 値は `"paper"` か、それ以外（= `"ink"`）。JS の `normalize` は `LOOKS.indexOf(out.look) >= 0 ? out.look : 'ink'` なので、**大文字小文字を含めて完全一致だけが紙**、他はすべて墨。Go も同じ規則にする。
- 速い道: `strings.Contains(raw, "paper")` が偽なら**即 `ink`**（JSON の解析をしない。既定の人はこの道だけを通る）。真のときだけ、BOM を外して `json.Unmarshal` で `struct{ Appearance struct{ Look string } }` を読む（他のキーは読み飛ばす）。`appearance` がオブジェクトでない、`look` が文字列でない、JSON が壊れている、は墨。
- 費用（見込み。**ベンチで確かめる**）: ink の道は約 5 KB（この PC の `config.json` は 4,876 バイト）の検索 1 回で約 1 µs、割り当て 0。paper の道は解析 1 回で数十 µs。既存の `parseGlobalSummonShortcut` と `parseJevRelevantSettings`（それぞれ全体を解析）と同じ桁で、**起動の差はノイズの下**（`v2_perf.mjs` の交互 16 回で確かめる、§7）。
- **しないこと**: `config.json` を Go が別に開く（キャッシュが無駄になる）、`appearance` を Go の型にする（Go は設定を JSON のまま持つ方針。`v2-implementation-contract.md` §7-7）、ネイティブの色を設定に持たせる（色の値は 1 か所 = `tokens.css`）。

#### ページ側のちらつきの残り（Go では直らないもの）

`localStorage` の印が無いときは、Go が紙のネイティブの色を出しても、**ページが墨で描かれてから紙に変わる**（明 → 暗 → 明）。印が無い場合: 設定の取り込み・別の PC に `config.json` を持ち込んだ最初の起動、WebView2 の保存領域を消したあと、固定ポート 41739 が使えず別ポートで起動したとき（`localStorage` はポートごと）。**紙は v2 で初めてできる見た目なので、v1.x から上げた人の既存の設定には無い**（紙を選んだ人は選んだ時点で印が書かれる）。起動の都度起きる穴ではないので、**既定では直さない**。直すなら任意の A7（§2.4）。

### 2.3 最小で安全な設計

新しいファイル `nativelook.go`（ビルドタグなし。どの OS でも型検査・テストができる）:

```go
type nativeLook struct{ R, G, B uint8; Paper bool }            // ink / paper の 2 つだけ
var (
    nativeInk   = nativeLook{0x0e, 0x0f, 0x17, false}           // tokens.css の :root --canvas-bg
    nativePaper = nativeLook{0xfb, 0xfb, 0xf9, true}            // tokens.css の :root.look-paper --canvas-bg
)
func parseAppearanceLook(configJSON string) string              // "paper" か "ink"（上の規則）
func nativeLookFor(look string) nativeLook
func (a *App) startupNativeLook() nativeLook                    // a.GetConfig() から（キャッシュ済み）
func webview2BackgroundEnv(l nativeLook) string                 // "0xFF0E0F17"
func colorrefBGR(l nativeLook) uintptr                          // 0x00BBGGRR（Win32 の COLORREF）
```

- **実行中の追従は `SaveConfig` の中**（新しい bind・RPC・JS の変更なし）: 書いて `invalidateConfigCache()` した直後に `a.noteNativeLook(configJSON)`。`parseAppearanceLook` の結果が、最後に当てた値（`a.nativeLook`、`runPlatformWindow` が起動時に入れる）と違うときだけ、`a.applyNativeLook`（`runPlatformWindow` が入れるフック。窓が無いテストでは `nil`）を呼ぶ。フックの中身は `a.w.Dispatch(func(){ setNativeLook(l) })`（`isDestroyed` を見る。`dispatchEval` と同じ形）。**設定画面の「プレビュー」（保存前の即時反映）にはネイティブは追従しない**（保存で追従。他の OS 連携の設定、トレイ常駐・グローバルショートカットと同じ流儀）。
- **Windows の `setNativeLook(l)`**（`window_windows.go`）: ① `DwmSetWindowAttribute(globalHwnd, 20, &(!l.Paper))` と 19、② クラスのブラシを `brushFor(l)` に替える（**ink と paper の 2 つのブラシをそれぞれ最初に必要になったときだけ作り、使い回す**。`SetClassLongPtrW` が返す前のブラシは**捨てない**: 起動時のフックで他のクラスにも付けた共有のブラシで、消すと他の窓が壊れる。漏れるのは 0 個）、③ `PutDefaultBackgroundColor`（N5 の既存の反射の道を `applyNativeDarkMode` から切り出して使う）、④ タイトルバーの再描画（`SetWindowPos` の `SWP_FRAMECHANGED` か `RedrawWindow` — **実機で、どれが必要か確かめる**）。環境変数（N1）は起動時だけ。
- **起動時**: `runPlatformWindow` の最初（`globalApp = app` の直後）で `l := app.startupNativeLook()`、`app.nativeLook = l`。N1 は `webview2BackgroundEnv(l)`、N2 のブラシとフックの DWM の値は `l` から、`applyNativeDarkMode(w)` は `applyNativeLook(w, l)` に改名して `l` を受ける（N3〜N5 を 1 か所に）。
- **macOS**: `setupMacWindowDelegate(void *nsWindow, double r, double g, double b)` に変え、`[NSColor colorWithSRGBRed:r green:g blue:b alpha:1.0]` を N6・N7 の両方に使う。実行中用に `static void sykiSetBackdrop(double r, double g, double b)`（`dispatch_async(main)`、`gWindow` に同じ 2 つを当てる。`underPage…` は `@available(macOS 12.0, *)` の中）。Go 側は `window_darwin.go` に `setNativeLook(l nativeLook)`（`C.sykiSetBackdrop`）、`platform_darwin_nocgo.go` に空のスタブ。**Obj-C の差分は 25 行以内**、既存の同じ形（`dispatch_async` と `@available`）の写し。この PC に clang が無く、**CI の macOS ジョブが最初のコンパイル**。
- **値の一致を機械で縛る**: ネイティブの 2 色と `tokens.css` の `--canvas-bg`（`:root` と `:root.look-paper`）が違うとテストが落ちる（§2.5）。`index.html` の `theme-color` の値も墨と同じであることを見る。

### 2.4 手順（各手順の終わりでアプリが動く）

| 手順 | 内容 | 触るファイル | 終わりの状態 |
| --- | --- | --- | --- |
| A0 | **変更前の証拠**。現行 HEAD の試験 exe（`v2-p5.exe` など）で、最初のフレームの色を取る（§2.6 の方法）。墨 `#1e1e1e` と、紙の設定での暗さを数値で残す | なし（scratchpad） | 問題が数字で見える |
| A1 | `nativelook.go` とテスト（純粋なもの）。**まだ誰も呼ばない** | `nativelook.go`、`nativelook_test.go` | 挙動は不変。`go test` と 2 つのクロスチェックが通る |
| A2 | Windows の起動時: N1・N2・N3（フック）・N4・N5 を `startupNativeLook` から。墨の既定は `#0e0f17` に（ごくわずかに暗くなる）。紙は明るく | `window_windows.go`、`app.go`（フィールド 2 つ） | 墨・紙の最初のフレームが地と一致（§2.6） |
| A3 | Windows の実行中: `SaveConfig` → `noteNativeLook` → `setNativeLook`。ブラシのキャッシュ、タイトルバー、再描画 | `app_config.go`（3 行）、`nativelook.go`、`window_windows.go` | 設定画面で地を替えて保存すると、タイトルバーと窓の下地が追従 |
| A4 | macOS: Obj-C の引数・`sykiSetBackdrop`・Go の wrapper・nocgo のスタブ・`window_darwin_lifecycle_test.go` の文字列検査 | `window_darwin.go`、`platform_darwin_nocgo.go`、`window_darwin_lifecycle_test.go` | **push して CI の macOS ジョブが緑**（これが唯一のコンパイル） |
| A5 | 文書: `v2-tokens.md` 6.7 の「Go のネイティブの色」を「済み」に、Quick Capture を「対象外」に。設計書 §4.1 の「下の角 11px」を、F12 のとおり**直す**（§10 O8） | `docs/design/` | 記述と実装が一致 |
| A6 | 実機で証明（§2.6）。**墨・紙の両方**、Windows 11（できれば 10 も）。結果を `v2-tokens.md` に数字で書く | scratchpad、`docs/design/` | 受け入れ基準 A（§9） |
| A7（任意） | 印が無い紙の人のちらつきを消す: Go の HTTP ハンドラが、紙のときだけ `/`（`index.html`）の `<body class="dark-theme theme-olive"` と `<html>` に `look-paper` を入れて返す（埋め込みの `index.html` を 1 回だけ読んで置換して保持）。**推奨: 今回はやらない**（上の「残り」のとおり起動の都度の穴ではなく、`http.FileServer` の経路に手を入れる費用が見合わない）。実機で気になると分かったら 2.0.x で | `main.go` | — |

`tools/…/make_overlay.py`（隔離した実アプリの作成用。scratchpad の `v2e2e/`）は `window_windows.go` の**3 つの文字列がちょうど 1 回**あることを `assert` する（`"Local\\syki_sok_SingleInstance_Mutex_v1"`、`"--disable-hang-monitor",`、`webViewDataPath := filepath.Join(dataDir, "syki", "webview")`）。**A2〜A3 はこの 3 行を変えない**（変えるなら `make_overlay.py` を同時に直す。契約 §2.1 の道具）。

### 2.5 テスト（hermetic。実機に副作用を出さない）

`TestMain`（`testmain_test.go`）が設定の置き場を一時フォルダにしている前提で、**新しいテストは窓も DWM も WebView2 も作らない**。

| テスト | 内容 | 起動条件 |
| --- | --- | --- |
| `TestParseAppearanceLook` | 空、`{}`、壊れた JSON、`appearance` が無い・配列・文字列、`look` が `"paper"`・`"ink"`・`"Paper"`・`"PAPER"`・数値・`null`、`general.look` や他の場所の `"paper"` は無視、BOM 付き、`paper` が別のキーの値、巨大な設定 | どの OS でも |
| `TestNativeLookMatchesTokens` | 埋め込みの `frontendFS`（`frontend/css/tokens.css`）から `:root { … --canvas-bg: #xxxxxx` と `:root.look-paper { … --canvas-bg: #xxxxxx` を正規表現で取り、Go の 2 色と**等しい**こと。`index.html` の `theme-color` が墨と等しいこと | どの OS でも |
| `TestNativeLookFormats` | `webview2BackgroundEnv` が `0xFF0E0F17` / `0xFFFBFBF9`、`colorrefBGR` が `0x00170F0E` / `0x00F9FBFB` | どの OS でも |
| `TestSaveConfigAppliesNativeLookOnChange` | `App{}` に記録用のフックを入れ、`SaveConfig`（一時フォルダに書く）を 墨 → 墨（0 回）→ 紙（1 回）→ 紙（0 回）→ 壊れた JSON（0 回。直前の値を保つ）→ 墨（1 回）。フックが `nil`（窓なし）でも落ちない | どの OS でも |
| `BenchmarkParseAppearanceLook` | 5 KB と 200 KB の `config.json`（紙あり・なし）。**結果を `v2-tokens.md` に書く**（墨の道で割り当て 0、1 µs 台） | 手動 |
| ミューテーション確認 | 値を 1 つ変える、`strings.Contains` の語を変える、比較を `!=` → `==` にする、`SaveConfig` の呼び出しを消す、のそれぞれでテストが落ちること | 手動（戻したら `git diff` で残りが無いこと） |
| `window_darwin_lifecycle_test.go`（`//go:build darwin`、CI の macOS だけ） | `setupMacWindowDelegate(` の呼び出しが 3 つの色の引数を渡すこと、`sykiSetBackdrop` の定義があること、`colorWithCalibratedRed` が**無い**こと（文字列の検査） | CI の macOS |

既存の `TestCBTHookDarkMode`（`shortcut_windows_test.go`、隠しの窓を作る）は触らない。`quickcapture_test.go` と `platform_bridge_parity_test.go`（bind を足さないので不変）が通ることを確かめる。

クロスチェック（この PC で）: `go vet .`、`GOOS=windows go vet ./...`（Windows 上では通常のビルド）、`powershell -File tools/crosscheck.ps1`（darwin/arm64 と darwin/amd64 の cgo なしの型検査と `go test -c`）、`go build -o <scratchpad>\x.exe -ldflags "-H windowsgui" .`（worktree 直下に exe を作らない。契約 §1）。**Obj-C は push して CI の macOS ジョブで**。`go test ./... -count=1`（**実機に副作用を出さない**。`app_meeting_test.go` の時間依存の既知の不安定は単独で通るか見る）。

### 2.6 実機での確かめ方（隔離した実アプリ。ふだんの syki.exe を止めない）

**2 つの段階を別々に見る**。どちらも、数字（画素の値）で。

| 段階 | 何が見えるか | 方法 |
| --- | --- | --- |
| (a) 窓はあるが WebView2 がまだ | クラスのブラシ（N2/N4）とタイトルバー（N3） | 隔離した exe を起動し、PowerShell の `Add-Type`（C#）で、**起動直後から 5 ms 間隔で 600 ms**、窓の矩形を `PrintWindow(PW_RENDERFULLCONTENT)` か `Graphics.CopyFromScreen` で撮り、中心と左上の 4px 四方の色を記録。窓が出てから WebView2 が覆うまでの区間の色が、墨 `#0e0f17`・紙 `#fbfbf9` であること |
| (b) WebView2 はあるがページが描かれる前 | `PutDefaultBackgroundColor` と環境変数（N1/N5） | **オーバーレイで HTTP ハンドラの `/` を 3 秒遅らせる**（`make_overlay.py` と同じ要領の 1 つの置換）。起動の 1.5 秒後に窓を撮り、クライアント領域の中心の画素を読む。変更前は `(30,30,30)` で、変更後は 墨 `(14,15,23)`、紙 `(251,251,249)` |
| (c) 実行中の追従 | `SaveConfig` → `setNativeLook` | CDP で設定画面の「外観」から地を紙にして保存（保存前は変わらず、保存後に変わる）。`DwmGetWindowAttribute(hwnd, 20)` を PowerShell から読んで 1 → 0、タイトルバーの色を画面（`computer-use` のスクリーンショットか `CopyFromScreen`）で。墨に戻して逆も。**設定画面の「キャンセル」では変わらない**こと |
| (d) 起動時 | `startupNativeLook` | `config.json` に `appearance.look: "paper"` を書いた隔離した設定で起動し、(a)(b) を紙で。`syki_look` の印が**無い**プロファイルでも、窓の下地は紙であること（ページが墨で一瞬描かれる穴は A7、§2.2 のとおり既知） |
| (e) 起動の費用 | 起動に遅れが出ていない | `v2_perf.mjs`（§7）で、A の前後の exe を交互に 16 回。差が 5 ms 未満 |

目で見る確認も 1 回: 紙で起動して、タイトルバーが明るく、最初の 1 フレームが暗くないこと（`computer-use` のスクリーンショットで足りる速さではないので、(a)(b) の数字が主）。Windows 10 の実機が無ければ「Windows 10 は未確認（`DWMWA_USE_IMMERSIVE_DARK_MODE` の 19 は古い 10 用に残した）」と書く。

### 2.7 やらないこと

Quick Capture と画面キャプチャの枠の色を見た目に従わせる。Windows 11 のタイトルバーの色（`DWMWA_CAPTION_COLOR`）を地に合わせる（シームレスに見えるが、Win10 に無く、設定の費用が増える。**推奨: しない**）。Mac の `NSAppearance`（タイトルバーとボタンを見た目で固定）。設定画面のプレビュー中のネイティブの追従。`quickCaptureAlpha` や角の丸みの見直し。

---

## 3. 作業束 B: 強制色・動きを減らす・コントラスト・a11y

### 3.1 今あるもの（確認済み）

| 項目 | 実装 | 状態 |
| --- | --- | --- |
| 強制色: バー | `chrome.css:280-296`: `--bar-a: 1`、`backdrop-filter: none`、`#header` の下と `#status-bar` の上に 1px の `currentColor` の線。`prefers-reduced-transparency: reduce` も同じ塊（古いエンジンでは塊ごと読み飛ばされる） | CDP で確認済み（P2a・P2b） |
| 強制色: タブの帯 | `style.css:434-454`: 塗りを描かず、枠線（`CanvasText`）、選択中は 2px の `Highlight`、未保存・競合の印は `ButtonText`、焦点は `Highlight` | CDP で確認済み（P3a・P3b） |
| 強制色: 分割・紙 | `style.css:1243-1277`: 仕切りは線、紙は 1px の枠、フォーカスのあるページは `Highlight`、右ページの帯は枠 | CDP で確認済み（P4a） |
| 動きを減らす | `style.css` の全体規則（`*, *::before, *::after` の `animation-duration: 0.01ms !important`、`transition-duration: 0s !important`、`scroll-behavior: auto !important`）+ 個別 5 か所（状態バーの AI・設定のスイッチ・教訓カード・録音の点・タブの `--tab-open-delay: 0ms`）+ `panel_fade.js` の `matchMedia`。`scrollIntoView` に `behavior: 'smooth'` の指定は**無い** | 規則は十分に見える。実機の動きは未確認 |
| a11y の構造 | タブ: `role="tablist" aria-orientation="vertical"`（左右）、仕切り: `role="separator"` と `aria-valuenow`、`F6` の巡回（本文 → ヘッダー → 左の帯 → 右の帯 → 仕切り → フッター）、バーは `opacity: 0; pointer-events: none` で隠すので**読み上げと Tab の順からは外れず**、`:focus-within` で出る。`#stat-message` は Zen で見えなくしても `aria-live` に残る。失敗と録音中は Zen でも出す | 単体テスト・smoke 済み。**実際の画面読み上げは未確認** |
| コントラスト | `tests/look_contrast_test.mjs`: 63 の組 × 墨・紙 × 5 つのアクセント、自分で選ぶ色。最悪値は `v2-tokens.md` の 6.5（墨の補助の文字 3.77:1 は入力欄の上の 3:1 基準で通る、`--accent-hover` の線は 3.33:1 で 3:1 基準） | 計算では済み。**画面の目視は P5 の付箋の分が未** |

### 3.2 足りない・確かめていないもの（仮説。CDP で確認する）

強制色では、背景色・影・グラデーションが描かれず、`color` と `border-color` と `outline-color` と SVG の `fill`/`stroke` はシステムの色に置き換わる。**v2 は「枠ではなく色の差と影」で面を分けた**ので、枠線の無い面が消える。次の表は**見つかるはずの不具合の仮説**で、B2 の監査で 1 つずつ確かめる（外れていたら削る）。

| 面 | 仮説 | 直し方の候補（`chrome.css` に新しい節。契約 §1.5 の構文だけ） |
| --- | --- | --- |
| 付箋のパネル（P5 の 6 種、`.inline-prompt-bar`・`.quick-pick-modal`・`.jev-action-panel`）、`.modal-card`（設定・about・パック・確認など）、コンテキストメニュー、ヘルプ、`.tab-list-panel`、`.status-ai-pop`、`.running-tasks-panel` | 面を影と紙の色で分けていて、枠が無いものは境が消える | `@media (forced-colors: active) { … { border: 1px solid CanvasText; box-shadow: none; } }`。粘着帯・折り目は描かない（飾り） |
| スイッチ（設定の `input[type=checkbox]` の見た目、状態バーの AI のスイッチ） | 軌道と丸が背景色だけで、オン・オフが同じ色になる | `forced-color-adjust: none` + `Highlight`/`ButtonText` の指定、または枠と丸の位置で区別 |
| アクセントの色見本（外観の 5 つ + 自分で指定） | 色そのものが内容なのに、`Canvas` に置き換わって区別できない | 見本だけ `forced-color-adjust: none`（許可リストの 1 行） |
| 状態バーのチップ（`.clickable-badge` の `::before` のピル）、ヘッダーのアイコンのボタン | `border: none` のボタンは強制色で枠が出ず、ボタンに見えない | `border: 1px solid ButtonText` |
| 検索の一致（`.find-match-rect`）、結果ブロックの帯（`.result-accent`、行番号の左端 3px）、ghost-diff の帯、選択範囲 | 背景色の重ねなので消える | 一致は `outline`、帯は `border-left` を `Highlight`/`LinkText` |
| ゴースト（予測の薄い文字） | 文字色が `CanvasText` に統一され、本物の文字に見える | `color: GrayText` |
| カーソルのオーラ（`#cursor-aura`、`mix-blend-mode`） | 飾り。残ると文字の読みを妨げうる | `display: none` |
| Mermaid の図（インラインの SVG） | 図の色が置き換わり、線と文字が同じ色になる | 図のカードに `forced-color-adjust: none`（カードは白か暗い自前の地） |
| 行番号（`rgb(var(--text-muted-rgb) / var(--linenum-a))` の薄い文字） | 色のアルファは強制色で無視され `CanvasText` の全濃度になり、本文と同じ濃さになる | そのままでよい（読めることが優先）。Zen の 0.3 のフェードも同じ |
| ノドのドット・影、紙の影、机と紙の色の差 | 描かれない | 規則が済み（P4a）。**机の上で紙が見える**か目で確認 |

`prefers-contrast: more`（Windows の設定でも、Mac の「コントラストを上げる」でも立つ）の規則は**無い**。任意の B5（§3.5）で、文字の補助色・罫線 `--hair`・タブの下限 20% を引き上げる小さな塊を足せる（実行時の費用は 0）。**推奨: 足す**（10 行ほど、`@media (prefers-contrast: more)`。Safari 14.1+）。

### 3.3 検証の分担: CDP のエミュレーションでできること、実機でしかできないこと

| 条件 | CDP（`Emulation.setEmulatedMedia`、隔離した実アプリと docshots のどちらでも） | 実機でしか分からない |
| --- | --- | --- |
| `forced-colors: active` | Chromium は強制色の描画も適用する（既定のシステム色の組。P4a が 4 つの表示を同じ方法で撮り、黒地・白枠・`Highlight` の水色の線・矢印つきのスクロールバーになることを確認済み）。**面の消え・枠・Highlight の使い方・SVG・ボタンの境**はこれで足りる | **本物のハイコントラストテーマ**（Aquatic、Desert、Dusk、Night sky）の色の組。OS の切り替えをアプリが実行中に受けるか（WebView2）。ネイティブのタイトルバー・スクロールバー |
| `prefers-reduced-motion: reduce` / `no-preference` | 両方。**アニメーションの有無で状態が違う**ものは必ず両方（perf ハーネスは `--motion no-preference`） | OS の「視覚効果」をオンにした素の動き（開発 PC は `reduce`） |
| `prefers-contrast: more`、`prefers-color-scheme: light/dark`、`prefers-reduced-transparency: reduce` | エンジンが認識すれば。**WebView2 154 が `prefers-reduced-transparency` を認識するか**は B0 で `matchMedia('(prefers-reduced-transparency: reduce)').media` を印字して確かめる（認識しなければ「効くかは実機で」と書く） | Mac の「透明度を下げる」「コントラストを上げる」 |
| 配色・コントラスト | 計算（63 の組）と、墨・紙・5 アクセントの画面（docshots の `--look`、`--accent`） | 画面の見え方、ClearType の文字の鮮明さ（`filter` を使わない設計だが目では見ていない） |
| キーボード | CDP の実キー（`F6`、`Tab`、矢印、`Esc`、日本語入力以外） | **実際の IME**（変換の開始でバーが消える。`compositionstart`）、画面読み上げ |
| 画面の読み上げ | アクセシビリティツリー（`Accessibility.getFullAXTree`）の中身 | NVDA / Narrator / VoiceOver の読み上げ |
| ズーム・文字の拡大 | エディタの文字サイズの最大、窓幅 600px（`@media (max-width: 900px)` の規則） | OS の拡大率 125〜200%（高 DPI のタブの 6px・当たり判定） |

### 3.4 チェックリスト（機械で・オーナーが）

**機械（私が、B で）**

- [ ] B0: 埋め込みの WebView2 が `forced-colors`・`prefers-contrast`・`prefers-reduced-transparency`・`prefers-reduced-motion` を認識するか（`matchMedia(...).media`）。CDP の特徴の名前で通ること
- [ ] 全 70 の状態 × {強制色、動き減、紙+強制色、墨} の画面を撮り（§3.5 B1）、**目で**: ①面の境が見える ②ボタンがボタンに見える ③選択中・フォーカス・一致・オン/オフが区別できる ④文字が読める ⑤飾りが邪魔をしない
- [ ] コントラスト: P5 の付箋（本文・粘着帯のフォーカス・折り目）、紙のタブの下限と印、行番号 55〜70%、紙の補助の文字を、**墨・紙・5 アクセント**で。足りない組は `look_contrast_test.mjs` に追加（ミューテーション確認つき）
- [ ] キーボードだけで一周: `F6`（本文 → ヘッダー → 左の帯 → 右の帯 → 仕切り → フッター）、帯のロービング `tabindex`、パネルを開いて `Esc`、設定の全タブ。バーが隠れていても `:focus-within` で出る
- [ ] 動きを減らす: フェードも展開も即時になり、**機能は残る**（バーは出入りする、帯は開く、パネルは開閉する）。`--tab-open-delay: 0` で、ポインタが通り過ぎるだけで帯が開いてチカチカしないか
- [ ] `docs/testing/sessions` の憲章 **C3**（パネル）・**C5**（分割とプレビュー）・**C13**（キーボードと a11y）・**C14**（日英）・**C4**（8 万行）を v2 に対して**1 周**（既存のセッションの書式で、日付を 2026-10 にして）

**オーナーの実機（Windows、約 30 分）**

- [ ] 設定 → アクセシビリティ → コントラストテーマで **Aquatic、Desert、Dusk、Night sky** の 4 つを順に適用（`Alt + 左 Shift + PrtScn` で切り替え）。各テーマで: 本文が読める、ヘッダーとステータスバーの境に線が見える、左の帯のタブが区別できる（選択中は太い枠）、設定を開いて境が見える、スイッチのオン/オフが分かる、検索の一致が分かる。終わったら元のテーマに戻す
- [ ] 設定 → アクセシビリティ → 視覚効果の「アニメーション効果」を**オン**にして（今は `reduce`）、バーのフェード、帯の展開、パネルが動くか。**ちらつき・引っかかり・消え残りが無い**か。終わったら元に戻す
- [ ] Narrator（`Win + Ctrl + Enter`）か NVDA で 5 分: `F6` で移動するたびに場所が読まれる、タブの帯が一覧として読まれる、「保存しました」などの状態が、バーが消えている間も読まれる、仕切りに値（パーセント）が付く
- [ ] 日本語入力: 変換を始めた瞬間にヘッダーとフッターが消える、確定しても勝手に戻らない、マウスを数 px 動かすと戻る。候補ウィンドウがバーに隠れない
- [ ] 窓の角: Windows 11 では OS が下の角も丸める。**紙・墨のどちらでも、角に別の色の隙間が出ない**（A の下地が地と同じ色なので出ないはず）。Windows 10 は直角
- [ ] 拡大率 125%・150%・200% で、タブの帯（6px）とバーが崩れない

### 3.5 手順（B。各手順のあとアプリが動く）

| 手順 | 内容 | 触るファイル |
| --- | --- | --- |
| B0 | 認識する特徴の確認（上）。**製品の変更なし** | scratchpad |
| B1 | **docshots に `--media`**（例: `--media forced-colors:active,prefers-reduced-motion:reduce`、`Emulation.setEmulatedMedia` を各状態の読み込みの直後に 1 回）。小さな連絡用シート作成（`tools/docshots/contact_sheet.py`、Pillow、n 枚を 1 枚に並べる）。出力は `--out`（scratchpad）。**コミットする画像は無い**。+15 行ほど | `tools/docshots/run.mjs`、新規 `contact_sheet.py`、`README.md` |
| B2 | 監査（目）。不具合の一覧を作る（面、条件、画像、直し方）。**P5 が済んだあと**（付箋が最も数が多い） | — |
| B3 | 直す（`chrome.css` の末尾に「強制色」の節。`style.css` は触らない。許可の `forced-color-adjust: none` は理由つきの短い一覧）。**新しいテスト** `tests/forced_colors_test.mjs`: B2 の面ごとに `@media (forced-colors: active)` の規則があること、`forced-color-adjust: none` の使用が許可リストの外に無いこと、システム色以外の色の直書きが無いこと（`css_tokens_test` と同じ流儀）。ミューテーション 5 件 | `frontend/css/chrome.css`、`tests/forced_colors_test.mjs` |
| B4 | 動きを減らす: B3 の新しいアニメーションと遷移を、全体規則か個別の規則が覆うこと（`@keyframes` と `transition` の一覧をテストが数え、P5 の付箋の降りる動きを含む）。**JS で動かすもの**（`panel_fade.js`、`ChromeOverlay` のタイマー）が `matchMedia` を見ること、見ないものは「CSS の遷移が即時になる」で足りること、をテストの注釈に | `tests/reduced_motion_test.mjs` |
| B5（推奨） | `@media (prefers-contrast: more)`（`--text-muted` を主な面で 7:1 へ、`--hair` を濃く、タブの下限 20% → 40%）と、コントラストの組の追加 | `tokens.css`、`chrome.css`、`tests/look_contrast_test.mjs` |
| B6 | 再撮影（§5）の前に、B3〜B5 を**墨・紙の両方**で目視し、`node tools/run_js_tests.mjs` と smoke（英日）を通す | — |

---

## 4. 作業束 C: Mac

### 4.1 CI が確かめられること・できないこと

| CI の macOS ジョブ（`macos-latest`）で**確かめられる** | **確かめられない**（実機だけ） |
| --- | --- |
| `go build ./...`（Obj-C と cgo のコンパイル。**A4 の変更の唯一の検証**） | 見た目の全部（WKWebView の描画: 紙と墨、バーの半透明、`-webkit-backdrop-filter` のすりガラス、ノドのドットの `-webkit-mask-image`、付箋の `clip-path`） |
| `go test ./...`（`window_darwin_lifecycle_test.go` など `//go:build darwin` の文字列検査を含む） | 起動時の最初のフレームの色、タイトルバーと窓の背景の調和 |
| `build_mac.sh` → universal の `.app`、`plutil -lint`、`lipo -archs`、**`--version` と `--help` の起動検査**（フレームワークが読めて、窓を作る前に返る） | 入力（日本語 IME、`F6` に `Fn`、`⌘` のキー）、ホバー（帯の展開）、スクロールバー（オーバーレイ式）、Retina の文字 |
| JS 全件（`node tools/run_js_tests.mjs`、WebKit 側のコードは同じファイル） | 8 万行の性能（Mac では未測定） |
| 署名の検査（ad-hoc。失敗は注釈だけ） | ⌘Q・Dock・Finder から開く・グローバルショートカットの動き（`tools/MACOS_CHECKLIST_JA.md` の 1〜5） |

さらに、ジョブは `syki-macos-<sha>`（`.app` の zip）を 14 日保存するので、**タグを打つ前に、リリースと同じ作り方の `.app` を実機で試せる**（`gh run download <run-id> -n syki-macos-<sha>`、または Actions の画面。初回は `xattr -dr com.apple.quarantine syki::sok.app`）。**rc のタグ・先行リリースは作らない**（`release.yml` が先行リリースを区別せず、`build_mac.sh` は版を `app.go` から読み、更新確認は `releases/latest` を見るので、手間が増えるだけ）。

### 4.2 Safari 15.6 の構文の見張りの現状

| 対象 | 見張り | 現状 |
| --- | --- | --- |
| CSS・`index.html` のスタイル・JS のスタイル文字列 | `tests/css_compat_test.mjs`: `color-mix(`、`@container`・`container-type`・`cq*` の単位、CSS ネスト、`scrollbar-gutter`、新しい `:has(`（基準の数を超える使用）。ミューテーションつき。`chrome_overlay_wiring_test`・`split_view_style_test`・`tab_index_wiring_test`・`chrome_bars_zen_test` が自分の CSS の使う機能を個別に | **緑**。P5 の CSS も同じテストで止まる |
| JS の構文・API | **無い** | 走査（`frontend/js/*.js`、テストを除く）: 後読み `(?<=`・`(?<!`、`static {`、`.at(`、`Object.hasOwn`、`.toSorted(`・`.toReversed(`、`Array.fromAsync`、`AbortSignal.timeout/any`、`requestIdleCallback`（Safari に無い）、`crypto.randomUUID`、`replaceChildren`、`findLast`、`structuredClone`、`content-visibility`、`dvh`、`startViewTransition` ほか 24 項目で、**未保護の使用は 0 件**。`checkVisibility`（`a11y.js:73`）と `Intl.Segmenter`（`note_title.js:151`）は `typeof` で保護済み |
| 新しい見張り（C2、推奨） | `tests/js_compat_test.mjs`: 上の項目の正規表現（コメント・文字列を除く）。保護の許可リスト（`typeof x === 'function'` が直前にある）つき。ミューテーションで落ちること | — |

### 4.3 `window_darwin.go` の見た目に依存する部分

A4 のとおり、窓の背景と下地の 2 か所だけ。**Mac のタイトルバー・ボタン・メニューは OS の外観に従う**（`NSAppearance` は設定しない。OS がダークで見た目が紙、OS がライトで見た目が墨、の組み合わせは「OS の枠が逆」になるが、ネイティブの感触を優先する。§10 O7）。`underPageBackgroundColor` は macOS 12 以上だけなので、**10.15・11 では WKWebView の白い下地が最初のフレームに残る**（墨の人にだけ見える。今も同じ。直すなら `drawsBackground` の KVC だが、`-fobjc-exceptions` が要り cgo で使えないと既存のコメントにある。**既知として書く**）。`sykiPrintWebView`（印刷）は見た目に依存しないが、紙の見た目でプレビューを印刷して**白紙にならない**ことを実機で 1 回確かめる（`print.css` は紙のまま）。

### 4.4 オーナーの実機チェックリスト（Mac、凝縮版。現行の macOS と 10.15 の両方）

`tools/MACOS_CHECKLIST_JA.md` の 0〜9 章（**P5 が 10 章を足す**）を、**実行できる順**に凝縮する。**ブロック M1〜M3（約 20 分）が出荷の条件、M4 以降は結果を未確認として書いてよい**。各項目は「やること → 成功のしるし」。

**準備（5 分）**: CI の `syki-macos-<sha>` をダウンロードし、`xattr -dr com.apple.quarantine syki::sok.app`、`syki::sok.app` を開く（macOS 15 以降は システム設定 → プライバシーとセキュリティ →「このまま開く」）。ふだんの設定と混ざらないよう、**別のユーザー**か、`~/Library/Application Support/syki-sok` を退避してから。終わったら戻す。macOS のバージョンを控える（10.15 の機械が無ければ、その旨を結果に書く）。

**M1 起動と窓（5 分）**: ① 起動して**白いフラッシュが出ない**（墨: 暗い地のまま。**macOS 10.15・11 は白が一瞬出る可能性があり既知**）② 窓が出て、黄・緑のボタンが有効、リサイズできる ③ `⌘M` で Dock、アイコンで戻る ④ 赤ボタン → Dock から復帰、⌘Q で完全に終了（`lsof -i :41739` が空）⑤ **設定 → 外観で「紙」を選んで保存 → 窓の背景が追従**（A4 の `sykiSetBackdrop`）、終了して再起動 → **起動の最初から紙の色で出る**（暗い色を経由しない。A4 の起動時）。墨に戻す。

**M2 見た目の基本（10 分）**: ① 長いノートを開く: 左端に 6px の色の帯、ポインタを置いて約 0.12 秒で 200px に広がり名前が読める。本文は動かない（`F6` でも広がる、Fn が要る場合は設定のショートカットで別のキーに）② ヘッダーとステータスバーが本文の上に重なる。**打つと消え、ホイールで消え、マウスを動かすと戻る**。日本語入力で変換を始めた瞬間に消える ③ スクロールの一番下まで行って**最後の行がフッターの上に出る**、↓ を押し続けて**キャレットの行がバーに隠れない** ④ 設定 → 外観: 地（墨・紙）、アクセント 6 つ、バーの透過（**すりガラスで `-webkit-backdrop-filter` が効く**か。効かなければ「うすい」と同じ＝壊れてはいない）、自動非表示のオフ、ページの間の仕切り 3 種、エディタのフォント — **保存前に反映・取り消しで戻る・保存して再起動で残る** ⑤ `⌘\` で左右 2 ページ: ノドのドットが両端へ薄れて**四角い帯に見えない**（`-webkit-mask-image`）、仕切りのドラッグ・`F6` から矢印・`Enter`。`⌘⌥V` でプレビュー: 紙が机の上に浮き、上下いっぱい

**M3 パネルと表示（5 分）**（P5 の付箋）: ① `⌘L`・`⌘K`・`⌘J`・`⌘E`・`⌘⇧P`・`⌘⇧F` のパネルが**付箋として読める**（粘着帯・折り目・影。`clip-path` で折り目が切れていても影が欠けていない）② フォーカスが入ると粘着帯がアクセントの塗りになる ③ `Esc` で閉じる（フェード）④ 設定画面は素の紙 ⑤ Zen（`⌃⌘Z`）: 余白は残り、バーはマウスでは戻らず、窓の**最上端か最下端に 150ms** 止めると戻る（**Mac の最上端はメニューバーの下**: そこまで持っていけるか。全画面のときのメニューバーの自動表示と喧嘩しないか）

**M4 外観の周辺（10 分、未確認として書いてよい）**: ① システム設定 → アクセシビリティ → ディスプレイ: **「コントラストを上げる」と「透明度を下げる」**をオン → バーが不透明になり、すりガラスが付かない（Safari 15.6 に `prefers-reduced-transparency` は無い。**効かなくても壊れてはいない**）。「視差効果を減らす」でフェードの扱い ② 画面の読み上げ（VoiceOver）: バーが消えている間も「保存しました」が読まれる ③ ステータスバーの Git・AI・文字コードのチップの凹みが**影の強すぎない**表現で見える ④ Retina の文字が滲まない（`filter` を使っていない）⑤ 8 万行のノート（`tools/perf/gen_note.mjs --out note.md` で作る）を開く・スクロールしてもたつかない（Mac の数字は未測定。**体感で**）

**M5 既存の 1〜9 章の要点（15 分、未確認として書いてよい）**: 起動の前面化、`echo hi | syki` の追記と前面化、Finder の「このアプリケーションで開く」、`⌥⌘M` のグローバル召喚、`⌘Z`・`⇧⌘Z`、`⌃A`/`⌃E`、`⌃⌘F` のフルスクリーン、設定のバージョン表示、印刷（`PDF ▾`→ PDF として保存。**紙の見た目でも白紙でない**）。詳細は `tools/MACOS_CHECKLIST_JA.md` の該当章。

**結果の返し方**: 各ブロックについて、「OS のバージョン／通った項目の番号／変だった項目の番号と画面写真」。変だったものは、**出荷を止めるか（M1〜M3）、リリースノートの『未確認』に書くか**（M4 以降）を私が決める。

---

## 5. 作業束 D: 文書と図

### 5.1 文書の在庫（v2 の見た目で変わる記述）

状態: ○ = P2〜P4 で書き込み済み、△ = 一部、× = 未着手、P5 = P5 の担当が書く（P6 が確認）。

| 文書 | 変える内容 | 状態 |
| --- | --- | --- |
| `manual.html` / `manual_ja.html`（英日、同じ id・同じ図の数。`python tools/check_manual.py` が見る） | **`ui-tour`**: 窓の各部の説明（凡例の番号）、タブの帯（○）、**バーが本文の上に浮いて、打つと消えマウスで戻る（×）**、行番号が余白に薄く（×）、Zen（○）、短いツールバー（○）、**日本語入力で出し入れ（×）** | △ |
| 同 | **`status-bar`**: 凡例・表（Git・IME・文字コードのチップの見た目、ステータスバーの図） | △（図のみ撮り直し） |
| 同 | **`editor-split`**: ノド（○）、仕切りのキーボード（○）、**`split-editor` の図を置く（×、凡例 4 つ）**、見開きプレビュー（紙が浮く、×）、プレビューのみ（×）、右ページの帯（×） | △ |
| 同 | **`cfg-general`**: 「テーマ色」の 1 行を、**外観の節**（地: 墨・紙、アクセント 5 + 自分で指定、バーの透過 3 種、自動非表示、ページの間の仕切り 3 種、エディタのフォント、Mermaid の配色 `auto`）に書き直す。図 `settings-general` の凡例 | × |
| 同 | **`ai-prompt`・`ghost-text`・`slot-agent`・`jev-action`・`command-palette`・`parallel-grep`・`about-syki` ほか、パネルを出す章**: 図の撮り直し（付箋）。文言は位置・幅・Esc は不変なので少ない（P5 が確認） | P5 |
| 同 | **`cfg-shortcuts`**: `F6`（○）、「前のタブ」の `Ctrl+Shift+Tab` の修正（要確認）、Mac では `Fn` | △ |
| 同 | **用語集（`glossary`）**: 墨・紙（ink / paper）、ノド（gutter）、索引の帯（tab strip）、机（desk）、付箋 | × |
| 同 | **版**: バッジ・例・フッター（§6.1）。`json-rpc` の `app.info` の例の `"version"` | E で |
| `docs/features.md` / `features_ja.md` | 「タブは場所を取らない」「2 つのページと仕切り」（○）。**追加**: 見た目（墨・紙・アクセント）、バーの自動非表示、Zen の新しい意味（○ 表に 1 行）、付箋のパネル（P5）、行番号の余白化。末尾の「Windows と macOS で何が動くか」の表に、**見た目の行**（紙・すりガラス・ノドのドット・タイトルバーの追従: Windows 済み／Mac 未確認）。画像: `screen_diagram.png` ほか 6 枚が古い（§5.2） | △ |
| `README.md` / `README_JA.md` | 1 行足す（「紙か墨か、端の細いタブ、書くと消えるバー」）。GIF（11 本）が新しい見た目になる。**短いまま** | × |
| `index.html` / `index_ja.html`（ルートのランディング。**`frontend/index.html` ではない**。独自の暗い・明るい切り替えを持つ別のデザイン） | **ショーケースの画像 `img/screen_diagram.png`・`screen_cli_filter.png`・`screen_scraps_search.png`・`setting.png`・`screen_settings_agent.png` ほか**（`data-img` と `og:image`）。説明文: 「General, themes (Dark Olive / Forest Teal), and editor behavior」→ 外観・紙と墨。カード（Customizable Toolbar、Related Notes in the Status Bar）は不変。**ページ自体の配色は変えない**（推奨） | × |
| `skills/syki/`（LF） | `SKILL.md`、`references/interfaces.md`（4.7 状態バー、4.11 の帯（○）、`ui.state`、設定 `appearance`）、`setup-guide.md`（(b) `appearance` の行 ○、(e) 前提と確認）、`troubleshooting.md`（「タブバーが無い」○。**追加**: 「バーが消える」「紙にしたのにタイトルバーが暗い」「強制色で境が出ない」）。**版**（§6.1）。`go test -run "Skill" .` と `go test -run "Help" .` | △ |
| `docs/design/` | `v2-visual-2026-10.md`（§4.2 のキーボード（○）、§4.1 の下の角 11px を**直す**（F12）、§7 に P6 の結果）、`v2-tokens.md` 6.7（Go の色: 済みに、`forced-colors`、Mac）、`v2-implementation-contract.md`（§12 P6 を足す）、`panel-template.md`（P5）、`settings-dialog.md` は**記録なので直さない**（先頭の注釈 1 行だけ: 「v2 で面は紙になった」）、`ux-review-2026-09.md` も記録 | △ |
| `tools/MACOS_CHECKLIST_JA.md` | §4.4 の凝縮版を先頭に足す（0〜9 章は残す）。10 章は P5、11 章は P6（見た目とネイティブの色、A4） | × |
| `tools/docshots/README.md` | `--media`（B1）、紙の撮り方、GIF | △ |
| `packaging/README.md`、`packaging/homebrew/syki.rb` | リリース後（§6.5） | E で |

### 5.2 図のパイプラインと数

| 種類 | 数 | 作り方 | v2 で |
| --- | --- | --- | --- |
| マニュアルの図（`img/manual/{en,ja}`） | **70 状態 × 2 = 140 + ネイティブ 2 × 2 = 4 → 144 枚**（今 142: `split-editor` が無い）。マニュアルが参照するのは 65 × 2 = **130 枚**。マニュアルに置いていない 7 状態（`status-ai-unset`、`status-bar-focus-blue`、`tabs-overflow-narrow`、`find-bar-match`、`risky-command-confirm`、`header-calm-narrow` は以前から。`split-editor` は新しい）も撮る（撮影の確認用・テストの題材。**置くかは D1 で決め、`split-editor` だけは置く**） | `node tools/docshots/run.mjs --lang both --method cdp --no-md`（約 130 秒/言語。全部で約 5 分。実行中は Edge の窓がデスクトップに開くので、その間は PC を使わない）。UWSCR の Windows Graphics Capture を使えば本物の窓の画素（`--method auto`）。`--no-md` は `shots.md` を作らない | **全部撮り直す**（色が変わった。墨の色が青みに、バーが重なり、パネルが付箋に） |
| ネイティブの図 2 つ（`quick-capture-popup.png`、`screen-capture-pick.png`、英日） | 4 | `tools/docshots/native/compose_native.py`（Win32 窓の描画から作る。`shots.json` の外） | **撮り直さない**（ネイティブの色を変えない、§2.1）。ただし、**背景に写る画面**（ノートの墨の色）が古いなら撮り直す（目視で決める） |
| ランディング・`features.md` 用の手作りの図 | 12 枚（`img/screen*.png`、`setting.png`。1120〜1140 × 720〜756） | 昔の `tools/capture_screens.uws`（**本物の exe を `ui eval` で操作する旧い道具**。パスが主ツリーの `syki.exe` を指す）。今は docshots のほうが再現でき、本物の窓に触れない | **docshots の図で置き換える**（推奨: `screen_diagram` ← `split-preview`、`screen_cli_filter` ← `cli-bar`、`screen_scraps_search` ← `scraps-search`、`setting` ← `settings-general`、`screen_settings_agent` ← `settings-agent`、`screen_settings_model` ← `settings-model`、`screen_settings_sync` ← `settings-sync`、`screen_palette` ← `command-palette`、`screen_prompt` ← `inline-ai`、`screen_split` ← `split-editor`、`screen_mobileQR` ← `mobile-drop-dialog`、`screen` ← `ui-map`）。同じ 1120×720 でマーカーは付けない版が要る（`size: full` のマーカー無し）。**旧い `capture_screens.uws` は使わない** |
| デモ GIF（`img/demo`、英語のみ。README が日英で共有） | **11 本**（860px 幅、24〜114 フレーム）。合計 1.6 MB | `node tools/docshots/gifs/record.mjs`（1 本あたり約 30〜40 秒、全部で約 7 分）。確認は `--preview <dir>` | **全部撮り直す**（色と、**バーが打つと消える**新しい動き）。シナリオが依存する id（`#tabs-list .tab-item`、`#stat-message`、`#stat-recording`）は残っている |

### 5.3 どの見た目を見せるか（推奨）

- **マニュアルの図は墨（`--look ink`、アクセントは Dark Olive）で全部**。理由: ①新規のユーザーが最初に見るのが墨（既定）なので、手順と図が食い違わない ②今の図もすべて暗い ③P1b の「墨 = 今の見た目の引き継ぎ」の決定と一致 ④二つの見た目で全図を持つと、撮り直しと目視が 2 倍で、文書の更新のたびに 2 倍の費用が続く。
- **紙は 5 枚前後だけ追加**（`shots.json` に `boot: { "look": "paper" }` の状態として。コードの変更なしで足せる）: `ui-map` の紙（`ui-map-paper`）、`split-editor` の紙、`split-preview` の紙（机と紙の見え方）、`settings-general` の外観の節（紙を選んだ状態）、`inline-ai` の紙（付箋）。マニュアルの外観の節と `features.md`・ランディングが使う。
- **GIF は墨**（既定。README は日英で同じ画像）。ランディングの hero は、白い紙のほうが「紙・本・付箋」の世界観に合うが、**同じ画像を別の見た目で持つ判断は後でよい**（O4）。
- ランディング `index.html` のページ自体の見た目は変えない。

### 5.4 壊れた・動いた図と、確認の手順

静的な確認（済み）: マーカーの `selector` はすべて現行の `frontend` に実在する（F14）。マーカーか切り抜きがヘッダー・状態バー・タブ・仕切り・行番号・ペインを名指しする状態は **12**（`ui-map`、`status-bar`、`status-ai-unset`、`status-bar-focus-blue`、`welcome-note`、`split-preview`、`split-editor`、`tabs-overflow`、`tabs-overflow-narrow`、`tabs-all-list`、`header-calm`、`header-calm-narrow`）。うち `ui-map`・`welcome-note`・`tabs-*`・`split-*` は P2〜P4 で位置を直してある（帯は右側に番号を置く、`#tabs-list` を指す、など）。**`status-bar` 系 3 つと `header-calm` 系 2 つは P2 のオーバーレイ化のあとで再確認が要る**。**幾何の変化で壊れうるもの**（P2a が「切り抜きにヘッダーの帯が入る」と書いたものと、P2〜P4 の記述）は、撮ったあとに**1 枚ずつ目で**見るしかない。確認の観点:

1. **半透明のバーの下の文字が透ける**（`bars: light` は 86%。`split-preview` の上部で、ヘッダーの下に本文の一行がうっすら見えた）。切り抜きの 5 図（`status-bar`、`status-ai-popover`、`status-ai-unset`、`status-bar-focus-blue`、`voice-indicator`）は、バーの背後の文字が写るので、**見苦しければ `solid` で撮る**（`data/demo.mjs` に `?bars=` を 1 つ足せば、状態ごとの上書き `boot.bars` で済む。数行）。**既定の見た目をそのまま見せるのが原則**で、見苦しいものだけ。
2. **マーカーの重なり**: `ui-map` の番号 4（`#stat-chars`）は文字の上に被る位置（P4a の `ui-map.png` で確認）。`at`・`dx`・`dy` を直す。
3. **JS で切り抜く 6 図**（`ghost-text`、`voice-recording`、`voice-rescue`、`ghost-diff`、`file-link-drop`、`file-link-result`）: キャレットの行がヘッダー・フッターに隠れていないか（`scroll-padding` が効くのでおおむね良いはず）。
4. **狭い窓の 4 図**（800×600 の `tabs-overflow-narrow`、`header-calm-narrow`、スマホの 390×844 の 2 図）: 帯とバーが崩れていないか。
5. **付箋のパネル**（P5 の後）: 20 近い図で、パネルが窓の上端中央に出て文字が読めること。マーカーの位置。
6. **紙**: 紙の図の色（`--look paper`）で、アクセントのマーカー（`#e8743b`、朱の `#b8472c` と近い）が紛れないこと。
7. **実データの写り込み**が無いこと（モックなので原則ない）。1120×720 の寸法（`postprocess.py` が検査する）。
8. ファイルの大きさ（`img/manual` は 4.7 MB。`postprocess.py` が最適化する。**全図の差し替えで git の履歴が約 5 MB 増える**ことは受け入れる）。

撮り方（私が、E の前に）: ①`node tools/docshots/run.mjs --lang both --method cdp --no-md --look ink --out <scratch>/ink` ②紙の追加の図は `--only <名前> --look paper` ③**連絡用シート**（B1 の `contact_sheet.py`、9 枚/枚）で全体を見て、気になる図を原寸で見る（約 1 時間。`Read` で画像を開く）④直したものを再撮影 ⑤問題が無ければ `img/manual` に書き出す（`--out` なし）⑥ `python tools/check_manual.py`。

### 5.5 `docs/maintenance/after-a-big-change.md` を v2 に当てはめる

| 章 | v2 での扱い |
| --- | --- |
| 0 洗い出し | v2 で増えたもの: 設定 `appearance`（look・accent・accentCustom・editorFont・bars・autoHide・splitBoundary）、ショートカット（`F6` の `focusChrome`）、新しい文字列（i18n 英日）、**RPC・CLI は増えていない**（`check_manual.py` は影響なし）、**外へ送るデータは増えていない**、Mac で未確認の部分は §4.4 |
| 1 コード（画面） | i18n 英日（P1b〜P4b 済み）、絵文字なし、ショートカットの衝突（`F6` を `DEFAULT_SHORTCUTS` と照合済みか再確認）、設定キー（`syncBackendConfig` の F7 の往復は P1b 済み）、**軽さ**（§7）、パネルの統一（P5）、**見える全モードで確かめる**（1 ページ・左右・見開きプレビュー・プレビューのみ・Zen・狭い窓。**P6 の smoke を 1 本足す: 4 つの表示 × 墨・紙で、バーとタブとパネルが出る**）|
| 2 コード（Go と Mac） | A: bind を足さない（パリティ不変）、cgo の darwin に nocgo のスタブ（A4）、`go vet` の 2 つのクロスチェック、push して CI の macOS（**タグの前に緑を待つ**） |
| 3 テスト | `go test ./... -count=1`、`go vet`、**JS 全件**、smoke 英日、ミューテーション確認、**CI で落ちるものを作らない**（一時フォルダの symlink・8.3 短縮名・Windows パス: 新しい Go のテストは `TestMain` の一時フォルダだけを使い、`frontendFS` を読む）、実アプリ（隔離。`go build -overlay`）、**テストに鍵の形の文字列を書かない** |
| 4 ドキュメント | §5.1 の表そのもの。英日、`check_manual.py`、docshots、README、ランディング、skills、`docs/design` |
| 5 版・リリース | §6 |
| 6 プラットフォーム | §4。Mac で動かないもの・未確認を、**表・マニュアル・ランディング・リリースノートの全部に同じ言い方で** |
| 7 終わったら | 試験用の exe・Ollama・ブラウザを止める、scratchpad 以外に残さない、ユーザーの本番の exe は起動中は上書きできない（**2.0.0 を入れるときは、ふだんの syki を終了してから**） |

### 5.6 手順と見積り（D）

| 手順 | 内容 | 時間（作業の目安） |
| --- | --- | --- |
| D1 | 文書の本文（§5.1 の × と △）。manual 英日の `cfg-general` の外観の節、`ui-tour`、`editor-split`、用語集、`features*.md`、README、ランディングの文言、skills | 4〜6 時間（英日で 2 倍） |
| D2 | コード凍結後に図を撮る（マニュアル 144 枚 + 紙 5 枚 + 手作りの 12 枚の置き換え）。機械の時間は約 10 分、**目視と直しが 2〜3 時間** | 3〜4 時間 |
| D3 | GIF 11 本（撮り直し + フレームの確認）。バーが消える動きが画面に入り、切り抜きの枠が崩れる場合はシナリオを直す | 2〜3 時間 |
| D4 | `check_manual.py`、`go test -run "Skill" .` と `go test -run "Help" .`、リンク切れ、`docs/maintenance` の再点検、`docs/design` の更新、図の差し替え後の `git diff --stat` | 1 時間 |

---

## 6. 作業束 E: 2.0.0 のリリースと main への取り込み

### 6.1 版を上げる場所（`reference_release_procedure.md` と、`grep -rn "1\.14\.0"` の実測）

| 場所 | 行 |
| --- | --- |
| `app.go` の `AppVersion` | :96 |
| `app_rpc_test.go` | :267-268（2 行） |
| `frontend/js/app.js` の `currentVersion` の既定値 | :15349 |
| `tests/update_checker_test.mjs`（既定値が現行版と一致するか見張る） | :27（文字列と失敗メッセージの 2 つ） |
| `manual.html` / `manual_ja.html` | バッジ :887、`app.info` の例 :4783 / :4961、フッター :5308 / :5508 |
| `skills/syki/SKILL.md`（`Version x`）、`references/interfaces.md`（Basis :3、例 `"appVersion"` :944）、`references/setup-guide.md`（Basis :3） | |
| **リリース後**: `packaging/homebrew/syki.rb`（`version` と `sha256`）、タップ `youshinh/homebrew-tap` の `Casks/syki.rb`（LF）、`packaging/README.md` の表、winget（§6.5） | |

**上げない**: 機能が入った版を示す履歴の言及（"from 1.10.0"、「1.13.0 より新しい版」）、`docs/design/*.md`、`frontend/index.html` の `?v=`（ファイルごとの独立した番号）、旧版の設定パッケージを表すダミー（`1.5.5`）。置換は**全文字列の置換でなく、現行版の文脈ごとの完全な部分文字列を、出現数 1 を assert して**（`reference_release_procedure.md` の教訓。`app.js` の履歴コメントと `1.13.0` の「より新しい」は残す）。機能のコミットと版更新のコミットは**分ける**。コミットは `&&` でつなぐ。**コミットに Claude の共同作成者の行を付けない**（オーナーの規則。過去のコミットは書き換えない）。

### 6.2 ユーザーにとって変わること（リリースノートの材料）

**これが「最初に目に入る」順**（ノートの最初の画面で、動いたものを書く）:

1. **タブが窓の左端の細い色の帯になった**（6px、ポインタを置くか `F6` で 200px に広がって名前が読める。2 ページなら左右それぞれ）。**上のタブの列は無い**。「+」と「すべてのタブ」は帯の足元。ピン留め・タブ名の変更・中クリックで閉じるは、もともと無く、足していない。
2. **ヘッダーとステータスバーが本文の上に浮き、書く・スクロールすると消え、マウスを動かすと戻る**（既定でオン。設定でオフにできる、`appearance.autoHide`）。透過は「うすい」が既定（本文がうっすら透ける）、「不透明」「すりガラス」も選べる。
3. **Zen（`Shift+F11`）の意味が変わった**: 余白は残り、バーはマウスで戻らず（窓の上端・下端に 150ms、または `F6`）、通常の通知は出ない（読み上げには残る）。**保存の失敗と録音中は Zen でも出る**。
4. **見た目が 2 つ**: 墨（既定、青みの暗い色）と**紙**（新しい、明るい）。アクセントは Dark Olive（既定）・Classic Blue・Forest Teal・Charcoal Monochrome・**朱（新）**・**自分で指定した色（新）**。設定 → 外観。**既存の人は、墨のまま、今のテーマ色のまま**（`general.theme` は引き継がれ、`appearance` は設定を開いて保存するまで書かれない）。
5. **左右 2 ページの真ん中はノド**（影とドット）で、**キーボードで動かせるようになった**（`F6` で届き、`←` `→`・`Home` `End`・`Enter`）。プレビューは**紙が机の上に浮く**（上下いっぱい、プレビューのみは中央 800px まで）。ページの間の見た目は設定で 3 種。
6. **`Ctrl+L`・`Ctrl+K`・`Ctrl+J`・`Ctrl+E` などのパネルは付箋**になった（位置・幅・`Esc` は同じ）。設定画面は素の紙。
7. **行番号が左の余白に薄く出る**（背景・縦線なし）。折り返した行は先頭の行にだけ番号。
8. **エディタのフォントを名前で選べる**（同梱しない）。
9. `F6`: 本文 → ヘッダー → 左の帯 → 右の帯 → 仕切り → フッター。`Ctrl+Shift+Tab` が「前のタブ」。
10. 変わっていないもの（安心のために書く）: 保存形式、セッション、**CLI・JSON-RPC・設定の形**、ショートカット（`F6` の追加と `Ctrl+Shift+Tab` の修正以外）、AI・検索・パイプ・エージェント。

**既知（以前からで、新しくない）**: 8 万行のノートをプレビューにすると重い（見開きで約 1.9 GB、プレビューのみで約 3.4 GB、切り替えに 3.5 秒 / 2.1 秒）。v2 はこれを**悪化させない**ことだけを約束した（§7）。

**ダウングレード**: 2.0.0 が書く `config.appearance` を、1.x は未知のキーとして次の保存で**落とす**（`config.semantic` と同じ性質）。アクセントは `general.theme` に書き戻してあるので残る。見た目の地（紙）と他の外観の設定は戻らない。セッションの形は同じ。

### 6.3 リリースノートの骨子（英日の 2 部。`### Added / Changed / Checked / Not verified`）

- **冒頭の 2 行**: 何が変わったかを、見た目の変更が主であること、機能は減っていないこと、**タブと上下のバーの動きが大きく変わること**で。「1.14.0 から N コミット」。
- **Added / Changed**: §6.2 の 1〜9。**Changed の最初に「タブの列が無くなった」**。
- **Checked**: Go のテスト（全パッケージ）、JS のテスト（134 ファイル）、smoke（62 本、英日）、ミューテーション確認の数、コントラストの計算（63 の組 × 墨・紙 × 5 アクセント）、**性能（§7 の数字: 起動・メモリ・8 万行の開く・スクロール・入力。基準との差）**、**隔離した実アプリの確認**（最初のフレームの画素、設定の往復、4 つの表示、強制色と動き減の CDP のエミュレーション）、CI の両 OS。
- **Not verified**（**正直に**。確認していないものは確認済みと書かない）:
  - **macOS**: 実機で動かしていない項目（M4 以降）。10.15 の実機が無ければ明記。すりガラス（`-webkit-backdrop-filter`）・ノドのドット・付箋の折り目・Zen の上端のホットゾーン・`F6` の `Fn`。**CI は Obj-C をコンパイルし、`.app` が起動することを確かめるだけ**。
  - **Windows の実際のハイコントラストテーマ**（CDP の強制色のエミュレーションで面の消えを確かめたが、本物のテーマの色は見ていない、または見たテーマを書く）。
  - **実際の IME 以外の IME**（日本語入力で変換開始時のバーの出し入れを確かめた IME を書く）、**画面読み上げ**（動かした読み上げを書く）、Windows 10 の窓の角とタイトルバー。
  - 見た目を変えたあとの**起動の最初の 1 フレーム**: Windows の墨と紙は確認、**`localStorage` の印が無い紙のプロファイルでは、ページが墨で一瞬描かれる**（既知）、Mac は未確認。
  - **8 万行のプレビューの重さは以前からのまま**。
  - タブの帯の当たり判定（12px）は、タッチやポインタの精度の低い環境で狙いにくい（`Ctrl+Tab`・一覧・展開後の行で同じ操作ができる）。
  - 既知の限界: `v2-visual-2026-10.md` の「下の角 11px」は、OS が丸めるため実装していない。
- タイトルは `v2.0.0` のまま、副題に「paper and ink」など（`gh release edit --title`）。

### 6.4 CI の期待

- **v2 ブランチを origin に push**（オーナーの了承が要る。**P5 が済んだらすぐ、P6 の前に**）→ ci.yml が両 OS で走る。ここで初めて v2 の JS 134 件が macOS・Windows の Node で通るかが分かる（v2 のテストの多くは `tests/lib` の共通部品を使う。パスの区切り・改行・時刻に依存していれば落ちる）。**早く落として直す**。
- 期待: Windows ジョブ（`go vet` は注釈だけで既知、`go build`、`go test`、darwin の cgo なしの `go vet` と `go test -c`、JS 全件、exe とCLIの検査）が緑、macOS ジョブ（`go build`、`go test`、`.app`、JS 全件、署名は注釈）が緑。`app_meeting_test.go` の時間依存の不安定は、落ちたら再実行して**原因を記録**（タグを打たない理由にはしない。ただし両 OS の緑を 1 回見る）。
- `static.yml` は main の push でしか走らない（ブランチの push では公開されない）。
- **CI に無いもの**（追加は今回しない。記録だけ）: smoke（Edge が要る）、`tools/perf`。`windows-latest` に Edge があるので、smoke を CI に載せるのは 2.0.x の改善候補。

### 6.5 packaging

| 対象 | 2.0.0 での扱い |
| --- | --- |
| Homebrew（`packaging/homebrew/syki.rb` とタップ） | リリースの zip の実物の sha256 で、`version` と `sha256` を更新。タップ `youshinh/homebrew-tap` の `Casks/syki.rb` に**同じ内容を LF で**（名義 `-c user.name=youshinh -c user.email=15696922+youshinh@users.noreply.github.com`）。忘れると `brew install` は古い版を入れる。`depends_on macos:` は付けない（既知） |
| winget | **PR #438694 は 1.12.0 のまま moderator 待ち**（F15）。2.0.0 で PR を差し替えると再検証の列の最後に戻る恐れがあるので、**触らない（推奨）**。マージされてから `wingetcreate update youshinh.syki --version 2.0.0 --urls <zip> --submit`（PR のタイトル `Update: youshinh.syki to 2.0.0`）。**CLA はオーナー本人が PR に `@microsoft-github-policy-service agree` とコメントする**（代行しない）。README・マニュアル・ランディングは winget を宣伝しない（マージ後に戻す） |
| zip の中身 | exe・CLI・README・LICENSE・`skills/syki`。変わらない |

### 6.6 branch `v2` を `main` に安全に取り込む手順（主ツリーに触れない）

**前提**（F2・F3）: `git log v2..main` は今 0 件（依頼文の「8 コミット」は存在しない。**出す直前に `git fetch` して確かめる**）。主ツリー `C:\Users\yoush\Documents\syki-sok` には他セッションの未コミットがあり、`main` がそこにチェックアウトされている。以下の `git` はすべて **worktree `C:\Users\yoush\Documents\syki-v2`** で行う。

```
# 0. 読むだけ
git fetch origin                                  # origin/* の追跡参照だけが動く
git log --oneline v2..origin/main                 # 0 件なら、そのまま FF できる
git diff --name-only v2...origin/main             # main に新しいものがあれば、重なりを見る

# 1. 1.x の保守の線を残す（新しいブランチを 1 つ。破壊的でない）
git push origin 2fe2a2b:refs/heads/release/1.x    # 2.0.0 が問題でも 1.14.x の修正を出せる

# 2. v2 を origin に（CI と Mac のアーティファクトのため。P5 が済んだらすぐ）
git push origin v2

# 3. main が動いていたら（今は不要）: v2 に main を取り込む。rebase でなく merge（衝突の解決が 1 回）
git merge origin/main                             # 衝突しやすいのは app.js・style.css・i18n.js・manual*.html・docs/features*.md
#    解決したら §7 の性能ゲートと JS 全件・smoke を回し直す。1.x の修正は、v2 の変更と意味が衝突しないか（タブ・バー・Zen・パネル）を読む

# 4. コード凍結 → 文書・図（§5）→ 版更新のコミット（§6.1）→ push → 同じ sha で CI が両 OS 緑
# 5. 出す（FF のみ。force しない）
git push origin v2:main                           # main が動いていれば拒否される → 3 に戻る
# 6. すぐタグ（§6.7 の順序）
git tag -a v2.0.0 <sha> -F <notes> --cleanup=verbatim && git push origin v2.0.0
```

- **ローカルの `main` の参照は動かさない**（`git update-ref refs/heads/main …`、`git branch -f main …`）: 主ツリーの HEAD だけが進み、index と作業ツリーは古いままなので、`git status` が v2 の全変更の**取り消し**を並べる。誰かがコミットすると v2 が消える。主ツリーは、そちらのセッションが自分で `git pull --ff-only` する。**そのとき未追跡の `docs/design/v2-visual-2026-10.md`（F3）が「上書きされる」で止まる**ので、先に退避する。ほかの未コミット（`.gitignore`、ルートの 8 本の削除、`tests/e2e/`）は v2 と重ならない（F3）。
- なぜ FF か: 履歴（今 14 コミット。P5・P6 で増える）の意図が残り、二分探索ができ、タグの先が `main` の履歴に含まれる。squash は 123 ファイルが 1 つになり、不具合の特定ができなくなる。
- **`git push` はすべて、オーナーの「出してよい」を聞いてから**（`release/1.x`、`v2`、`v2:main`、タグ。これまでの約束: push は指示があるまでしない）。
- **Pages**: 手順 5 で全部が公開される。文書・図が未完成のまま 5 に進まない。5 とタグの間は**数分**に。
- main に取り込んだあとの `packaging/` の更新は、v2 ではなく main に直接小さなコミット（`git add` で自分のパスだけ。他セッションの `packaging/README.md`・`packaging/winget/*` の未コミットを巻き込まない）。

### 6.7 リリースの順序（`reference_release_procedure.md` を v2 に当てはめる）

1. 版更新コミット（§6.1）→ push → **同じコミットで CI が両 OS 緑**（`gh run list --commit <sha>`）
2. **オーナーが Mac のアーティファクトで M1〜M3**（§4.4）。止める条件が出たら直して 1 に戻る
3. `git push origin v2:main`（Pages が公開される）→ すぐ 4
4. 注釈付きタグ `v2.0.0`（本文はリリースノートそのまま、tagger は youshinh）→ push → `gh run watch`（Release ワークフロー）
5. `gh release edit v2.0.0 --title … --notes-file …`（英日の本文。空で出る）
6. zip を取得して `sha256sum` を `gh release view --json assets` の `digest` と照合し、中身（exe・CLI・README・LICENSE・skills、`.app`）を見る。Windows の `syki-cli --version` が `2.0.0`、`jev verify` の終了コード（`"echo hello"` が 0、`"rm -rf /"` が 1）、macOS の `Info.plist`（`CFBundleShortVersionString` と `CFBundleVersion` が 2.0.0）、埋め込みの frontend に v2 の文字列（`grep -a -c -F` で `look-paper`、`tab-index-left` など）、macOS のバイナリに `sykiSetBackdrop`
7. `packaging/` を実物のハッシュで更新（Homebrew は小文字）、タップに同じ cask を LF で push。winget は §6.5
8. 公開すると、1.x のアプリのヘルプに「更新あり」が出る（`releases/latest` を見る）。**ノートの最初の 1 行が、アプリの更新の通知から開かれる**

### 6.8 ロールバック

| いつ | 方法 |
| --- | --- |
| main に出す**前** | 何も戻すものは無い（`git push origin --delete v2`、Pages は動かない） |
| main に出した**後**・タグの前 | **force しない**。範囲の `git revert --no-commit 2fe2a2b..HEAD`（FF で線形なので 1 本の「v2 を戻す」コミットにまとめられる。手順 3 で merge コミットができていれば、その merge は `-m 1` で）を v2 の worktree で作って push。Pages も戻る（文書と図が 1.14 のものに）。1.x の修正は `release/1.x` から |
| タグ・リリースの**後** | `gh release delete v2.0.0 --yes`（`--cleanup-tag` でタグも）→ `releases/latest` は自動で `v1.14.0` に戻る（先行リリースでないので）。**タグを動かさない**（ハッシュが変わり cask を壊す）。cask とタップを前の版に戻す（revert コミット）。**2.0.0 を入れた人には、downgrade の道は無い**ので、基本は 2.0.1 で**前へ直す**（`release/1.x` は最後の手段） |
| ユーザーの設定 | §6.2 のダウングレードの節。`appearance` は 1.x が捨てるだけで壊れない。**1.x は新しい設定を使えないが、起動はする** |

---

## 7. 作業束 F: 性能ゲート（出す前）

道具: `tools/perf/v2_perf.mjs`（隔離した試験 exe を 1 回ごとに起動・停止。`E2E/app.lock` を取る）、`run_matrix.mjs`（構成を交互に）、`idle_ab.mjs`、`gen_note.mjs`（8 万行のノート。sha256 `e12f4596…` で固定）。基準 `tools/perf/baseline-v1.14.md`/`.json`（`v2-base.exe` = v1.14.0 と同じ見た目、14 回の中央値）、`v2-p2-translucency.md`（同セッションの交互の測定とバーの既定）、`v2-p3-idle-cpu.md`（アイドル CPU の見方）。

**条件**（毎回書く）: 同じ PC、**電源につないで**、他のエージェントの重い作業（screenshots、ビルド）が無い時間（ハーネスは前・中・後のシステム CPU が 10% を超えた回を捨てて繰り返す）、**`--motion no-preference`**（この PC は `reduce` を返し、ふだんは遷移が全部切れるため。ハーネスが各回で確かめる）、WebView2 のバージョンを記録、**基準 `v2-base.exe` と「今回の exe」と「P5 の最後の exe（P6 の前）」を同じセッションで交互に**（`run_matrix.mjs`、2 ラウンド逆順 × 3 回以上）。基準のファイルは別の日の数字なので比較は参考止まり（P2 の「+7%」が見かけだったときの教訓）。

```
node tools/perf/run_matrix.mjs --matrix <p6.json> --out <dir> --rounds 2 --runs 3        # base / p5 / rc を交互に
node tools/perf/v2_perf.mjs --exe v2-rc.exe --runs 7 --motion no-preference --compare tools/perf/baseline-v1.14.json
node tools/perf/v2_perf.mjs --exe v2-rc.exe --runs 7 --config-patch '{"appearance":{"look":"paper"}}' --motion no-preference   # 紙でも
node tools/perf/v2_perf.mjs --exe v2-rc.exe --runs 5 --config-patch '{"appearance":{"bars":"glass","autoHide":false}}' --bars-state shown --browser-args "--disable-gpu" --motion no-preference   # 最悪の構成の確認
```

### 7.1 合否の基準（案。基準の幅と P2・P3 の実績から）

| 指標 | 基準 v1.14（14 回） | 合格 | 不合格（修正か説明が要る） |
| --- | --- | --- | --- |
| 起動（プロセスから ready まで） | 483 ms（473〜499）。同セッションの v1.14 の見た目 456 ms に対し P2b は 465 ms（+2.0%） | 同セッションの `v2-base` に対し **+5% 以内**（約 +25 ms）。**P5 の最後の exe に対し +3 ms 以内**（A の追加が 0 に近いこと） | +10% 超 |
| アイドルのメモリ（private working set、全プロセス） | 111 MB（110〜114） | **+5 MB 以内**（≤ 116 MB）。作業セット 390 MB → ≤ 400 MB | +10 MB 超、プロセス数が 7 から増える |
| アイドル CPU | 約 1.2%（カウンタの分解能 15.6 ms の目盛り。**同じビルドでも 1.08〜2.36%**） | 差が出ないこと。**見分けるにはトレース**（`v2-p3-idle-cpu.md`）。紙・墨・自動非表示の入り切りで、同じセッション 6 回以上の中央値の差 < 0.5 ポイント | 継続的な +0.5 ポイント超がトレースでも確認 |
| 8 万行を開く | 1,858 ms（1,849〜1,877）。メモリ +690 MB（作業セット 1,077 MB、private 787 MB） | **+5% 以内**（≤ 1,950 ms）、作業セット ≤ 1,130 MB | +10% 超（≥ 2,045 ms） |
| 8 万行のスクロール（100 px / 33 ms × 4 s） | 50 ms 超のフレーム 0、p50 18.2 ms、p95 19.3 ms、最大 21 ms 前後、遅いフレーム 0 | **50 ms 超 0**、p95 ≤ 20.5 ms、遅いフレーム ≤ 2（240 中） | 50 ms 超が 1 つでも |
| 8 万行の入力（50 打鍵、中央付近） | p50 128 ms（125〜131）、p95 154 ms | **p50 +5% 以内**（≤ 135 ms）、p95 ≤ 162 ms | p50 +10% 超 |
| 8 万行の GC（開いて 10〜30 秒後に 1 回） | 約 658 ms | 参考（悪化なし） | — |
| 紙の構成 | （基準なし） | 上のすべてが墨と**同じ幅**（紙・墨の差 < 5%） | 紙だけ悪い |
| glass・自動非表示オフ・GPU なし（最悪） | `v2-p2-translucency.md`（GPU なしで GPU プロセスの CPU が 2 倍。だから glass は既定にしない） | 結論が変わらない（既定は `light`、`glass` は選択） | 既定の構成が最悪より悪い |
| exe の大きさ | `v2-base.exe` 24,560,128 バイト | 埋め込み（Go の `embed`）は圧縮されないので、frontend の +272,745 バイトがほぼそのまま増える見込み。**+400 KB 以内** | +1 MB 超 |
| 付箋のパネルの開閉（P5） | （基準なし） | パネルを 20 回開閉して、DOM のノード数・メモリが増え続けない（リークなし）。8 万行で開いたときの 1 フレームが 50 ms を超えない | リーク、固まる |

**判定の規則**: 1 つでも不合格なら、原因（トレース・差分の二分）を見つけて直すか、**数字つきでオーナーに「悪化するが出すか」を聞く**。基準の幅の外に出た場合だけ不合格とする（ノイズで落とさない）。結果は `tools/perf/v2-p6-release-gate.md` に、条件・exe の sha256・表で残す。

### 7.2 既知の重さ（非目標）として文書に書くこと

**8 万行のノートのプレビュー**: 見開きプレビューで約 1.9 GB、プレビューのみで約 3.4 GB、切り替えに約 3.5 秒 / 2.1 秒（P4a で測定。**v1.14 から**あり、v2 は悪化させない）。**v2 の目標ではない**。リリースノートの「既知」、`docs/design/v2-visual-2026-10.md` §7 の P6 の結果に 1 行、プレビューに切り替えるときの 7 秒の残課題（`project_huge_note_performance`）とあわせて**別件**として残す。**v2 でプレビューに入って悪化したら不合格**（§7.1 の 8 万行の行に「見開きプレビュー・プレビューのみ」を足して、P4a の数字より悪くないことを見る）。

---

## 8. 順序・依存・見積り

```
P5 完了（コミット、検証） ── 入口の条件（下）
   │
   ├── v2 を origin に push（了承）→ CI の初回（JS 134 件が両 OS で通るか）
   │
   ├── A0 → A1 → A2 → A3 ──────────────┐   （Go。A4 は push して CI の macOS を待つ）
   │                  └── A4 → CI macOS │
   ├── B0 → B1 → B2（P5 後）→ B3 → B4 → B5 → B6 ─┤
   │                                               ▼
   │                                       【コード凍結】
   │                                               │
   ├── D1 文書の本文（B の画面は凍結を待たずに書き始めてよい。図は待つ）
   ├── D2 図 → D3 GIF → D4 検査         （凍結後）
   ├── F 性能ゲート                      （凍結後。D と並行できる）
   ├── C オーナーの Mac（M1〜M3）        （凍結後の CI の .app で）
   ▼
 E 版更新 → CI 緑 → Mac OK → main へ → タグ → 公開 → packaging
```

**入口の条件**（P5 から）: 付箋のパネルがコミット済みで、`node tools/run_js_tests.mjs` 全件、smoke 英日、`python tools/check_manual.py` が緑。**P5 の文書（panel-template.md、マニュアルのパネルの章）が済んでいるか**を D1 の前に確認。

| 束 | 作業時間の目安 | 待ち（オーナー・CI） |
| --- | --- | --- |
| A Go | 3〜4 時間（A2・A3 の実機の確かめが半分） | CI の macOS 約 10 分 |
| B a11y | 4〜6 時間（監査と直しの数による） | オーナーの実機 約 30 分 |
| C Mac | 私は 1 時間（CI の確認と結果の整理） | **オーナー 約 20 分（M1〜M3）+ 30 分（M4〜M5）**。10.15 の機械が無ければ現行のみ |
| D 文書と図 | 10〜14 時間（英日・図の目視・GIF） | — |
| F 性能 | 2 時間の作業 + 機械の時間（最悪構成を含め約 1.5 時間） | — |
| E リリース | 2〜3 時間（ノート英日、置換、検証、packaging） | CI 約 15 分、Release 約 15 分 |

合計は私の作業で **約 25〜35 時間**（P2b が見積りの倍かかった実績があるので、**長めに見る**）。**オーナーの時間は約 1.5 時間**（Mac 50 分 + Windows の実機 30 分 + 判断）。

---

## 9. 受け入れ基準（P6 が終わったと言える条件）

**A（Go のネイティブの色）**: ① `nativelook_test.go` が緑（4 つのテストとミューテーション）で、Go の 2 色と `tokens.css` の `--canvas-bg` が機械で縛られている ② 隔離した実アプリで、墨と紙の**起動直後の最初のフレームの画素が地と一致**（変更前は `(30,30,30)`）、段階 (a)(b)(c)(d) すべて ③ 設定画面で地を替えて**保存すると**、タイトルバーと窓の下地が追従し、**キャンセルでは変わらない** ④ 起動の差が P5 の最後の exe に対し 3 ms 以内（`v2_perf.mjs` の交互 16 回）⑤ `go vet`・darwin の 2 つのクロスチェック・CI の macOS ジョブが緑 ⑥ `v2-tokens.md` 6.7 を更新。

**B（強制色・動き・a11y）**: ① 70 の状態 × 4 条件の画面を目で見て、**面が消えて分からない画面が 0**（付箋・設定・スイッチ・色見本・検索の一致・結果の帯・ゴースト・図・チップが §3.2 の表のとおり直っている、または「直す必要が無かった」と記録されている）② `tests/forced_colors_test.mjs`・`tests/reduced_motion_test.mjs` が緑でミューテーションで落ちる ③ コントラストの組が P5 の付箋まで増え、**全部が基準を満たす** ④ 憲章 C3・C5・C13・C14・C4 を 1 周し、見つけた不具合は直すか記録 ⑤ オーナーの実機（ハイコントラストの 4 テーマ、動きあり、IME、読み上げ）の結果が記録され、**未確認はリリースノートの「未確認」に**。

**C（Mac）**: ① CI の macOS ジョブが緑で、`syki-macos-<sha>` の `.app` が `--version` まで動く ② `tests/js_compat_test.mjs` が緑 ③ オーナーが M1〜M3 を現行の macOS で通し、結果が記録されている。10.15 は通した、または**未確認と書いてある** ④ `tools/MACOS_CHECKLIST_JA.md` に 11 章と凝縮版がある。

**D（文書と図）**: ① `python tools/check_manual.py` が clean ② マニュアル英日に、外観の節・`split-editor`・見開き/プレビューのみ・バーの自動非表示・用語が入っている ③ `img/manual/{en,ja}` の**全図が v2 の見た目**で、目視のうえマーカーの重なり・実データの写り込み・寸法の問題が無い。紙の図 5 枚 ④ GIF 11 本が新しい見た目で、再生して崩れが無い ⑤ ランディングのショーケースの画像・`features*.md`・README が新しい見た目の画像を指し、説明文が事実と一致 ⑥ `go test -run "Skill" .` と `go test -run "Help" .` が緑 ⑦ `docs/maintenance/after-a-big-change.md` の各章に、v2 の欄で ✓ か理由が付いている。

**E（リリース）**: ① 版が 9 ファイル（§6.1）で 2.0.0 に、`update_checker_test` を含む JS 全件が緑 ② main の FF の push、`v2.0.0` のタグ、Release の成功、`gh release edit` の英日の本文、sha256 が digest と一致、CLI・Info.plist・埋め込み文字列の検証 ③ cask とタップの更新（LF）④ **主ツリーに触れていない**（手順はすべて v2 の worktree と remote だけ。主ツリーの `git status` は index を更新しうるので、**こちらからは実行しない**。ローカルの `main` の参照が動いていないことは `git rev-parse main`（読むだけ）で確かめる）⑤ ロールバックの手順が書いてある（§6.8）。

**F（性能）**: §7.1 の全行が合格か、数字つきで説明され、`v2-p6-release-gate.md` に残っている。

---

## 10. リスクと未決（順位つき、推奨の答えつき）

### 10.1 リスク（大きい順）

| # | リスク | 内容 | 対策 |
| --- | --- | --- | --- |
| R1 | **Mac が未確認** | 見た目の全部が WKWebView で初めて動く。Obj-C の変更（A4）の最初のコンパイルが CI。Mac の既定の透過は「うすい」のまま。10.15 の実機が無いかもしれない | v2 を早く push して CI を見る（§6.4）。`.app` のアーティファクトでオーナーが M1〜M3。JS の見張りを足す（C2）。**未確認は書く**。10.15 は未確認で出してよい（Safari 15.6 の機能表との突き合わせと見張りで限界を明記） |
| R2 | **最初に見えるものの変化が大きい（慣れの壁）** | 上のタブの列が無くなる、バーが消える、Zen の意味が変わる。**1.x のアップデート通知から開いた人が最初に出会う**。苦情が出るなら、まずここ | リリースノートの冒頭で、タブの帯・バーの出し入れ・`F6` を図と一緒に。**自動非表示の設定**（オフにできる）を目立たせる。2.0.x で「タブの帯を常に広げる」設定を足す余地（CSS 変数 1 つで済む）を残す |
| R3 | **文書と図が古いまま Pages に出る** | main への push で全部が公開される | 文書・図の完成を `main` の push の前の条件にする（§6.6、E の順序） |
| R4 | **Go の変更は実機でしか確かめられない** | DWM・ブラシ・WebView2 のコントローラは hermetic にならない。v2 で最初の Go の変更。`make_overlay.py` の文字列の前提を壊すと隔離の道具が動かない | 純粋な部分（解析・色の値・`tokens.css` との一致）を機械で縛り、残りは隔離した実アプリの画素で。差分を小さく。**既定の見た目（墨）の挙動は `#0e0f17` に変わるだけ**で、解析に失敗したら今までと同じ墨。`make_overlay.py` の 3 つの文字列を変えない |
| R5 | **主ツリーと main の取り扱い** | 他セッションの未コミットがある主ツリーで、ローカルの `main` の参照を動かすと v2 を取り消した見た目になる。未追跡の `v2-visual-2026-10.md` が `pull` を止める | §6.6 の手順（remote への FF だけ、ローカルの `main` は動かさない、主ツリーは持ち主が `pull --ff-only`）。**出す前に `git fetch` して `v2..origin/main` を確かめる**（今は 0 件） |
| R6 | **性能** | 8 万行は「悪化させない」だけが目標。P5 の付箋と P6 の変更で崩れる可能性 | §7 の同セッション交互。ノイズで落とさない。P5 の後に 1 回、A・B の後にもう 1 回 |
| R7 | **強制色・読み上げが実機で未確認** | CDP のエミュレーションは本物のテーマと同じではない。画面読み上げは動かしていない | オーナーの実機チェック（§3.4）。未確認は「未確認」に書く |
| R8 | **付箋・紙の目視が間に合わない** | 図 144 枚、紙・墨、英日、アクセント 5 つ。見落としが出る | 連絡用シートで全体 → 原寸、観点の一覧（§5.4）、墨を既定にして紙は 5 枚に絞る |
| R9 | **CI で v2 の JS が初めて両 OS で走る** | 一時フォルダ・改行・パス・時刻・Node のバージョンの違いで落ちる。`tests/lib` の共通部品が多い | v2 の早い push。「手元で通って CI で落ちる」の観点（一時フォルダの 8.3 短縮名・symlink・Windows パス・時刻）を新しいテストに当てる |
| R10 | **Release ワークフローの macOS の `go test -v ./...` が時間依存の不安定で落ちる** | `app_meeting_test.go` の既知の flake。落ちると Mac の zip が出ない | 落ちたら再実行（`gh run rerun --failed`）。タグを動かさない |
| R11 | **8 万行のプレビューの重さ**（既存） | 見開きで約 1.9 GB、プレビューのみ約 3.4 GB | 非目標として書く（§7.2）。「悪化させない」だけ確認 |
| R12 | **設計書・契約・計画書が実装と食い違う** | 設計書 §4.1 の下の角 11px（実装なし）、計画書の初版の `gutter` と実装の `dots` など | A5・D で設計書を事実に直す。`docs/design/v2-*` は「記録」と「現行の仕様」を分けて、先頭に状態を書く |
| R13 | **ダウングレードで `appearance` が落ちる** | 1.x は未知のキーを保存で捨てる（`config.semantic` が消えた件と同じ性質） | リリースノートに 1 行。アクセントは `general.theme` に残る |
| R14 | **winget が古い版のまま** | PR は 1.12.0 で moderator 待ち | 触らない。マージされたら Update の PR。ドキュメントは winget を宣伝しない |

### 10.2 オーナーへの質問（決める順）

| # | 質問 | 推奨 |
| --- | --- | --- |
| O1 | **版は 2.0.0 か 1.15.0 か** | **2.0.0**。オーナー自身が「v2」と呼んでおり、見た目の変更の大きさは過去最大。**CLI・JSON-RPC・設定・セッションの形は互換**なので、「2」は見た目と操作の大きな変更を意味し、API の破壊を意味しない（ノートの冒頭に書く）。リネーム（`syki::sok`）は別リポジトリの別アプリなので、版の名前とぶつからない。1.15.0 にすると、見た目が大きく変わることの警告が弱い。更新確認（`isNewerVersion`）は 2.0.0 を新しい版として扱う（`tests/update_checker_test.mjs` が見ている） |
| O2 | **新規ユーザーの既定の見た目** | **墨 + Dark Olive のまま**（P1b の決定。見た目の連続性。紙は設定で選ぶ）。OS の明暗に従う案は、起動時のちらつきの設計（Go が OS の設定を読む）が要り、2.0 では見送る |
| O3 | **マニュアルに見せる見た目** | **墨を全図、紙は 5 枚**（§5.3）。理由: 新規の人が最初に見るのが墨、図が今も暗い、費用が 2 倍にならない |
| O4 | ランディングの hero に紙を使うか | 今回は**墨**（README の GIF と揃える）。紙の hero は、後で画像 1 枚の差し替えで済む。ランディング自体の配色は変えない |
| O5 | **タブの帯の幅（6px）と当たり判定（12px）を、実アプリで決めたか** | **出す前に、オーナーが 1 週間ふだんの作業で使って決める**（CSS 変数。数字を変えるだけで画像の撮り直しが要る → 画像の撮影の前に決める）。WCAG 2.2 の目標サイズ 24px に届かない点は、代わりの経路（`Ctrl+Tab`・一覧・展開後）があることで記録 |
| O6 | バーの透過の既定（`light`）と、Mac の既定 | **`light` のまま**。Mac は M2-④ の確認が済むまで `light`。すりガラスは選択。紙でバーの下の文字が透けて見えることを、説明に書く |
| O7 | **タイトルバー**: Windows は見た目に従う（紙で明るい）、Mac は OS に任せる、Win11 のキャプション色は設定しない | **推奨どおり**（A）。Mac の `NSAppearance` 固定と Win11 のキャプション色は、見た目の連続性は上がるが費用と未確認が増えるので 2.0.x の候補 |
| O8 | **下の角丸 11px**（設計書 §4.1）は実装していない。落としてよいか | **落とす**。Windows 11・Mac は OS が窓を丸める。CSS で丸めると、角に**ネイティブの下地**（A の色）が見えて二重になる。設計書の記述を直す（A5） |
| O9 | Quick Capture（Win32 の小窓）を見た目に従わせるか | **従わせない**（暗いまま）。どのアプリの上にも出る小窓。マニュアルの記述と一致 |
| O10 | `prefers-contrast: more` の規則を足すか（B5） | **足す**（10 行、費用 0）。Windows のハイコントラストとは別の、Mac の「コントラストを上げる」にも効く |
| O11 | **Mac が未確認でも出すか** | **M1〜M3 を現行の macOS で通ったら出す。M4 以降と 10.15 は未確認として書く**。通らなければ Windows だけを先に出すことはせず（`release.yml` は両方を作る）、直してから |
| O12 | 履歴: FF（今 14 コミット、P5・P6 で増える。それを残す）か squash か | **FF**。二分探索ができ、タグの先が履歴に含まれる |
| O13 | `release/1.x`（2fe2a2b）の保守ブランチを作るか | **作る**（push 1 回、害なし）。2.0.0 が問題でも 1.14.x の修正を出せる |
| O14 | リリースの前に `v2` を origin に push してよいか | **P5 が済んだらすぐ**（CI と Mac のアーティファクトのため）。Pages は動かず、公開されるのはブランチだけ |
| O15 | アプリ名は syki のままか | **syki のまま**（設計書 §1 の範囲外: 改名は別リポジトリの新しいアプリ）。ウィンドウタイトル・ヘッダーの文字・`.app` の名前・cask・winget の ID・設定フォルダは変わらない |
| O16 | smoke を CI に載せるか | 2.0 では**載せない**（記録だけ）。`windows-latest` に Edge があるので、2.0.x で検討 |
| O17 | 起動時の最初の 1 フレームのちらつき（印が無い紙のプロファイル、A7）を直すか | **直さない**（起動の都度の穴ではない）。実機で気になると分かったら 2.0.x |

---

## 付録 A. 今回確かめたコマンドと結果

```
git diff --name-only main v2                       # 123 件: docs 10、frontend 29、manual 2、skills 3、tests 55、tools 24。.go・.github・packaging は 0
git rev-parse main origin/main v2                  # 2fe2a2b… 2fe2a2b… fabb29c…
git log --oneline v2..main                         # 空（main は 2fe2a2b のまま）
git worktree list                                  # syki [main] 2fe2a2b / syki-v2 [v2] fabb29c
gh pr view 438694 --repo microsoft/winget-pkgs     # OPEN、REVIEW_REQUIRED、検証は通過
gh run list --repo youshinh/syki-sok --limit 3      # 2fe2a2b の CI と Pages は success
python tools/check_manual.py                       # clean（manual.html 54 id、65 図、25 表 / manual_ja.html 54 id、65 図、26 表）
node scratchpad/p6/selcheck.mjs                    # shots.json の selector 233 部分を frontend と突き合わせ: 消えた id・class は 0（スマホのページと動的な is-info を除く）
grep -rn "#1e1e1e" window_*.go                     # window_windows.go に 4、window_darwin.go に 2
```

## 付録 B. 触るファイルの一覧（P6 全体）

| 束 | 新規 | 変更 |
| --- | --- | --- |
| A | `nativelook.go`、`nativelook_test.go` | `window_windows.go`、`window_darwin.go`、`platform_darwin_nocgo.go`、`window_darwin_lifecycle_test.go`、`app.go`（フィールド）、`app_config.go`（`SaveConfig` に 3 行）、`docs/design/v2-tokens.md`、`v2-visual-2026-10.md` |
| B | `tests/forced_colors_test.mjs`、`tests/reduced_motion_test.mjs`、`tools/docshots/contact_sheet.py` | `frontend/css/chrome.css`（末尾の節）、`frontend/css/tokens.css`（B5）、`tests/look_contrast_test.mjs`、`tools/docshots/run.mjs`、`README.md` |
| C | `tests/js_compat_test.mjs` | `tools/MACOS_CHECKLIST_JA.md` |
| D | `img/manual/{en,ja}/*.png`（144）、`img/demo/*.gif`（11）、ランディング用の画像（12）、`tools/perf/v2-p6-release-gate.md`（F） | `manual.html`、`manual_ja.html`、`docs/features*.md`、`README*.md`、`index.html`、`index_ja.html`、`skills/syki/**`、`tools/docshots/shots.json`（紙の図 5 つ）・`setups.mjs`・`data/demo.mjs`、`docs/design/*` |
| E | リリースノート（scratchpad）、`tools/perf/v2-p6-release-gate.md` | 版の 9 ファイル（§6.1）、`packaging/homebrew/syki.rb`、タップ |

**触らない**: `frontend/css/print.css`、`pkg/dropzone/html.go`、Quick Capture と画面キャプチャの色、`.github/workflows/*`（CI の変更は今回しない）、RPC・CLI の形、セッションの JSON、`make_overlay.py` の 3 つの文字列。
