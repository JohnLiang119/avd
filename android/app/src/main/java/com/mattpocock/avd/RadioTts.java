package com.mattpocock.avd;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 文字轉語音：把**多句**中文各自合成成音檔，而不是直接朗讀。
 *
 * 合成成檔再交給既有的 ExoPlayer 播，讓股票報價頻道與直播、本地檔案走**同一個播放器**
 * （紅線 2：單一播放路徑）—— 鬧鐘音量、音訊焦點、通知、時長、循環全部沿用，不必為
 * TextToSpeech.speak() 另寫一套音訊語意與停止邏輯。
 *
 * 一句一個檔的理由：句與句之間的停頓要可調（使用者要求），引擎對句號的停頓不可控；
 * 播放端在檔與檔之間夾指定秒數的靜音（{@link SilenceWav}）。
 *
 * 語言依序試 zh-TW、任何中文；都沒有就回報失敗（使用者需安裝含中文的語音引擎）。
 */
public final class RadioTts {

    private static final String TAG = "RadioTts";
    private static final String UTTERANCE_PREFIX = "avd-stock-";
    /** 引擎初始化加全部合成的總上限；超過即視為引擎卡住。 */
    private static final long TIMEOUT_MS = 90 * 1000L;

    private RadioTts() {
    }

    public interface Callback {
        /** 全部合成完成，依句序回傳音檔。呼叫端不保證在主執行緒。 */
        void onDone(List<File> files);

        /** 任一句合成失敗，附可顯示的原因。呼叫端不保證在主執行緒。 */
        void onError(String message);
    }

    /**
     * @param sentences 要念的句子，依序
     * @param dir       音檔資料夾；檔名為 s000.wav、s001.wav…，每次覆寫
     */
    public static void synthesizeAll(Context context, final List<String> sentences, final File dir,
                                     final Callback callback) {
        if (sentences == null || sentences.isEmpty()) {
            callback.onError("沒有要念的內容");
            return;
        }

        final Handler main = new Handler(Looper.getMainLooper());
        final TextToSpeech[] holder = new TextToSpeech[1];
        final boolean[] finished = {false};
        final List<File> outputs = new ArrayList<File>();
        final int[] index = {0};

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
                    final TextToSpeech tts = holder[0];
                    if (status != TextToSpeech.SUCCESS || tts == null) {
                        failOnce(finished, main, timeout, tts, callback, "裝置沒有可用的文字轉語音引擎");
                        return;
                    }

                    int lang = tts.setLanguage(Locale.TAIWAN);
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        lang = tts.setLanguage(Locale.CHINESE);
                    }
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        failOnce(finished, main, timeout, tts, callback,
                                "裝置沒有中文語音，請在系統設定安裝文字轉語音的中文語音包");
                        return;
                    }
                    tts.setSpeechRate(0.95f);

                    if (!dir.exists() && !dir.mkdirs()) {
                        failOnce(finished, main, timeout, tts, callback, "無法建立音檔資料夾");
                        return;
                    }

                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {
                        }

                        @Override
                        public void onDone(String utteranceId) {
                            File current = outputs.get(outputs.size() - 1);
                            if (!current.isFile() || current.length() == 0) {
                                failOnce(finished, main, timeout, tts, callback, "合成的音檔是空的");
                                return;
                            }
                            index[0]++;
                            if (index[0] >= sentences.size()) {
                                if (finish(finished)) {
                                    main.removeCallbacks(timeout);
                                    shutdown(tts);
                                    callback.onDone(new ArrayList<File>(outputs));
                                }
                                return;
                            }
                            synthesizeNext(tts, sentences, dir, index[0], outputs, finished, main, timeout, callback);
                        }

                        @Override
                        @Deprecated
                        public void onError(String utteranceId) {
                            onError(utteranceId, -1);
                        }

                        @Override
                        public void onError(String utteranceId, int errorCode) {
                            failOnce(finished, main, timeout, tts, callback, "合成失敗（錯誤碼 " + errorCode + "）");
                        }
                    });

                    synthesizeNext(tts, sentences, dir, 0, outputs, finished, main, timeout, callback);
                }
            });
        } catch (Exception e) {
            failOnce(finished, main, timeout, holder[0], callback, "建立文字轉語音引擎失敗：" + e.getMessage());
        }
    }

    private static void synthesizeNext(TextToSpeech tts, List<String> sentences, File dir, int i,
                                       List<File> outputs, boolean[] finished, Handler main, Runnable timeout,
                                       Callback callback) {
        File out = new File(dir, String.format(Locale.US, "s%03d.wav", i));
        if (out.exists() && !out.delete()) {
            Log.w(TAG, "could not delete previous " + out.getName());
        }
        outputs.add(out);
        int result = tts.synthesizeToFile(sentences.get(i), new Bundle(), out, UTTERANCE_PREFIX + i);
        if (result != TextToSpeech.SUCCESS) {
            failOnce(finished, main, timeout, tts, callback, "引擎拒絕合成（回傳 " + result + "）");
        }
    }

    private static void failOnce(boolean[] finished, Handler main, Runnable timeout, TextToSpeech tts,
                                 Callback callback, String message) {
        if (finish(finished)) {
            main.removeCallbacks(timeout);
            shutdown(tts);
            callback.onError(message);
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
