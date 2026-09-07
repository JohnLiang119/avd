import { describe, it, expect, vi } from 'vitest';
import { fetchChannelRssWithRetry } from '../DownloadService';

describe('fetchChannelRssWithRetry', () => {
  it('網路層錯誤在重試期間恢復時回傳 RSS，不拋錯', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('NETWORK_ERROR:temporary offline'))
      .mockResolvedValueOnce('<feed />');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).resolves.toBe('<feed />');
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('重試耗盡後拋出仍含分類前綴的原始錯誤', async () => {
    const error = new Error('HTTP_STATUS:500:server unavailable');
    const request = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('HTTP_STATUS:500:server unavailable');
    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 4000);
    expect(sleep).toHaveBeenNthCalledWith(3, 8000);
  });

  it('內容層錯誤不重試，立即拋出', async () => {
    const request = vi.fn().mockRejectedValue(new Error('頻道 RSS XML 解析失敗'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('頻道 RSS XML 解析失敗');
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});