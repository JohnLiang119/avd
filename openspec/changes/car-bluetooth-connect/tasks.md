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

- [x] 3b.1 `CarBluetoothSchedule.java`（資料模型、JSON、最早下一次，沿用 `RadioAlarmSchedule`）、`CarBluetoothScheduler.java`（單一系統鬧鐘）、`CarBluetoothScheduleReceiver.java`（觸發與開機／時間變更重登錄，goAsync 背景連線）；`CarBluetooth.notifyNotConnected` 與播放服務共用
- [x] 3b.2 `YoutubeDlPlugin`：`getCarBluetoothSchedule`／`setCarBluetoothSchedule`；Manifest 註冊接收器；`CarBluetoothScheduleTest`
- [x] 3b.3 前端 `carBluetooth.ts` 排程型別、`describeNextConnect` 等純函式與測試；`App.vue` 車機藍牙區段的排程列（時刻、星期、開關、移除、新增、下一次連線）

## 4. 建置與驗證

- [x] 4.1 `npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check`、`gradlew :app:compileDebugJavaWithJavac` 全數通過
- [x] 4.2 進版七處並更新 `publish_all.ps1` 預設發布說明；提交、推送、執行發布腳本
- [ ] 4.3 實車驗證：上車後按磚或等鬧鐘，確認 CX501A 是否被 RFCOMM 喚醒接回 A2DP；不吃則記錄並評估 Shizuku 方案
