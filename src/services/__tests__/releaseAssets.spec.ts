import { describe, it, expect } from 'vitest';

import { pickApkAsset, versionFromTag } from '../releaseAssets';

describe('Release 附件挑選', () => {
  const assets = [
    { name: 'AVD_1.0.107_x64.msi', browser_download_url: 'https://github.com/JohnLiang119/avd/releases/download/v1.0.107/AVD_1.0.107_x64.msi' },
    { name: 'AVD_1.0.107.apk', browser_download_url: 'https://github.com/JohnLiang119/avd/releases/download/v1.0.107/AVD_1.0.107.apk' },
    { name: 'AVD_1.0.107.APK.sha256', browser_download_url: 'https://x/y' },
  ];

  it('挑出 .apk，不會拿到 msi 或校驗檔', () => {
    const picked = pickApkAsset(assets);
    expect(picked?.name).toBe('AVD_1.0.107.apk');
    expect(picked?.url).toContain('/AVD_1.0.107.apk');
  });

  it('副檔名不分大小寫', () => {
    expect(pickApkAsset([{ name: 'AVD.APK', browser_download_url: 'https://x/AVD.APK' }])?.name).toBe('AVD.APK');
  });

  it('沒有 apk、沒有網址、或根本不是陣列時回傳 null', () => {
    expect(pickApkAsset([assets[0]])).toBeNull();
    expect(pickApkAsset([{ name: 'a.apk' }])).toBeNull();
    expect(pickApkAsset(undefined)).toBeNull();
    expect(pickApkAsset({})).toBeNull();
  });

  it('自 tag 取版本號', () => {
    expect(versionFromTag('v1.0.107')).toBe('1.0.107');
    expect(versionFromTag('1.0.107')).toBe('1.0.107');
    expect(versionFromTag(undefined)).toBe('');
  });
});
