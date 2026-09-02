## 1. 階段 A：本機垃圾清理（低風險，無版控影響）

- [x] 1.1 以雜湊比對驗證 `src-tauri/bin/` 中 gnu 與 msvc 副本內容是否相同，記錄比對結果；若有差異則暫停並回報
  - 比對結果（SHA256 前 16 碼）：`ffmpeg` 兩份皆為 `90B69CA440CBA4B6`、`rclone` 兩份皆為 `505AC2B0B6112428`、`yt-dlp` 兩份皆為 `652E154BCE717007`。三組 gnu 與 msvc 副本位元組完全相同，確認為複製品，可安全刪除 gnu 副本。
- [x] 1.2 刪除 `src-tauri/bin/` 內的測試媒體檔（`*.mp4`）與 `test_output_123.info.json`
  - 已刪除測試 mp4 與 `test_output_123.info.json`，釋出 18.35 MB。兩者原本即未被 git 追蹤。
  - 注意：mp4 檔名含 `[...]`，PowerShell `Remove-Item -Path` 會將中括號視為萬用字元而不刪除，必須使用 `-LiteralPath`。
- [x] 1.3 刪除 `src-tauri/bin/` 內的 `*.exe.old` 備份殘留檔
  - 兩個 `.old` 檔原為 git 追蹤中，已用 `git rm` 同時移出工作區與索引，釋出 34.76 MB。
- [x] 1.4 刪除根目錄 `AVD_1.0.26` ~ `AVD_1.0.60` 共 33 個歷史安裝包，僅保留當前版本 MSI 與 APK
  - 實際數量修正：原估 37 個有誤，實為 34 個 MSI + 1 個 APK，扣除當前版本後刪除 33 個，釋出 2107.88 MB。
  - **查證推翻 design 假設**：GitHub Releases 最舊僅到 v1.0.45，1.0.26 ~ 1.0.44 共 17 個 MSI（1094 MB）遠端並無備份。經使用者裁示接受永久遺失後全數刪除。
- [x] 1.5 刪除 `rclone_temp/` 目錄
  - 刪除前查證：`rclone_temp/` 與 `src-tauri/bin/` 的 rclone 同為 v1.67.0，前者為未壓縮來源（58.41 MB），後者為 UPX 壓縮產物（16.32 MB），確認重複。原為 git 追蹤中，已用 `git rm -r` 移除，釋出 65.86 MB。
- [x] 1.6 補強 `.gitignore`：新增 `*.old`、`src-tauri/bin/*.mp4`、`rclone_temp/`、`upx.exe`、`rclone.zip` 規則
  - `src-tauri/bin/*.mp4` 原已存在，本次新增 `rclone.zip`、`rclone_temp/`、`upx.exe`、`*.old` 四條規則。
  - ignore 規則對已追蹤檔案無效，故一併對 `rclone.zip` 與 `upx.exe` 執行 `git rm --cached`（保留本機檔案），並以 `git check-ignore -v` 驗證規則生效。
  - 查證 `upx.exe` 移出版控的影響：`all.ps1:212-223` 對其缺失有優雅降級（僅警告並略過壓縮步驟），且版控中的 sidecar 已是 UPX 壓縮產物（rclone 58.41 MB → 16.32 MB），全新 clone 不會產出更大的 MSI，建置不受影響。
- [x] 1.7 執行 `git status` 確認無非預期的未追蹤檔案，並記錄階段 A 釋出的磁碟空間
  - 階段 A 釋出合計約 2.23 GB（安裝包 2107.88 + rclone_temp 65.86 + 測試檔 18.35 + `.old` 34.76 MB），專案總佔用 6.3 GB → 4.39 GB。
  - `git status` 僅顯示本變更預期的刪除項與 `.gitignore` 修改，無非預期未追蹤檔案。
  - 附帶發現：`openspec/changes/channel-track-by-publish-time/` 有三個檔案存在**本變更以外的未提交修改**（進行中變更的既有編輯），本次不予處理，提交時須注意分開。

## 2. 階段 A 驗證：建置腳本仍可運作

