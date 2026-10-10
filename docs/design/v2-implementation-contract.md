# v2 実装の契約（担当者向け、2026-10-04）

設計は `docs/design/v2-visual-2026-10.md`（合意事項と仕様）。この文書は、**実装を担当する人（サブエージェント）が守る取り決め**。矛盾したら設計書が優先。画面案（アーティファクト）のコードは持ち込まない。

## 1. 場所と禁止事項（最優先）

- 作業するのは **worktree `C:\Users\yoush\Documents\syki-v2`（ブランチ `v2`）だけ**。`C:\Users\yoush\Documents\syki-sok`（main の作業ツリー）は、ユーザーの別セッションが使っているので**読むのも書くのも禁止**（作業ツリーの外の `scratchpad` を除く）。
- `git add` / `commit` / `stash` / `checkout` / `reset` / `merge` / `push` は**しない**（コミットは統括役が検証してから行う）。`git diff` / `git status` / `git log` は可。
- ユーザーのふだんの syki::sok（`syki.exe`、起動中）を**止めない・触らない**。`go build` は `-o` で出力先を指定する（worktree 直下に exe を作らない）。Ollama も触らない。
- **性能と軽さが最優先**（常駐メモリ 5〜15MB、起動 15ms 未満が売り）。未使用なら何も作らない・何も読み込まない。起動時に重い処理を足さない。追加した CSS/JS は、増えたバイト数と、起動・8 万行ノートへの影響を報告する。
- テストは hermetic（実ネットワーク・実設定・実 Ollama に触れない）。偽の鍵は書かない。UI に絵文字を使わない（✕ だけ例外）。アイコンは線画 SVG。
- ファイルの改行を保つ（`git ls-files --eol <file>` で確認。`frontend/js/i18n.js` などは CRLF）。Edit ツールは `\uXXXX` を文字に直す。バックスラッシュを含む編集は、Edit ツールか、Write で作った `.py` を使う（シェルのヒアドキュメントは `\\` を潰す）。
- 他の担当と**同じファイルを同時に編集しない**。自分の担当ファイルの外に手を入れる必要が出たら、その理由を報告して止める。

## 1.5 CSS・JS の互換性（macOS の最低は 10.15 = Safari 15.6 まで）

- 使えない: `color-mix()`（Safari 16.2〜）、`@container`、CSS ネスト、`:has()` の新しい使い方（既存の設定画面の使用は現状維持）。使ってよい: `rgb(r g b / a)`（スペース区切り + スラッシュのアルファ）、`max()`/`min()`/`clamp()`、`inset`、`backdrop-filter`（`-webkit-backdrop-filter` も併記）、`aspect-ratio`（Safari 15）、カスタムプロパティ。
- 色が別の色から派生する場合（アクセントの薄い色など）は、**チャンネルのトークン**（`--accent-rgb: 85 107 47`）と `rgb(var(--accent-rgb) / 0.14)` を使うか、段階の色を**あらかじめ計算した別トークン**として持つ。画面案の `color-mix()` はそのまま持ち込まない。
- 新しい CSS の構文を使うときは、caniuse 相当の根拠（Safari と Chromium の対応版）をコメントか報告に書く。

## 2. 道具

### 2.1 隔離した実アプリ（本物の設定に触れない）

