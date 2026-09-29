## Purpose

讓 Android 手機在 AVD 內充當門禁卡讀卡機：卡片靠近手機即顯示其 UID 為 Hex 正序卡號並可複製，並保留最近的讀卡紀錄，供使用者登錄或核對門禁卡時使用。

## ADDED Requirements

### Requirement: 平台可見性

NFC 讀卡機 MUST（必須）只在 Android 手機端提供；Windows（Tauri）端 MUST NOT（不得）顯示任何 NFC 讀卡機的進入點或介面。進入點 MUST（必須）位於偏好設定的 Android 專區，與既有的僅 Android 功能並列。

#### Scenario: Android 顯示進入點

- **WHEN** 使用者在 Android 手機開啟偏好設定
- **THEN** Android 專區出現「NFC 讀卡機」進入點

#### Scenario: Windows 不顯示

- **WHEN** 使用者在 Windows 開啟偏好設定
- **THEN** 介面中不存在「NFC 讀卡機」的任何進入點

### Requirement: 讀卡只在讀卡畫面開著時進行

系統 MUST（必須）只在 NFC 讀卡機畫面開啟期間感應卡片；畫面關閉後 MUST（必須）立即停止感應。系統 MUST NOT（不得）在讀卡畫面未開啟時攔截任何 NFC 卡片，也 MUST NOT（不得）因安裝本 App 而使裝置在靠近 NFC 卡片時出現「以 AVD 開啟」的選項。

讀卡畫面開啟期間，若 App 退到背景或螢幕鎖定，感應 MAY（可以）暫停；回到前景且畫面仍開著時，系統 MUST（必須）自動恢復感應，不需使用者再操作。

#### Scenario: 開啟畫面後感應卡片

- **WHEN** 使用者開啟 NFC 讀卡機畫面並將門禁卡靠近手機背面
- **THEN** 畫面顯示該卡片的卡號

#### Scenario: 關閉畫面後不再感應

- **WHEN** 使用者關閉 NFC 讀卡機畫面後將卡片靠近手機
- **THEN** AVD 不顯示卡號、不新增紀錄，也不跳出任何 AVD 的介面

#### Scenario: 畫面開著時切出再切回

- **WHEN** 讀卡畫面開著，使用者切到其他 App 再切回 AVD
- **THEN** 不需額外操作，卡片靠近即再次顯示卡號

### Requirement: 卡號格式為 UID 的 Hex 正序

卡號 MUST（必須）為卡片 UID 的十六進位表示：依卡片回報的原始位元組順序、大寫、不分隔、每個位元組固定兩位（例如 UID 位元組 `04 A3 7F 12` 顯示為 `04A37F12`）。4、7、10 byte 的 UID MUST（必須）皆以完整長度顯示，不截斷、不反序、不轉十進位。系統 MUST NOT（不得）讀取或顯示卡片扇區內容。

#### Scenario: 4 byte UID

- **WHEN** 感應到 UID 位元組為 `04 A3 7F 12` 的卡片
- **THEN** 卡號顯示為 `04A37F12`

#### Scenario: 7 byte UID

- **WHEN** 感應到 UID 位元組為 `04 12 3A 5B 6C 7D 80` 的卡片
- **THEN** 卡號顯示為 `04123A5B6C7D80`

#### Scenario: 位元組值小於 0x10

- **WHEN** 感應到 UID 位元組為 `0A 00 FF 01` 的卡片
- **THEN** 卡號顯示為 `0A00FF01`，每個位元組保留前導零

### Requirement: 顯示、複製與回饋

讀到卡片時，讀卡畫面 MUST（必須）以醒目字級顯示卡號，並提供「複製」操作把卡號原文寫入剪貼簿；複製成功 MUST（必須）有可見提示。讀到卡片時裝置 MUST（必須）短暫震動一次作為回饋。

#### Scenario: 複製卡號

- **WHEN** 畫面顯示卡號 `04A37F12`，使用者按「複製」
- **THEN** 剪貼簿內容為 `04A37F12`，畫面顯示已複製的提示

#### Scenario: 讀到卡片時震動

- **WHEN** 卡片靠近並成功讀到 UID
- **THEN** 裝置短暫震動一次，卡號同時更新

### Requirement: 歷史紀錄

系統 MUST（必須）保留最近 50 筆讀卡紀錄，每筆含讀取時間與卡號，最新在上；超過 50 筆時 MUST（必須）捨棄最舊的。同一卡號在 3 秒內重複感應 MUST（必須）只更新該筆的時間、不新增一筆。使用者 MUST（必須）能一次清除全部紀錄。歷史紀錄 MUST（必須）在 App 重啟後仍存在。

#### Scenario: 連續讀取多張不同卡片

- **WHEN** 使用者依序感應卡號 `A`、`B`、`C` 三張卡片
- **THEN** 歷史紀錄由上而下為 `C`、`B`、`A`，各附讀取時間

#### Scenario: 同一張卡短時間內重複感應

- **WHEN** 卡號 `A` 在 3 秒內被感應兩次
- **THEN** 歷史紀錄中 `A` 只有一筆，時間為較晚的那次

#### Scenario: 超過 50 筆

- **WHEN** 歷史已有 50 筆，再感應一張新卡片
- **THEN** 最舊的一筆被捨棄，新卡片位於最上方，總數仍為 50

#### Scenario: 清除歷史

- **WHEN** 使用者執行清除歷史
- **THEN** 歷史紀錄為空，畫面上目前顯示的卡號 MAY（可以）保留

#### Scenario: 重啟後保留

- **WHEN** 使用者讀過卡片後完全關閉並重新開啟 AVD
- **THEN** 歷史紀錄與關閉前一致

### Requirement: 裝置沒有 NFC 或 NFC 已關閉時的提示

裝置沒有 NFC 硬體時，讀卡畫面 MUST（必須）顯示「此裝置不支援 NFC」且不提供讀卡。裝置有 NFC 但已關閉時，畫面 MUST（必須）說明 NFC 已關閉，並提供前往系統 NFC 設定的操作；使用者開啟 NFC 後回到畫面，系統 MUST（必須）自動開始感應，不需關閉再重開畫面。任何一種狀態下系統 MUST NOT（不得）在無法讀卡時顯示「請將卡片靠近」的提示。

#### Scenario: 裝置無 NFC 硬體

- **WHEN** 使用者在沒有 NFC 硬體的裝置（例如 Android TV）開啟讀卡畫面
- **THEN** 畫面顯示「此裝置不支援 NFC」，沒有「請將卡片靠近」提示，也沒有前往設定的操作

#### Scenario: NFC 已關閉

- **WHEN** 使用者在 NFC 關閉的手機開啟讀卡畫面
- **THEN** 畫面說明 NFC 已關閉並提供前往系統 NFC 設定的操作

#### Scenario: 開啟 NFC 後回到畫面

- **WHEN** 使用者由讀卡畫面前往系統設定開啟 NFC 後返回 AVD
- **THEN** 畫面切換為「請將卡片靠近」，卡片靠近即顯示卡號

### Requirement: 安裝相容性

NFC 相關的權限與功能宣告 MUST NOT（不得）使沒有 NFC 硬體的裝置無法安裝 AVD。啟用讀卡 MUST NOT（不得）需要任何執行期權限請求。

#### Scenario: 無 NFC 裝置安裝

- **WHEN** 使用者在沒有 NFC 硬體的 Android 裝置安裝含本功能的 APK
- **THEN** 安裝成功，其餘功能照常使用
