# Proposal

## Why

目前 avd 只接受影音「網址」輸入；使用者想下載但手上沒有連結時，必須離開 App 到 YouTube 搜尋、逐一複製網址再貼回來。提供 App 內的關鍵字搜尋，讓「搜尋 → 明細勾選 → 批次下載」一氣呵成，不必往返瀏覽器。

## What Changes

- 主輸入框接受非網址文字：輸入不以 `http(s)://` 開頭的文字時，不再直接報錯，而是徵詢確認後以該文字作為 YouTube 搜尋關鍵字（確認對話框讓打錯網址的輸入有機會退回，不會莫名其妙變成搜尋）。
- 搜尋以 yt-dlp 的 `ytsearchN:<關鍵字>` 虛擬網址實作，走既有的清單解析管線；**不動用 YouTube Data API**（search.list 每次 100 單位，會吃掉頻道追蹤的每日配額，且搜尋不應要求使用者先設定金鑰）。
- 搜尋結果（預設前 50 筆）重用既有的批次下載嚮導對話框：列出標題與片長，支援全選／全不選／單項勾選，確認後整批加入下載佇列（含 MP3 模式、已存在網址去重等既有行為）。
- 搜尋結果只列**影片**：命中的頻道與播放清單會被濾除——既有解析邏輯會把這類 entry 當子清單整個展開（實測搜尋「周杰倫」第一筆即是頻道），搜尋情境下這是災難性的誤展開。
- 來源能力表（`sourceProfiles.ts`）新增 `youtube-search` 來源；搜尋**不記錄續抓進度**——搜尋結果不是穩定序列，以筆數定址續抓必然錯位。
- 任務樹以「YouTube 搜尋 / <關鍵字>」分組；子任務的頻道前綴留空，由下載完成時回報的實際頻道名補上（搜尋結果橫跨多個頻道，統一前綴是錯的）。
- 兩平台（Windows Tauri sidecar 與 Android YoutubeDl plugin）共用同一流程；Android 端的子清單展開邏輯需同步濾除規則。

## Capabilities

### New Capabilities

- `youtube-keyword-search`：關鍵字輸入的辨識與確認、以 yt-dlp 執行 YouTube 搜尋、結果過濾（只列影片）、搜尋不記進度、批次下載的任務歸組與命名等行為。

### Modified Capabilities

（無——`youtube-download` 既有的嚮導對話框勾選與批次下載行為完全不變，搜尋只是多了一個通往它的入口。）

## Impact

- `src/App.vue`：`addTask` 的非網址分支（確認對話框、組出搜尋虛擬網址）、解析成功後的進度推進加上「不記進度」防護、搜尋來源的群組標題覆寫、`onBatchModalConfirm` 的頻道前綴處理、輸入框 placeholder 文案。
- `src/services/sourceProfiles.ts`：新增 `youtube-search` profile（含不記進度旗標與「只列影片」的 entry 過濾規則）。
- `src/services/DownloadService.ts`：`parsePlaylist` 對搜尋來源跳過子清單展開並濾除非影片 entry。
- `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java`：`processEntriesHelper` 同步濾除邏輯。
- 測試：`src/services/__tests__/sourceProfiles.spec.ts` 等既有測試檔擴充。
- 版號：依規範 7 處同步進版，並更新 `avd_s/publish_all.ps1` 的 `$Message` 防呆文字。
