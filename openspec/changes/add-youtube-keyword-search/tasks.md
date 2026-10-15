# Tasks

## 1. 來源能力表與純函式（youtube-search profile）

- [x] 1.1 `src/services/sourceProfiles.ts`：`SourceProfile` 介面新增可選欄位 `tracksParseProgress?: boolean`（省略視為 true）；新增常數 `SEARCH_RESULT_LIMIT = 50` 與純函式 `buildYouTubeSearchUrl(keyword)`（trim 後組 `ytsearch50:<關鍵字>`）、`isSearchSource(url)`（`/^ytsearch\d*:/`）、`isSearchVideoEntry(entry)`（只認 `ie_key === 'Youtube'` 白名單）；註冊 `youtube-search` profile（`kind: 'collection'`、`flatMetadata: 'full'`、`needsPreParseConfirm: false`、`tracksParseProgress: false`、progressKey `yt:search:<關鍵字>`）。驗證：`npx vue-tsc --noEmit` 通過。
- [x] 1.2 `src/services/__tests__/sourceProfiles.spec.ts` 擴充：`resolveSourceProfile('ytsearch50:周杰倫')` 命中 `youtube-search` 且 `tracksParseProgress === false`；既有網址來源的命中順序不受影響；`buildYouTubeSearchUrl` 處理前後空白與含冒號的關鍵字；`isSearchVideoEntry` 對 `Youtube`／`YoutubeTab`／`YoutubePlaylist` entry 的取捨正確。驗證：`npm test` 通過。

## 2. 桌面端解析過濾（DownloadService）

- [x] 2.1 `src/services/DownloadService.ts` 的 `processEntries`：來源為搜尋（`isSearchSource(url)`）時，在子清單展開判斷之前短路——非 `isSearchVideoEntry` 的 entry 直接丟棄、不展開；留下註解指向 Android 端同規則（design D5）。驗證：`npm test`、`npm run build` 通過，且桌面端手動搜尋「周杰倫」明細不含頻道項目、無頻道被展開的大量影片。

## 3. App.vue 搜尋入口與流程接線

- [x] 3.1 `addTask()` 非網址分支：非空白且不以 `http(s)://` 開頭時改彈確認對話框「要用 YouTube 搜尋『<輸入文字>』嗎？」，確認後以 `buildYouTubeSearchUrl` 轉為虛擬網址續走既有流程，取消則不動作並保留輸入框內容；空白輸入維持既有提示。驗證：桌面端手動操作三種情境（確認、取消、空白）符合 spec 情境。
- [x] 3.2 解析結果處理：`parseProgress` 推進加上 `tracksParseProgress !== false` 防護；搜尋來源覆寫 `parsedChannelTitle = 'YouTube 搜尋'`、`parsedPlaylistTitle = <關鍵字>` 並設 `parsedSourceIsSearch` 旗標；無結果訊息按來源區分（搜尋顯示「找不到相關影片」）。驗證：同一關鍵字連續搜尋兩次皆為完整新搜尋、不出現「繼續上次進度」詢問。
- [x] 3.3 `onBatchModalConfirm()`：搜尋來源的子任務 `channelPrefix` 設為空字串（非 `parsedChannelTitle`），讓下載完成回報的實際頻道名經既有補值機制填入。驗證：自搜尋結果下載一部影片，任務樹歸於「YouTube 搜尋 / <關鍵字>」，完成後顯示標題與檔名前綴為該影片實際頻道名。
- [x] 3.4 主輸入框 placeholder 改為「輸入影音網址，或關鍵字搜尋 YouTube」。驗證：畫面檢視文案更新。

## 4. Android 端同步

- [x] 4.1 `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java` 的 `processEntriesHelper`：`originalUrl` 以 `ytsearch` 開頭時跳過子清單展開、只保留 `ie_key` 為 `Youtube` 的 entry；留下註解指向桌面端同規則。驗證：`gradlew :app:compileDebugJavaWithJavac` 通過。
- [ ] 4.2 Android 端手動驗證：關鍵字搜尋 → 明細只列影片 → 勾選 2 部批次下載成功，行為與桌面端一致（含頻道命中被濾除）。

## 5. 整合驗證與進版

- [x] 5.1 全套建置驗證：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過。
- [ ] 5.2 桌面端端到端驗證：關鍵字搜尋 → 勾選 2 部 → 批次下載成功且去重正常；漏打協定的網址（如 `www.youtube.com/...`）會進搜尋確認框且可取消；既有網址輸入路徑（單片、播放清單、頻道）行為不變。
- [x] 5.3 功能 commit 後進版：7 處版號同步（`package.json`、`package-lock.json` 2 處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 以 `cargo update --workspace --offline` 同步、`android/app/build.gradle` 的 `versionName` 與 `versionCode`），並把 `avd_s/publish_all.ps1` 的 `$Message` 預設值更新為本次改動描述與新版號；功能與進版各自一個 commit。驗證：grep 新版號於上述各處一致，`publish_all.ps1` 的版號防呆比對可通過。