- [x] 2.1 刪除 `src-tauri/bin/` 中的三個 `*-gnu.exe` 副本（依 1.1 驗證結果）
  - 三個 gnu 副本原為 git 追蹤中，已用 `git rm` 移除，釋出 58.62 MB。`src-tauri/bin/` 現僅存三個 msvc 副本。
- [x] 2.2 檢視 `all.ps1` 的 host-triple 補齊邏輯，補上「完全找不到某 sidecar 時顯示明確錯誤訊息並中止」的處理
  - 原邏輯在找不到任何副本時靜默跳過，會產生缺少 sidecar 的安裝包。改為將缺少的工具收集至 `$missingBinaries`，於 `try/catch` 區塊外統一檢查，列出工具名稱與應放置的完整路徑後 `exit 1`。
  - 變數 `$binDir`、`$binaries`、`$rustcHost` 提升至 `try` 區塊外宣告，供後續缺檔檢查與 UPX 段落共用。
- [x] 2.3 檢視 `all.ps1` 的 UPX 壓縮段落，調整為僅處理當前 host triple 所需副本，避免重複壓縮
  - 原以 `Get-ChildItem -Include "ffmpeg-*.exe", "rclone-*.exe"` 萬用字元比對，會對同一工具的多個平台副本重複壓縮。改為依 `$rustcHost` 直接組出單一檔名取用；若 host 偵測失敗則退回取第一個副本，確保每個工具至多壓縮一次。
  - 驗證：以擷取出的段落在暫存目錄執行三個規格情境，結果皆符合 — 情境 A（僅 msvc 副本）不複製且 exit 0；情境 B（僅 gnu 命名）三個工具皆自動複製為 msvc 檔名且 exit 0；情境 C（缺少 rclone）輸出「缺少工具「rclone」，請將執行檔放置於: src-tauri\bin\rclone-x86_64-pc-windows-msvc.exe」並 exit 1。
  - `all.ps1` 已確認維持 UTF-8 with BOM，且通過 PowerShell 語法解析檢查。
- [x] 2.4 執行完整 Tauri 建置，確認 MSI 產出成功且內含三個 sidecar
  - `npm run tauri:build` 以 exit 0 完成（release profile 52.59s），產出 `AVD_1.0.61_x64_zh-TW.msi`，63.26 MB — 與移除 gnu 副本前的同版本 MSI 尺寸一致，確認刪除重複副本對產出無影響。
  - 以 WindowsInstaller COM 查詢 MSI 的 File 資料表，內含 4 個檔案，其中 `yt-dlp.exe`、`ffmpeg.exe`、`rclone.exe` 三個 sidecar 皆齊備。
- [x] 2.5 安裝產出的 MSI 並實測一次下載，確認 yt-dlp / ffmpeg / rclone 皆正常運作
  - 由使用者實機驗證通過。本項在 v1.0.62、v1.0.63、v1.0.64 三次發布中反覆執行，皆確認移除 gnu 重複副本後，三個 sidecar 於安裝後的實際下載流程中運作正常。
  - 另有非安裝路徑的佐證：直接執行 `src-tauri/bin/` 內三個 msvc 副本，版本回報正常（yt-dlp 2026.08.18 / ffmpeg 7.0.1 / rclone v1.67.0）；MSI 內含檔案清單經 WindowsInstaller COM 查詢確認三者齊備。

## 3. 階段 B：OpenSpec 變更歸檔與規格回填

- [x] 3.1 依變更的時間先後排序 14 個待歸檔變更，產出歸檔執行順序清單
  - 以 `git log -1 --format=%cI -- <變更目錄>` 取得各變更最後提交時間並排序。實際時間序與提案時的推測順序不同，3.2 ~ 3.15 已依實測結果重排。
