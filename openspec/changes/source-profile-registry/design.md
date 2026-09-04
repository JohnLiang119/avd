## Context

動機、實測數據與五處散落的清單見 `proposal.md`。本節僅補充實作所需的現況。

**目前的五處判斷各自長什麼樣：**

```
App.vue            isPlaylistUrl        7 個 includes() 的 or 串接
App.vue            isCreatorPageUrl     2 個 includes() 的 or 串接
parseScope.ts      parseProgressKey     5 條 regex + 1 條 fallback
DownloadService.ts 項目網址組法          if douyin / else if tiktok / else youtube（兩處）
（無）              flat metadata 完整度  沒有任何地方記錄
```

前四處各有各的比對規則，彼此沒有共用的來源概念；第五處根本不存在，是這次才發現需要的維度。

**既有可複用的機制：**

- `runParseCommand`（`DownloadService.ts`）已具備 spawn、stdout 累積、child 保存與取消，補齊階段可直接沿用。
- Android 的 `execute(request, processId)` + `destroyProcessById` 同樣可用於補齊。
- `YouTubeBatchModal` 以 `v-for="item in items"` 渲染，`items` 為 prop；只要更新來源 ref 的內容，Vue 即會重繪，漸進回填不需要改動元件結構。

## Goals / Non-Goals

**Goals**

- 加一個新來源只改一處。
- Bilibili 空間頁可用，且選片時看得到標題。
- 補齊失敗永遠只是「少了資訊」，不會變成「不能用」。

**Non-Goals**

- 不把下載階段的 metadata 取得也納入本表。下載階段本就各自取得完整資訊且行為正確，強行統一會把一個運作正常的路徑捲進來。
- 不做補齊結果的快取。同一個來源重複解析時會重複補齊 —— 加快取需要決定失效策略，收益不明顯。
- 不改動列表階段既有的時間上限、取消與分批續抓。

## Decisions

### D1. 註冊表的形狀

```ts
type FlatMetadata = 'full' | 'none';
type SourceKind = 'collection' | 'single' | 'unsupported';

interface SourceProfile {
  id: string;                    // 'bilibili-space'
  label: string;                 // 使用者可見的名稱，用於訊息
  kind: SourceKind;
  match(url: string): boolean;
  progressKey(url: string): string;
  needsPreParseConfirm: boolean;
  flatMetadata: FlatMetadata;
  buildItemUrl?(videoId: string, entry: any, sourceUrl: string): string;
}
```

**依序比對、首個命中者生效**，未命中則落到 fallback（`kind: 'single'`）。順序有意義 —— `youtube.com/watch?v=x&list=PL...` 同時像單片與清單，既有行為是視為清單，故 `youtube-playlist` 必須排在 `youtube-single` 之前。順序依賴以測試釘住。

**`flatMetadata` 只有兩檔而非三檔**：實測結果非黑即白 —— TikTok 給 26 個欄位、Bilibili 給 3 個。硬造一個 `partial` 檔位沒有實測依據，需要時再加。

**`buildItemUrl` 為選用**：只有 TikTok 需要（見 `fix-filename-collision` 的實測）。多數來源的 entry 已帶完整網址。

### D2. Douyin 使用者頁標記為 `unsupported` 而非移除

三種選擇：

| 做法 | 使用者看到 |
| --- | --- |
| 維持現狀（假支援） | 解析轉圈後給出 generic extractor 的困惑錯誤 |
| 直接移除 | 被當成單一影片，下載失敗，訊息同樣困惑 |
| **標為 unsupported** | 立即得到「抖音使用者頁目前無法解析」 |

第三種才是誠實的。`kind: 'unsupported'` 也讓這類已知缺口在表中可見，而不是靠人記得。

### D3. 補齊為列表之後的第二階段，不併入列表

併入列表（即拿掉 `--flat-playlist`）會讓對話框的出現時間從 2 秒變成數十秒至數分鐘，且以 200 筆上限計算必然撞破 90 秒。

拆為兩階段後，兩階段各自的性質才說得通：

```
             列表                    補齊
─────────────────────────────────────────────────────
必須成功      是                      否
時間上限      PARSE_TIMEOUT_MS 90s    自有預算
失敗處置      整體失敗                 該項保留退化標籤
重試策略      快速失敗（不重試）        退避重試
使用者可見     等待中                  已在選片
```

**重試策略相反是刻意的。** `fix-playlist-parse-hang` 為列表階段訂下 `--extractor-retries 0`，理由是「extractor 層級的失敗多為永久性」。Bilibili 的 412 是該理由的反例 —— 它是限流，正是應該退避的情況。兩階段面對的失敗性質不同，策略本就不該一致。

### D4. 補齊以「一次呼叫帶多個網址」分塊進行

yt-dlp 接受多個網址於單次呼叫，輸出為 NDJSON（每行一個 JSON）。相較每支影片各起一個行程，省下行程啟動成本。

**分塊而非一次全送**的三個理由：漸進回填需要中途就有結果；限流需要塊間節流；取消需要有中斷點。

