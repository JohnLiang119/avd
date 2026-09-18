import { describe, it, expect } from 'vitest';

import {
  ALL_WEEKDAYS,
  DEFAULT_DURATION_MIN,
  DEFAULT_VOLUME_PERCENT,
  normalizeTime,
  validateTime,
  hasWeekday,
  normalizeWeekdays,
  toggleWeekday,
  describeWeekdays,
  clampDuration,
  clampVolume,
  channelName,
  defaultChannelId,
  describeAlarmSummary,
  newAlarm,
  describePlaybackState,
  registrationWarning,
  describeSelfTest,
  lastFailureText,
  permissionWarnings,
  isAggressiveVendor,
  normalizeConfig,
  type RadioAlarm,
  type RadioAlarmConfig,
  type RadioAlarmStatus,
  type RadioChannel,
} from '../radioAlarm';

const mask = (...days: number[]) => days.reduce((m, d) => m | (1 << d), 0);

const CHANNELS: RadioChannel[] = [
  { id: 'bcc-news', name: '中廣新聞網', kind: 'bcc', source: '中廣新聞網' },
  { id: 'bcc-pop', name: '中廣流行網', kind: 'bcc', source: '中廣流行網' },
];

const alarm = (over: Partial<RadioAlarm> = {}): RadioAlarm => ({
  id: 'a1',
  time: '06:00',
  weekdays: ALL_WEEKDAYS,
  channelId: 'bcc-news',
  durationMin: 30,
  enabled: true,
  ...over,
});

const config = (alarms: RadioAlarm[]): RadioAlarmConfig => ({
  schemaVersion: 2,
  alarms,
  channels: CHANNELS,
  volumePercent: 100,
});

const status = (over: Partial<RadioAlarmStatus> = {}): RadioAlarmStatus => ({
  playing: false,
  alarmAudioActive: false,
  playingChannelId: '',
  exactAlarmAllowed: true,
  notificationsGranted: true,
  registeredCount: 0,
  systemNextAlarmAt: -1,
  systemNextAlarmIsOurs: false,
  selfTestAt: -1,
  selfTestRegistered: false,
  selfTestFiredAt: -1,
  manufacturer: 'Google',
  hasLastResult: false,
  ...over,
});

describe('時刻', () => {
  it('接受合法時刻並補零', () => {
    expect(normalizeTime('6:0')).toBe('06:00');
    expect(normalizeTime('  7:05 ')).toBe('07:05');
    expect(normalizeTime('23:59')).toBe('23:59');
  });

  it('拒絕越界與格式不符，並附原因', () => {
    for (const bad of ['24:10', '06:60', '0600', 'abc', '', null, undefined]) {
      expect(normalizeTime(bad)).toBeNull();
    }
    const result = validateTime('24:10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('00:00');
  });

  it('同一時刻不再被視為重複 —— 沒有任何「已存在」的檢查', () => {
    expect(validateTime('06:00')).toEqual({ ok: true, time: '06:00' });
  });
});

describe('星期遮罩', () => {
  it('bit 0 是週日、bit 6 是週六，與 Date.getDay() 一致', () => {
    expect(hasWeekday(mask(0), 0)).toBe(true);
    expect(hasWeekday(mask(6), 6)).toBe(true);
    expect(hasWeekday(mask(1, 2, 3, 4, 5), 0)).toBe(false);
    expect(hasWeekday(ALL_WEEKDAYS, 7)).toBe(false);
  });

  it('空遮罩與越界位元回到全選', () => {
    expect(normalizeWeekdays(0)).toBe(ALL_WEEKDAYS);
    expect(normalizeWeekdays(0x80)).toBe(ALL_WEEKDAYS);
    expect(normalizeWeekdays(Number.NaN)).toBe(ALL_WEEKDAYS);
    expect(normalizeWeekdays(mask(1, 5) | 0x100)).toBe(mask(1, 5));
  });

  it('切換：可加可減，但取消最後一天會被拒絕', () => {
    expect(toggleWeekday(mask(1, 2), 3)).toBe(mask(1, 2, 3));
    expect(toggleWeekday(mask(1, 2), 2)).toBe(mask(1));
    expect(toggleWeekday(mask(1), 1)).toBe(mask(1));
    expect(toggleWeekday(mask(1), 9)).toBe(mask(1));
  });

  it('摘要：每天／平日／週末／逐日，逐日以週一起算、週日放最後', () => {
    expect(describeWeekdays(ALL_WEEKDAYS)).toBe('每天');
    expect(describeWeekdays(mask(1, 2, 3, 4, 5))).toBe('平日');
    expect(describeWeekdays(mask(0, 6))).toBe('週末');
    expect(describeWeekdays(mask(1, 3, 5))).toBe('一、三、五');
    expect(describeWeekdays(mask(0, 1))).toBe('一、日');
    expect(describeWeekdays(0)).toBe('每天');
  });
});

describe('時長與音量', () => {
  it('夾在允許範圍內', () => {
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(181)).toBe(180);
    expect(clampDuration(Number.NaN)).toBe(DEFAULT_DURATION_MIN);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(101)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME_PERCENT);
  });
});

