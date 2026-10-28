# 實作任務

## 1. ① 確定性錯誤清單

- [x] 1.1 `downloadErrors.ts` 新增 `BOT_CHECK_ERRORS` 與回傳值的 `botCheck` 標記，比對前把彎引號正規化為直引號
- [x] 1.2 匯出 `BOT_CHECK_USER_MESSAGE` 專屬訊息
- [x] 1.3 補 vitest：實際 logcat 原文（彎引號）與直引號皆命中；私人影片、年齡確認等「Sign in」開頭訊息不帶 bot 標記；既有案例的回傳物件補上 `botCheck`

## 2. ② 前端錯誤處置

- [x] 2.1 `App.vue` 下載佇列的 `catch`：`botCheck` 命中時顯示 `BOT_CHECK_USER_MESSAGE`，不顯示「已自動重試 N 次」

## 3. ③ Android 端

- [x] 3.1 `YoutubeDlPlugin.java` 新增 `isBotCheckError`，metadata 預取的 `catch` 命中時直接重新拋出，不進入正式下載；其他失敗維持不中斷

## 4. 建置與測試

- [x] 4.1 `npm run build`、`npx vue-tsc --noEmit`、`npm test`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [x] 4.2 `openspec validate fix-bot-check-no-retry --strict` 通過

## 5. 驗證

- [ ] 5.1 Android 4G 下載同一影片：立即失敗、顯示專屬訊息、logcat 只有一輪 player API 請求
