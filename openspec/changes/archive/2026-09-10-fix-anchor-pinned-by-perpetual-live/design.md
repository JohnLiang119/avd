## Context

問題現象、實機證據與根因見 `proposal.md` 的 Why。行為契約見兩份 delta spec。

決定本設計形狀的三個現況約束：

- **錨點守門只認一個集合**：`useChannelMatching.ts` 的 `nextChannelBaseline(videos, currentBaseline, unhandledVideoIds)` 完全依 `unhandledVideoIds` 的內容計算上限。演算法本身沒有錯 —— 錯的是呼叫端往那個集合裡放了太多東西。因此本修正**不需動該函式**，只需收斂集合的成員。
- **狀態判定散在兩條通道**：`DownloadService.checkVideoLiveStatus`（yt-dlp，桌面走 sidecar、Android 走原生外掛）與 `youtubeDataApi.mapLiveStatus`（API 的 `liveBroadcastContent`）。後者已能正確把 `upcoming` 判為 `'live'`；前者對排程直播會直接報錯而落入 `'unknown'`。
- **`'live'` 與 `'unknown'` 目前在呼叫端無差別**：`App.vue` 的檢查迴圈以 `if (liveStatus !== 'not_live')` 一視同仁地加入 `unhandledVideoIds`。這正是兩種語意被混為一談的地方。

2026-09-10 實測確認（`yt-dlp --print live_status --skip-download`）：

```
4y6daUqsp5c -> ERROR: [youtube] 4y6daUqsp5c: This live event will begin in 6 hours.
3jPB4Vrf5Vk -> ERROR: [youtube] 3jPB4Vrf5Vk: This live event will begin in 5 hours.
```

而同一批影片經 `--flat-playlist -J` 查頻道的 `/streams` 分頁時，`live_status` 明確為 `is_upcoming`。錯誤訊息本身帶有足夠的辨識資訊。

## Goals / Non-Goals

**Goals:**

- 讓永遠存在排程直播的頻道，其錨點能正常推進。
- 讓「已知的直播」與「狀態無法判定」在整條流程中成為兩種不同的處置。
- 兩平台（桌面 yt-dlp、Android 原生外掛）與兩通道（yt-dlp、API）的判定結果一致。

**Non-Goals:**

- 不引入 `deferredVideoIds` 之類的待重看清單。使用者已明確表示不要那些排程直播，該機制的主要好處因此消失（理由見 proposal 的替代方案）。
- 不新增使用者可設定的「是否包含直播」開關。目前沒有需要它的情境；等真的出現「某頻道的直播存檔我想要」再說。
- 不改動 `nextChannelBaseline` 的演算法，也不改動候選視窗上限規則。
- 不處理「直播結束後補抓」的需求 —— 那正是本 change 刻意放棄的。

## Decisions

### 1.【D-A】收斂 `unhandledVideoIds`，不改錨點演算法

**Decision:** 檢查迴圈只在 `liveStatus === 'unknown'` 時把影片加入 `unhandledVideoIds`；`'live'` 不加入。`nextChannelBaseline` 一行不改。

**Rationale:** 錨點卡死的成因不是計算方式錯誤，而是輸入集合被塞入了「永遠不會消失的成員」。修集合而非修演算法，好處是既有的 59 個 `useChannelMatching` 測試全數維持有效 —— 它們釘住的錨點語意（不得越過未處理影片、視窗覆蓋判定、未初始化例外）都仍然正確，只是「未處理」的定義收窄了。

**Alternatives:** 在 `nextChannelBaseline` 內加入「未處理影片超過 N 天即忽略」的逾期規則 —— 治標，且把「哪些影片算未處理」這個語意問題偽裝成時間問題，門檻值也沒有原則性依據。

### 2.【D-B】辨識 yt-dlp 對排程直播的錯誤訊息

**Decision:** `checkVideoLiveStatus` 的 catch 區塊檢查錯誤訊息，命中「即將開始的直播」樣式時回傳 `'live'` 而非 `'unknown'`。

**Rationale:** **這是本 change 能否生效的前提，不是附帶改善。** 本案的排程直播正好全部落在 `'unknown'`；若只做決策 A 而不做這項，那些影片仍會阻擋錨點，卡死問題原封不動。兩者必須同時做，這也是它們合為一個 change 的原因。

錯誤訊息的比對需容忍 yt-dlp 的用詞變動與本地化。實測樣式為 `This live event will begin in N hours`；應以較寬鬆的關鍵片段比對（如 `live event will begin`），而非整句完全匹配。同時保留「無法辨識者仍為 `'unknown'`」的保守預設 —— 比對失敗只會退回目前的行為，不會造成新的錯誤放行。

**Alternatives:**
- **改用 `--flat-playlist -J` 查 `/streams` 分頁取得 `is_upcoming`**：資料較結構化，但需為每個頻道多跑一次 yt-dlp、且只涵蓋直播分頁，成本與涵蓋面都比解析錯誤訊息差。
- **改以 API 的 `liveBroadcastContent` 為準**：API 通道確實乾淨，但那需要使用者自備金鑰。未設金鑰者（目前的預設）不能因此得不到修正。