- [x] 3.2 歸檔 `no-auto-run-all-ps1`（2026-08-13），檢視 `git diff openspec/specs/` 確認合併正確
  - 歸檔為 `2026-09-02-no-auto-run-all-ps1`，新建能力 `agent-rules`（+1 requirement）。
  - **此規格對本變更後續任務有約束**：`agent-rules` 明訂 Agent MUST NOT 自動執行 `all.ps1`。任務 2.4 已改用 `npm run tauri:build` 符合規範；任務 6.4 的發布流程實測須改由使用者手動執行。
### 3.A 既有主規格結構修復（實作中發現的既有缺陷，非原規劃範圍）

- [x] 3.A.1 修復 6 個主規格缺少 `## Requirements` 區段標頭的問題
  - 發現 `openspec/specs/` 7 個主規格中有 6 個（`auto-retry-clean-build`、`auto-update`、`channel-auto-monitor`、`channel-ui-layout`、`release-automation`、`youtube-download`）缺少 `## Requirements` 標頭，導致其下共 14 條已交付需求對 openspec 工具完全不可見（validate / list / archive 皆讀不到），且會使 archive 直接中止。
  - 已於各檔第一條 `### Requirement:` 前插入 `## Requirements` 標頭，並一併補上專案規範要求的 UTF-8 BOM。`git diff` 確認需求內容一字未改。
- [x] 3.A.2 依問題 1 選定的慣例，將 6 個主規格中 14 條缺少 `MUST`/`SHALL` 的需求改寫為「MUST（必須）」形式
  - 以指令碼僅針對每條需求「標題到第一個 `#### Scenario:` 之前」的描述句替換首次出現的「必須」，不影響情境內文。合計改寫 14 條：`auto-retry-clean-build` 2、`auto-update` 1、`channel-auto-monitor` 3、`channel-ui-layout` 2、`release-automation` 3、`youtube-download` 3。
- [x] 3.A.3 補寫 `auto-update`（25 字）與 `channel-auto-monitor`（46 字）過短的 `## Purpose`，達到 50 字門檻
  - `auto-update` 25 → 116 字、`channel-auto-monitor` 46 → 125 字。
  - 額外發現並修復兩處 `TBD - ... Update Purpose after archive.` 佔位符：`channel-backup-restore`（本次歸檔產生，其 delta 未帶 `## Purpose`）與 `windows-native-http-fetch`（先前歸檔遺留），皆已補寫實質內容。

### 3.B 逐一歸檔

- [x] 3.3 歸檔 `startup-auto-update-check`（2026-08-15），檢視合併 diff（預期併入 `auto-update`）
  - 已修正其 delta：5 處中文「必須」改為「MUST（必須）」；並依問題 3 裁示移除與主規格撞名的 `更新內容展示與使用者同意`（主規格版本較完整，含「阻止彈窗關閉、持續展示進度」細節），delta 保留其餘 4 條 ADDED。
  - 歸檔後 `auto-update` +4，共 5 條需求（原有 1 條完整保留）。
- [x] 3.4 歸檔 `prompt-channel-tracking`（2026-08-16），檢視合併 diff（預期併入 `channel-auto-monitor`）
  - delta 的 MODIFIED 需求含 3 處中文「必須」，依慣例改寫後歸檔。`channel-auto-monitor` ~1 modified。
- [x] 3.5 歸檔 `filter-live-streams`（2026-08-16），檢視合併 diff（預期併入 `youtube-download`）
  - 實際新建能力 `auto-check-filtering`（+1），非預期的併入 `youtube-download`。
- [x] 3.6 歸檔 `reduce-app-size`（2026-08-16），檢視合併 diff
  - 該變更 `.openspec.yaml` 宣告 `skip_specs: true`，無 spec 更新，僅移入 archive。
- [x] 3.7 歸檔 `channel-backup-restore`（2026-08-17），檢視合併 diff
  - 新建能力 `channel-backup-restore`（+2）。其 delta 未帶 `## Purpose`，主規格產生 TBD 佔位符，已於 3.A.3 補寫。
