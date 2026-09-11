import { describe, it, expect } from 'vitest';
import {
  ACTION_GLYPH,
  IRREVERSIBLE_ACTIONS,
  isIrreversibleAction,
  UI_COLOR,
  MIN_TOUCH_TARGET_PX,
  GLYPH_BUTTON_STYLE,
  GLYPH_BUTTON_DANGER_STYLE,
  type ActionName,
} from '../visualLanguage';

describe('操作字元', () => {
  it('每個動作都有非空的字元標示', () => {
    for (const [action, glyph] of Object.entries(ACTION_GLYPH)) {
      expect(glyph, action).toBeTruthy();
      expect(glyph.length, action).toBeGreaterThan(0);
    }
  });

  it('字元皆為單一字元 —— 不是圖示也不是文字標籤', () => {
    for (const [action, glyph] of Object.entries(ACTION_GLYPH)) {
      expect(Array.from(glyph).length, action).toBe(1);
    }
  });

  it('MUST NOT 使用表情符號 —— 那正是本次要拿掉的東西', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{FE0F}]/u;
    for (const [action, glyph] of Object.entries(ACTION_GLYPH)) {
      expect(emoji.test(glyph), `${action}: ${glyph}`).toBe(false);
    }
  });

  it('只有刪除的兩個動作共用字元，其餘皆互異', () => {
    // 兩顆刪除共用乘號是刻意的：動作類別相同，後果的差異由顏色承載。
    // 除此之外若有第二組重複，代表挑字元時撞車了。
    const counts = new Map<string, ActionName[]>();
    for (const [action, glyph] of Object.entries(ACTION_GLYPH) as [ActionName, string][]) {
      counts.set(glyph, [...(counts.get(glyph) ?? []), action]);
    }
    const shared = [...counts.entries()].filter(([, actions]) => actions.length > 1);
    expect(shared).toHaveLength(1);
    expect(shared[0][1].sort()).toEqual(['deleteFile', 'remove']);
  });
});

describe('顏色的語意', () => {
  it('不可逆的動作清單即為強調色的使用範圍', () => {
    expect(IRREVERSIBLE_ACTIONS).toEqual(['deleteFile']);
    expect(isIrreversibleAction('deleteFile')).toBe(true);
  });

  it('可復原的動作 MUST NOT 被歸為不可逆', () => {
    for (const action of ['play', 'upload', 'remove', 'submit'] as ActionName[]) {
      expect(isIrreversibleAction(action), action).toBe(false);
    }
  });

  it('中性色階之外只有兩個互不重疊的用途軸', () => {
    // 顏色只能落在「操作軸」（danger）與「狀態軸」（ok）上。
    // 藍、橘、琥珀一個都不該回來 —— 裝飾性用色會把 danger 稀釋。
    // 要加第三個顏色就會在此失敗，迫使加的人說明它屬於哪一軸。
    const neutral = ['text', 'textMuted', 'textFaint', 'line', 'surface', 'surfaceMuted'];
    const accents = Object.keys(UI_COLOR).filter(k => !neutral.includes(k));
    expect(accents.sort()).toEqual(['danger', 'ok', 'okLine', 'okSurface']);
  });

  it('操作軸與狀態軸的顏色互異 —— 否則兩個軸會被混為一談', () => {
    expect(UI_COLOR.ok).not.toBe(UI_COLOR.danger);
    expect(UI_COLOR.okSurface).not.toBe(UI_COLOR.danger);
  });

  it('狀態色 MUST NOT 用於任何可點擊的控制項', () => {
    // 字元按鈕是全應用程式唯一套用顏色的控制項，兩種樣式都不得帶狀態色
    for (const style of [GLYPH_BUTTON_STYLE, GLYPH_BUTTON_DANGER_STYLE]) {
      expect(style).not.toContain(UI_COLOR.ok);
      expect(style).not.toContain(UI_COLOR.okSurface);
    }
  });

  it('可復原與不可逆的按鈕樣式只差顏色，其餘完全相同', () => {
    // 差別若不只顏色，兩者的大小或間距就會不一致而看起來像兩種控制項
    const strip = (style: string) => style.replace(/color:\s*#[0-9a-f]{3,8};/i, '');
    expect(strip(GLYPH_BUTTON_DANGER_STYLE)).toBe(strip(GLYPH_BUTTON_STYLE));
    expect(GLYPH_BUTTON_DANGER_STYLE).not.toBe(GLYPH_BUTTON_STYLE);
    expect(GLYPH_BUTTON_DANGER_STYLE).toContain(UI_COLOR.danger);
  });
});

describe('觸控範圍', () => {
  it('字元按鈕的最小尺寸不小於下限 —— 視覺收斂不得縮小可點範圍', () => {
    expect(MIN_TOUCH_TARGET_PX).toBeGreaterThanOrEqual(32);
    expect(GLYPH_BUTTON_STYLE).toContain(`min-width: ${MIN_TOUCH_TARGET_PX}px`);
    expect(GLYPH_BUTTON_STYLE).toContain(`height: ${MIN_TOUCH_TARGET_PX}px`);
  });

  it('樣式拿掉了外框與背景，但保留水平 padding', () => {
    expect(GLYPH_BUTTON_STYLE).toContain('border: none');
    expect(GLYPH_BUTTON_STYLE).toContain('background: transparent');
    // padding 是可觸控範圍的一部分，拿掉外框不等於拿掉它
    expect(GLYPH_BUTTON_STYLE).toMatch(/padding:\s*0\s+[1-9]/);
  });
});
