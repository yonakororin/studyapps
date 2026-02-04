# 早押し国語 (Speed Kokugo Quiz)

中学受験向けの国語学習アプリ（四字熟語・ことわざ・故事成語）です。
スピード重視の早押しクイズで、楽しく語彙力を強化できます。

## 🚀 使い方

### 1. ローカルで実行する場合
このプロジェクトは **Webサーバー** 上で動作させる必要があります（ES Modulesを使用しているため）。

#### おすすめの方法
- **VS Code "Live Server"**: `index.html` を右クリックして "Open with Live Server" を選択。
- **Python**: ターミナルで以下を実行し、`http://localhost:8000` にアクセス。
  ```bash
  python -m http.server 8000
  ```
- **Node.js (Vite)**: 
  もしNode.js環境があれば、以下でセットアップ可能です：
  ```bash
  npm install
  npm run dev
  ```

### 2. クラウド設定 (Firebase)
学習記録をクラウドに保存するには、Firebaseの設定が必要です。
1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成。
2. "Webアプリ" を追加し、構成オブジェクト（apiKeyなど）を取得。
3. `js/app.js` の上部にある `firebaseConfig` をあなたのキーで書き換えてください。
   - ※ 設定しない場合、自動的に `localStorage`（ブラウザ保存）が使用されます。

## ✨ 機能
- **早押しクイズ**: 1問10秒。早く答えると高得点！
- **学習記録**: 日々の学習履歴をグラフで確認（予定）。
- **スマホ対応**: レスポンシブデザインでどこでも学習。

## 🛠 技術スタック
- HTML5 / CSS3 (Vanilla)
- JavaScript (ES6 Modules)
- Firebase Firestore (Cloud Storage)