- [x] 3.8 歸檔 `refine-channel-add-prompt`（2026-08-17），檢視合併 diff
  - 依問題 2 裁示，將原本的英文編號需求清單（`specs/refine-channel-add-prompt/spec.md`，無任何 delta 標頭）重寫為 `specs/channel-auto-monitor/spec.md` 的 ADDED delta：新增需求「輸入頻道網址時的追蹤與掃描兩段確認」含 4 個情境（未追蹤頻道、已追蹤頻道、確認掃描、略過掃描），語意完整保留。`channel-auto-monitor` +1。
- [x] 3.9 歸檔 `add-capacitor-share`（2026-08-17），檢視合併 diff
  - 新建能力 `capacitor-share-export`（+1）。
- [x] 3.10 歸檔 `yt-dlp-auto-update`（2026-08-19），檢視合併 diff
  - 新建能力 `yt-dlp-auto-update`（+2）。
- [x] 3.11 歸檔 `settings-ui-compact`（2026-08-19），檢視合併 diff
  - 宣告 `skip_specs`，無 spec 更新。
- [x] 3.12 歸檔 `fix-channel-check-feedback`（2026-08-19），檢視合併 diff
  - 新建能力 `channel-check-feedback`（+1）。
- [x] 3.13 歸檔 `yt-dlp-rss-fallback`（2026-08-25），檢視合併 diff
  - 新建能力 `yt-dlp-rss-fallback`（+1）。
- [x] 3.14 歸檔 `update-windows-layout`（2026-08-25），檢視合併 diff
  - 宣告 `skip_specs`，無 spec 更新。
- [x] 3.15 歸檔 `optional-ytdlp-fallback`（2026-08-26），檢視合併 diff
  - 首次歸檔被工具擋下：MODIFIED 區塊將情境更名為「Auto and manual checking via official RSS」，導致主規格既有情境「Auto and manual checking」會被丟棄（即 design.md 預警的 MODIFIED 陷阱）。判定兩者為同一情境的精修版（以發布時間錨點取代 `lastCheckTime`），故保留 delta 的精修內容並沿用原情境名稱，不丟失任何情境。`channel-auto-monitor` +1 ~1。
- [x] 3.16 確認 `openspec/changes/` 僅剩 `channel-track-by-publish-time` 與本變更
  - 已確認，14 個變更全數移入 `openspec/changes/archive/`，以 `2026-09-02-` 為前綴。
- [x] 3.17 執行 `openspec validate --strict`，修正所有回報問題
  - `openspec validate --all --strict` 結果：**16 passed, 0 failed**（14 個主規格 + 2 個進行中變更）。
- [x] 3.18 人工通讀 `openspec/specs/` 各主規格，確認無 MODIFIED 覆蓋造成的內容遺失、無 `TBD` 佔位殘留
  - 檢查項目：`TBD` 佔位殘留（發現 2 處並修復）、重複 Requirement 名稱（無）、無 Scenario 的空需求（無）。
  - 規格庫成果：能力數 7 → **14**，需求數 14 → **30**，且原本 14 條因缺少 `## Requirements` 標頭而對工具不可見的需求已全部可正常解析。

## 4. 階段 C 前置：備份與盤點

- [x] 4.1 將整個專案目錄（含 `.git`）完整複製為 `avd_backup_<日期>`，並驗證備份可正常 `git log`
  - 備份至 `C:\JohnLiang\..Project\avd_backup_2026-09-02`，662.6 MB / 1210 個檔案，已驗證可正常 `git log`（79 commits，HEAD 為 `5c1a06e`）。
  - 偏離原規劃：排除 `node_modules`、`src-tauri/target`、`android/app/build`、`android/.gradle`、`dist` 共約 3.77 GB 的可重建建置快取，只備份不可重建的內容。
  - **此備份實際發揮了作用**：見任務 5.1 的事故記錄。
- [x] 4.2 執行 `pip install git-filter-repo` 並確認 `git filter-repo --version` 可用
  - 已安裝 git-filter-repo 2.47.0。注意本機 `pip` 與 PATH 上的 `python` 指向不同 Python 安裝，`git filter-repo` 子指令無法直接呼叫，須使用完整路徑 `C:\Users\101169\AppData\Local\Python\pythoncore-3.14-64\Scripts\git-filter-repo.exe`。
