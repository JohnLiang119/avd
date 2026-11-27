## ADDED Requirements

### Requirement: 以 QR code 顯示富果 API 金鑰

系統 MUST（必須）在電台鬧鐘股票頻道詳情的金鑰欄提供「QR」按鈕；點選後以 QR code 顯示目前儲存的富果 API 金鑰，供其他裝置以相機或掃描程式取得。QR code MUST（必須）在本機產生，不經任何網路服務。

對話框 MUST NOT（不得）以文字顯示金鑰全文，並 MUST（必須）提醒金鑰不可截圖或外流；對話框 MUST（必須）在 60 秒後自動關閉。尚未設定金鑰時 MUST NOT（不得）顯示 QR code，改提示先填寫金鑰。

#### Scenario: 顯示金鑰 QR code

- **WHEN** 使用者已設定富果 API 金鑰，並在股票頻道詳情點選金鑰欄旁的「QR」
- **THEN** 介面顯示內容為該金鑰的 QR code 與外流提醒
- **AND** 畫面上不出現金鑰全文

#### Scenario: 自動關閉

- **WHEN** QR code 對話框已開啟 60 秒
- **THEN** 對話框自動關閉

#### Scenario: 尚未設定金鑰

- **WHEN** 金鑰欄為空時點選「QR」
- **THEN** 介面提示先填寫金鑰，不顯示 QR code
