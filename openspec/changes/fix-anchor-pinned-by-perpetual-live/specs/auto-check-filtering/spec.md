## MODIFIED Requirements

### Requirement: Exclude Live Streams from Queue

The system MUST perform a secondary validation on newly discovered videos from the RSS feed. If the video is currently broadcasting live or is scheduled as an upcoming premiere, the system MUST NOT add it to the download queue.

二次驗證的對象 MUST（必須）收斂為「通過該頻道關鍵字篩選的候選影片」。頻道未設定有效關鍵字時，所有符合既有新片條件的影片皆為候選影片；頻道已設定有效關鍵字時，僅標題命中任一關鍵字的影片為候選影片。關鍵字比對 MUST（必須）在兩側各自經過同一組正規化（全形英數折算為半形、折算到同一中文字形域、再轉小寫）後進行。

關鍵字篩選 MUST（必須）先於直播狀態驗證執行。未命中該頻道關鍵字的影片 MUST NOT（不得）觸發任何直播狀態查詢或額外的影片資訊擷取，也 MUST NOT（不得）被加入下載佇列。

**已判定為直播中或排程未開播的影片 MUST NOT（不得）阻擋該頻道的時間錨點推進。** 此類影片與未命中關鍵字的影片同列：兩者皆為系統已知且明確不予下載的項目，錨點得以越過。以壓住錨點來表達「這支之後還要再看」，在**永遠存在排程直播的頻道**上會使錨點永久卡死 —— 每輪都把錨點之後的所有影片重新判定為新片，僅靠佇列去重掩蓋，使用者清空佇列時即全部湧入。

**僅「狀態無法判定」的影片 MUST（必須）阻擋錨點**推進超過其發布時間，錨點 MUST（必須）以本輪所有此類影片中最早的發布時間為上限，且此上限 MUST NOT（不得）因本輪存在較新的未命中關鍵字影片而失效。狀態無法判定代表暫時性的查詢失敗，且此類影片會隨其離開資料來源的候選視窗而自然停止阻擋，不致造成永久卡死。

此項排除 MUST（必須）在所有支援的平台上一致生效。任何平台 MUST NOT（不得）以「該平台尚未支援直播狀態查詢」為由略過驗證而直接放行 —— 排程直播在開播前不存在任何可下載的格式，放行必然導致下載失敗。

#### Scenario: Active live stream discovered

- **WHEN** the RSS check detects a new video URL that is an active live stream
- **AND** 該頻道未設定有效關鍵字，或該影片標題命中該頻道任一關鍵字
- **THEN** the system verifies its status and silently ignores the video, leaving the download queue unaffected.
- **AND** 該影片 MUST NOT（不得）阻擋該頻道的時間錨點推進

#### Scenario: Normal pre-recorded video discovered

- **WHEN** the RSS check detects a normal video or a completed past live stream (VOD)
- **AND** 該頻道未設定有效關鍵字，或該影片標題命中該頻道任一關鍵字
- **THEN** 系統驗證其直播狀態，並在該影片同時滿足既有新片判定與佇列去重條件時，將其加入下載佇列
- **AND** 缺少上述關鍵字前提時，系統 MUST NOT（不得）僅因其為一般影片或已完成的存檔直播就將其加入佇列

#### Scenario: 未命中關鍵字的新影片不觸發直播狀態查詢

- **WHEN** 頻道已設定有效關鍵字，且某支符合既有新片條件的影片標題未命中其中任何關鍵字
- **THEN** 系統 MUST NOT（不得）對該影片提出直播狀態查詢或其他額外的影片資訊擷取
- **AND** 系統 MUST NOT（不得）將該影片加入下載佇列
- **AND** 系統對該影片的處置 MUST（必須）與其實際是否為直播無關（關鍵字篩選在流程順序上先於直播狀態驗證）

#### Scenario: 命中關鍵字但為直播的影片阻擋錨點被較新的未命中影片推過

- **WHEN** 本輪取得的影片中，較新的一支未命中該頻道關鍵字，較舊的一支命中關鍵字但**狀態無法判定**
- **THEN** 該頻道的時間錨點 MUST NOT（不得）推進超過那支狀態無法判定影片的發布時間
- **AND** 系統 MUST NOT（不得）因該較新的未命中影片而把錨點推進至更晚的時間
- **AND** 下次檢查時該狀態無法判定的影片 MUST（必須）再次被評估
- **AND** 若該較舊影片是**已判定為直播中或排程未開播**者，本情境 MUST NOT（不得）適用 —— 錨點得以越過它

#### Scenario: 排程但尚未開播的直播

- **WHEN** 檢查發現一支已排程、尚未開播的直播（`live_status` 為 `is_upcoming`）
- **THEN** 系統不將其加入下載佇列
- **AND** 該影片 MUST NOT（不得）阻擋該頻道的時間錨點推進
- **AND** 系統 MUST NOT（不得）於其開播結束轉為存檔後自動將其加入佇列 —— 已知的直播內容一律不予下載

#### Scenario: 各平台行為一致

- **WHEN** 同一支直播影片分別於 Windows 與 Android 上被檢查發現
- **THEN** 兩個平台皆將其排除，不會有任一平台將其加入佇列
- **AND** 兩個平台對「已判定為直播」與「狀態無法判定」的區分 MUST（必須）一致，MUST NOT（不得）有任一平台把可辨識的排程直播回報為狀態無法判定

#### Scenario: 直播狀態查詢失敗

- **WHEN** 直播狀態查詢本身因網路或工具錯誤而無法完成，且該錯誤**不足以辨識**該影片為直播或排程未開播
- **THEN** 系統記錄該狀況，且該影片的處置 MUST NOT（不得）使頻道的時間錨點越過它，以便下次檢查重新評估

## ADDED Requirements

### Requirement: 排程直播的狀態須可辨識，不得退化為狀態未知

當查詢工具因影片為排程直播而無法回報其狀態，但其回應**足以辨識該影片正是排程直播**時，系統 MUST（必須）將其判定為「排程未開播」，MUST NOT（不得）退化為「狀態無法判定」。

此項為前述錨點規則能否生效的前提：若排程直播一律落入「狀態無法判定」，它們仍會阻擋錨點，永久卡死的問題完全沒有被解決。兩者的處置相反 —— 前者永久略過並讓錨點越過，後者暫時保留並壓住錨點 —— 因此可辨識性本身就是行為契約的一部分，而非實作細節。

#### Scenario: 查詢工具因排程直播而報錯

- **WHEN** 直播狀態查詢因該影片為尚未開播的排程直播而失敗，且錯誤內容明確指出該影片為即將開始的直播
- **THEN** 系統 MUST（必須）判定其為「排程未開播」
- **AND** 系統 MUST NOT（不得）將其判定為「狀態無法判定」
- **AND** 該影片 MUST NOT（不得）阻擋該頻道的時間錨點推進

#### Scenario: 無法辨識的查詢失敗仍為狀態未知

- **WHEN** 直播狀態查詢因網路中斷、逾時或其他無法辨識影片狀態的原因而失敗
- **THEN** 系統 MUST（必須）判定為「狀態無法判定」
- **AND** 該影片 MUST（必須）阻擋錨點推進，以便下次檢查重新評估

#### Scenario: 具備結構化狀態欄位的來源不受影響

- **WHEN** 資料來源能直接回報結構化的直播狀態（例如官方 API 的 `liveBroadcastContent` 為 `upcoming`）
- **THEN** 系統 MUST（必須）直接依該欄位判定為「排程未開播」，不需依賴錯誤訊息的辨識
