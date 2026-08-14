# 🚀 AVD (Audio Video Downloader)

<div align="center">

![GitHub Release](https://img.shields.io/github/v/release/JohnLiang119/avd?color=blue&style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)

**現代化跨平台影音下載與智慧自動追蹤工具**  
支援 YouTube 頻道定時新片自動追蹤、高畫質 MP4 / MP3 轉換、播放清單批次解析與區域網路跨裝置快傳

</div>

---

## 📥 軟體下載 (Downloads)

> 💡 **提示**：以下為固定永久連結，每次點擊都會自動下載 GitHub 上的最新發行版本！

| 平台系統 | 最新安裝包下載 (點擊直接下載) | 適用設備說明 |
| :--- | :--- | :--- |
| 📱 **Android** | [👉 **點此下載最新 Android APK (`avd_apk.apk`)**](https://github.com/JohnLiang119/avd/releases/latest/download/avd_apk.apk) | 支援 Android 手機、平板及 Android TV |
| 💻 **Windows** | [👉 **點此下載最新 Windows 安裝檔 (`avd_win.msi`)**](https://github.com/JohnLiang119/avd/releases/latest/download/avd_win.msi) | 支援 Windows 10 / 11 (64 位元) |

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
