## Why

使用者每天早上開車上班，在車上聽 AVD 早報鬧鐘播的中廣新聞；但手機上車後常常沒有自動連上車機藍牙（CX501A），得下拉通知列、進藍牙面板、點一下車機才會接回來。使用者希望 AVD 在鬧鐘響起前先把手機連到車機，上車時也能一按就連。

Android 12 起，`BluetoothA2dp.connect()` 這類「叫系統去連某台已配對裝置」的 API 要求 `BLUETOOTH_PRIVILEGED`，一般 App 呼叫會收到 SecurityException，所以「App 直接連」做不到。使用者在比較過「Shizuku 全自動」後選擇不加額外依賴，採「盡力自動、失敗一鍵」。

## What Changes

- **新增「車機藍牙」設定（Android）**：偏好設定可從已配對裝置中選一台車機（車用音訊排最前）；選定的裝置由原生端持有（鬧鐘響起時 WebView 未必在執行，快速設定磚也在 WebView 之外），前端不另存副本。
- **鬧鐘響起前先連車機**：鬧鐘模式啟動播放服務時，若已設定車機且有權限，先盡力連線，最多等 10 秒再開始播放；試播與手動直播不走這段。連不上就照播，並發出高優先通知，點一下即開系統藍牙設定。連上後系統會自動把正在播的聲音切到車機。
- **「盡力連線」的實作**：對車機開一條 RFCOMM 連線（只需 `BLUETOOTH_CONNECT`）把底層 ACL 鏈路喚起，多數車機看到手機連上就會自己接回 A2DP／通話協定；期間每半秒查一次音訊協定連線狀態。能不能成要看車機韌體，故所有入口都有退回路徑。
- **快速設定磚「連線車機」**：上車時下拉一按即嘗試連線；連不上就開藍牙設定並收起通知列；尚未選車機時開 App。磚面顯示車機名稱與已連線／未連線。
- **主畫面的「連線車機」鈕**：取代原本左側的「網路正常」標籤（Android）；同一套流程，結果以 toast 說明，失敗即開藍牙設定。網路不穩或離線時仍有獨立警示列，Windows 版維持原標籤。尚未選車機時按下去提示先到偏好設定選擇。
- **新增 Android 權限**：`BLUETOOTH_CONNECT`（API 31+，執行期請求，選裝置時才要）；API 30 以下用 `BLUETOOTH`。不要 `BLUETOOTH_SCAN`——只連已配對的裝置，不掃描。`android.hardware.bluetooth` 標為非必要（同一份 APK 也裝在 TV）。

- **連線排程**：偏好設定可新增多筆「時刻 + 星期 + 啟用」，時間一到由系統鬧鐘喚醒、自動盡力連線選定的車機（不播放任何東西），連不上發同一則「點一下開藍牙設定」通知。對應上班、下班等固定上車時間。只維護一個系統鬧鐘（指向最早的下一次），觸發時先登錄下一次再連線；重開機與改時間、時區後自動重新登錄。

### 已做的假設（可在審閱時推翻）

- 「連結藍芽的排程」解讀為**到時間自動連線**的排程，而非「排程播放」。排程用 `setExactAndAllowWhileIdle`（精確鬧鐘被關時退為 `setAndAllowWhileIdle`），不佔用狀態列的鬧鐘圖示；接收器以 goAsync 在背景連線，等待上限 8 秒（系統對接收器時限約 10 秒）。排程上限 12 筆。

- 等待上限 **10 秒**：車機接回協定通常在 2–5 秒內；超過就當沒成功，早報不能遲到太久。
- 只在**鬧鐘模式**先連車機；試播與直播時使用者在 App 裡，要連可以按主畫面的「連線車機」鈕。
- 退回的「一鍵」是**系統藍牙設定頁**而非系統的輸出切換面板：後者在部分 ROM 上要求呼叫者有進行中的媒體工作階段，且 HyperOS 的面板行為未驗證；藍牙設定頁在所有裝置上都能點一下連線。
- 實車上 CX501A 是否吃 RFCOMM 喚醒這招，**本次無法在開發機驗證**（手機不在線上、車不在旁邊）；若不吃，功能退化為「一鍵開藍牙設定」，仍比現狀少兩步。

## Capabilities

### New Capabilities

- `car-bluetooth-connect`: 車機藍牙的選擇與持久化、鬧鐘前的盡力連線與退回通知、快速設定磚、主畫面的手動連線、定時連線排程。

### Modified Capabilities

- 無。`config-persistence` 既有的「原生端為權威來源的設定」例外已涵蓋本設定。

## Impact

- **Android 原生**（`android/app/src/main/java/com/mattpocock/avd/`）：新增 `CarBluetoothStore`（SharedPreferences）、`CarBluetooth`（連線與查詢）、`CarBluetoothTileService`（快速設定磚）；`RadioPlaybackService` 在鬧鐘模式先連車機；`RadioAlarmConstants` 新增等待上限與通知頻道；`YoutubeDlPlugin` 新增 `getCarBluetooth`／`listBondedBluetoothDevices`／`setCarBluetooth`／`connectCarBluetooth`／`openBluetoothSettings`；`AndroidManifest.xml` 新增權限、feature 與磚；新增磚圖示 `ic_car_bluetooth` 與字串 `car_bluetooth_tile_label`。
- **前端**：`src/services/carBluetooth.ts`（插件封裝與純函式，附 vitest）；`App.vue` 偏好設定新增「車機藍牙」區段（Android 限定）。
- **不影響**：Windows／Tauri 端、下載佇列、鬧鐘以外的播放路徑。
- **版本進版**：依工作區規範同步七處版號並更新 `avd_s/publish_all.ps1` 預設發布說明。
