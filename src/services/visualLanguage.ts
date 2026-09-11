/**
 * 視覺語言的單一來源：操作字元與顏色語意。
 *
 * 集中於此的理由是**一致性無法靠人維持**。介面的極簡化按畫面分批進行，
 * 同一個動作會在不同批次中被改到；若各處自行挑字元，過幾批之後「移除」
 * 在佇列是一個字元、在頻道清單是另一個，而沒有任何機制會提醒。
 *
 * 本模組刻意只放常數與純函式，不匯入任何 Vue 或平台相依，使其可被測試引用。
 */

/**
 * 操作的字元標示。
 *
 * 選字的準則是「形狀對應動作」而非「好看」：三角形向右即播放、箭頭向上即
 * 上傳、乘號即移除。使用者不該需要學習對照表。
 *
 * `remove` 與 `deleteFile` **共用乘號**是刻意的。兩者的動作類別相同（都是
 * 刪除），差別在後果是否可逆，而後果的差異由顏色承載（見 `UI_COLOR.danger`）。
 * 用兩個不同字元反而會暗示這是兩種不同的操作，模糊掉「同樣是刪，一個可救
 * 一個不可救」這個真正重要的區別。
 */
export const ACTION_GLYPH = {
  /** 播放已下載的影片 */
  play: '▸',
  /** 上傳至雲端硬碟 */
  upload: '↑',
  /** 自清單移除（可復原） */
  remove: '×',
  /** 徹底刪除實體檔案（不可逆） */
  deleteFile: '×',
  /** 送出表單 */
  submit: '↓',
} as const;

export type ActionName = keyof typeof ACTION_GLYPH;

/**
 * 不可逆或會造成設定永久遺失的操作。
 *
 * 這份清單決定 `UI_COLOR.danger` 的使用範圍 —— 顏色在此承載語意而非裝飾，
 * 故「哪些操作算危險」必須是一個可被查閱、可被測試的事實，而不是各處
 * 自行判斷的品味。
 */
export const IRREVERSIBLE_ACTIONS: readonly ActionName[] = ['deleteFile'];

/** 某動作是否為不可逆操作（據此決定是否套用強調色）。 */
export function isIrreversibleAction(action: ActionName): boolean {
  return IRREVERSIBLE_ACTIONS.includes(action);
}

/**
 * 介面的色彩。
 *
 * 中性色階承擔絕大部分的呈現，顏色只出現在**兩個互不重疊的用途軸**上：
 *
 * ```
 *   danger  ->  操作軸：「按下去會發生什麼」   只用於不可逆或會遺失設定的操作
 *   ok      ->  狀態軸：「現在的情況如何」     只用於連線正常的指示
 * ```
 *
 * 兩者不會出現在同一個元素上，故不互相稀釋 —— 這正是收斂調色盤的原意。
 * 先前介面同時使用藍、綠、橘、琥珀與紅，紅色只是五分之一而毫不顯眼，
 * 而四處緊鄰的刪除按鈕正是只靠顏色區分「可復原」與「不可逆」。
 * 抽掉裝飾性用色之後，剩下的紅色才真正是警告。
 *
 * 任何要再加第三個顏色的提案，都必須先說明它屬於哪一個軸、以及為什麼
 * 不會稀釋既有的那一個。
 *
 * 色值只存在於此處與實作中，**刻意不寫進規格** —— 規格保護的是「兩者必須
 * 分得出來」，不是「必須是這個紅」。
 */
export const UI_COLOR = {
  /** 主要文字 */
  text: '#0f172a',
  /** 次要文字（時間、說明） */
  textMuted: '#64748b',
  /** 弱化文字（提示、佔位） */
  textFaint: '#94a3b8',
  /** 分隔線與邊界 */
  line: '#e2e8f0',
  /** 底層留白 */
  surface: '#ffffff',
  /** 略帶層次的底 */
  surfaceMuted: '#f8fafc',
  /** 唯一的操作強調色。只用於不可逆或會造成設定永久遺失的操作 */
  danger: '#dc2626',
  /**
   * 網路連線正常的狀態色。
   *
   * **這是唯一一個用於「狀態」而非「操作」的顏色**，且刻意與 `danger` 分屬
   * 兩個不同的用途軸：`danger` 標記「按下去會發生什麼」，`ok` 標記
   * 「現在的情況如何」。兩者不會出現在同一個元素上，故不互相稀釋。
   *
   * 保留它的理由是它承載語意而非裝飾 —— 使用者以此在一瞥之間確認連線正常，
   * 而該標籤同時帶有文字與形狀標示（見 `useNetworkStatus` 的 `icon`），
   * 顏色是輔助而非唯一的傳達手段。
   *
   * MUST NOT 用於任何可點擊的控制項。
   */
  ok: '#059669',
  /** 狀態色的襯底與邊界，只與 `ok` 搭配使用 */
  okSurface: '#ecfdf5',
  okLine: '#a7f3d0',
} as const;

/**
 * 可觸控範圍的下限（像素）。
 *
 * 視覺尺寸與可點擊尺寸是**兩件事**：極簡化拿掉外框與背景之後，按鈕看起來
 * 只剩一個字元，但它的可點區域 MUST 不小於簡化之前。少了這條，介面會在
 * 手機上變得難以命中，而那是比「畫面比較花」嚴重得多的問題。
 */
export const MIN_TOUCH_TARGET_PX = 32;

/**
 * 字元按鈕的共用樣式。
 *
 * 拿掉外框與背景，只留字元；padding 與最小尺寸維持，使可觸控範圍不變。
 * 全部字元按鈕引用同一份，避免各處自行拿捏而出現大小不一的觸控目標。
 */
export const GLYPH_BUTTON_STYLE =
  `border: none; background: transparent; box-shadow: none; padding: 0 8px;`
  + ` min-width: ${MIN_TOUCH_TARGET_PX}px; height: ${MIN_TOUCH_TARGET_PX}px;`
  + ` font-size: 17px; line-height: 1; color: ${UI_COLOR.textMuted};`;

/** 不可逆操作的字元按鈕樣式：與上者相同，只換顏色。 */
export const GLYPH_BUTTON_DANGER_STYLE =
  GLYPH_BUTTON_STYLE.replace(`color: ${UI_COLOR.textMuted};`, `color: ${UI_COLOR.danger};`);
