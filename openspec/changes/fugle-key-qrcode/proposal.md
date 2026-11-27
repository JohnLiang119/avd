## Why

使用者另有一支舊手機（Android 6、無通訊軟體）跑「Claude 額度」看板 App，該 App 新增了富果股票報價，
需要同一把富果 API 金鑰。金鑰只存在 avd 的原生設定（`avd_radio_alarm`），金鑰欄又刻意以密碼欄位遮蔽、
不回顯全文，使用者沒有方便的方式把金鑰帶到另一台裝置。以 QR code 顯示，舊手機用「掃一掃」即可取得。

## What Changes

- 電台鬧鐘股票頻道詳情的「金鑰」欄右側新增「QR」按鈕。
- 點選後以對話框顯示富果 API 金鑰的 QR code（沿用既有 `qrcode.vue`），附「不要截圖或讓別人掃描」提醒，
  60 秒後自動關閉；尚未設定金鑰時提示先填寫，不顯示 QR code。
- 對話框不以文字顯示金鑰全文（維持「不在畫面上回顯全文」的既有原則）。
- QR code 完全在本機產生，不經網路。

## Capabilities

### New Capabilities
- `fugle-key-qrcode`: 以 QR code 顯示富果 API 金鑰，供其他裝置掃描取得。

### Modified Capabilities

## Impact

- `src/App.vue`：金鑰欄新增按鈕、QR code 對話框與倒數關閉邏輯。
- 不影響原生端（Java）與金鑰的儲存方式。
