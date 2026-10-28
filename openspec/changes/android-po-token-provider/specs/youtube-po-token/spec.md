## Purpose

規範 Android 端 YouTube 下載的 PO Token（Proof of Origin）供應：token 由 App 內建的 provider 在本機鑄造並交給 yt-dlp，使 player 與串流請求帶著 BotGuard 驗證，降低被來源以 IP 信譽判定為機器人的機率；provider 失敗時下載行為不得劣化。

## ADDED Requirements

### Requirement: YouTube 請求帶上本機鑄造的 PO Token

Android 端對 YouTube 的影片資訊預取與下載請求，系統 MUST（必須）載入內建的 PO Token provider 外掛，並要求 yt-dlp 對每個 context（player、gvs、subs）在發出請求前先向 provider 取得 token，不得只在 client 政策標為必要時才取。

#### Scenario: 下載 YouTube 影片

- **WHEN** 使用者在 Android 下載一部 YouTube 影片
- **THEN** yt-dlp 在 player 請求前向 provider 取得 player PO Token，在取得格式後為串流取得 gvs PO Token，兩者皆由 App 本機鑄造

#### Scenario: 影片資訊預取

- **WHEN** 下載流程先以 `--dump-json` 預取影片資訊，或批次補抓多支影片的資訊
- **THEN** 該請求同樣載入 provider 外掛並帶上 token

### Requirement: Provider 在本機以 BotGuard 鑄造 token

系統 MUST 在裝置本機（僅 127.0.0.1）提供 HTTP provider，介面與 bgutil-ytdlp-pot-provider 相容（`GET /ping` 回版本、`POST /get_pot` 收 `content_binding` 與 `bypass_cache`、回 `poToken`）。token MUST 由隱藏的 WebView 執行 YouTube 的 BotGuard 鑄造；WebView MUST NOT（不得）自行發出網路請求，所需的首頁、直譯器與 integrity token 由原生端取得後注入。

#### Scenario: 首次鑄造

- **WHEN** provider 收到第一個 `/get_pot` 請求
- **THEN** 系統取得 BotGuard 挑戰、載入直譯器、換得 integrity token，鑄造對應 content binding 的 token 並回傳

#### Scenario: 挑戰來源備援

- **WHEN** YouTube 首頁取不到 `ytAtN` 挑戰
- **THEN** 系統改以 `youtubei/v1/att/get` 取得挑戰再繼續，不直接失敗

### Requirement: Token 快取與到期重建

provider MUST 依 content binding 快取 PO Token 六小時；收到 `bypass_cache` 時 MUST 重新鑄造並覆蓋快取。integrity token MUST 在來源給定的有效期（保留十分鐘邊際）到期後重建，鑄造失敗時 MUST 重建一次再試，再失敗才回報錯誤。

#### Scenario: 同一 content binding 重複請求

- **WHEN** 六小時內以同一 content binding 再次請求且未指定 `bypass_cache`
- **THEN** provider 直接回傳快取的 token，不重新鑄造

#### Scenario: integrity token 到期

- **WHEN** integrity token 已到期（含十分鐘邊際）後收到請求
- **THEN** provider 重新執行 BotGuard 取得新的 integrity token 後再鑄造

### Requirement: Provider 失敗時下載行為不劣化

provider 的任何環節失敗（伺服器未啟動、WebView 不可用、挑戰或 integrity token 取得失敗、鑄造失敗）時，外掛 MUST 以「拒絕此請求」回應 yt-dlp，yt-dlp MUST 照常以不帶 token 的方式繼續；系統 MUST NOT 因 provider 失敗而讓下載失敗或顯示錯誤。

#### Scenario: 本機伺服器未啟動

- **WHEN** `load()` 時伺服器埠被占用或啟動失敗
- **THEN** 系統記錄 log、停用 provider，後續下載與未導入本功能前相同

#### Scenario: WebView 不可用

- **WHEN** 裝置的 WebView 無法執行 BotGuard（例如 console 出現 Uncaught 的語法錯誤）
- **THEN** provider 對 `/get_pot` 回 JSON 錯誤，外掛拒絕請求，下載照常進行