describe('頻道', () => {
  it('依 id 取名稱，找不到時落到第一個', () => {
    expect(channelName(CHANNELS, 'bcc-pop')).toBe('中廣流行網');
    expect(channelName(CHANNELS, 'nope')).toBe('中廣新聞網');
    expect(channelName([], 'nope')).toBe('');
  });

  it('預設頻道是第一個內建頻道', () => {
    expect(defaultChannelId(CHANNELS)).toBe('bcc-news');
    const custom: RadioChannel = { id: 'c1', name: '我的台', kind: 'url', source: 'https://x/y' };
    expect(defaultChannelId([custom, ...CHANNELS])).toBe('bcc-news');
    expect(defaultChannelId([custom])).toBe('c1');
    expect(defaultChannelId([])).toBe('');
  });
});

describe('鬧鐘卡片', () => {
  it('收合時的摘要看得出星期與頻道', () => {
    expect(describeAlarmSummary(alarm(), CHANNELS)).toBe('每天 · 中廣新聞網');
    expect(describeAlarmSummary(alarm({ weekdays: mask(0, 6), channelId: 'bcc-pop' }), CHANNELS))
      .toBe('週末 · 中廣流行網');
  });

  it('新增鬧鐘的預設值：06:00、每天、第一個內建頻道、30 分鐘、啟用', () => {
    const a = newAlarm(CHANNELS);
    expect(a.time).toBe('06:00');
    expect(a.weekdays).toBe(ALL_WEEKDAYS);
    expect(a.channelId).toBe('bcc-news');
    expect(a.durationMin).toBe(30);
    expect(a.enabled).toBe(true);
    expect(a.id).not.toBe('');
    expect(newAlarm(CHANNELS).id).not.toBe(a.id);
  });
});

describe('播放中的狀態字', () => {
  it('沒在播放時為空字串', () => {
    expect(describePlaybackState(null, CHANNELS)).toBe('');
    expect(describePlaybackState(status(), CHANNELS)).toBe('');
  });

  it('分得出直播與鬧鐘，並帶出頻道 —— 兩者的音量來源不同', () => {
    expect(describePlaybackState(status({ playing: true, alarmAudioActive: false, playingChannelId: 'bcc-pop' }), CHANNELS))
      .toBe('直播中：中廣流行網（媒體音量）');
    expect(describePlaybackState(status({ playing: true, alarmAudioActive: true, playingChannelId: 'bcc-news' }), CHANNELS))
      .toBe('播放中：中廣新聞網（鬧鐘音量）');
  });
});

describe('系統登錄 —— 只在異常時說話', () => {
  it('正常時什麼都不說', () => {
    expect(registrationWarning(config([alarm()]), status({ registeredCount: 1 }))).toBe('');
    expect(registrationWarning(config([alarm()]), null)).toBe('');
  });

  it('沒有啟用的鬧鐘時也不說 —— 沒有東西該被登錄', () => {
    expect(registrationWarning(config([]), status({ registeredCount: 0 }))).toBe('');
    expect(registrationWarning(config([alarm({ enabled: false })]), status({ registeredCount: 0 }))).toBe('');
  });

  it('有啟用的鬧鐘、系統中卻一筆都沒有時，說清楚不會響並指出原因', () => {
    const text = registrationWarning(config([alarm()]), status({ registeredCount: 0 }));
    expect(text).toContain('不會響');
    expect(text).toContain('強制停止');
  });
});

