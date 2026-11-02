# 實作任務

## 1. 原生端：設定與連線

- [x] 1.1 `CarBluetoothStore.java`：選定車機的 SharedPreferences 持久化（位址＋名稱）
- [x] 1.2 `CarBluetooth.java`：權限判定、已配對裝置清單（車用排前）、音訊協定連線查詢、RFCOMM 喚醒＋輪詢的盡力連線、藍牙設定頁意圖、結果說明文字
- [x] 1.3 `RadioAlarmConstants`：等待上限、通知頻道與 id

## 2. 原生端：觸發點

- [x] 2.1 `RadioPlaybackService`：鬧鐘模式先連車機再播；等待期間第二筆 START 走延長；被停止時放棄結果；連不上發高優先通知（點開藍牙設定）；前景通知顯示「正在連線車機」
- [x] 2.2 `CarBluetoothTileService` 快速設定磚：按下盡力連線，失敗開藍牙設定，未設定開 App；磚面狀態與副標
- [x] 2.3 `AndroidManifest.xml`：`BLUETOOTH_CONNECT`／`BLUETOOTH`（≤30）、`android.hardware.bluetooth` 非必要、磚的 service 宣告；圖示 `ic_car_bluetooth`、字串 `car_bluetooth_tile_label`

## 3. 插件與前端

- [x] 3.1 `YoutubeDlPlugin`：`bluetooth` 權限別名與 `getCarBluetooth`／`listBondedBluetoothDevices`／`setCarBluetooth`／`connectCarBluetooth`／`openBluetoothSettings`
- [x] 3.2 `src/services/carBluetooth.ts`：型別、插件封裝、`sortBondedDevices`／`describeCarBluetoothStatus`／`needsSettingsFallback` 等純函式；`carBluetooth.spec.ts`
- [x] 3.3 `App.vue` 偏好設定「車機藍牙」區段：選擇／更換／清除車機（action sheet 列已配對裝置）、狀態文字；手動「連線車機」鈕放在主畫面左側取代「網路正常」標籤（失敗即開藍牙設定）

## 3b. 連線排程

- [x] 3b.1 `CarBluetoothSchedule.java`（時間區段模型、JSON、下一次開始、現在是否在區段內，沿用 `RadioAlarmSchedule`）、`CarBluetoothScheduler.java`（單一系統鬧鐘，區段內儲存或開機即立刻開始）、`CarBluetoothScheduleReceiver.java`（區段開始與開機／時間變更重登錄）、`CarBluetoothConnectService.java`（連接裝置型前景服務：區段內重試、連到即停、區段結束仍未連上才通知）；`CarBluetooth.notifyNotConnected` 與播放服務共用
- [x] 3b.2 `YoutubeDlPlugin`：`getCarBluetoothSchedule`／`setCarBluetoothSchedule`（含 endTime、activeUntil、connecting）；Manifest 註冊接收器、前景服務與 `FOREGROUND_SERVICE_CONNECTED_DEVICE`；`CarBluetoothScheduleTest`
- [x] 3b.3 前端 `carBluetooth.ts` 區段型別與純函式（`describeCarScheduleStatus`、`addMinutesToTime`、`validateCarWindow` 等）及測試；`App.vue` 車機藍牙區段的排程列（開始與結束時刻、星期、開關、移除、新增、狀態說明）

## 4. 建置與驗證

- [x] 4.1 `npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [x] 4.2 進版七處並更新 `publish_all.ps1` 預設發布說明；提交、推送、執行發布腳本
- [x] 4.3 實車驗證：上車後按磚或等鬧鐘，確認 CX501A 是否被 RFCOMM 喚醒接回 A2DP；不吃則記錄並評估 Shizuku 方案
  - 結果（2026-11-02）：**不吃**。等滿 10 秒後開藍牙設定，手動點一下才連上。改以無障礙服務代點（見第 5 節），不引入 Shizuku。

## 5. 自動點選車機（無障礙服務）

- [x] 5.1 `CarBluetoothAutoTapService`：待命 15 秒、名稱完全相同（含別名）、點前確認未連線、一次只點一下、捲動找列（僅設定頁所屬套件）、點後等接回即提示並返回；`res/xml/car_bluetooth_auto_tap.xml` 與字串
- [x] 5.2 `CarBluetoothSettingsActivity` 透明中繼頁（設定待命 → 開系統藍牙設定）；`CarBluetooth.settingsIntent(Context)` 改指中繼頁，磚、插件、「車機未連線」通知、連線排程常駐通知（新增點一下開設定）全部改走它
- [x] 5.3 `CarBluetooth`：`awaitConnected`、`displayNames`、`manualWaitMs`（自動點選開著時手動入口不等 RFCOMM）；`connect` 等待為 0 時不做喚醒
- [x] 5.4 Manifest：無障礙服務、中繼頁、藍牙設定動作的 `<queries>`
- [x] 5.5 插件：狀態帶 `autoTapEnabled`、`openCarAutoTapSettings`、手動連線改用 `manualWaitMs` 與交接訊息
- [x] 5.6 前端：`autoTapEnabled` 型別與 `describeCarAutoTap` 純函式及測試；偏好設定「自動點選車機」列；App 回前景時重讀車機狀態
- [ ] 5.7 建置驗證（五項）全數通過；進版七處與 `publish_all.ps1` 預設發布說明；提交、發布
- [ ] 5.8 實車驗證：開啟無障礙服務後按磚，確認 HyperOS 藍牙設定頁能自動點選 CX501A 並返回
