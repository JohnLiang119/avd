import { describe, it, expect, vi } from 'vitest';
import { fetchChannelRssWithRetry } from '../DownloadService';

describe('fetchChannelRssWithRetry', () => {
  it('網路層錯誤只做一次短重試，恢復時回傳 RSS', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('NETWORK_ERROR:temporary offline'))
      .mockResolvedValueOnce('<feed />');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).resolves.toBe('<feed />');
    expect(request).toHaveBeenCalledTimes(2);
    // 0.5 秒而非 2 秒：DNS/連線失敗重試多次無望，只需容忍 Wi-Fi 瞬斷
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('網路層錯誤重試耗盡後即拋出，不再等待', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NETWORK_ERROR:unable to resolve host'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('NETWORK_ERROR');
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('404 採短重試（累計約 1.1 秒），涵蓋來源回隨機假 404 的情境', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP_STATUS:404:無法獲取頻道 RSS'))
      .mockRejectedValueOnce(new Error('HTTP_STATUS:404:無法獲取頻道 RSS'))
      .mockResolvedValueOnce('<feed />');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).resolves.toBe('<feed />');
    expect(sleep).toHaveBeenNthCalledWith(1, 300);
    expect(sleep).toHaveBeenNthCalledWith(2, 800);
  });

  it('5xx 採較長重試，耗盡後拋出仍含分類前綴的原始錯誤', async () => {
    const error = new Error('HTTP_STATUS:500:server unavailable');
    const request = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('HTTP_STATUS:500:server unavailable');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 3000);
  });

  it('內容層錯誤不重試，立即拋出', async () => {
    const request = vi.fn().mockRejectedValue(new Error('頻道 RSS XML 解析失敗'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('頻道 RSS XML 解析失敗');
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('noRetry 降級模式一律單次嘗試，不論錯誤層級', async () => {
    const request = vi.fn().mockRejectedValue(new Error('HTTP_STATUS:404:無法獲取頻道 RSS'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchChannelRssWithRetry(request, sleep, { noRetry: true })).rejects.toThrow('HTTP_STATUS:404');
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('首次失敗決定時間表，後續錯誤類型改變不會讓重試次數失控', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP_STATUS:404:無法獲取頻道 RSS'))
      .mockRejectedValueOnce(new Error('HTTP_STATUS:500:server unavailable'))
      .mockRejectedValueOnce(new Error('HTTP_STATUS:500:server unavailable'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    // 依首次的 404 時間表僅重試 2 次（300ms、800ms），不因中途變成 5xx 而改用較長的表
    await expect(fetchChannelRssWithRetry(request, sleep)).rejects.toThrow('HTTP_STATUS:500');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 300);
    expect(sleep).toHaveBeenNthCalledWith(2, 800);
  });
});
