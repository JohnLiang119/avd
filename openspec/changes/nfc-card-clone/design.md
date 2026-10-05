## Context

動機與功能範圍見 proposal.md；驗收契約見 specs/nfc-card-clone/spec.md。現有 Android 使用 Capacitor `NfcPlugin`、`NfcAdapter.ReaderCallback` 與 `tagDiscovered` 事件，Windows 才使用 Tauri。一般讀卡不執行金鑰驗證或區塊 I/O；可選的技術列表、SAK／ATQA 僅取自探索資訊。

MIFARE Classic 支援屬 Android 裝置選配，sector 存取需要驗證金鑰；不能由「手機有 NFC」推定可寫卡。[Android MifareClassic](https://developer.android.com/reference/android/nfc/tech/MifareClassic) 說明此限制；[NfcA](https://developer.android.com/reference/android/nfc/tech/NfcA) 的探索資訊可用於相容性比對，但不是魔術卡世代證明。

## Goals / Non-Goals

**Goals：** 將複製操作與普通讀卡隔離；由原生端管理來源快照、一次性寫入權與驗證，避免前端生命週期或延遲事件觸發錯誤寫入；純資料規則可自動測試。

**Non-Goals：** 不提供任意區塊寫入 API、不把前端傳來的 16-byte 陣列直接當作寫入依據、不自動推斷卡片世代；不增加持久化卡片映像或自動修復流程。

## Decisions

### D1 明確啟動來源準備，維持普通讀卡契約

- `armCloneSource({ requestId, sourceUidHex })` 只在讀卡畫面開啟、Activity 位於前景且 NFC 可用時接受。前端先註冊複製事件，再建立本次唯一識別碼並請使用者重新感應來源。
- 下一次探索必須符合選定 UID、4-byte 長度與支援的 MIFARE Classic 卡型；不相符即結束本次準備並回報，不能偷偷換來源。此階段只有讀取權，永不寫入。
- 原生端以 `KEY_DEFAULT` 嘗試 sector 0 的 Key A／Key B，各至多一次；不使用字典、破解或修改存取條件。成功讀到的 block 0 須驗證長度、UID、BCC 與卡型；資料不合法時拒絕，不以 fallback 掩蓋。
- 金鑰不符或 block 0 無法讀取而探索資料有效時，只提供 `uid-only` 模式，供使用者明確選擇；來源移開、取消、逾時與一般 I/O 錯誤則終止準備，不當作正常降級條件。
- 原生持有不可變來源快照，發出 `cloneSourceReady({ requestId, sourceUidHex, profile, availableModes, block0Hex? })`。前端拿到的內容只供顯示／驗證，不是後續寫入的權威來源。
- 選擇再次感應以確保來源新鮮；不在普通 `tagDiscovered` 流程驗證金鑰或預讀 block 0，因此無需修改 reader 的扇區禁止契約。

### D2 兩種資料模式與相容性條件

- `full-block0`：只採用已驗證的完整來源 16 bytes，且來源／目標須符合已實測的相容 profile。讀到完整區塊仍不代表可跨卡型原樣覆寫。
- `uid-only`：先讀取並驗證目標原始 block 0；複製目標內容，僅替換 bytes 0–3 為來源 UID、byte 4 為四個 UID bytes 的 XOR，完整保留目標 bytes 5–15。
- 不把來源 SAK／ATQA 當成可任意套用的 block 0 模板，也不填造廠商 bytes。ATQA 保留 API 原始順序供比對，不另行猜測端序。
- profile 固定包含 MIFARE Classic type／size、4-byte UID、SAK 整數、ATQA 原始兩 bytes 與已驗證的 block 0 格式；來源與目標的 type／size／SAK／ATQA 均須相同。整塊模式還須符合目標型號已驗證的非 UID 位元組限制。支援紀錄包含實測手機與目標卡型；資料不符或尚無相容性依據時拒絕寫入，不新增讓使用者猜測 profile 的介面。
- profile 只能篩除不相容情形；認證成功、UID 或商品名稱皆無法證明卡片是 gen2。介面須說明僅支援已驗證的目標卡型，不能宣稱自動辨識全部魔術卡。
- 選擇保留目標資料的 UID 模式，避免重建非 UID bytes；整塊模式相容性不符時不得靜默改用 UID 模式。

### D3 Capacitor API、狀態與事件

| 介面 | 行為 |
| --- | --- |
| `armCloneSource({ requestId, sourceUidHex })` | 建立一次來源準備，回傳只代表已待命。 |
| `armCloneWrite({ requestId, mode })` | 使用同一操作的原生來源快照，進入一次目標等待；不接受 block 0 payload。 |
| `armCloneVerify({ requestId })` | 僅在尚未結束且原生持有獨立完整預期資料時，明確啟動唯讀核對，永不寫入。 |
| `disarmCloneWrite({ requestId })` | 撤銷整個複製操作，包括來源準備與驗證；重複呼叫可安全結束。 |
| `cloneSourceReady` | 來源快照已備妥、可選模式與識別碼。 |
| `cloneResult` | `{ requestId, status, stage, code?, writeAttempted }`；只接受目前識別碼的事件。 |

- 狀態路徑為 `idle → awaiting-source → source-ready → awaiting-target → processing-target → awaiting-verification → verifying → terminal`。來源、來源備妥後的模式選擇、目標及重新感應等待各以原生單調時鐘計時，30 秒到期即撤銷；UI 倒數只作顯示。
- `status` 區分非終態 `verification-required`，以及終態 `verified`、`matched-without-write`、`failed`、`unknown`、`cancelled`；`stage` 區分來源、目標、寫入、讀回與重新感應。只有 `verified` 可顯示「UID 複製完成」，任一終態皆清除操作資料。
- `processing-target` 原子消耗待命寫入權；同時或後續探索不能再取得寫入權。任何重試須由使用者另開操作，不自動重設 armed。
- 只接受當前 requestId 與狀態所允許的後續呼叫；操作進行中拒絕另開來源、重複待命寫入或不合狀態的驗證請求。過期 requestId 的呼叫與事件無效。複製階段不向普通讀卡歷史送目標事件，避免覆蓋選定來源與污染歷史。

### D4 原生序列 I/O 與取消競態

- `onTagDiscovered` 只辨識目前操作、取得一次處理權，再交單一背景 executor 執行 `connect → authenticate → read／write → close`；所有區塊 I/O 都離開主執行緒，且 `finally` 釋放連線。
- 每段卡片連線工作自 `connect` 前起算最多 5 秒；獨立排程器逾時即使操作失效並由另一執行緒 `close()`，不能把中止工作排在已阻塞的 I/O executor 後面。不能只靠前端計時器或 `setTimeout`：後者僅保證套用於 `transceive`。[Android MifareClassic I/O 與 close](https://developer.android.com/reference/android/nfc/tech/MifareClassic)
- 原生在 I/O 各步與真正寫入前重查操作世代、畫面／Activity／NFC 狀態；短鎖內完成最後 guard 與 `writeAttempted` 標記，以此作為開始寫入的原子邊界，再至多呼叫一次 `writeBlock(0, expected)`，不持鎖等待 I/O。
- 取消、30 秒等待逾時、`stopScan`、彈窗關閉、Activity pause、NFC 關閉、插件銷毀都立即撤銷待命權並中止連線；NFC 開關需原生監聽 adapter 狀態，不能只等 resume。
- 取消在該原子邊界之前取得處理權時，撤銷操作並保證不再寫入；邊界之後取消，即使實際呼叫尚未送出，也只能保守回報結果未知，不宣稱未修改。卡片寫入不能視為可回滾交易。
- 前景恢復僅依 reader 狀態恢復普通讀卡；不恢復來源快照、待命寫入或驗證。退出操作時清除快照／預期資料，前端移除 listener 並使識別碼失效。

### D5 目標檢查與分階段驗證

1. 取得目標後先檢查技術、4-byte UID、profile、金鑰存取及原始 block 0。原生重算預期完整內容，檢查 UID 與 BCC，未通過前不得寫入。
2. 目標 UID 與來源相同時永不寫入，並結束寫入待命；提示移開來源或更換目標。若已有獨立的完整來源預期資料，可改為僅等待使用者明確啟動唯讀核對；不得從待驗卡自己組出預期值再自證相符。此路徑只回報「既有資料相符」，不能算新寫入成功；無完整預期資料時結束操作，只提供普通 UID 核對。
3. 寫入一次後讀回並逐 byte 比對完整 16 bytes；明確不符立即以驗證失敗終止。連線中斷或無法讀回時可進入非終態 `verification-required`，顯示「結果尚未驗證」，等待以新探索完成唯讀驗證；不重寫。等待逾時、取消或生命週期中止才以 `unknown` 終止並清除預期資料。
4. 讀回相符仍只發出 `verification-required`。關閉該連線並提示移開目標後重新感應，僅以新的探索事件建立驗證 Tag；舊 `Tag.getId()` 是原探索資料，不是寫後重讀 UID。參見 [Android Tag](https://developer.android.com/reference/android/nfc/Tag)。
5. 新探索的 UID 必須符合來源，再驗證金鑰並讀取 block 0；完整內容與先前凍結的預期資料皆相符才回報 `verified`。不能因 UID 相同略過完整區塊比對，也不能重用原 Tag 連線模擬重新感應。
6. 重複 UID 無法證明物理卡片身分；介面提醒移開來源、只呈現目標。此驗證證明所呈現卡片的資料相符，不宣稱其可通過實際門禁。

### D6 錯誤、資料保存與測試邊界

- 錯誤碼按可觀察證據區分：`unsupported-profile`、`invalid-data`、`source-mismatch`、`same-uid`、`authentication-failed`、`tag-lost`、`io-failed`、`verification-mismatch`、`timeout`。例外發生階段與 `writeAttempted` 決定失敗或未知，單次認證／I/O 失敗不能斷言普通卡或 gen1a。
- 將 Hex／BCC／模式組裝與完整比對抽成無 Android I/O 相依的 Java 純類別，使用既有 JUnit 測試；`nfcClone.ts` 僅提供型別、事件資料驗證、顯示與插件封裝，避免維護兩份權威 builder。前端測試不能取代原生狀態與實卡寫入驗證。
- block 0、目標原始內容與金鑰不寫進歷史、儲存或一般 log；只在有效操作記憶體持有。尚待唯讀驗證時仍受生命週期與 30 秒期限限制；終態未知不得保留快照再次啟動驗證。
- 自動檢查涵蓋資料長度／BCC、UID 模式完整保留 bytes 5–15、整塊比對、重複探索、取消競態與過期結果；實機記錄涵蓋卡型、手機、兩種模式、重新感應、移卡及 NFC／背景中止。未完成硬體驗收前不列為支援組合。

## Risks / Trade-offs

- [商品標示與實際卡型不同，或 block 0 改寫後無法再次存取] → 限定實測組合、拒絕不符 profile、保留目標非 UID bytes；不承諾永久可重寫或可還原。[MIFARE Classic Tool 原始說明](https://raw.githubusercontent.com/ikarus23/MifareClassicTool/master/Mifare%20Classic%20Tool/app/src/main/res/values/strings.xml) 指出只有部分 gen2 卡把 block 0 尾部當成 SAK／ATQA，錯誤內容可能使卡片失效，因此不採通用重建模板。
- [來源不可讀時，僅 UID 複製與原卡資料不同] → 使用者明確選擇模式，結果標示範圍；實際門禁相容性另行驗證。
- [未知結果誘發使用者連續重寫] → 區分未寫入與結果未知，優先提供有有效預期資料的唯讀核對，永不自動重寫。
- [不同卡片可能具有相同 UID／block 0] → 不宣稱驗證了物理身分；移開來源後只呈現目標，作為實機操作要求。

## Migration Plan

- 先確立 `nfc-card-reader` 主規格，再整合／歸檔本 change；本次不改 reader change 的完成狀態。
- 無持久化遷移；前端與原生插件同版部署，完成實作與驗收才依工作區規則進版。
- 軟體回退可移除複製入口與相關插件方法、保留普通讀卡；已改寫的實體卡不會因軟體回退自動還原。
