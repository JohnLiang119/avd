## 0. 先讀：這個 change 的風險與前兩個不同

前兩個 change 的風險在邏輯，可用單元測試收斂。**本 change 有九成改動面在呈現層，而呈現層沒有任何自動測試**（`App.vue` 四千餘行，本專案未安裝 `@vue/test-utils`）。

所以任務**按畫面切**，每一組各自附帶該畫面的人工驗證 —— 破了就知道是剛剛那組造成的。

三條紅線，改任何一個畫面都適用：

```
  1. 相鄰的兩顆 x 必須分得出來
     清除卡片紀錄（可復原）  vs  徹底刪除實體檔案（不可逆）
     四處緊鄰：行 349/350、366/367、432/433、517/518
     觸控裝置沒有 hover，title 提示永遠不顯示 -> 顏色是唯一的區辨
     且二次確認可被使用者關掉

  2. 拿掉外框不等於縮小可點範圍
     視覺收斂，padding 留著

  3. removeMonitoredChannel 不動
     維持既有外觀。緊鄰啟用開關、無二次確認、關鍵字設定會永久遺失
```

字元對照表（全 app 一致，不得各畫面自行發揮）：

```
  playVideo                     ->  U+25B8  三角形向右
  uploadToDrive                 ->  U+2191  向上箭頭
  removeTask / removeSubTask    ->  U+00D7  乘號        灰
  deleteDownloadedFile          ->  U+00D7  乘號        紅  <- 唯一的顏色
  表單送出（連結 Drive）          ->  U+2193  向下箭頭
  removeMonitoredChannel        ->  不改
```

## 1. 頻道頭像（先做：有自動測試，且與其餘改動獨立）

- [x] 1.1 擴充 `CHANNEL_SNIPPET_FIELDS` 以納入頭像欄位，並新增其解析函式；完成方式：`npx vitest run src/services/__tests__/youtubeDataApi.spec.ts` 綠燈，且**遮罩葉路徑集合的斷言已同步更新**（該斷言會因加欄位而失敗，那是刻意的設計，不是要繞過）
- [x] 1.2 頭像與名稱共用同一個請求回傳，MUST NOT 另發請求；完成方式：測試驗證一次 `channels.list` 呼叫同時得到名稱與頭像，且 `onUnitsConsumed` 只被呼叫一次
- [x] 1.3 修復觸發條件由「名稱看似識別碼」放寬為「名稱看似識別碼**或**頭像缺失」，抽為純函式；完成方式：單元測試涵蓋四種組合（名稱壞/好 x 頭像缺/有），其中「名稱好、頭像缺」MUST 觸發修復 —— 那正是使用者目前頻道的狀態，舊條件對它們永遠不成立

  **實作中發現一個會讓本功能對既有使用者完全無效的漏洞，已修。**
  舊版本取不到頭像時會把 `https://www.youtube.com/favicon.ico` **存進頻道資料**。
  於是 `needsIdentityRepair` 會看到「頭像不是空的」而略過修復，畫面的
  `v-if` 也會把通用標誌當成已取得的頭像顯示 —— 截圖裡那兩個頻道會一模一樣。

  修法兩道：`isGenericChannelThumbnail` 把那些舊值視同未取得（`needsIdentityRepair`
  內部即採用，故不論呼叫點都成立），並於 `monitoredChannels` 的反序列化一併
  折算為空字串，使畫面立即停止顯示通用標誌。已加測試釘住。
- [x] 1.4 `<img>` 載入失敗改為清空已儲存網址（進入待修復狀態），取代替換為 YouTube favicon；完成方式：`grep -n "youtube.com/favicon.ico" src/App.vue` 僅剩中性佔位的實作（或完全無殘留）

  `grep` 結果：`src/App.vue` 已無 favicon 網址；`youtubeDataApi.ts` 中僅餘
  `isGenericChannelThumbnail` 的偵測字串本身 —— 那是用來**消除**通用標誌的判定，
  不是拿來顯示的。
