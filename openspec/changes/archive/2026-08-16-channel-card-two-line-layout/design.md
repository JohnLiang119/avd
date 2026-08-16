# 系統設計：頻道卡片雙行版面重構 (Design: Channel Card Two-Line Layout)

## UI 結構設計 (UI Structure)

### 結構對比

#### 修改前 (單行擁擠)：
```
[ 頭貼 ] [ 頻道名... / 最新影片... ] [ 測試 ] [ Switch ] [ X ]
```
> 問題：三個按鈕橫排佔去 ~130px，造成中間文字區僅剩不到一半寬度。

#### 修改後 (雙行優化)：
```
┌────────────────────────────────────────────────────────┐
│ [頭貼] 頻道完整名稱 (寬敞)              [Switch]  [ X ]│
│                                                        │
│   最新: 南宋岳飛之謎完整標題...           [ 測試 ]      │
└────────────────────────────────────────────────────────┘
```

## CSS 排版樣式規範
- 外層容器：`display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;`
- 第一行容器：`display: flex; align-items: center; justify-content: space-between;`
  - 左側頻道資訊：`display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;`
  - 右側操作區：`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`
- 第二行容器：`display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #f8fafc; padding: 4px 8px; border-radius: 6px;`
  - 左側最新影片：`font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;`
  - 右側測試按鈕：`van-button size="mini" type="warning" plain round`
