# Refine Channel Add Prompt Specification

## Requirements

1. **New Channels (Not in Tracking List)**
   - When a channel URL is added via `addTask`, fetch the channel information.
   - If the channel is NOT in `monitoredChannels`, show a confirmation dialog:
     - Title: "發現新頻道"
     - Message: "您輸入的是頻道網址。是否要將「[頻道名稱]」加入自動追蹤清單？\n\n加入後系統將每小時自動為您檢查並下載新影片。"
     - Buttons: "加入追蹤" / "不加入"
   - If confirmed, add it to `monitoredChannels`.
   - Proceed to the scanning prompt (Requirement 3).

2. **Tracked Channels**
   - If the channel is ALREADY in `monitoredChannels`, skip the tracking prompt.
   - Proceed directly to the scanning prompt (Requirement 3).

3. **Scanning Prompt**
   - After handling the tracking prompt (or skipping it), show a second confirmation dialog:
     - Title: "掃描歷史明細"
     - Message: "是否要掃描「[頻道名稱]」的歷史影片明細？\n\n(若頻道影片較多，可能需要較長時間)"
     - Buttons: "掃描並選擇下載" / "略過"
   - If confirmed ("掃描並選擇下載"), the system must continue to the existing `parsePlaylist` logic.
   - If cancelled ("略過"), the system MUST abort the rest of the function (i.e. `return`), preventing the playlist from being parsed.
