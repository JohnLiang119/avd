# yt-dlp-rss-fallback Specification

## Purpose
當官方 YouTube RSS 伺服器回傳錯誤（如 404 或限流）時，提供一個基於 yt-dlp 的穩定備援方案，確保自動追蹤頻道新片的功能不會因為官方 RSS 的不穩定而中斷。
## Requirements
### Requirement: yt-dlp RSS 備援擷取
當系統嘗試透過官方 RSS XML 網址擷取頻道新片失敗時，系統 SHALL 自動喚醒 yt-dlp 進行 JSON 解析，作為備用資料源。

#### Scenario: 官方 RSS 成功
- **WHEN** 系統要求獲取某頻道最新影片，且官方 RSS 端點正常回傳 200 OK 且包含有效的 XML
- **THEN** 系統直接解析 XML 並回傳，不觸發 yt-dlp 備援機制

#### Scenario: 官方 RSS 失敗引發備援
- **WHEN** 官方 RSS 端點回傳 404 Not Found 或其他網路錯誤
- **THEN** 系統自動呼叫內建的 `yt-dlp` 執行緒，目標為該頻道的首頁或 /videos 頁面，解析最新的影片資料並轉回內部共用的資料結構，使上層呼叫端無法察覺底層切換。

#### Scenario: 備援機制也失敗
- **WHEN** 官方 RSS 失敗，且 yt-dlp 也無法成功解析該頻道網頁（例如頻道被刪除）
- **THEN** 系統向上層拋出錯誤，觸發頻道錯誤的相關提示或計數。

