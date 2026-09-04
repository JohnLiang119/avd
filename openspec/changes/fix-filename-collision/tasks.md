# 實作任務

## 1. 檔名規則的共用純函式

- [x] 1.1 新增 `src/services/fileNaming.ts`，實作 `sanitizeTitleForFile(title)`（去非法字元、截 30 字、去尾端句點與空白）
- [x] 1.2 實作 `buildDownloadFileName(title, publishTimeMs)`：無發布時間時退回僅標題，有則接 `__yyyyMMdd_HHmmss`
- [x] 1.3 實作 `nextAvailableName(base, ext, exists)`：以注入的存在性判斷函式尋找可用名稱，含嘗試次數上限
- [x] 1.4 補上 vitest：同標題不同時間互異、無時間退回、非法字元、截斷邊界、遞增改名、上限保護

## 2. ① Windows 端接上發布時間

- [x] 2.1 `DownloadService.ts` 的 `cleanFileName` 改用 `buildDownloadFileName`，發布時間取現有的 `timestampNum` / `uploadDate` 推導結果
- [x] 2.2 既有的 `while (await exists(...))` 遞增迴圈改用 `nextAvailableName`，補上嘗試次數上限
- [x] 2.3 確認 `-o {uniqueId}.%(ext)s` 的落檔行為未變（僅最終改名的目標檔名改變）

## 3. ① + ② Android 端

- [x] 3.1 `YoutubeDlPlugin.java` 的 `cleanTitle` 接上發布時間，格式與 Windows 一致；於註解寫入與 TS 端對照的案例表
- [x] 3.2 移除「偵測到同名即 `throw new Exception("檔案已存在 (重複)")`」
- [x] 3.3 改為遞增尋找可用名稱：沿用既有的 MediaStore 查詢與檔案系統檢查兩層，改為判斷「此名稱可否使用」，含嘗試次數上限
- [x] 3.4 確認 TikTok 分支（`CronetDownloader` 路徑）與 yt-dlp 分支都套用同一組檔名

## 4. ③ 確定性錯誤清單

- [x] 4.1 `PERMANENT_DOWNLOAD_ERRORS` 加入「檔案已存在」（取子字串以容忍括號內文字變動）
- [x] 4.2 確認命中後不顯示「已自動重試 N 次」字樣

## 5. 建置與測試

- [x] 5.1 `npm run build`、`npx vue-tsc --noEmit`、`npm test`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [x] 5.2 `openspec validate fix-filename-collision --strict` 通過

## 6. 驗證

- [ ] 6.1 Windows：下載兩支標題相同、發布時間不同的影片，確認產生兩個檔名互異的檔案且皆成功
- [ ] 6.2 Windows：手動造出同名檔案後再下載，確認自動改名且既有檔案未被覆蓋
- [ ] 6.3 Android 實機：重跑本次回報的情境（自 `@bingleng8888888` 批次下載多支同描述影片），確認全數成功、無「檔案已存在 (重複)」
- [ ] 6.4 Android 實機：確認檔案總管中的檔名帶有可辨識的發布時間
- [ ] 6.5 Android 實機：確認既有的舊格式檔案未被改名或移動
- [ ] 6.6 兩平台：下載一支 YouTube 影片，確認新命名格式未破壞既有的正常流程（含 mp3 模式）
