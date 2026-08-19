## Why
設定彈窗 (偏好設定) 因為加入了 yt-dlp 引擎狀態區塊後，三大區塊共 10 行 cell 把 `van-dialog` 撐爆，「關閉」按鈕被推到畫面外，使用者無法操作。需要重新排版讓整體更簡潔。

## What Changes
- 將「系統版本與更新」和「yt-dlp 引擎狀態」合併為一個「版本與更新」區塊。
- 將 4 個防呆開關壓縮成 2 行（每行放「全部」與「單一」兩個 switch）。
- 整體從 10 行 cell 壓縮到約 6 行，確保「關閉」按鈕可見。

## Capabilities

### New Capabilities

### Modified Capabilities

## Impact
- `App.vue`：設定彈窗 template 與相關樣式調整。