describe('自我測試的狀態', () => {
  const now = new Date(2026, 8, 17, 10, 0, 0);

  it('尚未測試過', () => {
    expect(describeSelfTest(null, now)).toBe('');
    expect(describeSelfTest(status(), now)).toBe('尚未測試過');
  });

  it('已登錄時報出會響的時刻並提示可關掉程式', () => {
    const at = new Date(2026, 8, 17, 10, 2, 30).getTime();
    const text = describeSelfTest(status({ selfTestRegistered: true, selfTestAt: at }), now);
    expect(text).toContain('10:02:30');
    expect(text).toContain('關掉');
  });

  it('已響起時點明是系統喚起的', () => {
    const fired = new Date(2026, 8, 17, 9, 58, 3).getTime();
    expect(describeSelfTest(status({ selfTestFiredAt: fired }), now)).toContain('9/17 09:58:03 由系統喚起並響起');
  });
});

describe('上次播放 —— 只在失敗時說話', () => {
  it('成功或從未觸發為空字串', () => {
    expect(lastFailureText(null)).toBe('');
    expect(lastFailureText(status())).toBe('');
    expect(lastFailureText(status({ hasLastResult: true, lastResultTime: 1, lastResultSuccess: true }))).toBe('');
  });

  it('失敗時附上時間與未截斷的原因', () => {
    const at = new Date(2026, 8, 17, 6, 3, 0).getTime();
    const message = '在 3 分鐘內無法開始播放（可能是沒有網路或串流暫時無法連線）。';
    const text = lastFailureText(status({ hasLastResult: true, lastResultTime: at, lastResultSuccess: false, lastResultMessage: message }));
    expect(text).toContain('9/17 06:03');
    expect(text).toContain(message);
  });
});

describe('權限與廠牌提示', () => {
  it('一切正常時沒有提示', () => {
    expect(permissionWarnings(status())).toEqual([]);
    expect(permissionWarnings(null)).toEqual([]);
  });

  it('缺什麼就提示什麼', () => {
    expect(permissionWarnings(status({ exactAlarmAllowed: false }))[0]).toContain('不會響');
    expect(permissionWarnings(status({ notificationsGranted: false }))[0]).toContain('停止');
    expect(permissionWarnings(status({ manufacturer: 'Xiaomi' })).length).toBe(1);
    expect(permissionWarnings(status({ exactAlarmAllowed: false, notificationsGranted: false, manufacturer: 'OPPO' })).length).toBe(3);
  });

  it('廠牌判定寬鬆：漏掉的後果是早上沒被叫醒卻不知道為什麼', () => {
    expect(isAggressiveVendor('HUAWEI')).toBe(true);
    expect(isAggressiveVendor('samsung')).toBe(true);
    expect(isAggressiveVendor('Google')).toBe(false);
    expect(isAggressiveVendor(null)).toBe(false);
  });
});

describe('插件回傳的收斂', () => {
  it('缺欄位時給出可用的預設', () => {
    const r = normalizeConfig(undefined);
    expect(r.alarms).toEqual([]);
    expect(r.channels).toEqual([]);
    expect(r.volumePercent).toBe(100);
  });

  it('剔除時刻不合法的鬧鐘，校正遮罩、時長與無效頻道', () => {
    const r = normalizeConfig({
      schemaVersion: 2,
      volumePercent: 40,
      channels: CHANNELS,
      alarms: [
        { id: 'a', time: '24:10', weekdays: 1, channelId: 'bcc-news' },
        { id: 'b', time: '6:0', weekdays: 0, channelId: 'gone', durationMin: 999, enabled: true },
      ],
    });
    expect(r.alarms.length).toBe(1);
    expect(r.alarms[0]).toEqual({
      id: 'b', time: '06:00', weekdays: ALL_WEEKDAYS, channelId: 'bcc-news', durationMin: 180, enabled: true,
    });
    expect(r.volumePercent).toBe(40);
  });

  it('音量缺欄位讀成 100，不是 0', () => {
    expect(normalizeConfig({ alarms: [] }).volumePercent).toBe(100);
    expect(normalizeConfig({ volumePercent: null }).volumePercent).toBe(100);
    expect(normalizeConfig({ volumePercent: 0 }).volumePercent).toBe(0);
  });

  it('頻道的 kind 只有 bcc 與 url，其餘視為 bcc', () => {
    const r = normalizeConfig({ channels: [{ id: 'x', name: 'X', kind: 'weird', source: 's' }] });
    expect(r.channels[0].kind).toBe('bcc');
  });
});