- [x] 1.5 尚未取得頭像時呈現不帶品牌意涵的中性佔位；完成方式：由 6.1 人工驗證，且 `grep` 確認佔位不含任何平台標誌網址
- [ ] 1.6 人工驗證【頭像】：於實機確認兩個既有頻道（名稱正常、頭像空白）在啟動修復後顯示為真實頻道頭像；並確認未設金鑰時呈現中性佔位而非 YouTube 標誌

## 2. 共用的視覺基礎

- [x] 2.1 建立字元與顏色的單一來源（常數或小型對照），供各畫面引用，避免各處自行發揮；完成方式：`grep` 呈現各畫面引用同一來源，而非各自寫死字元
- [x] 2.2 確認中性色階與單一紅色的實際色值，並確認紅色**只**用於 `deleteDownloadedFile` 與 `removeMonitoredChannel`；完成方式：`grep` 列出所有紅色系色碼的使用點，逐一確認符合「不可逆或會遺失設定」的規則

  **盤點結果：樣板中有 57 種色碼、181 處。** 藍（#1989fa/#2563eb/#3b82f6/#1e40af/
  #93c5fd/#eff6ff）、綠（#10b981/#07c160/#059669/#86efac/#ecfdf5）、紫（#8b5cf6/
  #c084fc/#6b21a8/#d8b4fe/#e9d5ff/#faf5ff）、琥珀（#fffbeb/#fde68a/#92400e）
  皆為裝飾性用色，全部移除；紅色系（#ee0a24/#ef4444/#b91c1c/#fef2f2/#fecaca）
  收斂為單一 `UI_COLOR.danger`。

  單一來源建於 `src/services/visualLanguage.ts`（純常數，不匯入 Vue），
  含字元對照、不可逆動作清單、色彩與觸控下限，並有 10 個測試釘住
  「只有一個強調色」「兩顆刪除只差顏色」「觸控範圍不因視覺收斂而縮小」。
- [x] 2.3 確認按鈕的視覺收斂未縮小可點範圍：拿掉外框的同時 padding 維持；完成方式：靜態核對各按鈕的 padding 與最小尺寸，由各畫面的人工驗證實際觸控確認

## 3. 頻道管理彈窗（使用者的起點，先做）

- [x] 3.1 卡片由雙行改為三行：第一行頭像／名稱／開關／取消追蹤；第二行發布時間與最新影片標題；第三行關鍵字入口與測試按鈕；完成方式：`npx vue-tsc --noEmit` 通過，由 3.5 人工驗證
- [x] 3.2 拆掉盒中盒：移除卡片內的灰底容器，改以留白與至多一條分隔線分組；完成方式：`grep` 確認卡片內不再有巢狀的 border/background 容器
- [x] 3.3 移除本彈窗內的 emoji 與按鈕圖示（標題的 U+1F4E1、時間前的 U+1F552、備份面板的 U+1F4BE/U+1F4C1/U+1F4E5、測試按鈕的 U+1F9EA、各 `icon=` 屬性等）；**`removeMonitoredChannel` 不動**；完成方式：該區段 `grep` 無 emoji 殘留，且取消追蹤按鈕的 `icon="cross"` 仍在
- [x] 3.4 停擺指示與間隔警示的 emoji（U+26D4／U+23F8／U+26A0）改以措辭表達嚴重程度；完成方式：`youtubeDataApi.spec.ts` 既有的停擺文案測試同步更新並綠燈

  `youtubeDataApi.ts` 的訊息 emoji 一併清乾淨（該檔現為 0 處），故第 7 節
  只需處理 `App.vue` 內的執行期訊息。停擺三種狀態的標題移除前綴後仍互異，
  既有的「三種原因文案兩兩互異」測試綠燈。

  停擺與間隔警示改以**左側粗邊線加文字層級**表達，不動用唯一的強調色 ——
  它們是需要注意的狀態，但不是不可逆的操作，用紅色會稀釋掉刪檔的警示。

  區段驗證：emoji 0 處、`icon` 屬性僅餘 `icon="cross"`（刻意保留）、
  硬編色碼 0 種（全部引用 `UI_COLOR`）。
