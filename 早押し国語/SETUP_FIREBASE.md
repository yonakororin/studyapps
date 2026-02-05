# Firebase セットアップガイド

アプリが「タイムアウト」や「権限エラー」になる場合、以下の設定を確認してください。

## 1. Firestore セキュリティルールの更新（重要）
機能追加に伴い、ルールの更新が必要です。
以下のコードを**すべてコピー**して、Firebaseコンソールの「ルール」エディタに上書き貼り付けしてください。

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. **Build** -> **Firestore Database** -> **ルール (Rules)** タブを選択
3. 以下の内容を貼り付けて **「公開 (Publish)」** を押す

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 1. 学習記録（履歴）
    match /study_records/{document=**} {
      allow read, write: if request.auth != null;
    }
    
    // 2. 問題データ（管理者が書き込み、全員が読み込み）
    match /questions/{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // 3. 苦手分析データ（NEW!）
    match /word_stats/{document=**} {
       allow read, write: if request.auth != null;
    }
  }
}
```

## 2. Authentication (認証) の確認
まだ設定していない場合のみ確認してください。
1. **Authentication** -> **Sign-in method**
2. **「匿名 (Anonymous)」** が **有効** であること

## 3. 動作確認
- 設定後、少し待ってからアプリをリロードしてプレイしてください。
- プレイ完了後、履歴画面や「苦手分析」画面を開いて動作を確認します。
- それでもエラーが出る場合は、ブラウザのキャッシュをクリアするか、シークレットウィンドウで試してみてください。