**塊大小與節流間隔以實測為準**：Bilibili 在 5 支連續請求下已有 3 支被 412。初值取小（每塊 5 支、塊間 1 秒）並於任務中實測調整；此二值置於註冊表之外的共用常數，因限流是來源特性而非解析特性 —— 若日後發現各來源差異大，再移入 `SourceProfile`。

**Windows 的漸進性天然成立**：`runParseCommand` 已逐行累積 stdout，改為逐行回呼即可。**Android 需確認**：`YoutubeDL.execute` 為阻塞式，其 `Function3<Float, Long, String>` 回呼的第三個參數是否為 stdout 行尚未驗證。若不可行，退回「每塊一次 plugin 呼叫」的較粗粒度漸進 —— 塊大小既然只有 5，粒度已足夠。

### D5. 漸進回填以取代 ref 內容達成，不改動對話框元件

`parsedPlaylistItems` 是 `ref<PlaylistItem[]>`，`YouTubeBatchModal` 以 prop 接收並 `v-for` 渲染。補齊時依 `id` 找到對應項目並更新其欄位即可觸發重繪。

**勾選狀態不受影響的前提是 `:key="item.id"` 保持穩定**，且更新時不可替換整個陣列為新物件序列（會使 `selectedIds` 對不上）。以就地更新欄位、或以保留同一組 id 的方式重建陣列來滿足。此點以測試釘住。

### D6. 多序列來源：進度逐序列記錄，首批採用內嵌結果

`fix-playlist-parse-hang` 的續抓對 YouTube 頻道會漏片，根因與實測數據見 `proposal.md` ④。這裡談修法。

**為何不能只靠一個純量進度**：一個頻道是三個獨立序列，長度各異（117／23／332）。`fetched = 340` 這個數字對任何單一序列都沒有意義 —— 它既不是 videos 的位置，也不是 shorts 的位置。把它當成範圍起點送進每個分頁，必然錯位。

**修法**：`SourceProfile` 新增一個宣告，標明該來源會展開為多序列；進度鍵隨之帶上序列識別：

```
yt:channel:UCSJ4gkVC6NrvII8umztf0Ow/videos    → { fetched: 117, complete: true  }
yt:channel:UCSJ4gkVC6NrvII8umztf0Ow/streams   → { fetched:  23, complete: true  }
yt:channel:UCSJ4gkVC6NrvII8umztf0Ow/shorts    → { fetched: 200, complete: false }
```

續抓時只對 `complete: false` 的序列發出請求，各自帶自己的範圍。**所有序列皆 complete 時**，該來源才算抓完。

**上限的語意隨之改變**：對多序列來源，200 是「每序列 200」，故三分頁頻道的首批可達 600 筆。這是刻意接受的 —— 唯有每序列各自設限，續抓才定址得進去。事前確認對話框需據實說明，不能只報一個合計數字。

**首批不重打子分頁**。實測 `--playlist-end 200` 打在頻道網址上時，內嵌的 `entry.entries` **已各自被裁到 200**（117／23／200，4 秒），與逐分頁呼叫的結果完全相同：

```
頻道網址 + --playlist-end 200   →  videos 117 / streams 23 / shorts 200   （1 次呼叫，4 秒）
逐分頁各打一次                   →  videos 117 / streams 23 / shorts 200   （3 次呼叫）
```

現行程式碼忽略 `entry.entries` 一律重打，等於同一批資料抓兩次（共 4 次呼叫）。改為：**首批直接採用內嵌結果；只有續抓才對個別序列送 `--playlist-items`**。這同時結案了 `fix-playlist-parse-hang` 任務 8.6 記錄的效率缺陷。

**替代方案**：把整個頻道視為單一序列、在客戶端把三個分頁串接後全域切片。要拿到完整的 472 筆就不能對頻道網址設上限 —— 等於放棄抓取上限的保護，對大型頻道會回到本次要修的病灶。否決。

### D7. 限流辨識與退避集中於 `rateLimit.ts`，兩階段共用

**辨識以訊息文字比對**。yt-dlp 不提供結構化錯誤代碼（`downloadErrors.ts` 已為同一理由採此作法），故比對 `429`／`412`／`too many requests`／`precondition failed` 等片語。

**與 `matchPermanentError` 的關係**：兩者是互斥的分類。限流 MUST NOT 落入確定性錯誤清單 —— 目前 `PERMANENT_DOWNLOAD_ERRORS` 並未包含 429／412，此關係已經成立，但需以測試釘住，避免日後有人「順手」把 429 加進確定性清單。

**退避策略**：指數退避，初值 2 秒、上限 3 次（2s → 4s → 8s，累計 14 秒）。此數字受既有的 `PARSE_TIMEOUT_MS`（90 秒）約束 —— 14 秒的累計退避在其中仍有充裕餘裕，不會讓退避本身把逾時撐爆。

