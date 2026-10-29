import { describe, it, expect } from 'vitest';

import {
  sortBondedDevices,
  describeBondedKind,
  describeCarBluetoothStatus,
  needsSettingsFallback,
  describeNextConnect,
  describeCarScheduleStatus,
  describeCarWindow,
  addMinutesToTime,
  validateCarWindow,
  newCarScheduleEntry,
  sortCarSchedule,
  type BondedDevice,
  type CarBluetoothState,
} from '../carBluetooth';

const device = (name: string, kind: BondedDevice['kind'], address = `AA:BB:CC:DD:EE:${name.length}`): BondedDevice =>
  ({ name, kind, address });

describe('sortBondedDevices', () => {
  it('車用音訊排最前、其他音訊次之、其餘最後', () => {
    const sorted = sortBondedDevices([
      device('H12', 'audio'),
      device('Keyboard', 'other'),
      device('CX501A', 'car'),
    ]);
    expect(sorted.map((d) => d.name)).toEqual(['CX501A', 'H12', 'Keyboard']);
  });

  it('同類依名稱排序且不改動輸入', () => {
    const input = [device('B-car', 'car'), device('A-car', 'car')];
    const sorted = sortBondedDevices(input);
    expect(sorted.map((d) => d.name)).toEqual(['A-car', 'B-car']);
    expect(input.map((d) => d.name)).toEqual(['B-car', 'A-car']);
  });
});

describe('describeBondedKind', () => {
  it('只標車用與音訊，其餘留白', () => {
    expect(describeBondedKind('car')).toBe('車用音訊');
    expect(describeBondedKind('audio')).toBe('音訊裝置');
    expect(describeBondedKind('other')).toBe('');
  });
});

describe('describeCarBluetoothStatus', () => {
  const base: CarBluetoothState = {
    device: { address: '00:11:22:33:44:55', name: 'CX501A' },
    permissionGranted: true,
    adapterOn: true,
    connected: false,
  };

  it('未選擇車機', () => {
    expect(describeCarBluetoothStatus(null)).toBe('尚未選擇車機');
    expect(describeCarBluetoothStatus({ ...base, device: null })).toBe('尚未選擇車機');
  });

  it('權限與藍牙開關優先於連線狀態', () => {
    expect(describeCarBluetoothStatus({ ...base, permissionGranted: false, connected: true })).toContain('權限');
    expect(describeCarBluetoothStatus({ ...base, adapterOn: false, connected: true })).toContain('關閉');
  });

  it('已連線只說已連線；未連線說明鬧鐘前會嘗試', () => {
    expect(describeCarBluetoothStatus({ ...base, connected: true })).toBe('已連線');
    expect(describeCarBluetoothStatus(base)).toContain('未連線');
  });
});

describe('needsSettingsFallback', () => {
  it('車機沒回應與藍牙關閉要退回藍牙設定', () => {
    expect(needsSettingsFallback('notConnected')).toBe(true);
    expect(needsSettingsFallback('adapterOff')).toBe(true);
  });

  it('其餘結果不開設定頁', () => {
    expect(needsSettingsFallback('connected')).toBe(false);
    expect(needsSettingsFallback('alreadyConnected')).toBe(false);
    expect(needsSettingsFallback('noDevice')).toBe(false);
    expect(needsSettingsFallback('noPermission')).toBe(false);
  });
});

describe('describeNextConnect', () => {
  const now = new Date(2026, 8, 17, 6, 0); // 2026-09-17 週四 06:00

  it('沒有啟用的排程時不顯示任何字', () => {
    expect(describeNextConnect(-1, now)).toBe('');
    expect(describeNextConnect(0, now)).toBe('');
  });

  it('今天、明天與更遠的日子', () => {
    expect(describeNextConnect(new Date(2026, 8, 17, 7, 30).getTime(), now)).toBe('下一次連線：今天 07:30 開始');
    expect(describeNextConnect(new Date(2026, 8, 18, 7, 30).getTime(), now)).toBe('下一次連線：明天 07:30 開始');
    // 9/21 是週一
    expect(describeNextConnect(new Date(2026, 8, 21, 18, 5).getTime(), now)).toBe('下一次連線：週一 18:05 開始');
  });
});

describe('車機連線排程', () => {
  it('新增的預設值為 07:30–08:00、每天、啟用', () => {
    const entry = newCarScheduleEntry();
    expect(entry.time).toBe('07:30');
    expect(entry.endTime).toBe('08:00');
    expect(entry.weekdays).toBe(0x7f);
    expect(entry.enabled).toBe(true);
    expect(entry.id).not.toBe(newCarScheduleEntry().id);
  });

  it('依時刻由早到晚排序且不改動輸入', () => {
    const input = [
      { ...newCarScheduleEntry(), id: 'b', time: '18:00' },
      { ...newCarScheduleEntry(), id: 'a', time: '07:30' },
    ];
    expect(sortCarSchedule(input).map((e) => e.id)).toEqual(['a', 'b']);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('時間區段', () => {
  it('addMinutesToTime 跨午夜回繞', () => {
    expect(addMinutesToTime('07:30', 30)).toBe('08:00');
    expect(addMinutesToTime('23:50', 30)).toBe('00:20');
    expect(addMinutesToTime('00:10', -30)).toBe('23:40');
    expect(addMinutesToTime('壞掉', 30)).toBe('壞掉');
  });

  it('開始與結束相同不合法', () => {
    expect(validateCarWindow('07:30', '07:30').ok).toBe(false);
    expect(validateCarWindow('07:30', '08:00').ok).toBe(true);
    expect(validateCarWindow('23:00', '01:00').ok).toBe(true);
  });

  it('describeCarWindow 跨午夜標示隔日', () => {
    expect(describeCarWindow({ time: '07:30', endTime: '08:00' })).toBe('07:30–08:00');
    expect(describeCarWindow({ time: '23:00', endTime: '01:00' })).toBe('23:00–01:00（隔日）');
  });

  const now = new Date(2026, 8, 17, 6, 0);
  const base = { entries: [], nextTriggerAt: -1, activeUntil: -1, connecting: false, exactAlarmAllowed: true };

  it('區段內依連線進行與否說明，並帶結束時刻', () => {
    const until = new Date(2026, 8, 17, 8, 0).getTime();
    expect(describeCarScheduleStatus({ ...base, activeUntil: until, connecting: true }, now))
      .toBe('正在嘗試連線車機，到 08:00 為止，連上即停');
    expect(describeCarScheduleStatus({ ...base, activeUntil: until }, now))
      .toBe('目前在連線時段內，到 08:00 為止');
  });

  it('不在區段內顯示下一次開始；都沒有則不說話', () => {
    expect(describeCarScheduleStatus({ ...base, nextTriggerAt: new Date(2026, 8, 18, 7, 30).getTime() }, now))
      .toBe('下一次連線：明天 07:30 開始');
    expect(describeCarScheduleStatus(base, now)).toBe('');
    expect(describeCarScheduleStatus(null, now)).toBe('');
  });
});
