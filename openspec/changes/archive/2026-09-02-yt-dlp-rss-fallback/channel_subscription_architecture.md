# 頻道自動追蹤架構圖 (Channel Monitoring Architecture)

這份架構圖展示了目前 AVD 專案中「頻道自動追蹤排程」的完整運作流程，包含觸發條件、核心檢查邏輯，以及針對 Windows 與 Android 不同平台的擷取與備援機制。

```mermaid
graph TD
    %% 定義樣式
    classDef trigger fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef core fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    classDef fetcher fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef fallback fill:#ffebee,stroke:#d32f2f,stroke-width:2px;
    classDef process fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;

    %% 觸發層 (Trigger Layer)
    subgraph 觸發層 [1. 觸發來源 (Trigger)]
        T1([每小時定時器 setInterval]):::trigger
        T2([立即檢查 按鈕]):::trigger
        T3([模擬測試 按鈕]):::trigger
    end

    %% 核心邏輯層 (Core Logic Layer)
    subgraph 核心邏輯 [2. 核心檢查邏輯 (App.vue)]
        C1{檢查開關與狀態}:::core
        C2[過濾出已啟用的頻道清單]:::core
        C3((開始迴圈: 逐一檢查頻道)):::core
    end

    T1 -->|isManual: false| C1
    T2 -->|isManual: true| C1
    T3 -->|強制抓取並下載| Fetch_Simulate([simulateGlobalNewVideo])
    
    C1 -->|若未檢查中且允許| C2
    C2 --> C3

    %% 資料擷取層 (Data Fetching Layer)
    subgraph 擷取層 [3. 資料擷取與備援 (DownloadService.ts)]
        D1[請求官方 RSS XML\n/feeds/videos.xml?channel_id=...]:::fetcher
        
        D2_Win[Windows: Tauri fetch_http_text]:::fetcher
        D2_And[Android: YoutubeDlPlugin.fetchChannelRss]:::fetcher
        
        F_Win[Windows 備援: Tauri fetch_channel_videos_fallback\n(執行外部 yt-dlp.exe)]:::fallback
        F_And[Android 備援: YoutubeDlPlugin.parsePlaylist\n(執行內建 yt-dlp 庫)]:::fallback
        
        P1[成功取得並解析影片資料]:::fetcher
        E1[雙重失敗: 記錄 Error]:::fallback
    end

    C3 -->|DownloadService.fetchYouTubeRss| D1
    D1 -->|判斷平台| Platform{isTauri?}
    Platform -->|Yes| D2_Win
    Platform -->|No| D2_And

    D2_Win -->|HTTP 200 OK| P1
    D2_And -->|HTTP 200 OK| P1

    D2_Win -->|HTTP 404 / 失敗| F_Win
    D2_And -->|HTTP 404 / 失敗| F_And

    F_Win -->|成功| P1
    F_And -->|成功| P1
    
    F_Win -->|失敗| E1
    F_And -->|失敗| E1

    %% 處理與比較層 (Processing & Queueing Layer)
    subgraph 處理層 [4. 狀態比對與下載排隊]
        P2{是新影片嗎？\n比對 lastKnownVideoId & lastCheckTime}:::process
        P3{是否為直播中？\ncheckVideoLiveStatus}:::process
        P4[更新頻道最後檢查時間]:::process
        P5[將影片排入下載佇列的最前方]:::process
        P6[觸發 processQueue 開始下載]:::process
    end

    P1 --> P2
    E1 --> P4
    
    P2 -->|不是新片| P4
    P2 -->|是新片| P3
    
    P3 -->|是直播 (跳過)| P4
    P3 -->|非直播| P5
    
    P5 --> P4
    P4 -->|迴圈結束| P6

    Fetch_Simulate -.-> D1
```

### 🧠 架構重點解析

1. **平台分流 (Platform Branching)**：因為跨網域限制 (CORS) 與執行環境不同，Windows 依賴 Tauri Rust 後端，而 Android 依賴 Capacitor Java 插件。
2. **階層式備援 (Tiered Fallback)**：
   - **Tier 1 (極速)**：官方 RSS。
   - **Tier 2 (穩定但較慢)**：當官方 RSS 回傳 404 或被擋時，自動啟動 `yt-dlp` 進行網頁解析救援。
3. **防重複機制**：透過 `lastKnownVideoId` (影片 ID) 與 `lastCheckTime` (發布時間戳記) 進行雙重比對，確保同一部影片不會被重複下載。
4. **直播過濾**：新影片進入佇列前，會額外發送一次檢查 (`checkVideoLiveStatus`)，避免下載到正在直播中而無法取得完整檔案的影片。