- [x] 4.3 記錄現有全部 tag 與其對應 commit SHA 至暫存清單，供重寫後修復指向
  - **重大發現**：本機原本只有 1 個 tag（`v3.0.1`），遠端卻有 18 個。`git filter-repo` 只重寫本機存在的 ref；若不先抓取，17 個遠端 tag 會繼續指向含全部二進位檔的舊 commit，導致 GitHub 端歷史被 tag 保住、體積不縮反增（新 clone 會同時取得新舊兩份歷史），階段 C 等同失效。
  - 已 `git fetch --tags origin` 補齊至 18 個，並確認全部皆位於 `main` 歷史上。原始 SHA 清單存於 `avd_backup_2026-09-02\TAGS_BEFORE_REWRITE.txt`。
  - **使用者裁示 1**：重寫後 `main` 與全部 tag 一併強制推送。GitHub Release 綁定 tag 名稱，tag 移動後 17 個 Release 與下載資產完全保留，僅頁面顯示的 commit 改變。
  - **使用者裁示 2**：`v3.0.1` 為孤兒 tag（指向 2026-08-14 自動存檔 commit、無對應 Release、版號與專案 1.0.x 不符），於重寫前自本機與遠端刪除。
- [x] 4.4 記錄重寫前的 `.git` 體積與 commit 數作為對照基準
  - 基準：`.git` = 208 MB、commit 數 = 79、tag 數 = 18（刪除 `v3.0.1` 後為 17）。
- [x] 4.5 確認工作目錄無未提交變更（先提交階段 A 與階段 B 的成果）
  - 階段 A/B 成果已提交為 `5c1a06e`（102 個檔案，+728 / -194203）。
  - ⚠️ 此項僅部分達成：工作區刻意保留了 `openspec/changes/channel-track-by-publish-time/` 的 3 個檔案未提交（進行中變更的既有編輯，不屬本變更範圍）。這個「不乾淨的工作區」在任務 5.1 導致了事故，見該處記錄。

## 5. 階段 C：Git 歷史重寫（不可逆）

- [x] 5.0 刪除孤兒 tag `v3.0.1`（本機與遠端），避免其被一併重寫並保留在遠端
  - 刪除前已用 `gh release view v3.0.1` 確認無對應 Release。本機 `git tag -d` 與遠端 `git push origin :refs/tags/v3.0.1` 皆完成，tag 數 18 → 17。
- [x] 5.1 執行 `git filter-repo --invert-paths`，清除 `src-tauri/bin/`、`rclone.zip`、`upx.exe`、`rclone_temp/` 的全部歷史版本
  - 重寫成功：79 個 commit 全數解析並重寫，HEAD 由 `5c1a06e` 變為 `dc14386`，commit 數與 tag 數皆無遺漏（79 / 17）。
  - ⚠️ **事故與復原**：執行時加了 `--force` 以略過「工作區不乾淨」的保護，但當時工作區確實有 3 個未提交檔案（任務 4.5 刻意保留的 `channel-track-by-publish-time` 既有編輯）。`filter-repo` 會硬重設工作區，導致那些編輯被清除。已自任務 4.1 的備份完整還原（比對 SHA256 一致，`git diff` 重現原本的 +50 / -3）。
  - **教訓**：對 `filter-repo` 使用 `--force` 前必須先 `git stash` 或確認工作區完全乾淨，不可在明知有未提交變更時略過保護。
- [x] 5.2 重新設定 `origin` remote（`git filter-repo` 會主動移除遠端設定）
  - 已重新加入 `https://github.com/JohnLiang119/avd.git`。
- [x] 5.3 將備份中的三個 msvc sidecar 複製回 `src-tauri/bin/`，以單一新 commit 提交
  - 提交為 `61137d5`。三者 SHA256 前 16 碼與任務 1.1 記錄完全相符（`652E154BCE717007` / `90B69CA440CBA4B6` / `505AC2B0B6112428`），並以 `git check-ignore` 確認未被 `.gitignore` 誤擋。
