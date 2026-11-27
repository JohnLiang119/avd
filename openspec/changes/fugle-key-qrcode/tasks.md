## 1. 實作

- [x] 1.1 金鑰欄右側新增「QR」按鈕（未設定金鑰時提示先填寫）。
- [x] 1.2 新增 QR code 對話框：`qrcode-vue` 顯示金鑰、外流提醒、60 秒倒數自動關閉，不顯示金鑰全文。

## 2. 驗證

- [x] 2.1 `npm run build`、`npm test`、`npx vue-tsc --noEmit` 通過。
- [x] 2.2 `cargo check`、`gradlew :app:compileDebugJavaWithJavac` 通過。
