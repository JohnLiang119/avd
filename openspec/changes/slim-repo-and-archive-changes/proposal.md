## Why

專案倉庫已累積嚴重的技術債務：`.git` 目錄達 207 MB（其中約 141 MB 是被版控追蹤的二進位執行檔），本機磁碟佔用 6.3 GB，且 `src-tauri/bin/` 混雜了 19 MB 測試影片與 36 MB 的 `.old` 殘留檔。同時 `openspec/changes/` 堆積 15 個未歸檔變更，其中 14 個任務已 100% 完成卻未合併回 `openspec/specs/`，導致規格庫無法反映系統實際能力，後續開發與 AI 協作都必須重讀 3296 行的 `App.vue` 才能確認行為。

## What Changes

### 第一部分：OpenSpec 變更歸檔與規格回填

- 逐一對 14 個已 100% 完成的變更執行 `openspec archive`，將其 spec delta 正確合併進 `openspec/specs/` 的既有能力或新增能力。
- 待歸檔清單：`add-capacitor-share`、`channel-backup-restore`、`filter-live-streams`、`fix-channel-check-feedback`、`no-auto-run-all-ps1`、`optional-ytdlp-fallback`、`prompt-channel-tracking`、`reduce-app-size`、`refine-channel-add-prompt`、`settings-ui-compact`、`startup-auto-update-check`、`update-windows-layout`、`yt-dlp-auto-update`、`yt-dlp-rss-fallback`。
- 保留 `channel-track-by-publish-time`（18/24 進行中），不歸檔。
- 歸檔後 `openspec/changes/` 僅存 1 個進行中變更，`openspec/specs/` 完整涵蓋已交付能力。

### 第二部分：版控與磁碟瘦身

- **BREAKING（僅影響 Git 歷史）**：使用 `git filter-repo` 重寫歷史，清除所有二進位檔的歷史 blob（`src-tauri/bin/*.exe`、`rclone.zip`、`upx.exe`、`rclone_temp/`），需 `git push --force`，所有 commit SHA 將改變。
- 重寫後重新提交**單一份** msvc sidecar（`yt-dlp`、`ffmpeg`、`rclone`），刪除完全重複的 gnu 副本（省 60 MB）。
- 刪除誤入版控與本機的垃圾檔：`src-tauri/bin/` 內的測試 mp4（19 MB）、`*.exe.old`（36 MB）、`test_output_123.info.json`。
- 清理根目錄 37 個歷史 MSI 安裝包（1.0.26 ~ 1.0.60），僅保留當前版本。
- 移除 `rclone_temp/`（66 MB，與 `rclone.zip` 內容重複）。
- 補強 `.gitignore`：明確排除 `*.old`、`src-tauri/bin/*.mp4`、`rclone_temp/`、`upx.exe`。
- 確認 `all.ps1` 既有的 host-triple 自動補齊邏輯在僅存 msvc 副本時仍能正確建置。

## Capabilities

### New Capabilities

- `repo-artifact-hygiene`: 定義版控可追蹤之二進位資產邊界，以及建置時 sidecar 執行檔的唯一來源與自動補齊行為。

### Modified Capabilities

- `release-automation`: 新增發布完成後的歷史安裝包保留策略，避免根目錄無限累積 MSI／APK。

## Impact

- **版控歷史**：全部 commit SHA 改變，需 force push 至 `JohnLiang119/avd`。執行前必須完整備份 `.git`。GitHub Releases 資產不受影響。
- **檔案系統**：`.git` 預估 207 MB → 約 70 MB；專案總佔用 6.3 GB → 約 3.2 GB（含 `src-tauri/target` 與 `node_modules` 不動）。
- **建置腳本**：`all.ps1`（sidecar 複製與 UPX 壓縮段落）、`.gitignore`、`release_avd.ps1`（新增舊安裝包清理）。
- **OpenSpec**：`openspec/changes/` 減 14 個目錄、`openspec/changes/archive/` 增 14 個、`openspec/specs/` 內容擴充。
- **不影響**：應用程式執行期行為、`src/`、`src-tauri/src/`、`android/` 任何原始碼。
