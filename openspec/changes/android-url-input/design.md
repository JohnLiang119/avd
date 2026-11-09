## Context

- 主畫面輸入列（`App.vue` 的 `<van-form class="download-form">`）整列包在 `v-if="isTauri()"`，自初版 `126fad8` 起即如此；Android 只能經 `ACTION_SEND` 分享進網址（`MainActivity.handleIntent` → `DownloadService.getSharedUrl` → `checkSharedUrl` → `addTask`）。
- `addTask` 與 `DownloadService.download` 不分平台；Android 端由 `YoutubeDlPlugin`（youtubedl-android）執行，任意 yt-dlp 支援的網址皆可下載。

## Decisions

### D1 只拆開平台判斷，不另做 Android 版輸入介面

- 輸入框、送出鈕與 Windows 共用同一段模板與 `onSubmit`，行為（網址 → 佇列、非網址 → 搜尋確認、重複網址提示）自然一致，不會兩端漂移。
- 只有「開啟資料夾」「連結 Drive」改包 `v-if="isTauri()"`：前者呼叫桌面檔案總管；後者在 Windows 是 Rclone 設定，Android 的對應設定已在偏好設定內，不必在主畫面重複。

### D2 欄位型別維持一般文字，不用 `type="url"`

- 欄位同時是關鍵字搜尋入口；部分 Android 鍵盤在 url 型別下沒有空白鍵，打不了多字關鍵字。
- 網址多半以長按貼上，文字鍵盤不影響。

### D3 不從整段文字中擷取網址

- 從 App 複製的分享文字可能是「標題 + 網址」，分享入口（`checkSharedUrl`）會以正規式取出網址；輸入框則維持既有行為 —— 非 `http(s)://` 開頭即視為關鍵字並徵詢確認。改成擷取會牴觸 `youtube-keyword-search` 規格「非網址開頭的文字必須先徵詢」，且確認對話框已讓使用者有機會取消後修正。

## Risks / Trade-offs

- **[手機主畫面變擠]** → 只多一列輸入框（Windows 那兩顆按鈕不出現），`.download-form` 原有的 25px 下邊距在 Android 本來就在（空表單），版面不會再額外下推。
- **[TV 模式]** → 整個表單既有 `v-show="!isTvMode"`，TV 上仍不顯示。
