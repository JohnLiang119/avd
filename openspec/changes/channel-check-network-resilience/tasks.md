## 1. Rust 端（Windows/Tauri）錯誤分類

- [x] 1.1 查核 `ureq::Error` 的實際變體與 `Kind`（`Error::Status` 與 `Error::Transport` 各自涵蓋的失敗情境，含 DNS 解析失敗、連線逾時、連線被拒），確認能可靠分流
- [x] 1.2 修改 `src-tauri/src/lib.rs` 的 `fetch_http_text`：依變體組裝分類前綴（`HTTP_STATUS:<code>:<訊息>` 或 `NETWORK_ERROR:<訊息>`），而非現行單一 `format!("HTTP 請求失敗: {}", e)`，並執行 `cargo check` 確認編譯通過

## 2. Android 端錯誤分類

- [x] 2.1 修改 `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java` 的 `fetchChannelRss`：在既有的非 200 分支組裝 `HTTP_STATUS:<code>:<訊息>`；新增針對 `UnknownHostException`／`ConnectException`／`SocketTimeoutException` 的攔截，組裝 `NETWORK_ERROR:<訊息>`，其餘例外維持現行 `catch (Exception e)` 兜底
- [x] 2.2 執行 `gradlew :app:compileDebugJavaWithJavac` 確認編譯通過，並確認 UTF-8 無 BOM（`.java` 規範）

## 3. 前端錯誤分類與退避重試

- [x] 3.1 在 `src/services/rateLimit.ts` 新增分類函式，解析 `NETWORK_ERROR:`／`HTTP_STATUS:<code>:` 前綴，回傳錯誤層級（網路層／伺服器層／內容層），並撰寫對應單元測試（比照既有 `rateLimit.spec.ts` 風格，涵蓋三種前綴與無前綴的既有內容層錯誤訊息）
- [x] 3.2 修改 `src/services/DownloadService.ts` 的 `fetchYouTubeRss`：將現有「取得 XML」段落包入退避重試迴圈（沿用 `RATE_LIMIT_MAX_RETRIES`、`rateLimitBackoffMs`），僅對網路層與伺服器層錯誤重試，內容層錯誤（XML 為空、解析失敗）不重試；重試耗盡後才進入現有的備援/拋錯邏輯，且拋出的錯誤訊息需保留分類資訊供上層判斷
- [x] 3.3 撰寫或更新 `DownloadService` 相關測試，驗證：(a) 網路層錯誤在重試期間恢復時不拋錯 (b) 重試耗盡後才拋錯且訊息含分類資訊 (c) 內容層錯誤不觸發重試、立即進入既有邏輯

## 4. 訊息呈現

- [x] 4.1 新增依錯誤分類回傳文案的純函式（緊鄰 `rateLimit.ts` 或 `DownloadService.ts`），網路層錯誤回傳不含備援建議的文案，伺服器層/內容層錯誤維持現有含備援建議的文案，並撰寫單元測試涵蓋三種分類
- [x] 4.2 修改 `src/App.vue` 的 `checkAllMonitoredChannels` 總結 Toast 組字邏輯，改用新的文案函式取代現行寫死的三元判斷，人工核對四種既有分支（全部失敗／部分失敗有新片／部分失敗無新片／全部成功）在網路層錯誤情境下的顯示文字符合預期

## 5. 整合驗證

- [x] 5.1 執行 `npm run build`、`npm test`、`npx vue-tsc --noEmit` 全數通過
- [ ] 5.2 Windows 端：暫時斷開網路後手動觸發「檢查頻道」，確認退避重試期間的行為（可觀察 console 或加中間輸出），並確認最終顯示「目前無法連線」而非「官方 RSS 連線異常」，且不建議開啟備援
- [ ] 5.3 Windows 端：以真實頻道確認正常情況下 RSS 檢查行為不變（無退避、無多餘延遲）
- [ ] 5.4 Android 實機：比照 5.2、5.3 驗證兩種情境下的行為與文案
- [x] 5.5 確認錯誤日誌（`errorLog`）在退避重試自行恢復的情境下不新增紀錄；在重試耗盡的情境下新增的紀錄仍保留原始錯誤訊息（供除錯）

## 6. 版本進版

- [x] 6.1 全面同步 avd 專案版號（`package.json`、`package-lock.json` 兩處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`android/app/build.gradle` 的 `versionName` 與 `versionCode`）
- [ ] 6.2 確認第 5 節全部驗證通過後，建立獨立於功能修正的進版 commit
