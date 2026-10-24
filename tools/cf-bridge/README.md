# syki::sok Cloudflare Mobile Bridge

外出先（Pixel / iPhone / Android等）から `syki::sok` へ、テキスト・写真・音声メモを瞬時に投函するための軽量中継サーバー（Cloudflare Worker & PWA）です。

## 特徴
- **超軽量 PWA**: アプリインストール不要。スマホのブラウザでURLを開き「ホーム画面に追加」するだけで即起動。
- **マルチメディア対応**: テキスト（文字数無制限）、カメラ写真、ワンタップ音声録音（MediaRecorder）。
- **オフラインキュー（Optimistic UI）**: 地下鉄など圏外時でも即座にメモを入力・保存可能。オンライン復帰時に自動送信。
- **強整合性 & 完全消去**: Cloudflare D1（SQLite）を採用。PC（`syki::sok`）がフェッチしてローカルに保存した瞬間にクラウド上から完全消去。
- **自動メタデータ**: 端末名（Pixel等）、クライアント側記録時刻、Cloudflareエッジによる都市名（Tokyo等）を自動付与。

---

## デプロイ手順（3ステップ）

### 1. 依存パッケージのインストール
```bash
cd tools/cf-bridge
npm install
```

### 2. D1 データベースの作成
```bash
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create syki_memos_db
```
出力された `database_id` をコピーし、`wrangler.toml` の `database_id = "..."` に貼り付けます。

スキーマを適用します：
```bash
# ローカル検証環境
npx wrangler d1 execute syki_memos_db --local --file=schema.sql

# 本番環境
npx wrangler d1 execute syki_memos_db --remote --file=schema.sql
```

### 3. 認証トークンの設定 & デプロイ
任意の強力な秘密トークンを Cloudflare Secrets に登録します：
```bash
npx wrangler secret put AUTH_TOKEN
# プロンプトが表示されたら、任意の秘密文字列（例: ランダムな英数字32文字以上）を入力
```

Workerをデプロイします：
```bash
npx wrangler deploy
```
デプロイが完了すると、専用の固定URLが表示されます：
`https://bridge.<your-subdomain>.workers.dev`

---

## スマホ（Pixel等）での初期設定

スマホで長いURLやトークンを手入力する必要はありません。
`syki::sok` デスクトップアプリの「設定 > Cloudflare Bridge」にデプロイしたURLとトークンを入力し、**「ペアリングQR」** をクリックしてスマホのカメラでスキャンするだけで自動接続されます。

* `#`（ハッシュ）以降の情報はスマホの `localStorage` に自動保存され、URL欄から自動消去されます。
* 画面右上の共有メニューから **「ホーム画面に追加」** をタップすれば、ネイティブアプリ感覚でワンタップ起動できます。