`C:\Users\yoush\AppData\Local\Temp\claude\C--Users-yoush-Documents-md-memo\c56620cc-7e7e-498b-a7c7-c4a14c374db1\scratchpad\v2e2e\`（以下 `E2E`）。

```
sh E2E/build.sh v2-<名前>.exe                      # worktree から試験用 exe を作る（デバッグポート 9335、専用 mutex、専用 WebView2 プロファイル）
powershell -File E2E\launch.ps1 -Exe v2-<名前>.exe [-Notes <フォルダ>]   # 起動して PID=… を出す
powershell -File E2E\stop.ps1 -ProcId <pid>        # 自分が起動したものだけを止める（v2-* 以外は拒否する）
```

- `E2E/cdp.mjs`: CDP の小さな補助（`connect()` → `ev(式)`、`waitFor`、`shot(名前)`、`key`、`send`）。画像は `V2_SHOTS`（既定 `E2E/shots/`）に保存。Alt=1、Ctrl=2、Meta=4、Shift=8。右クリックやドラッグの `Input.dispatchMouseEvent` には `buttons` を付ける（右=2、左=1）。
- **ポート 9335 は 1 つしかない**。使う前に `E2E/app.lock` を `mkdir` で取り（取れなければ待つ）、止めたら `rmdir` で返す。
- 実アプリのスクリーンショットは**自分の目で見て**確認する（Read ツールで画像を開く）。
- 試験用 exe は `v2-` で始まる名前にする。`E2E/v2-base.exe` は、v2 ブランチを切った時点（変更前）の基準版。

### 2.2 全図の撮影（見た目の回帰を見る）

```
node tools/docshots/run.mjs --lang en --method cdp --no-md --out <dir>
```

固定の時計とモックのバックエンドで、日英 65 の状態を撮る（1120x720、約 130 秒/言語）。実行中は Edge の窓がデスクトップに開く。基準は `E2E/base-shots/`（P1a の最初に撮る）。

## 3. トークンの方針

- 色はすべて **CSS 変数**で持つ。定義は新しい `frontend/css/tokens.css`（`index.html` で `style.css` の前に読む）に集め、`style.css` と `print.css` 以外の CSS・JS・HTML のインライン style には**色の直書きを置かない**。
- 既存のトークン名（`--bg-main`、`--text-muted`、`--accent-color` など）は**そのまま使い続ける**（469 か所＋JS が参照）。足すときは同じ命名（`--<役割>-<変種>`）。
- 地の切り替えは `body` のクラスで行う: 今の `body.dark-theme` が**墨**の値、P1b で `body.look-paper`（紙）を足す。アクセントは今の `body.theme-olive|blue|forest|charcoal` に `theme-vermilion`（朱）を足し、自分で指定する色は `--accent-color` 等を JS が `body` の style に流す。
- 台帳 `docs/design/v2-tokens.md`: トークンごとに「役割、墨の値、使われる場所の数、紙の値（P1a では空）」を表にする。

## 4. P1a: 直書きの色をトークンへ（見た目は変えない）

担当: `frontend/css/style.css`、新規 `frontend/css/tokens.css`、`frontend/index.html`（link と、インラインの色）、`frontend/js/*.js` のインラインの色、`tests/css_tokens_test.mjs`（新規）、`docs/design/v2-tokens.md`（新規）。**`print.css` は触らない**（印刷は紙の見た目のまま）。

1. **基準を撮る**: 何も変える前に `node tools/docshots/run.mjs --lang en --method cdp --no-md --out E2E/base-shots` を実行する（同じ状態を 2 回撮って、画素が一致するか＝再現性を先に確かめる。ずれる図は、理由と一緒に一覧にする）。
2. **棚卸し**: `style.css` の色の直書き（`#rgb`、`#rrggbb`、`rgb()`、`rgba()`、`hsl()`、名前つきの色。`transparent`・`currentColor`・`inherit` は除く）を、**値ごとに集計**して、役割（面、文字、線、影、スクリム、状態〈危険・警告・成功〉、リンク、コードの背景、など）を決める。JS（`style.`、`cssText`、`innerHTML` の style 属性）と `index.html` の直書きも同様に洗い出す。**JS が計算する色**（mermaid の配色、キャンバス）は、トークンを読む形にできるものだけ直し、残りは `v2-tokens.md` の「未対応」に理由を書く。
3. **置き換え**: 各直書きを、**墨の値が元の値と等しい**トークンに置き換える（アルファつきの色は、`rgba` の組をそのままトークンの値にする）。意味が違うのに値が偶然同じものは、**別のトークン**に分ける（紙の値が別々になるため）。同じ役割なのに値が少しずつ違うものは、**統合しない**（見た目を変えない。統合の提案は台帳に書く）。
4. **ロック**: `tests/css_tokens_test.mjs`（Node のみ。`node tests/css_tokens_test.mjs`）を作る。`style.css`、`frontend/css/` の `tokens.css` 以外の CSS、`index.html` のインライン style、JS のインライン style に、色の直書きが**ない**ことを検査する（許す例外は、理由つきの許可リストに 1 行ずつ）。ミューテーション確認（わざと 1 つ直書きして落ちること）をする。
5. **検証**: `node tools/run_js_tests.mjs` が全件通る。全図を撮り直して基準と比べる。比較ツール `tools/docshots/compare_dirs.py`（Pillow。2 つのフォルダの PNG を名前で突き合わせ、差のある図と差のある画素数を出す）を作る。**完了の条件は、全図で画素が一致**（基準で不安定と分かった図を除く）。一致しない図があれば、原因を直す。
6. 追加した CSS/JS のバイト数（`tokens.css` 分を含む）、`style.css` の行数の変化、`index.html` の読み込みが 1 つ増える影響を報告する。

## 5. 性能の測定（P1a と並行して別の担当）

担当: 新規 `tools/perf/`（`v2_perf.mjs` と README）のみ。アプリのソースは触らない。

- 対象の exe を引数に取る（`--exe E2E\v2-base.exe`）。`E2E/launch.ps1` と CDP で隔離した実アプリを動かし、**1 回ごとに起動して止める**（`app.lock` を使う）。
- 測るもの（`--runs N`、既定 7。中央値・最小・最大を出す）:
  1. **起動**: プロセスを起こしてから、ページが操作できる状態（`document.readyState === 'complete'` かつ `window.backend`）になるまでの時間。
  2. **メモリ**: 起動して 10 秒置いたあとの、アプリと、その `msedgewebview2` の子プロセス（専用プロファイルのパスで特定）の作業セットの合計と内訳。
  3. **8 万行のノート**: 8 万行のノート（日本語・英語・見出し・コードを混ぜた決まった内容を生成するスクリプト。乱数は固定）を開くまでの時間と、そのあとのメモリ。
  4. **スクロール**: 8 万行のノートで、決まったホイールの量（CDP の `mouseWheel` を一定間隔で数秒）を送り、ページ内の `requestAnimationFrame` の間隔（p50・p95・最大、17ms を超えた枚数）と、`Performance.getMetrics` の増分（ScriptDuration、LayoutDuration、RecalcStyleDuration、TaskDuration）。
  5. **入力**: 8 万行のノートの途中で、キー入力 50 回の、押してから次の描画までの時間（中央値・p95）。
- 出力は JSON と、貼れる Markdown の表。**基準 `v2-base.exe`（v1.14.0 と同じ見た目）を測って、`tools/perf/baseline-v1.14.md` に残す**。以前の計測の方法は `scratchpad` の `load_bench.mjs`、`perf.mjs`、`bench*.mjs`、記録 `project_huge_note_performance`（メモリ）が参考になる（読むだけ）。
- 測定値が揺れるので、条件（他のアプリが動いている、電源）を書く。同じ条件で 2 回測って、差を示す。

## 6. 報告の形

簡潔に: 変えたファイルと理由、実行したコマンドと結果（件数）、基準との比較（画素一致の図の数／不一致の一覧）、追加したバイト数、未対応・迷った点とその判断、実機で確かめていないこと。**通っていないものを通ったと書かない**。

## 7. P1b: 紙と墨の値、アクセント、「外観」設定（P1a の後）

前提: P1a で色はすべて `frontend/css/tokens.css` のトークンになり、墨（今の暗い見た目）は画素一致のまま。P1a の台帳は `docs/design/v2-tokens.md`。**他の段の計画書（`v2-plan-P2.md`、`P3`、`P4-P5`）が P1b に頼んでいること**を、ここで引き受ける。

担当: `frontend/css/tokens.css`、`frontend/css/style.css`（地ごとの微調整だけ）、`frontend/index.html`（設定画面の「外観」の節）、`frontend/js/app.js`（設定の読み込み・保存・適用の配線だけ）、新規 `frontend/js/appearance.js`（純粋な関数＋適用）と `frontend/js/appearance_test.js`、`frontend/js/i18n.js`（英日、**CRLF**）、`frontend/js/config_pack.js`、`tools/docshots/`（`--look`）、関連テスト、`docs/design/v2-tokens.md`。

1. **機構を先に**（見た目は不変）: 地の切り替え（`body` のクラス。墨 = 今の `dark-theme`、紙 = 新しい `light-theme`。`dark-theme` を前提にしている CSS/JS を洗い出して、紙でも成り立つようにする）と、`config.appearance`（`look: "ink"|"paper"`、`accent: "olive"|"blue"|"forest"|"charcoal"|"vermilion"|"custom"`、`accentCustom: "#rrggbb"`、`editorFont: ""`）の読み込み・保存・適用。**この段階の終わりに、墨の見た目が P1a と画素一致であること**を全図で確かめる（`compare_dirs.py`）。
2. **値を作る**: 設計書 §4.1 の面（`--wall` `--page` `--sheet` `--ink` `--ink-2` `--hair` `--shade`）を、全トークンの役割に広げて、**墨（v2 の青みのある墨色。画面案の値が出発点）と紙（暖かみのある薄い灰）の両方の値**を作る。方針: 面は 3 段（机 < ページ < 紙）、線は枠ではなく薄い罫線（`--hair`）、影はやわらかく、アクセントは控えめ（塗りつぶしは選択中・ボタンだけ）。状態の色（危険・警告・成功・リンク）は、紙でも 4.5:1 を確保する。**墨の値の変更は、機構の確認が済んでから別の手順で**行い、差分が `tokens.css` に集まるようにする。
3. **アクセント**: 現行 4 テーマ（Dark Olive 既定、Classic Blue、Forest Teal、Charcoal Monochrome）の値を、紙と墨のそれぞれで使えるようにし、**朱（`vermilion`）を追加**（案: `accent-color #b8472c`、`accent-hover #cf5c3c`、`accent-label #f1977c`。紙・墨で読めるか確かめて調整してよい）。**自分で指定する色**（`custom`）は、`appearance.js` が `--accent-color` `--accent-hover` `--accent-label` `--accent-active-bg` `--text-on-accent` と、チャンネル `--accent-rgb` を計算して `body` の style に流す（HSL の計算。選んだ色の上の文字が 4.5:1 になるよう白／黒を選ぶ）。使わないときは何も計算しない・何も作らない。
4. **チャンネルのトークン**（`color-mix()` が使えないため。契約 §1.5）: `--accent-rgb` `--ink-rgb` `--shade-rgb` `--page-rgb` `--sheet-rgb` `--wall-rgb` `--bar-top-rgb` `--bar-bottom-rgb` `--text-muted-rgb`（`85 107 47` の形。値は対応するトークンと一致し、テストで縛る）。タブ用（`--tab-accent`、`--tab-base`、`--tab-ink`、`--tab-ink-hi`、`--tab-hair`、`--tab-dirty`、`--tab-conflict`。P3 の計画書の付録 A）、分割・プレビュー・付箋用（P4/P5 の計画書が名前を挙げているもの）も、**値だけ**先に作る（使うのは後の段）。
5. **プレビュー（`.markdown-body`）、コード、Mermaid、KaTeX、検索の強調、選択範囲、スクロールバー**が紙で読めること。Mermaid は P1a で未対応のまま残った 3 つの `themeVariables` を `getComputedStyle` で読む形に直し、紙では既定のトーンを地に従わせる設定値 `auto` を足す（既存の設定値は保つ）。
6. **「外観」の設定の節**（設定画面）: 地、アクセント（色見本と、自分で指定する色の入力）、エディタのフォント（`<input id="cfg-editor-font" list=…>`。空 = 既定。同梱しない。変えたら `invalidateCharPixelMirrors()` など、フォントに依存する測定を更新する。大きさは現行の設定）。**P2 の透過・自動非表示と、P4 の分割の境界の設定は後からこの節に足される**ので、足しやすい構造にする。保存前に即時反映し、取り消しで戻る（現行の設定画面の流儀に合わせる）。i18n は英日。
7. **保存の罠（F7）**: `syncBackendConfig` と `loadLocalConfigSync` は**既知のキーだけ**を `config` に写す。`config.appearance` を写さないと次の保存で消える（`config.semantic` と同じ罠）。**両方に足し**、保存→再読み込みの往復テストを書く。正規化は**未知のキーを保つ**（後の段が足す）。設定パッケージ（`config_pack.js`）は `appearance` を `general` の節のキーとして扱う。Go は設定を JSON のまま持つので変更不要（確認して報告）。
8. **全図を両方の地で撮る**: `tools/docshots/run.mjs` に `--look ink|paper`（モックの設定に `appearance` を入れる）と、必要ならアクセントの指定を足し、英語の全図を**紙と墨**で撮り直す。**撮った画像を 1 枚ずつ自分の目で見て**（Read ツール）、読めない・見分けがつかない・色が合っていない箇所を直す。報告には、直した箇所の一覧と、**どの図が気になるか**を書く。
9. **ロック**: コントラストのテスト（`tests/look_contrast_test.mjs`: 主要な文字と面の組で、紙・墨・全アクセントで、本文 4.5:1、補助の文字 3:1 以上。組の一覧はテストに書く）、禁止構文のテスト（`color-mix(`、`@container`、CSS のネストを `frontend/css/*.css` と JS の style 文字列から探す。既存の `file_anchor.js` は直前に代替の宣言がある例外として許可）、`appearance` の往復テスト。それぞれミューテーション確認をする。
10. 7 つの既存テストが `style.css` の文字列を検査している（P1a で `withTokens()` 経由に直した）。紙・墨の値の変更で落ちるものは直し、**値の検査ではなく規則の検査**にする。`panel_template_test.mjs`・`first_run_welcome_test.mjs` の `rgba(255, 255, 255, 0.07)` の行は、トークン経由に直す。
11. 検証: `node tools/run_js_tests.mjs` 全件、`node tests/smoke/run.mjs` 英日、docshots 英語の紙・墨、隔離した実アプリ（`E2E/v2-p1b.exe`）で、設定画面の「外観」から地・アクセントを切り替えて保存→再起動しても残ること、スクリーンショットを目で確認。追加したバイト数と、起動時に何も増えていない（未使用なら何もしない）ことを報告する。

報告の形は §6 のとおり。

## 8. P2: ヘッダー・フッターのオーバーレイ、自動非表示、透過、Zen（P1b の後）

計画書 `docs/design/v2-plan-P2.md` が詳細（インベントリ、ステップ S0〜S8、状態機械、設定、性能の測り方、リスク）。**計画書の記述を契約として扱う**。ただし次のオーナーの決定が優先する:

- **Zen（`body.zen-mode`、Shift+F11）**: 余白は**消さない**（現行どおり本文の左右を広げ、行番号は薄める。計画書 §4.6 の「余白」の行）。バーはマウスの移動では戻らず（窓の上端・下端のホットゾーン 150ms か `F6` で戻る）、通知（`#stat-message`）は見えなくする（読み上げ用の `aria-live` には残す）。**失敗（保存の失敗・設定の保存失敗・ディスクの衝突など）と録音中は Zen でも出す**（`important`）。タブの帯は隠す（P3）。
- オーバーレイの自動非表示は**既定で有効**（`appearance.autoHide: true`）。切る設定を付ける。
- **既定の透過**は暫定で `light`（半透明・ぼかしなし）。S8 の測定で決める。
- 新しい CSS は `frontend/css/chrome.css`（`media=screen`）に置く（計画書 §2.2）。P1b で `tokens.css` と `appearance.js`（正規化。**未知のキーを保つ**）は出来ている: `appearance.bars`（`solid|light|glass`）と `appearance.autoHide` は**そこへ足す**（新しい `appearance.js` を作らない）。設定画面の「外観」の節（P1b が作った）に `#cfg-bars` と `#cfg-auto-hide` を足す。チャンネルのトークン `--bar-top-rgb` `--bar-bottom-rgb` `--text-muted-rgb` は P1b で出来ている（ledger `v2-tokens.md` を確認）。
- 契約 §1.5（`color-mix()` などの禁止）と、P1b の `tests/css_compat_test.mjs`（禁止構文の検査）、`tests/look_contrast_test.mjs` を守る。**紙と墨の両方**で確かめる（`--look paper`）。
- 性能は最優先: 基準は `tools/perf/baseline-v1.14.md`（起動 483ms、8 万行を開く 1.86 s、入力 p50 128ms）。P1b の時点の値（`scratchpad\perf\`、起動 +3%、8 万行を開く +4%）より悪化させない。S8 は `tools/perf/v2_perf.mjs`（`--config-patch`、GPU プロセスの CPU、`--disable-gpu` の構成が計画書で頼まれているので、**この担当がハーネスに足してよい**: `tools/perf/` はこの段の担当に引き継ぐ）で測る。

**分担（直列）**: P2a = S0〜S3（実機での前提確認、余白の変数化［画素一致］、オーバーレイへの切り替え、自動非表示の状態機械）。P2b = S4〜S8（透過と設定、Zen、行番号を余白に、後始末、測定と既定の決定）。P2a が終わったら統括役が検証してコミットし、P2b を始める。

## 9. P3: タブを窓の端の細い帯にする（P2b の後）

計画書 `docs/design/v2-plan-P3.md` が詳細。**§4 の D1〜D13 は、推奨案をそのまま採用する**（オーナーは細かい選択を私に任せ、実アプリで見て直す方針）。要点: 「+」は左の帯の足元（`#btn-new-tab` の id を保つ）、「すべてのタブ」は一覧・パレット・RPC を残し、ボタンはあふれたときだけ帯の足元に出す、ピン留め・タブ名の変更・中クリックで閉じるは**足さない**、左右の帯は同じ全ノートの一覧と順序（各帯が自分のペインの選択中を持つ。帯をクリックしたペインが変わる。Alt+クリックは従来どおり）、見開きプレビューは左の帯だけ（常に左のページを変えてプレビューが付いてくる）、プレビューのみは帯なし、20 枚を超えたら 30px → 20px に詰め、それでも超えたら縦スクロール（選択中は必ず見える）、幅 6px・当たり判定 12px・展開 200px・右の帯のスクロールバー用の余白 9px は**CSS 変数のまま**（オーナーが実アプリで決める）、未保存の印は丸、**`F6` の巡回は 本文 → ヘッダー → 左の帯 → 右の帯（あれば）→ フッター → 本文**（P2a の `focusChrome` に帯を足す）、`Ctrl+Shift+Tab` を「前のタブ」に直す（別の小さな修正としてテスト付きで）、Zen では帯を隠す（`visibility: hidden`）。

- DOM の契約（`#tabs-list`、`#tabs-scroll`、`.tab-item[data-tab-id]`、`.tab-title`、`.tab-dirty-dot`、`.tab-conflict-mark`、`.tab-close`、`#btn-new-tab`、`#btn-all-tabs`、`#tab-list-panel`）を**保つ**（多くのテスト、スモーク、docshots の isReady がこれに依存する）。`renderTabs()` の全再構築（約 40 の呼び出し）は、キー付きの更新にして、キーボードのフォーカスを失わない。
- 濃淡は `color-mix()` を使わず、疑似要素の `opacity` を `--d`（選択中からの距離）から `max(floor, calc(base - step*d))` で出す（計画書 §2）。トークンは P1b で出来ている `--tab-*`。上端・下端は P2a の `--ov-top` / `--ov-bottom`（`--tab-strip-top/bottom`）。
- 計画書が名指しする罠: `#workspace` の padding は `initPaneResizer` の比率計算を狂わせる（ペイン側に空きを取る）、結果ブロックの帯（ガターの左端 3px）と 6px の帯の衝突、ネイティブのスクロールバー幅（Windows 15px。右の帯の余白は実測値で）、`tab_overflow.js` に軸の引数を足して純粋関数を再利用、ソースや CSS の文字列を検査する 4 つのテストと、描画方法に依存する 2 つのテストを同時に直す、偽 DOM に伝播が無い（`children`/`appendChild`/`insertBefore` だけで動く更新）。
- 各手順の終わりで動く状態を保つ（計画書 §3 の S1〜S7）。性能: 帯の展開は**オーバーレイ**（本文の再レイアウトをしない）、キー入力ごとのコストは 0。基準は `tools/perf/baseline-v1.14.md` と P2b の結果。

## 10. P4: ページ・分割・プレビュー・分割の境界（P3 の後）

計画書 `docs/design/v2-plan-P4-P5.md` の P4 の部分が詳細。**§2.5 の Q1〜Q10 は推奨案をそのまま採用する**。要点: プレビューの紙は**ペイン自身**（`#preview-pane` が紙になる。ラッパーを足さない。`print.css` と `print_style_test` が `#workspace > #preview-pane` の親子を固定しているため）、机の色は親、中央寄せ 800px まで、ホイール転送を足す、仕切り（`#pane-resizer`）に**キーボード操作を新設**（`role="separator"`、`tabindex`、矢印、Home/End、Enter で既定に戻す）、右ペインのヘッダーは小さな浮き帯にし両ページに同じ上余白（P2 の `--pad-top-extra`）、`appearance.splitBoundary`（`dots` 既定｜`shade`｜`line`）、エディタのフォント設定は P1b で済み、`print.css` は紙のまま、Mermaid は P1b の `auto`。仕切りの比率を保存するかは Q7 の推奨に従う。

## 11. P5: 付箋のパネル（P4 の後）

計画書 `docs/design/v2-plan-P4-P5.md` の P5 の部分が詳細。**§3.6 の Q1〜Q8 は推奨案をそのまま採用する**。要点: 位置・幅 560px・フェード・入力欄の規則は v1.10.5 のまま、面だけを付箋に（薄いアクセント色の紙を**背景の重ね**で作る、粘着帯、折り目、持ち上がった影。`clip-path` は影を切るので、切り欠きは `::before` の紙の層だけに付ける。回転しない）、フォーカスは粘着帯がアクセントの塗りになることで示す（v1.10.5 の「枠がアクセントになる」規則を置き換える）、墨の地では暗い紙（`--sheet` を土台）、設定画面は付箋ではなく**素の「紙」**（`--sheet`・影・粘着帯と折り目なし）、パネルの位置の定数（`--panel-top` / `--panel-modal-top` / `dockPanelBar` の 16 / Ctrl+J の `bottom`）は P2 のオーバーレイに合わせ済みか確認し、Ctrl+J のパネルを `#editor-wrapper` から `#workspace` へ移す。`panel_template_test`・`panel_fade_test` を規則の検査として改訂。
