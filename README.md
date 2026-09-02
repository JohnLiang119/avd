# 🚀 AVD (Audio Video Downloader)

<div align="center">

![GitHub Release](https://img.shields.io/github/v/release/JohnLiang119/avd?color=blue&style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)

**現代化跨平台影音下載與智慧自動追蹤工具**  
支援 YouTube 頻道定時新片自動追蹤、高畫質 MP4 / MP3 轉換、播放清單批次解析與區域網路跨裝置快傳

</div>

> ⚠️ **免責聲明 (Disclaimer)**  
> 本專案僅供程式開發、個人研究與合理使用（Fair Use）學習之用。請勿使用本工具下載受版權保護且未獲授權之商業內容。使用者須自行承擔因不當使用所衍生之所有法律責任。

---

## 📥 軟體下載 (Downloads)

> 💡 **提示**：請點擊下方連結前往 GitHub 最新發行版本頁面下載對應平台的最新安裝包：

| 平台系統 | 安裝包下載連結 | 適用設備說明 |
| :--- | :--- | :--- |
| 📱 **Android** | [👉 **前往下載最新 Android APK (`AVD_*.apk`)**](https://github.com/JohnLiang119/avd/releases/latest) | 支援 Android 手機、平板及 Android TV |
| 💻 **Windows** | [👉 **前往下載最新 Windows 安裝檔 (`AVD_*_x64.msi`)**](https://github.com/JohnLiang119/avd/releases/latest) | 支援 Windows 10 / 11 (64 位元) |

---

## ✨ 核心特色與功能

- 📡 **YouTube 頻道定時自動追蹤**：
  - 每 1 小時背景極速比對已追蹤頻道最新發布之影片（免消耗 API 配額）。
  - 偵測到新影片自動排入佇列第 1 位並立即優先下載。
  - 支援雙行清單檢視與一鍵測試模擬。
- 🎬 **跨平台影音高畫質下載**：
  - 支援高畫質 MP4 影片與高音質 MP3 音訊一鍵無縫切換。
  - 具備自動簡轉繁功能，檔名與標題乾淨易讀。
- 📑 **智慧播放清單批次解析**：
  - 貼上清單或多集網址自動展開清單彈窗，支援自由勾選要下載的集數。
- ⚡ **區域網路快傳伺服器**：
  - 手機端一鍵開啟 Local File Server，自動產生連線 QR Code 與 Wi-Fi 熱點資訊，其他裝置掃描即可秒速接收影片。
- ☁️ **雲端同步備份**：
  - 支援 Windows Rclone 同步與 Android Google Drive 上傳。

---

## 🛠️ 本地開發與編譯 (Build & Development)

### 環境需求
- **Node.js**: 18+
- **Rust / Cargo**: 適用於 Windows Tauri 端
- **Android SDK & JDK 17+**: 適用於 Android 原生端

### 內建 Sidecar 執行檔
本專案將 `yt-dlp`、`ffmpeg`、`rclone` 隨倉庫一併發布，clone 後**無須額外下載即可離線建置**。

版控中每個工具**僅保留單一 `x86_64-pc-windows-msvc` 副本**（放在 `src-tauri/bin/`）；建置時 `all.ps1` 會自動偵測當前 Rust host triple，必要時從既有副本複製出所需檔名。因此請勿為了其他平台而在此目錄放入重複副本，以免倉庫體積再次膨脹。

若某個工具在 `src-tauri/bin/` 完全找不到任何副本，`all.ps1` 會列出缺少的工具與應放置路徑並中止建置，不會產生缺件的安裝包。

> `upx.exe` 已不納入版控。缺少它時建置僅會略過壓縮步驟並顯示警告 —— 由於版控中的 sidecar 本身已是壓縮後的產物，安裝包大小不受影響。

### 常用指令
```powershell
# 1. 安裝前端依賴
npm install

# 2. 前端開發伺服器
npm run dev

# 3. 前端建置與型別檢查
npm run build

# 4. 全平台自動編譯 (產生 APK 與 Windows MSI)
.\all.ps1
```

---

## 📄 授權條款 (License)
本專案採用 [MIT License](LICENSE) 條款開源。
