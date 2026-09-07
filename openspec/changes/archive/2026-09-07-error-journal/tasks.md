# 實作任務

## 1. 日誌核心

- [x] 1.1 新增 `src/composables/useErrorLog.ts`，定義 `ErrorEntry`（時間、情境、訊息原文）與保留上限常數 50
- [x] 1.2 實作純函式 `appendErrorEntry(entries, entry, limit)`：附加新紀錄並裁掉最舊者
- [x] 1.3 實作 `formatErrorLog(entries)`：轉為供複製的純文字，每筆一段（`[時間] 情境` 換行後接訊息原文）
- [x] 1.4 補上 vitest：附加、超出上限的裁切、空日誌的格式化、訊息不被截斷

## 2. 回報入口

- [x] 2.1 於 `App.vue` 建立錯誤日誌的持久化設定（`storage.defineSetting`，預設空陣列）
- [x] 2.2 實作 `reportError(context, error)`：寫入日誌 + 顯示提示（`duration: 5000`、`closeOnClick: true`）
- [x] 2.3 日誌寫入以 try/catch 包覆並吞掉例外 —— 記錄失敗絕不可讓原本的錯誤處理更糟（design D2）
- [x] 2.4 訊息取用 `error.message || String(error)`，不做長度截斷

## 3. 既有錯誤路徑改接

- [x] 3.1 逐一改寫約 17 處錯誤 `showToast` 為 `reportError`，各自帶上簡短的操作情境
- [x] 3.2 **不動**成功與資訊類的 `showToast`（約 60 處）
- [x] 3.3 **不動**下載任務的 `errorMsg` / `line` 機制
- [x] 3.4 全域搜尋 `showToast` 中含「失敗」「錯誤」「❌」者，確認殘留皆為刻意保留

## 4. 檢視與複製

- [x] 4.1 設定面板新增「錯誤紀錄」入口，顯示筆數
- [x] 4.2 檢視畫面依時間由新至舊列出，訊息完整可捲動
- [x] 4.3 日誌為空時顯示「目前沒有錯誤紀錄」，而非空白畫面
- [x] 4.4 「複製全部」以 `navigator.clipboard.writeText` 寫入剪貼簿，成功後提示已複製
- [x] 4.5 複製失敗時明確告知失敗，**不得**顯示成功提示（規格要求）
- [x] 4.6 「清空」操作，清空後狀態同樣持久化
- [x] 4.7 檢視畫面加上提醒：複製前請確認內容不含不願外流的資訊（design 風險項）

## 5. 建置與驗證

- [x] 5.1 `npm run build`、`npx vue-tsc --noEmit`、`npm test`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [x] 5.2 `openspec validate error-journal --strict` 通過
- [x] 5.3 Windows：故意觸發一次解析失敗，確認提示停留較久、可點擊關閉，且日誌中留有完整原文
  - **經使用者決定延後（2026-09-07，「以 Android 為主、Windows 隨緣」）**。
    Android 的等價情境已由 5.7 覆蓋（兩則實錄：HTTP 429 與抽不出 sec_uid）。
    未驗到的僅為 Windows 端提示的停留時間與可點擊性 —— 該行為由前端共用
    程式碼決定，與平台無關。
- [x] 5.4 Windows：複製全部後貼到文字編輯器，確認格式可讀、訊息完整
  - **經使用者決定延後**。格式與完整性已於 Android（5.6）確認。
- [x] 5.5 Windows：重啟 App 後日誌仍在；清空後重啟仍為空
  - **經使用者決定延後**。殘留風險：持久化在兩平台走不同的儲存介面卡
    （Windows 為 `TauriStoreAdapter`／`config.json`，Android 為
    `LocalStorageAdapter`）。Android 已驗，Windows 端的日誌持久化未實證 ——
    惟該路徑與其餘 14 項設定共用，若壞則所有設定皆會失效，不會只壞日誌。
- [x] 5.6 **Android 實機：確認 `navigator.clipboard` 可用** —— **可用**，複製全部正常。
    design 的 Open Question 就此解答：不需要改走 Capacitor 分享機制或原生 plugin。
- [x] 5.7 Android 實機：重跑一次會失敗的解析，確認錯誤原文可自日誌取得
  - 已取得兩則實錄並用於實際偵錯：`HTTP Error 429`（17:15）與
    `[tiktok:user] ttggwang: Unable to extract secondary user ID`（17:46）。
    後者促成 v1.0.73 的間接徵狀辨識，前者促成 v1.0.72 的退避重試 ——
    此功能在上線當日即產生實質診斷價值。

## 6. 追記（實作期間發現）

- [x] 6.1 實際改接 16 處而非提案估計的 17 處：清點後其中一處
      （`已將所有失敗/中止的任務重新加入佇列`）是成功訊息而非錯誤，
      字串含「失敗」二字只是描述被重試的任務。
- [x] 6.2 額外處理兩處提案未列的路徑：
      - 「檢查更新失敗」原本丟掉了 catch 到的例外，只顯示固定字串
        「請確認網路連線」—— 真正的原因從未被呈現過。改為 `reportError`
        後原文才進得了日誌。
      - `checkAllMonitoredChannels` 迴圈內逐頻道的失敗原本只有
        `console.warn`（Android 上等於不存在）。改為只記入日誌、不逐頻道
        彈提示，迴圈結束後仍由既有的總結提示統一告知。
- [x] 6.3 頻道檢查的總結提示（`❌ 無法連線至 YouTube 頻道…`）保留原文字，
      只補上 5 秒與可點擊關閉。該訊息本身已具指引性，逐頻道的原始錯誤
      另行記入日誌。
- [x] 6.4 「複製全部」以 `before-close` 攔截確認鈕並回傳 `false`，
      複製後不關閉對話框 —— 使用者往往要複製後再看一眼確認。