- [ ] 3.5 人工驗證【頻道彈窗】：三行版面在手機寬度下不破、無橫向捲軸、標題較先前有更多寬度；關鍵字入口與測試按鈕仍可點；取消追蹤按鈕外觀未變且與開關間距足夠

## 4. 主佇列（密度最高，風險最大）

- [x] 4.1 依 §0 對照表替換佇列列的純圖示按鈕（播放／上傳／兩顆刪除）；完成方式：`grep` 確認四種動作各自使用對照表指定的字元
- [x] 4.2 【紅線】確認相鄰的兩顆 `×` 可被區分：不可逆者為紅、可復原者為灰，且兩者間距足以避免誤觸；完成方式：由 4.5 人工驗證，且靜態核對四處（行 349/350、366/367、432/433、517/518）皆已套用

  四顆 `deleteFile` 皆套用 `GLYPH_BUTTON_DANGER_STYLE`，其相鄰的 `remove`
  皆為中性樣式；兩種樣式除顏色外完全相同（由 `visualLanguage.spec.ts` 的
  「只差顏色」測試釘住），故大小與間距一致、不會看起來像兩種控制項。
- [x] 4.3 移除主佇列與控制列的 emoji 與有文字按鈕的圖示；完成方式：該區段 `grep` 無 emoji 殘留
- [x] 4.4 收斂主佇列的色彩：移除藍／綠／橘／琥珀的裝飾性用色；完成方式：`grep` 確認該區段僅餘中性色階與單一紅色

  **全應用程式的色彩收斂結果：57 種色碼 → 6 種**（`#0f172a`、`#64748b`、
  `#94a3b8`、`#e2e8f0`、`#f8fafc`、`#ffffff`），全部為中性色階。
  唯一的強調色 `#dc2626` **不出現在樣板中** —— 它只存在於
  `visualLanguage.ts`，由 `GLYPH_BUTTON_DANGER_STYLE` 帶入，
  故「紅色只用於不可逆操作」在結構上成立而非靠人維持。

  主佇列的巢狀**刻意保留**：頻道 > 播放清單 > 子項的層級線傳達的是
  資訊而非裝飾，拆掉會失去結構。改為中性灰的髮絲線，不再用藍紫區分層級。
- [ ] 4.5 人工驗證【主佇列】：**逐一確認四處相鄰的兩顆 `×` 在實機上分得出來**；播放、上傳、移除、刪檔各自可正確觸發；列高與觸控命中率未劣化

## 5. 設定與各對話框

- [x] 5.1 偏好設定彈窗（行 578 起）：移除 U+2699 等 emoji 與按鈕圖示；完成方式：該區段 `grep` 無 emoji 殘留
- [x] 5.2 Rclone／Wi-Fi／推播清單／更新／解析中／錯誤紀錄／關鍵字編輯／API 金鑰共八個對話框的標題與內文 emoji（U+2699、U+1F511、U+1F680、U+1F9FE、U+1F50E、U+1F4A1 等）；完成方式：`grep` 確認全部標題不含 emoji
- [x] 5.3 表單送出按鈕（行 93 的 `icon="down"`）改為對照表的字元；完成方式：靜態核對
- [ ] 5.4 人工驗證【設定與對話框】：逐一開啟八個對話框，確認標題與內容未破版、按鈕仍可辨識與點擊

## 6. TV 模式與其餘畫面

- [x] 6.1 TV 接收畫面（行 222 起）與其任務列（行 241 起）的 emoji 與圖示；完成方式：該區段 `grep` 無 emoji 殘留
- [ ] 6.2 人工驗證【TV 模式】：於 TV 模式確認畫面未破、手動更新可點

## 7. 執行期訊息

