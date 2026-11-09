## ADDED Requirements

### Requirement: 主畫面網址輸入

系統 MUST（必須）於 Windows 與 Android 的主畫面皆提供網址輸入框與送出鈕。使用者貼上或輸入影音網址並送出後，系統 MUST（必須）將其加入下載佇列（或於多片來源時進入既有的解析與選集流程），行為與 Windows 端一致；輸入非網址文字時沿用既有的 YouTube 關鍵字搜尋確認流程。

Android 端 MUST NOT（不得）因新增輸入框而移除既有的「從其他 App 分享網址」入口。TV 模式下輸入區維持隱藏。

#### Scenario: Android 貼上影片網址下載

- **WHEN** 使用者於 Android 主畫面的輸入框貼上影片網址並按送出
- **THEN** 該網址加入下載佇列並開始下載
- **AND** 輸入框清空並提示已加入佇列

#### Scenario: Android 輸入關鍵字

- **WHEN** 使用者於 Android 主畫面的輸入框輸入不以 `http://`／`https://` 開頭的文字並送出
- **THEN** 系統徵詢是否以該文字搜尋 YouTube，與 Windows 端相同

#### Scenario: 分享入口仍可用

- **WHEN** 使用者自其他 App 以「分享」把影片網址傳給 AVD
- **THEN** 該網址照舊加入下載佇列

#### Scenario: Windows 專屬按鈕

- **WHEN** 使用者於 Android 開啟主畫面
- **THEN** 輸入列不出現「開啟資料夾」與「連結 Drive」按鈕