### 3.【D-C】Android 原生外掛比照處理

**Decision:** `YoutubeDlPlugin.checkVideoLiveStatus` 的錯誤處理同樣需辨識該樣式，使兩平台回傳一致。

**Rationale:** 規格明訂「兩平台對『已判定為直播』與『狀態無法判定』的區分 MUST 一致」。若只修桌面端，Android 上的錨點仍會卡死，而使用者主要在手機上使用追蹤功能 —— 那等於沒修。

Android 端的 yt-dlp 由 `youtubedl-android` 函式庫驅動，錯誤訊息來源與桌面 sidecar 相同（皆為 yt-dlp 本身的輸出），因此樣式可共用。

**【已於規劃階段驗證】訊息確實會抵達 Java 層。** 反組譯 `io.github.junkfood02.youtubedl-android:library:0.18.1` 的 `YoutubeDL.execute()` 位元組碼：

```
624: astore 19   <- outBuffer.toString()   (stdout)
638: astore 20   <- errBuffer.toString()   (stderr)
642: ifle   699                            <- exitCode <= 0 則跳過拋出
689: new    YoutubeDLException
693: aload  20                             <- 例外訊息即為完整 stderr
```

`YoutubeDLException` 以 `errBuffer.toString()` 建構，而 `YoutubeDlPlugin.checkVideoLiveStatus` 的 catch 是 `call.reject("查詢直播狀態失敗: " + e.getMessage())`，故 yt-dlp 的原始錯誤（`ERROR: [youtube] xxx: This live event will begin in 6 hours.`）會原樣傳到前端。樣式比對在 Android 上可行，無須改採其他訊號。

**Alternatives:** 只修桌面端並記為已知限制 —— 不可接受，主要使用平台就是 Android。

### 4.【D-D】判定樣式集中於單一處，不在兩層各寫一份

**Decision:** 把「錯誤訊息是否代表排程直播」抽為可測試的純函式，置於既有的純函式層（與 `matchPermanentError` 同類），由 `checkVideoLiveStatus` 呼叫。Android 的 Java 端因語言隔閡無法共用該函式，需各自實作，但**樣式常數與測試案例須在兩處對齊並互相註明**。

**Rationale:** 這類「靠字串樣式判定外部工具狀態」的邏輯，最常見的故障是兩處實作漂移。`downloadErrors.ts` 的 `matchPermanentError` 已是同一類問題的既有樣板，沿用其形式。

**Alternatives:** 直接在 `checkVideoLiveStatus` 內嵌 regex —— 無法單元測試，而這正是本 change 唯一可自動驗證的部分。

## Risks / Trade-offs

- **[直播結束轉存檔後不再被下載]** → 這是使用者明確要求的取捨，已寫入規格的 Scenario 與其理由。若日後改變心意，回頭採用 `deferredVideoIds`（見 proposal 的替代方案）。
- **[yt-dlp 錯誤訊息用詞變動使辨識失效]** → 退化行為是回到目前的 `'unknown'`，即錨點重新被壓住 —— 是既有的故障而非新的故障，且不會造成錯誤放行。以較寬鬆的關鍵片段比對降低發生率；yt-dlp 自動更新後若卡死重現，此處是第一個要看的地方。
- **[Android 端錯誤訊息可能不會原樣傳到 Java catch]** → **已於規劃階段以位元組碼驗證排除**（見決策 3）：`YoutubeDLException` 以完整 stderr 建構。殘餘風險僅在於日後函式庫升級改變此行為 —— 屆時的退化是回到 `unknown`（既有故障），不會錯誤放行。
- **[既有錨點已被污染的頻道不會自動復原]** → 修正後錨點會正常推進，但已卡在舊時間點的頻道，第一次檢查仍會把那之後的影片判定為新片（本案是 32 支）。使用者需清空一次佇列，或接受該輪的湧入。這不需要程式處理，但**須在發布說明中告知**。
- **[`'unknown'` 仍可能壓住錨點]** → 若某支影片持續查詢失敗且長留在候選視窗中，仍會卡住。與排程直播不同的是，這種情況不會被系統性地每日補充，且影片離開視窗後即自然解除。暫不處理，但若實際遇到，`deferredVideoIds` 是通用解。

## Migration Plan

1. ~~先實測 Android 端訊息可得性~~ —— 已於規劃階段以位元組碼驗證，見決策 3。
2. 加入判定樣式的純函式與單元測試。
3. 接上桌面 `checkVideoLiveStatus`，確認排程直播回傳 `'live'`。
4. Android 原生外掛比照，兩處樣式與測試案例對齊。
5. 檢查迴圈只讓 `'unknown'` 進入 `unhandledVideoIds`。
6. 重跑既有測試（`useChannelMatching` 的 59 個應全數維持綠燈 —— 若有失敗，代表本 change 意外改動了錨點語意，須停下檢視）。
7. 五項建置驗證後進版；發布說明須告知既有頻道可能有一次性的舊片湧入。

**回滾**：本 change 無資料模型變更。回滾即回到錨點被壓住的行為，不會留下需要清理的狀態。
