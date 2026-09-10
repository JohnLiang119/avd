## MODIFIED Requirements

### Requirement: Exclude Live Streams from Queue

The system MUST perform a secondary validation on newly discovered videos from the RSS feed. If the video is currently broadcasting live or is scheduled as an upcoming premiere, the system MUST NOT add it to the download queue.

二次驗證的對象 MUST（必須）收斂為「通過該頻道關鍵字篩選的候選影片」。頻道未設定有效關鍵字時，所有符合既有新片條件的影片皆為候選影片；頻道已設定有效關鍵字時，僅標題命中任一關鍵字的影片為候選影片。關鍵字比對 MUST（必須）在兩側各自經過同一組正規化（全形英數折算為半形、折算到同一中文字形域、再轉小寫）後進行。

關鍵字篩選 MUST（必須）先於直播狀態驗證執行。未命中該頻道關鍵字的影片 MUST NOT（不得）觸發任何直播狀態查詢或額外的影片資訊擷取，也 MUST NOT（不得）被加入下載佇列。

通過關鍵字篩選但因直播中、尚未開播或狀態無法判定而未被實際處理的影片，MUST（必須）阻擋該頻道的時間錨點推進超過其發布時間。錨點 MUST（必須）以本輪所有未處理影片中最早的發布時間為上限，且此上限 MUST NOT（不得）因本輪存在較新的未命中關鍵字影片而失效；未命中關鍵字的影片本身則得被錨點越過。

此項排除 MUST（必須）在所有支援的平台上一致生效。任何平台 MUST NOT（不得）以「該平台尚未支援直播狀態查詢」為由略過驗證而直接放行 —— 排程直播在開播前不存在任何可下載的格式，放行必然導致下載失敗。

#### Scenario: Active live stream discovered

- **WHEN** the RSS check detects a new video URL that is an active live stream
- **AND** 該頻道未設定有效關鍵字，或該影片標題命中該頻道任一關鍵字
- **THEN** the system verifies its status and silently ignores the video, leaving the download queue unaffected.

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

- **WHEN** 本輪取得的影片中，較新的一支未命中該頻道關鍵字，較舊的一支命中關鍵字但因直播中、尚未開播或狀態查詢失敗而未被處理
- **THEN** 該頻道的時間錨點 MUST NOT（不得）推進超過那支命中但未被處理影片的發布時間
- **AND** 系統 MUST NOT（不得）因該較新的未命中影片而把錨點推進至更晚的時間
- **AND** 下次檢查時該命中但未被處理的影片 MUST（必須）再次被評估

#### Scenario: 排程但尚未開播的直播

- **WHEN** 檢查發現一支已排程、尚未開播的直播或首播（系統可判定其為「即將開始」狀態）
- **THEN** 系統不將其加入下載佇列

#### Scenario: 各平台行為一致

- **WHEN** 同一支直播影片分別於 Windows 與 Android 上被檢查發現
- **THEN** 兩個平台皆將其排除，不會有任一平台將其加入佇列

#### Scenario: 直播狀態查詢失敗

- **WHEN** 直播狀態查詢本身因網路或工具錯誤而無法完成
- **THEN** 系統記錄該狀況，且該影片的處置 MUST NOT（不得）使頻道的時間錨點越過它，以便下次檢查重新評估