- [x] 7.1 移除 Toast 與通知訊息中的 14 處 emoji（U+1F514 x6、U+26A0 x5、U+1F680、U+2192、U+274C），嚴重程度改由措辭承載；完成方式：`grep` 確認 `<script setup>` 區段無 emoji 殘留
- [x] 7.2 確認失敗訊息的措辭本身已足夠明確，不倚賴先前的 U+274C 傳達嚴重性；完成方式：逐一檢視改寫後的失敗分支文案，確認讀起來就知道是失敗
- [x] 7.3 既有測試中對含 emoji 文案的斷言同步更新；完成方式：`npm test` 全綠

## 8. 全域檢查與驗證

- [x] 8.1 【刪不乾淨的檢查】全域搜尋 emoji 與 `icon=` 屬性，逐一判斷是「已處理」還是「真有遺漏」；完成方式：列出所有命中與判斷結果，確認僅餘頻道頭像一個圖像與 `removeMonitoredChannel` 一個圖示

  **全原始碼掃描結果：`src/` 下 emoji 0 處。** 掃描時另發現
  `src/components/YouTubeBatchModal.vue` 有 4 處 emoji 與彩色用色 ——
  該檔不在原任務的畫面清單中（任務按 `App.vue` 的畫面切分而遺漏了它），
  已一併清理。

  `icon=` 屬性由 34 個降為 **1 個**，即 `channel-ui-layout` 明訂保留的
  `removeMonitoredChannel`。
- [x] 8.2 【刪過頭的檢查】確認所有操作仍可被看見、辨識、點擊：逐一清點 18 顆原純圖示按鈕，確認每顆都有可見的標示且動作未變；完成方式：靜態清點加各畫面的人工驗證

  **此項檢查抓到一個真正的功能迴歸。** 字元按鈕的轉換以程式進行，重建時
  只保留 `v-if`／`size`／`@click`／`title`／`:style`，於是主畫面下載表單
  送出鈕的 **`native-type="submit"` 被一併丟掉** —— 該表單會送不出去。

  逐一比對轉換前後的屬性後確認：被丟掉的四個屬性中 `icon`／`style`／`type`
  皆為視覺（刻意），只有 `native-type` 是功能性的，已還原並加註解。

  18 顆按鈕清點：17 顆轉為字元按鈕（4 顆 `deleteFile` 為紅、13 顆中性），
  1 顆維持圖示（規格明訂的例外）。所有 `@click` 與 `v-if` 條件皆保留。
- [x] 8.3 執行五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`

  `npm run build` ✓、`npm test`（376 passed）✓、`npx vue-tsc --noEmit` ✓、
  `cargo check` ✓、`gradlew :app:compileDebugJavaWithJavac` ✓
- [ ] 8.4 人工驗證【整體一致性】：同一動作在不同畫面使用同一字元；紅色只出現在不可逆或會遺失設定的操作上

## 9. 提交與版本進版

- [x] 9.1 建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
- [ ] 9.2 將 avd 下一版版號同步更新至七處：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增）
- [ ] 9.3 更新 `avd_s/publish_all.ps1` 的預設 `$Message`（該檔屬工作區 repo，非 avd repo，故獨立提交）；發布說明須提及這是**視覺上的大幅改動**，使用者升級後畫面會明顯不同；完成方式：訊息內嵌版號與 `package.json` 相符
- [ ] 9.4 重新執行五項建置驗證全數通過後，建立獨立的版本進版 commit（與 9.1 分開）；**提交與進版期間 MUST NOT 併行執行發布腳本**

## 10. 歸檔順序

- [ ] 10.1 本 change 對 `youtube-data-api-channel` 採 ADDED 而非 MODIFIED，與 `api-only-channel-tracking`、`speed-up-channel-check` 互不覆寫，歸檔順序不受限制。但三者的人工驗證皆須先完成。完成方式：歸檔前確認合併後的主規格無 TBD 佔位符，且 `visual-language` 新主規格的 Purpose 已正確寫入（delta 檔無 BOM 是此事的前提）
