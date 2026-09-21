package com.mattpocock.avd;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.io.File;
import java.util.Locale;

/**
 * 文字轉語音：把一段中文**合成成音檔**，而不是直接朗讀。
 *
 * 合成成檔再交給既有的 ExoPlayer 播，讓股票報價頻道與直播、本地檔案走**同一個播放器**
 * （紅線 2：單一播放路徑）—— 鬧鐘音量、音訊焦點、通知、時長、循環全部沿用，不必為
 * TextToSpeech.speak() 另寫一套音訊語意與停止邏輯。
 *
 * 語言依序試 zh-TW、任何中文；都沒有就回報失敗（使用者需安裝含中文的語音引擎）。
 */
public final class RadioTts {

    private static final String TAG = "RadioTts";
    private static final String UTTERANCE_ID = "avd-stock-report";
    /** 引擎初始化加合成的總上限；超過即視為引擎卡住。 */
    private static final long TIMEOUT_MS = 60 * 1000L;

    private RadioTts() {
    }

    public interface Callback {
        /** 合成完成，音檔可播。呼叫端不保證在主執行緒。 */
        void onDone(File file);

        /** 合成失敗，附可顯示的原因。呼叫端不保證在主執行緒。 */
        void onError(String message);
    }

    public static void synthesizeToFile(Context context, final String text, final File out, final Callback callback) {
        final Handler main = new Handler(Looper.getMainLooper());
        final TextToSpeech[] holder = new TextToSpeech[1];
        final boolean[] finished = {false};

        final Runnable timeout = new Runnable() {
            @Override
            public void run() {
                if (finish(finished)) {
                    shutdown(holder[0]);
                    callback.onError("文字轉語音引擎在 " + (TIMEOUT_MS / 1000) + " 秒內沒有完成");
                }
            }
        };
        main.postDelayed(timeout, TIMEOUT_MS);

        try {
            holder[0] = new TextToSpeech(context.getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    TextToSpeech tts = holder[0];
                    if (status != TextToSpeech.SUCCESS || tts == null) {
                        if (finish(finished)) {
                            main.removeCallbacks(timeout);
                            shutdown(tts);
                            callback.onError("裝置沒有可用的文字轉語音引擎");
                        }
                        return;
                    }

                    int lang = tts.setLanguage(Locale.TAIWAN);
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        lang = tts.setLanguage(Locale.CHINESE);
                    }
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        if (finish(finished)) {
                            main.removeCallbacks(timeout);
                            shutdown(tts);
                            callback.onError("裝置沒有中文語音，請在系統設定安裝文字轉語音的中文語音包");
                        }
                        return;
                    }
                    tts.setSpeechRate(0.95f);

                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {
                        }

                        @Override
                        public void onDone(String utteranceId) {
                            if (finish(finished)) {
                                main.removeCallbacks(timeout);
                                shutdown(holder[0]);
                                if (out.isFile() && out.length() > 0) {
                                    callback.onDone(out);
                                } else {
                                    callback.onError("合成的音檔是空的");
                                }
                            }
                        }

                        @Override
                        @Deprecated
                        public void onError(String utteranceId) {
                            onError(utteranceId, -1);
                        }

                        @Override
                        public void onError(String utteranceId, int errorCode) {
                            if (finish(finished)) {
                                main.removeCallbacks(timeout);
                                shutdown(holder[0]);
                                callback.onError("合成失敗（錯誤碼 " + errorCode + "）");
                            }
                        }
                    });

                    File dir = out.getParentFile();
                    if (dir != null && !dir.exists() && !dir.mkdirs()) {
                        if (finish(finished)) {
                            main.removeCallbacks(timeout);
                            shutdown(tts);
                            callback.onError("無法建立音檔資料夾");
                        }
                        return;
                    }
                    if (out.exists() && !out.delete()) {
                        Log.w(TAG, "could not delete previous report file");
                    }

                    int result = tts.synthesizeToFile(text, new Bundle(), out, UTTERANCE_ID);
                    if (result != TextToSpeech.SUCCESS) {
                        if (finish(finished)) {
                            main.removeCallbacks(timeout);
                            shutdown(tts);
                            callback.onError("引擎拒絕合成（回傳 " + result + "）");
                        }
                    }
                }
            });
        } catch (Exception e) {
            if (finish(finished)) {
                main.removeCallbacks(timeout);
                shutdown(holder[0]);
                callback.onError("建立文字轉語音引擎失敗：" + e.getMessage());
            }
        }
    }

    /** 只允許收尾一次：初始化失敗、逾時、完成、錯誤四條路互斥。 */
    private static boolean finish(boolean[] finished) {
        synchronized (finished) {
            if (finished[0]) return false;
            finished[0] = true;
            return true;
        }
    }

    private static void shutdown(TextToSpeech tts) {
        if (tts == null) return;
        try {
            tts.stop();
            tts.shutdown();
        } catch (Exception e) {
            Log.w(TAG, "tts shutdown failed", e);
        }
    }
}
