# 實作提案 (Implementation Proposal)

## 目標 (Goal)
1. 隱藏主畫面的 TV 開關按鈕（畫面不顯示，但保留相關程式碼邏輯與方法）。
2. 在主畫面快傳伺服器按鈕的左側加入版號標籤（例如 `v3.0.1`）。
3. 將 MP3 下載模式核取方塊改為圓形音樂圖示按鈕 (`music-o` / `music`)。

## 實作計畫 (Plan)
1. 修改 `src/App.vue`：
   - 將 `<van-checkbox ...>MP3</van-checkbox>` 替換為與其他操作列一致的圓形圖示按鈕 `<van-button size="small" round ... />`。
   - 點擊按鈕切換 `mp3Mode` 狀態（啟用時切換高亮與實心圖示 `music`，未啟用時為 `music-o`）。
2. 驗證編譯與建置 (`npm run build`)。