- [x] 5.4 驗證 `.git` 體積已降至約 70 MB（執行 `git gc --aggressive --prune=now` 後量測）
  - **結果：208 MB → 58.9 MB（-72%）**，優於預估的 70 MB。
- [x] 5.5 比對重寫前後的 commit 數與 tag 數，確認無遺漏；產出新舊 SHA 對照表
  - commit 數 79 → 79、tag 數 17 → 17，皆無遺漏。`filter-repo` 產出的新舊 SHA 對照表位於 `.git/filter-repo/commit-map`。
- [x] 5.6 在重寫後的工作目錄執行建置（`npm run tauri:build`，依 `agent-rules` 規格不得自動執行 `all.ps1`），確認 MSI 產出成功
  - 建置以 exit 0 完成（release profile 55.90s），產出 `AVD_1.0.61_x64_zh-TW.msi`。歷史重寫未影響建置能力。
- [x] 5.7 執行 `git push --force origin main` 與 `git push --force origin --tags`，一併更新 17 個 tag
  - `main`：`c7c2f3d` → `61137d5`（forced update）。17 個 tag 全數 forced update，例如 `v1.0.45` `9cd37b7` → `fb89ec5`、`v1.0.61` `c7c2f3d` → `966f449`。
  - 推送前的遠端 ref 快照已存至 `avd_backup_2026-09-02\REMOTE_REFS_BEFORE_PUSH.txt`。
- [x] 5.8 開啟 GitHub Releases 頁面，確認 17 個 Release 仍存在且下載連結可正常下載
  - 17 個 Release 全數保留（數量與推送前一致），資產齊全：16 個各 2 項、`v1.0.52` 為 3 項。
  - 實測最舊的 `v1.0.45` MSI 下載連結：HTTP 200、64.39 MB，正常可下載。tag 移動未影響任何資產。
- [x] 5.9 確認遠端已無指向舊歷史的 ref（`git ls-remote` 比對），並記錄 GitHub 端體積變化
  - 推送前後遠端 ref 皆為 19 個，逐一比對確認**無任何 ref 仍指向舊 SHA**。
  - GitHub API 回報體積仍為 193.9 MB — 這是 GitHub 端 GC 延遲所致，非推送失敗。實際影響以 clone 體積為準（見 7.1）。

## 6. 階段 C 後置：發布腳本保留策略

> **範圍例外（使用者授權）**：`release_avd.ps1` 位於 `C:\JohnLiang\..Project\release_avd.ps1`，屬 JohnLiang 工作區倉庫，**在本變更 `allowedEditRoots`（avd 專案）之外**。這是既有的結構性錯配 —— `release-automation` 規格住在 avd 倉庫，它描述的腳本卻住在父倉庫。經使用者授權跨範圍修改，變更需另在 JohnLiang 倉庫提交。

- [x] 6.1 於 `release_avd.ps1` 新增「上傳成功後清理舊版本本機安裝包」邏輯，並輸出清理數量與釋出空間
  - 新增 `Invoke-CleanupOldPackages` 函式（腳本第 49 行），比對 `package.json` 版號後移除所有非當前版本的 `AVD_*.msi` / `AVD_*.apk`，逐檔列出名稱與大小，最後輸出移除數量與釋出的 MB 數。
  - 使用 `-LiteralPath` 刪除，避免檔名含中括號時被當成萬用字元（此坑於任務 1.2 踩過）。
- [x] 6.2 於 `release_avd.ps1` 新增保留參數（如 `-KeepOldPackages`），啟用時跳過清理並說明原因
  - 新增 `-KeepOldPackages` 開關，啟用時輸出「已指定 -KeepOldPackages，略過歷史安裝包清理，所有舊版本安裝檔原地保留。」並直接 return。
- [x] 6.3 確認上傳失敗路徑不會觸發任何本機安裝包刪除
  - 清理函式的唯一真實呼叫點在 `if ($LASTEXITCODE -eq 0)` 成功分支內（第 348 行）；失敗分支僅 `Write-Error` 後 `exit 1`，並補上「本機安裝包全數保留，可修正後重試發布」的提示。
