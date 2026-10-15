import { describe, it, expect } from 'vitest';
import { looksChinese } from '../textLang';

describe('looksChinese 啟發式判斷', () => {
  it('繁體與簡體中文皆判為中文', () => {
    expect(looksChinese('周杰倫 最好聽的歌')).toBe(true);
    expect(looksChinese('周杰伦 最好听的歌')).toBe(true);
  });

  it('中英混排判為中文（實務上最常見的形態）', () => {
    expect(looksChinese('Jay Chou【晴天】Official MV')).toBe(true);
    expect(looksChinese('周杰倫 Jay Chou')).toBe(true);
  });

  it('純英文不是中文', () => {
    expect(looksChinese('Best Songs Of Jay Chou [4K Video]')).toBe(false);
  });

  it('含假名的日文不是中文（平假名／片假名／半形片假名）', () => {
    expect(looksChinese('東京タワー巡り')).toBe(false);
    expect(looksChinese('夜に駆ける')).toBe(false);
    expect(looksChinese('ｱﾆﾒ 主題歌 名曲')).toBe(false);
  });

  it('純漢字的日文標題會誤判為中文 —— 已知且接受的誤差（design D8）', () => {
    // 釘住這個行為：若未來改變判準，此測試提醒重新評估取捨。
    expect(looksChinese('東京')).toBe(true);
  });

  it('含諺文的韓文不是中文', () => {
    expect(looksChinese('BTS 방탄소년단 Dynamite')).toBe(false);
  });

  it('中文標點不影響判斷（「」、・等不屬假名區段）', () => {
    expect(looksChinese('「晴天」完整版')).toBe(true);
  });

  it('空字串與無文字內容不是中文', () => {
    expect(looksChinese('')).toBe(false);
    expect(looksChinese('   ')).toBe(false);
    expect(looksChinese(undefined as any)).toBe(false);
  });
});
