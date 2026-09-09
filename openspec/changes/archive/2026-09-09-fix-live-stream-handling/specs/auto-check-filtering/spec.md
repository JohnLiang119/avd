## MODIFIED Requirements

### Requirement: Exclude Live Streams from Queue

The system MUST perform a secondary validation on newly discovered videos from the RSS feed. If the video is currently broadcasting live or is scheduled as an upcoming premiere, the system MUST NOT add it to the download queue.

此項排除 MUST（必須）在所有支援的平台上一致生效。任何平台 MUST NOT（不得）以「該平台尚未支援直播狀態查詢」為由略過驗證而直接放行 —— 排程直播在開播前不存在任何可下載的格式，放行必然導致下載失敗。

#### Scenario: Active live stream discovered

- **WHEN** the RSS check detects a new video URL that is an active live stream
- **THEN** the system verifies its status and silently ignores the video, leaving the download queue unaffected.

#### Scenario: Normal pre-recorded video discovered

- **WHEN** the RSS check detects a normal video or a completed past live stream (VOD)
- **THEN** the system verifies its status and successfully adds the video to the download queue for processing.

#### Scenario: 排程但尚未開播的直播

- **WHEN** 檢查發現一支已排程、尚未開播的直播（`live_status` 為 `is_upcoming`）
- **THEN** 系統不將其加入下載佇列

#### Scenario: 各平台行為一致

- **WHEN** 同一支直播影片分別於 Windows 與 Android 上被檢查發現
- **THEN** 兩個平台皆將其排除，不會有任一平台將其加入佇列

#### Scenario: 直播狀態查詢失敗

- **WHEN** 直播狀態查詢本身因網路或工具錯誤而無法完成
- **THEN** 系統記錄該狀況，且該影片的處置 MUST NOT（不得）使頻道的時間錨點越過它，以便下次檢查重新評估
