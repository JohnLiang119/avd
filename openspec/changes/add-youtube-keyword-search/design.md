# Design

## Context

動機見 proposal.md「Why」。與本設計相關的現況：

- `App.vue` 的 `addTask()`（約 4659 行）對不以 `http(s)://` 開頭的輸入直接報錯返回——「非網址文字」的語意空間目前是空的，可安全賦予新意義。
- 來源判定集中於 `sourceProfiles.ts` 的能力表（`resolveSourceProfile`），加來源只需加一筆宣告；解析走 `DownloadService.parsePlaylist()`，桌面端以 Tauri sidecar 執行 `yt-dlp --flat-playlist -J <url>`，Android 端由 `YoutubeDlPlugin.parsePlaylist` 把 `url` 原樣交給 youtubedl-android——兩端都能直接吃 yt-dlp 的 `ytsearchN:<關鍵字>` 虛擬網址。
- 實測 `yt-dlp --flat-playlist -J "ytsearch3:周杰倫"`：
  - 頂層 `title` 即關鍵字；entry 無 `timestamp`／`upload_date`（與 YouTube 播放清單的 flat 結果一致）。
  - 影片 entry（`ie_key: "Youtube"`）帶 `title`、`duration`、`view_count`。
  - **第一筆命中是頻道**（`ie_key: "YoutubeTab"`、id 為 `UC...`）——現行 `processEntries` 的子清單判斷（`ieKey === 'YoutubeTab'` 等）會把它整個展開，等於把該頻道前 200 部影片灌進搜尋明細。
- 解析階段的取消（`cancelParsePlaylist`）、逾時（`PARSE_TIMEOUT_MS` 90 秒）、重試收斂（`PARSE_RESILIENCE_ARGS`）為既有機制，搜尋走同一條管線即自動繼承。
- 批次勾選對話框 `YouTubeBatchModal` 與 `onBatchModalConfirm` 的歸組／去重／MP3 模式皆為既有行為，搜尋只需餵入相同形狀的 `PlaylistItem[]`。

## Goals / Non-Goals

**Goals:**

- 以最小 UI 變動把「關鍵字 → 明細勾選 → 批次下載」接上既有管線，兩平台行為一致。
- 搜尋零 API 配額、免金鑰、免新依賴。
- 過濾規則可被單元測試釘住（純函式）。

**Non-Goals:**

- 不做搜尋結果的分頁／載入更多（結果非穩定序列，續抓必錯位；要更多結果就換關鍵字再搜）。
- 不做搜尋篩選條件（時長、上傳日期、排序方式）與搜尋歷史。
- 不補齊搜尋結果的發布時間（flat 結果沒有；明細以標題＋片長呈現，與 YouTube 播放清單現況一致）。
- 不支援 YouTube 以外平台的關鍵字搜尋。

## Decisions

### D1：搜尋引擎用 yt-dlp 的 `ytsearchN:`，不用 YouTube Data API

`search.list` 每次 100 單位，佔每日 10,000 配額的 1%，而配額已保留給頻道自動追蹤；且 API 需要金鑰，搜尋不該有這個前置門檻。`ytsearchN:` 是 yt-dlp 原生的搜尋 extractor，兩端現有管線不加任何依賴即可執行。代價：排序固定為相關性、flat 結果無發布時間——可接受（見 Non-Goals）。

### D2：入口共用主輸入框＋確認對話框，不另設搜尋 UI

專案走極簡 UI 方向，另設搜尋框／分頁是多餘的表面積。非網址輸入目前只會報錯，直接把這個空間變成搜尋入口，配一個「要用 YouTube 搜尋『…』嗎？」確認對話框：打錯網址（漏協定前綴）的輸入會在這裡被使用者認出並取消，不會莫名其妙變成一次搜尋。取消時保留輸入框內容供修正。placeholder 文案同步改為「輸入影音網址，或關鍵字搜尋 YouTube」。

### D3：來源能力表新增 `youtube-search`，以旗標宣告「不記進度」

新增 profile：`match: url => /^ytsearch\d*:/.test(url)`、`kind: 'collection'`、`flatMetadata: 'full'`（有標題＋片長，不啟動補齊——50 筆逐一補齊的成本換不到勾選所需的資訊）、`needsPreParseConfirm: false`（搜尋已有自己的確認）。

`SourceProfile` 介面新增可選欄位 `tracksParseProgress?: boolean`（省略視為 `true`）：`App.vue` 解析成功後只對此旗標非 `false` 的來源推進 `parseProgress`。搜尋宣告 `false`——結果非穩定序列，記了進度反而觸發「繼續上次進度」詢問並以 `--playlist-items` 錯位續抓。用明確旗標而非「progressKey 加亂數」之類的旁門：語意清楚、可直接斷言。

### D4：結果上限 50 筆，內嵌於虛擬網址

`buildYouTubeSearchUrl(keyword)` 回傳 `ytsearch50:<trimmed keyword>`（常數 `SEARCH_RESULT_LIMIT = 50`，與 helper 同放 `sourceProfiles.ts`）。不用 `PARSE_BATCH_SIZE`（200）：搜尋每頁約 20 筆，200 筆要十輪請求，而搜尋情境使用者只看前面的結果。既有 `rangeArgs`（首批 `--playlist-end 200`）照常傳遞，上限以 N=50 先到者為準，無害也不必特判。

