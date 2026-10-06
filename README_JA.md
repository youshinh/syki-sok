# syki::sok

**カーソルの位置にAIがいる、超軽量Markdownスクラッチパッド。**  
思いついた瞬間には、もう開いています。チャット画面へのコピー＆ペーストはもう不要です。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-win%20%7C%20mac-lightgrey)](#インストール)
[![Release](https://img.shields.io/github/v/release/youshinh/syki-sok)](https://github.com/youshinh/syki-sok/releases/latest)
[![Official Manual](https://img.shields.io/badge/Docs-公式マニュアル-green.svg)](https://youshinh.github.io/syki-sok/manual_ja.html)

<p align="center"><img src="img/screen_diagram.png" width="840" alt="syki::sok - 左右分割エディタとリアルタイムMermaid図解プレビュー"></p>

[**ダウンロード**](https://github.com/youshinh/syki-sok/releases/latest) • [公式マニュアル](https://youshinh.github.io/syki-sok/manual_ja.html) • [English README](README.md) • [全機能リファレンス](docs/features_ja.md)

---

## 3秒でわかる特徴

- ⚡ **超速常駐・省メモリ**: `Ctrl+Alt+M` で瞬時に前面へ。Electron非使用（Go + OS標準WebView）でアイドル時わずか 5〜15MB。
- 🤖 **カーソル直結のAI**: チャット欄との往復ゼロ。`Ctrl+L` で質問し、答えは打っている場所のすぐ下に挿入。
- 🔮 **リアルタイム予測補完**: 書いているそばからローカルLLM（Ollama等）が続きを薄文字で提案、`Tab` で確定。
- 🛠️ **文章＝コマンドライン**: `Ctrl+E` で選択行を `sort` や `jq` に通し、`Ctrl+Enter` で Claude Code などのエージェントにタスクを丸投げ。
- 📂 **安心のローカルプレーンテキスト**: あなたのPC上のふつうの `.md` ファイル。Git自動commit/pushや完全オフライン運用に対応。

---

## よく使う操作

| やりたいこと | Windows | macOS | 動作 |
|---|---|---|---|
| **前面に呼び出す** | `Ctrl+Alt+M` | `Opt+Cmd+M` | トレイや裏から瞬時に復帰（カーソル位置も維持） |
| **AIに指示・質問** | `Ctrl+L` | `Cmd+L` | 選択範囲について指示を入力。答えがすぐ下に入る（元の文章は不変） |
| **誤字・脱字の即時修正** | `Alt+C` | `Cmd+Shift+C` | ワンキーで選択範囲のタイポや不自然な日本語をその場で校正 |
| **続きの文章を予測採用** | `Tab` | `Tab` | ローカルモデルが提案する薄文字の予測文を一発で採用 |
| **シェルコマンドをかける** | `Ctrl+E` | `Cmd+E` | 選択行を `sort`, `jq`, `prettier` などに通して結果を下に挿入 |
| **AIエージェントに委任** | `Ctrl+Enter` | `Cmd+Enter` | `{{ @claude ... }}` などの指示をバックグラウンドで自律実行 |
| **次の一手のアドバイス** | `Ctrl+J` | `Cmd+J` | いま書いている文脈に合わせた次のアクションを最大3つ提案 |
| **メモ・タブの切り替え** | 右クリック / `Ctrl+Shift+F` | 右クリック / `Cmd+Shift+F` | 右クリックから開いているメモを即切り替え、または全メモ横断検索 |
| **Mermaid図解・プレビュー** | `Ctrl+Alt+V` | `Cmd+Opt+V` | 箇条書きからフローチャートを生成、リアルタイムで横に描画 |
| **すべてのコマンド** | `Ctrl+Shift+P` | `Cmd+Shift+P` | コマンドパレットを開く |

---

## 動きを見る

<details open>
<summary><strong>主な動作アニメーション（クリックで開閉）</strong></summary>

### カーソル位置でAIに指示・質問（`Ctrl+L`）
<p align="center"><img src="img/demo/ask-ai.gif" width="700" alt="下書きを選んで Ctrl+L を押し、指示を入力すると、整えた文章が選択範囲のすぐ下に入り、しばらく光ります"></p>

### 誤字・脱字をワンキーで直す（`Alt+C`）
<p align="center"><img src="img/demo/proofread.gif" width="700" alt="誤字だらけの文章で Alt+C を押すと、直した文章に、その場で置き換わる"></p>

### 打ちながら予測、`Tab` で採用
<p align="center"><img src="img/demo/ghost-text.gif" width="700" alt="キャレットの後ろに薄い予測が出て、Tab で採用される"></p>

### 文章にコマンドをかける（`Ctrl+E`）
<p align="center"><img src="img/demo/command-bar.gif" width="700" alt="行を選んで Ctrl+E を押し、シェルのワンライナーを入力すると、並べ替えて数えた結果が選択範囲の下に入る"></p>

### エージェントに任せる（`Ctrl+Enter`）
<p align="center"><img src="img/demo/delegate-agent.gif" width="700" alt="@claude で始まる行で Ctrl+Enter を押すと、行がエージェントのタスクになり、裏で実行されて、結果が下に届く"></p>

### ライブプレビュー。Mermaid の図もそのまま（`Ctrl+Alt+V`）
<p align="center"><img src="img/demo/live-preview.gif" width="700" alt="左で Markdown を書くと、Mermaid のフローチャートも含めて右にリアルタイムで描画される"></p>

</details>

---

## その他の主な機能

- **スマート貼り付け (`Ctrl+V`)**: Web・Word・Excel を綺麗な Markdown に自動変換。画像のスクショもOCRでテキスト化。
- **音声入力 (`Ctrl+Shift+R`)**: 話した内容を文字起こし＋自動推敲。選択範囲への編集指示としても適用可能。
- **Mobile Drop (`Ctrl+Shift+U`)**: QRコードを読むだけで、スマホの写真・音声・メモを直接PCのノートへ転送。
- **Discord連携**: 外出先から自分のDiscordボットに送ったメモが、次回起動時に自動で今日のノートに届く。
- **ホットフォルダ**: フォルダに画像や録音を入れるだけで、OCRや文字起こしを経て自動でメモ化。
- **IME Guardian**: コードブロックやURL内での日本語IME誤爆（全角英数化）を自動でブロック。
- **Zenモード (Shift+F11)**: バーをすべて隠して執筆に没頭。マウスを端に置いたときだけ静かに現れる。
- **スクリプト・外部連携**: `cat build.log | syki` でターミナルから直接流し込み可能。JSON-RPC API 完備。

---

## インストール

**Windows** (PowerShell):
```powershell
Invoke-WebRequest https://github.com/youshinh/syki-sok/releases/latest/download/syki-windows-x64.zip -OutFile syki-windows-x64.zip
Expand-Archive syki-windows-x64.zip -DestinationPath syki
syki\syki.exe
```

**macOS** (Homebrew):
```bash
brew install --cask youshinh/tap/syki
```
*(macOS版は初回起動時のみ「システム設定 → プライバシーとセキュリティ → このまま開く」が必要です)*

すべての zip は [GitHub Releases](https://github.com/youshinh/syki-sok/releases/latest) からダウンロードできます。

---

## スクリプトやAIエージェントから

```bash
cat build.log | syki                 # ターミナルの出力をそのままアプリへ流し込む
syki-cli buffer get                  # 開いているノートを読む
echo "- [ ] 次にやること" | syki buffer append  # ノート末尾に追記
syki-cli agent install-skill         # Claude Code や Codex に syki::sok 操作スキルを教える
```

---

## ドキュメント

- [公式マニュアル](https://youshinh.github.io/syki-sok/manual_ja.html)（[English](https://youshinh.github.io/syki-sok/manual.html)）: スクリーンショット付きの詳しい使い方
- [全機能リファレンス](docs/features_ja.md)（[English](docs/features.md)）: 仕様・全ショートカット・設定項目の一覧

## ライセンス

[MIT License](LICENSE) で配布しています。個人利用も商用利用も無料です。