**為何是列表階段的例外而非推翻原則**：`fix-playlist-parse-hang` 訂下 `--extractor-retries 0` 的理由是「extractor 層級的失敗多為永久性」，這個判斷本身沒錯 —— 429 是它的反例，不是它的反證。故實作上維持 `--extractor-retries 0`（讓 yt-dlp 自己不要亂重試），改由**我們這一層**辨識限流後重跑整個呼叫。這樣兩種失敗各自走自己的路徑，不需要在 yt-dlp 的旗標裡表達細緻的分類。

**訊息改寫只在呈現層**。`reportError` 收到的仍是原始訊息並原樣寫入日誌；改寫發生在決定要顯示什麼給使用者的那一步。規格要求日誌保留原文，正是為了讓「使用者看到友善訊息」與「開發者拿得到原文」兩者並存。

## Risks / Trade-offs

- **[Risk] Bilibili 限流使補齊成功率偏低，使用者看到一半是「影片 N」** → Mitigation：節流與退避重試；且補齊本就是增益，最差情況等於本變更前的體驗。任務中實測調整塊大小與間隔。
- **[Risk] Android 無法逐行取得 stdout，漸進性打折** → Mitigation：退回每塊一次呼叫，塊大小 5 已提供足夠粒度。
- **[Risk] 註冊表的比對順序被日後改動而破壞既有行為**（如 `watch?v=x&list=PL` 從清單變單片）→ Mitigation：以測試釘住關鍵的順序敏感案例。
- **[Risk] 五處改為查表時漏改一處，造成新舊判斷並存** → Mitigation：改完後全域搜尋 `includes('tiktok`、`includes('douyin`、`includes('/channel/'` 等字樣，確認除註冊表外無殘留。
- **[Risk] 退避重試讓使用者等更久卻仍失敗** → Mitigation：累計上限 14 秒且受 90 秒總時長約束；且期間提示仍可取消。相較「立刻失敗但其實再等 2 秒就好」，這個取捨較佳。
- **[Risk] 限流片語比對誤判，把真正的永久性失敗當成限流而重試** → Mitigation：片語清單只收語義明確者（`429`、`too many requests`、`412`、`precondition failed`）；誤判的代價是多等 14 秒，不會造成錯誤結果。
- **[Trade-off] 補齊不做快取** → 重複解析同一來源會重複補齊。以本次的規模（數十筆）成本可接受，且省下失效策略的設計負擔。
- **[Risk] 既有的進度記錄以舊的純量鍵寫入，改為多序列鍵後對不上** → Mitigation：舊鍵直接忽略、視為無進度（等於從頭抓一次），不做遷移。`avd_parse_progress` 是 v1.0.68 才引入的便利性資料，重抓的代價只是使用者多按一次；寫遷移邏輯的成本高於收益。此點須於 Migration Plan 明載。
- **[Risk] 多序列來源的首批可達 600 筆，勾選對話框仍無虛擬列表** → 340 筆（Lofi Girl 的實際值）在實務上可接受，但分頁更多的頻道會更大。Mitigation：先實測 600 筆的渲染表現；若不可接受，虛擬列表才從非目標升格為必要工作。
- **[Risk] 「每序列 200」與使用者對「單次上限 200」的直覺不符** → Mitigation：事前確認對話框據實說明各序列的範圍，不報單一合計數字。這是 D6 的必要組成而非附帶說明。

## Migration Plan

行為改變，資料格式僅涉及 `avd_parse_progress` 的鍵。

**進度鍵不做遷移**。多序列來源的鍵會從 `yt:channel:UCxxx` 變為 `yt:channel:UCxxx/{分頁}`，Bilibili 從 `https://space.bilibili.com/{mid}` 變為 `bilibili:space:{mid}`。舊鍵直接忽略、視為無進度 —— 該來源會從頭抓一次，代價是使用者多按一次「略過」或多看一批重複項目（重複項目本就由既有的 `existingUrls` 過濾吸收）。`avd_parse_progress` 是 v1.0.68 才引入的便利性資料，寫遷移邏輯的成本高於收益。

回退即 `git revert`；回退後舊鍵重新生效，期間寫入的新鍵被忽略，同樣不造成故障。

**實作順序**：① 註冊表與五處改查表（純重構，行為不變，可獨立驗證）→ ④ 多序列進度與首批採用內嵌結果（修正既有漏片缺陷）→ ② Bilibili 納入（新增一筆）→ ③ 補齊階段。①完成後即可單獨合入；④ 因修的是既有缺陷，優先於新增來源。

**依賴**：本變更假設 `fix-playlist-parse-hang` 已落地並驗證。兩者皆改動 `App.vue` 的新增流程與 `DownloadService.parsePlaylist`，同時進行會互相踩到。

## Open Questions

- **Android 能否逐行取得 yt-dlp 的 stdout。** 影響的只是補齊的漸進粒度，不影響是否可行，故不阻塞設計 —— 任務 6.2 會驗證並據以選擇兩條路之一。
- **塊大小與節流間隔的最終值。** 需實測 Bilibili 的限流門檻，屬調參而非設計決策。