### D5：非影片 entry 以 `ie_key === 'Youtube'` 白名單過濾，兩端同規則

搜尋來源的 entry 只保留 `ie_key === 'Youtube'`（flat 模式下單支影片的固定值）；頻道（`YoutubeTab`）與播放清單（`YoutubePlaylist`）直接丟棄、不展開。判準以純函式 `isSearchSource(url)` ＋「搜尋來源 → 跳過子清單展開、濾除非影片」的形式落在：

- 桌面端：`DownloadService.parsePlaylist` 的 `processEntries` 迴圈，在子清單判斷之前短路。
- Android 端：`YoutubeDlPlugin.processEntriesHelper` 同位置，以 `originalUrl.startsWith("ytsearch")` 判定。

用白名單而非黑名單：未來 yt-dlp 若在搜尋結果混入新型別（如 Shorts 合輯），預設行為是「不顯示」而非「誤展開」。

### D6：任務歸組用固定群組名「YouTube 搜尋」，頻道前綴留空待補

解析成功後，搜尋來源覆寫 `parsedChannelTitle = 'YouTube 搜尋'`、`parsedPlaylistTitle = <關鍵字>`（yt-dlp 頂層 `title` 實測就是關鍵字，但不依賴它）。任務樹呈現「YouTube 搜尋 / <關鍵字>」，下載子資料夾為 `YouTube 搜尋/<關鍵字>`（沿用既有非法字元替換）。

新增 `parsedSourceIsSearch` 旗標：`onBatchModalConfirm` 對搜尋來源把子任務 `channelPrefix` 設為空字串，讓下載完成時回報的實際頻道名經既有補值機制（`result.channelPrefix && !task.channelPrefix`）填入——搜尋結果橫跨多頻道，統一前綴「YouTube 搜尋」會汙染檔名。

### D7：無結果訊息按來源區分

`res.items` 為空時，搜尋來源顯示「找不到相關影片」，其餘來源維持「此播放清單無可下載的影片」。既有「全部已存在」訊息兩者共用，語意不變。

### D8：「只列中文」為純前端文字啟發式，判準是「有表意文字、無假名諺文」

實測 flat 搜尋結果的 `language`／`audio_language` 皆為空，YouTube 多數影片本就沒填語言；逐支完整解析要 50 次請求。故以 `title + channel` 的字元組成判斷：含中日韓表意文字（U+3400–4DBF、U+4E00–9FFF、U+F900–FAFF）且不含日文假名（U+3040–30FF、U+31F0–31FF、半形片假名 U+FF66–FF9F）與韓文諺文（U+1100–11FF、U+3130–318F、U+AC00–D7AF）→ 視為中文。已知誤差並接受：純漢字標題的日文影片會誤判為中文；中文內容配純英文標題且頻道名也無中文者會漏判。

配套：`PlaylistItem` 增加可選欄位 `channel`，兩端解析時自 entry 的 `channel`／`uploader` 補值——頻道名常含中文（如「周杰倫 Jay Chou」），能接住英文標題的中文影片。純函式 `looksChinese()` 獨立於 `textLang.ts`（平台無關、可測試）。

過濾語意採「顯示 ∩ 勾選」：確認下載只取**目前顯示且勾選**的項目，全選／全不選也只作用於顯示中的項目（對隱藏項目的勾選狀態不動）——否則「預設全選 → 開過濾 → 確認」會把看不見的非中文影片也下載下去，違反所見即所得。開關預設關閉，且只在搜尋來源的明細出現（`showLangFilter` prop）：一般播放清單通常同頻道同語言，開關只是噪音。

## Risks / Trade-offs

- [yt-dlp 搜尋 extractor 受 YouTube 改版／風控影響而失效] → 失敗走既有解析錯誤回報與 90 秒逾時中止；yt-dlp 每日自動更新機制已存在，通常隨更新恢復。
- [關鍵字像網址（如 `www.youtube.com/...` 漏協定）被當搜尋] → 確認對話框原文呈現輸入內容，使用者可取消後補上協定；不做自動補 `https://` 的猜測（猜錯更難解釋）。
- [flat 結果無發布時間，明細資訊較播放清單少一欄] → 勾選決策主要靠標題＋片長；接受此限制（見 Non-Goals），不為 50 筆啟動逐筆補齊。
- [`ytsearch` 關鍵字含冒號或特殊字元] → 虛擬網址以單一引數傳遞（兩端皆非 shell 拼接），yt-dlp 將首個冒號後的全部視為查詢字串；僅需 trim。
- [Android 端 Java 過濾邏輯與桌面端 TS 規則日後漂移] → 規則收斂為一句話（「搜尋來源只留 `ie_key == 'Youtube'`」）並於兩端各留註解互相指向；桌面端純函式有測試釘住。

## Migration Plan

純新增行為，無資料結構與儲存格式變更；不影響既有網址輸入路徑。部署隨一般版本發布（7 處版號同步＋`publish_all.ps1` 防呆文字）；回滾即 revert 功能 commit。

## Open Questions

（無。結果上限 50 日後若要做成可調設定，不影響本案結構。）
