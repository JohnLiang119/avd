package com.mattpocock.avd;

import com.getcapacitor.BridgeActivity;

import android.media.AudioManager;
import android.os.Bundle;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {
    public static String sharedText = null;

    /**
     * 目前的畫面，供播放服務通知「播放狀態變了，音量鍵要換一條串流」。
     *
     * 以 WeakReference 持有：Activity 的生命週期由系統掌控，靜態強參考會讓它無法被回收。
     * 畫面不存在時什麼都不必做 —— 那表示沒有人在按音量鍵。
     */
    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YoutubeDlPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        applyVolumeControlStream();
    }

    @Override
    public void onPause() {
        super.onPause();
        if (current.get() == this) {
            current = new WeakReference<>(null);
        }
    }

    /** 由 {@link RadioPlaybackService} 在播放開始與結束時呼叫。 */
    static void notifyPlaybackStateChanged() {
        final MainActivity activity = current.get();
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.applyVolumeControlStream();
            }
        });
    }

    /**
     * 決定音量鍵調整的是哪一條串流。
     *
     * 早報鬧鐘播放中時固定為媒體音量：鬧鐘、試播、直播一律走媒體音量（design.md D17），
     * 播放期間明確指定，避免音量鍵在播放剛開始時落到鈴聲音量上。
     * 播放結束即還原，否則 App 平常的音量鍵行為會一直被改著。
     */
    private void applyVolumeControlStream() {
        setVolumeControlStream(RadioPlaybackService.isPlaying()
                ? AudioManager.STREAM_MUSIC
                : AudioManager.USE_DEFAULT_STREAM_TYPE);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(android.content.Intent intent) {
        if (android.content.Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            sharedText = intent.getStringExtra(android.content.Intent.EXTRA_TEXT);
        }
    }
}
