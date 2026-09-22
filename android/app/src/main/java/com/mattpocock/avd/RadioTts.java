package com.mattpocock.avd;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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
        synthesizeAll(context, sentences, dir, "", RadioAlarmConstants.DEFAULT_TTS_SPEECH_RATE, callback);
    }

    /**
     * @param voiceName  要用的聲音（Voice.getName()）；空字串或引擎中沒有這個聲音時用中文預設聲音
     * @param speechRate 語速倍率（0.5–2.0）
     */
    public static void synthesizeAll(Context context, final List<String> sentences, final File dir,
                                     final String voiceName, final double speechRate, final Callback callback) {
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
                    tts.setSpeechRate((float) RadioAlarmConfig.clampSpeechRate(speechRate));
                    applyVoice(tts, voiceName);

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

    /**
     * 指定聲音；找不到就保留 setLanguage 選出的預設聲音並記錄 —— 使用者換了手機或
     * 引擎更新後聲音消失，鬧鐘仍要響，只是換回預設聲音。
     */
    private static void applyVoice(TextToSpeech tts, String voiceName) {
        if (voiceName == null || voiceName.trim().isEmpty()) return;
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return;
            for (Voice v : voices) {
                if (voiceName.equals(v.getName())) {
                    int r = tts.setVoice(v);
                    if (r != TextToSpeech.SUCCESS) Log.w(TAG, "setVoice failed: " + r);
                    return;
                }
            }
            Log.w(TAG, "voice not found, using default: " + voiceName);
        } catch (Exception e) {
            Log.w(TAG, "applyVoice failed", e);
        }
    }

    /** 引擎中一個可選的中文聲音，供介面列出。 */
    public static final class VoiceInfo {
        public final String name;
        public final String locale;
        public final int quality;
        public final boolean network;

        VoiceInfo(String name, String locale, int quality, boolean network) {
            this.name = name;
            this.locale = locale;
            this.quality = quality;
            this.network = network;
        }
    }

    public interface VoicesCallback {
        void onResult(List<VoiceInfo> voices, String error);
    }

    /**
     * 列出引擎裡的中文聲音：先 zh-TW，再其他中文；同區域內品質高者先。
     * 不需網路的聲音在鬧鐘情境較可靠，但仍列出需網路者讓使用者自己選。
     */
    public static void listChineseVoices(Context context, final VoicesCallback callback) {
        final TextToSpeech[] holder = new TextToSpeech[1];
        try {
            holder[0] = new TextToSpeech(context.getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    TextToSpeech tts = holder[0];
                    List<VoiceInfo> result = new ArrayList<VoiceInfo>();
                    String error = null;
                    if (status != TextToSpeech.SUCCESS || tts == null) {
                        error = "裝置沒有可用的文字轉語音引擎";
                    } else {
                        try {
                            Set<Voice> voices = tts.getVoices();
                            if (voices != null) {
                                for (Voice v : voices) {
                                    Locale l = v.getLocale();
                                    if (l == null) continue;
                                    String lang = l.getLanguage();
                                    if (!"zh".equals(lang) && !"cmn".equals(lang) && !"yue".equals(lang)) continue;
                                    result.add(new VoiceInfo(v.getName(), l.toLanguageTag(), v.getQuality(),
                                            v.isNetworkConnectionRequired()));
                                }
                            }
                        } catch (Exception e) {
                            error = "無法列出聲音：" + e.getMessage();
                        }
                        Collections.sort(result, new Comparator<VoiceInfo>() {
                            @Override
                            public int compare(VoiceInfo a, VoiceInfo b) {
                                boolean aTw = a.locale.toUpperCase(Locale.US).contains("TW");
                                boolean bTw = b.locale.toUpperCase(Locale.US).contains("TW");
                                if (aTw != bTw) return aTw ? -1 : 1;
                                if (a.network != b.network) return a.network ? 1 : -1;
                                if (a.quality != b.quality) return b.quality - a.quality;
                                return a.name.compareTo(b.name);
                            }
                        });
                    }
                    shutdown(tts);
                    callback.onResult(result, error);
                }
            });
        } catch (Exception e) {
            shutdown(holder[0]);
            callback.onResult(new ArrayList<VoiceInfo>(), "建立文字轉語音引擎失敗：" + e.getMessage());
        }
    }

    // ---- 試聽 ----
    //
    // 試聽是「選聲音時馬上聽一句」，不是鬧鐘播放，所以直接 speak() 走媒體音量即可，
    // 不進 ExoPlayer 的單一播放路徑（那條紅線管的是鬧鐘會不會響，試聽與它無關）。

    /** 目前正在試聽的引擎；再按一次或按停止就把它關掉，不讓兩句疊在一起。 */
    private static TextToSpeech previewTts;

    public static final String PREVIEW_TEXT = "南亞 236.5 跌0.5。台化 89 漲1。";

    public interface PreviewCallback {
        void onResult(String error);
    }

    /** 以指定聲音與語速念一段範例。同一時間只有一個試聽；先停掉上一個。 */
    public static synchronized void preview(Context context, final String voiceName, final double speechRate,
                                            final PreviewCallback callback) {
        stopPreview();
        final TextToSpeech[] holder = new TextToSpeech[1];
        try {
            holder[0] = new TextToSpeech(context.getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    TextToSpeech tts = holder[0];
                    if (status != TextToSpeech.SUCCESS || tts == null) {
                        shutdown(tts);
                        callback.onResult("裝置沒有可用的文字轉語音引擎");
                        return;
                    }
                    int lang = tts.setLanguage(Locale.TAIWAN);
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        lang = tts.setLanguage(Locale.CHINESE);
                    }
                    if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                        shutdown(tts);
                        callback.onResult("裝置沒有中文語音");
                        return;
                    }
                    tts.setSpeechRate((float) RadioAlarmConfig.clampSpeechRate(speechRate));
                    applyVoice(tts, voiceName);
                    tts.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                    synchronized (RadioTts.class) {
                        previewTts = tts;
                    }
                    int r = tts.speak(PREVIEW_TEXT, TextToSpeech.QUEUE_FLUSH, null, "avd-preview");
                    callback.onResult(r == TextToSpeech.SUCCESS ? null : "引擎拒絕朗讀（回傳 " + r + "）");
                }
            });
        } catch (Exception e) {
            shutdown(holder[0]);
            callback.onResult("建立文字轉語音引擎失敗：" + e.getMessage());
        }
    }

    public static synchronized void stopPreview() {
        if (previewTts != null) {
            shutdown(previewTts);
            previewTts = null;
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
