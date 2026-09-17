package com.mattpocock.avd;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 鬧鐘響起、以及會讓既有登錄失效的系統事件，都在這裡收斂。
 *
 * 接收器**只做三件事**：登錄下一次、判斷這次該不該播、把播放交給前景服務。
 * 播放邏輯一律不放這裡 —— 接收器回傳後系統隨時可以回收程序，10 秒內沒做完就會
 * 被砍，而串流的建立本來就不只 10 秒。
 */
public class RadioAlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "RadioAlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        if (RadioAlarmScheduler.ACTION_ALARM_FIRE.equals(action)) {
            onAlarmFired(context, intent);
            return;
        }

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            // 重開機會清空所有已登錄的鬧鐘；改時間或時區則會讓既有的絕對時刻不再對應
            // 使用者設定的當地時刻。兩者都是重算一次就好，使用者不必開啟 App。
            //
            // 時鐘往前調越過某個時刻時，nextTrigger 自然落到次日 —— 規格明訂不補播。
            Log.d(TAG, "rescheduling after " + action);
            RadioAlarmScheduler.rescheduleAll(context);
        }
    }

    private void onAlarmFired(Context context, Intent intent) {
        String entryId = intent.getStringExtra(RadioAlarmScheduler.EXTRA_ENTRY_ID);
        long scheduledAt = intent.getLongExtra(RadioAlarmScheduler.EXTRA_SCHEDULED_AT, 0L);
        if (scheduledAt <= 0L) scheduledAt = System.currentTimeMillis();

        // 先登錄下一次。放在最前面是刻意的：後面的任何一步失敗（沒網路、服務起不來），
        // 都不該讓這筆鬧鐘從此消失 —— 今天沒響的隔天仍要響。
        RadioAlarmScheduler.rescheduleAll(context);

        RadioAlarmStore store = new RadioAlarmStore(context);
        RadioAlarmConfig config = store.getConfig();

        RadioAlarmConfig.Entry entry = null;
        for (RadioAlarmConfig.Entry candidate : config.enabledEntries()) {
            if (candidate.id.equals(entryId)) {
                entry = candidate;
                break;
            }
        }
        if (entry == null) {
            // 總開關已關、該筆已停用或已刪除，而這則廣播是取消前就排好的。不播。
            Log.d(TAG, "alarm fired for an entry that is no longer active: " + entryId);
            return;
        }

        long endAt = scheduledAt + entry.durationMin * 60L * 1000L;
        startPlayback(context, scheduledAt, endAt);
    }

    private void startPlayback(Context context, long scheduledAt, long endAt) {
        Intent service = new Intent(context, RadioPlaybackService.class);
        service.setAction(RadioPlaybackService.ACTION_START);
        service.putExtra(RadioPlaybackService.EXTRA_SCHEDULED_AT, scheduledAt);
        service.putExtra(RadioPlaybackService.EXTRA_END_AT, endAt);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
        } catch (IllegalStateException e) {
            // Android 12+ 限制從背景啟動前景服務。精確鬧鐘屬於豁免清單，正常情況不會
            // 走到這裡；真的被拒時（ForegroundServiceStartNotAllowedException 即
            // IllegalStateException 的子類，以父類承接可避免在舊版本上解析不到類別）
            // 改以鬧鐘的 showIntent 把 App 拉到前景，再由前景啟動服務。
            Log.e(TAG, "startForegroundService denied, falling back to activity", e);
            fallbackViaActivity(context, service, e);
        }
    }

    private void fallbackViaActivity(Context context, Intent service, Exception cause) {
        try {
            RadioAlarmScheduler.buildShowIntent(context).send();
            // App 到前景後即可啟動服務；若此處仍失敗則留下紀錄，介面會顯示失敗原因。
            context.startService(service);
        } catch (Exception e) {
            new RadioAlarmStore(context).recordFailure(
                    System.currentTimeMillis(),
                    "系統不允許在背景啟動播放服務，且無法將應用程式帶到前景。原始錯誤："
                            + cause + "；後續錯誤：" + e);
        }
    }
}