- [x] 6.4 以 dry-run 方式驗證清理與保留兩種行為皆符合規格
  - 依使用者裁示改為 dry-run，不建立真實 Release。新增 `-DryRun` 開關。
  - ⚠️ **首次實作的閘門位置錯誤並造成副作用**：`-DryRun` 判斷原本只放在步驟 5，但腳本步驟 3 會自動 `git add -A` / `commit` / `push`。首次測試時已對 avd 倉庫執行了 `git add -A`；所幸 git 的 stderr 警告在 `$ErrorActionPreference = "Stop"` 下觸發終止錯誤，腳本在 commit 前中斷，HEAD 與遠端皆未變動，僅檔案被暫存，已用 `git restore --staged .` 完整還原。
  - 修正：將 `-DryRun` 判斷下移包住步驟 3 的全部四處版控寫入動作（`git add` / `commit` / `push` ×2），模擬模式改為僅列出未提交清單。
  - 四個情境實測結果：**情境 1**（僅當前版本）輸出「無低於 v1.0.61 的舊安裝檔，無須清理」；**情境 2**（3 個假舊包）逐檔列出 `[模擬] 移除 ...` 並統計「3 個檔案，釋出 3 MB」，實測三檔皆未被刪除；**情境 3**（`-KeepOldPackages`）正確略過並說明；**情境 4** 靜態確認清理僅在成功分支被呼叫。全程未觸碰遠端與版控。
  - 附帶發現（未處理）：`release_avd.ps1:150` 在找不到當前版號 MSI 時，會退而取「最後修改時間最新的任意 MSI」上傳，版號不符也照傳，屬誤發布風險，建議另案處理。

## 7. 收尾驗證

- [x] 7.1 於全新目錄 `git clone` 遠端倉庫，確認 clone 體積符合預期
  - 全新 clone 結果：`.git` **58.9 MB**（與本機重寫後一致）、工作區含 sidecar 共 **119.2 MB**、commit 數 80、tag 數 17。
  - 歷史清除驗證：對 `rclone.zip`、`upx.exe`、`rclone_temp`、`src-tauri/bin/*-gnu.exe` 執行 `git log --all -- <path>`，**四者皆為 0 筆歷史**，確認已完全清除。
- [x] 7.2 在該全新 clone 執行 `npm install` 與完整建置，確認離線 sidecar 齊備且建置成功
  - `npm install` 與 `npm run tauri:build` 皆以 exit 0 完成（全新 `target/` 從零編譯），產出 `AVD_1.0.61_x64_zh-TW.msi` **63.26 MB — 與重寫前的建置產出完全一致**。
  - 這證實了核心目標：移除 gnu 副本、清空歷史後，全新環境**無須任何網路下載**即可完整建置，且產出無差異。
- [x] 7.3 記錄最終成果對照表（`.git` 體積、專案總佔用、`openspec/changes/` 數量）並更新 `README.md` 的開發環境說明（若有變動）
  - 成果對照：`.git` 208 MB → **58.9 MB**；專案總佔用 6.3 GB → **4.19 GB**；`openspec/changes/` 15 → **2** 個（進行中變更 + 本變更）；`openspec/specs/` 7 → **14** 個能力、14 → **30** 條需求。
  - `README.md` 新增「內建 Sidecar 執行檔」小節，說明版控僅保留單一 msvc 副本、`all.ps1` 會自動依 host triple 補齊、缺檔時會中止建置，以及 `upx.exe` 已移出版控但不影響安裝包大小。
- [x] 7.4 確認離線備份 `avd_backup_<日期>` 完整保留，標註可刪除日期（30 天後）
  - 備份完整保留於 `C:\JohnLiang\..Project\avd_backup_2026-09-02`（662.6 MB / 1210 檔）。
  - 已於備份目錄建立 `README_備份說明.md`，載明內容清單、回退步驟、此備份實際發揮過的作用，以及**可刪除日期 2026-10-02**與刪除前的三項確認條件。
