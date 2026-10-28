## Why

生產環境實例（Android，v1.0.125，2026-10-28）：手機以 4G 行動網路下載一部剛上架的 YouTube 影片，任務以「已自動重試 3 次仍失敗: ERROR: [youtube] Xkv3CNa1h5g: Sign in to confirm you’re not a bot. … Use --cookies-from-browser or --cookies for the authentication. …」告終。

以 adb 進手機、用 App 相同的 Python 與 yt-dlp（nightly 2026.10.26，當天 06:27 自動更新）、相同的 player client 組合做對照：

| 環境 | 對外 IP | 目標影片 | 熱門舊片 |
| --- | --- | --- | --- |
| 手機 4G（中華電信） | 49.216.x.x | 6/6 次失敗（default 與 mweb 皆擋） | 成功 |
| 手機切公司 WiFi | 36.229.x.x | 成功 | — |
| PC 固網（同一份 nightly yt-dlp） | 36.229.x.x | 成功 | — |

結論：此錯誤是 YouTube 依 **IP 信譽 × 影片** 做的 bot 驗證，行動網路的 CGNAT 共用 IP 對剛上架的影片特別容易中。與 App、yt-dlp 版本、player client 無關；在同一網路下重試必然再被擋。yt-dlp 官方的解法只有帶 cookies（登入）或 PO Token，App 目前沒有這兩個機制，也不在本次範圍。

兩個缺陷：

### A. 確定性錯誤仍重試 3 次，且訊息誤導

`PERMANENT_DOWNLOAD_ERRORS` 未涵蓋此訊息。App 白白重試 3 次後顯示「已自動重試 3 次仍失敗」，暗示問題是暫時性的；原始訊息又是 yt-dlp 給桌面使用者的英文 cookies 指引，對手機使用者毫無幫助。

### B. 被擋後仍多打一輪 player API

Android 端每次下載先以 `--dump-json` 預取 metadata（一輪 3 個 client），失敗只記 log 便進入正式下載（再一輪 3 client × `--extractor-retries 3`）。被 bot 驗證擋下時第二輪必然再被擋；配合前端 3 次重試，30 秒內對 YouTube 打出數十次 player API 請求，只會讓共用 IP 更快被標記。

## What Changes

### ① 「Sign in to confirm you're not a bot」納入確定性錯誤

`matchPermanentError` 新增 `botCheck` 標記，命中即視為確定性錯誤。YouTube 文案使用彎引號（’），比對前統一正規化為直引號，清單只需維護一種寫法。「Sign in」開頭的其他訊息（私人影片、年齡確認）不得誤判為 bot 驗證。

### ② 命中時顯示專屬訊息

顯示「YouTube 要求登入驗證（判定為機器人），通常是行動網路共用 IP 所致，請改用 WiFi 或稍後再試」，不顯示「已自動重試 N 次」，也不顯示 yt-dlp 的英文指引。

### ③ Android 端 metadata 預取被 bot 驗證擋下時直接結束

`YoutubeDlPlugin.java` 預取 metadata 的 `catch` 區塊：若例外訊息為 bot 驗證，直接重新拋出、以該錯誤結束本次下載，不再進入正式下載。其他 metadata 失敗（解析失敗、欄位缺漏）維持現況「不中斷下載，欄位留空由後續流程補齊」。

## Capabilities

### Modified Capabilities

- `download-retry-policy`：確定性錯誤新增「來源要求登入以通過 bot 驗證」；失敗訊息新增 bot 驗證的專屬訊息；新增「被 bot 驗證擋下後不得再發起後續請求」需求。

## Impact

**受影響程式碼**

- `src/services/downloadErrors.ts` — 新增 `BOT_CHECK_ERRORS`、`BOT_CHECK_USER_MESSAGE`、`botCheck` 標記與引號正規化
- `src/services/__tests__/downloadErrors.spec.ts` — 補上 bot 驗證案例與誤判防護案例
- `src/App.vue` — 下載佇列的 `catch`：`botCheck` 命中時改顯示專屬訊息
- `android/app/src/main/java/com/mattpocock/avd/YoutubeDlPlugin.java` — metadata 預取的 `catch` 對 bot 驗證錯誤直接重新拋出

**不做的事**

- 不引入 cookies／PO Token 機制：需要使用者的登入資料，超出本次範圍。
- 不改 Windows 端：Windows 端沒有 metadata 預取的第二輪問題，確定性錯誤判定走同一份 `downloadErrors.ts` 已一併涵蓋。
