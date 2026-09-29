package com.mattpocock.avd;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NFC 讀卡機：感應卡片並把 UID 回報給前端。
 *
 * 只做三件事 —— 查狀態、開關 Reader Mode、回報 UID；格式化以外的邏輯
 * （歷史、去重）全在前端 nfcReader.ts（design.md D2）。
 *
 * 採 Reader Mode 而非 Manifest intent filter 或 Foreground Dispatch：讀卡只在
 * 前端的讀卡畫面開著時發生，AVD 不會成為系統 NFC 分派的候選 App（design.md D1）。
 */
@CapacitorPlugin(name = "Nfc")
public class NfcPlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private static final String TAG = "NfcPlugin";

    /**
     * 四種技術全開讓各廠牌門禁卡都探測得到；SKIP_NDEF_CHECK 免去系統多讀一次 NDEF
     * （快，且不會在 Mifare Classic 上卡住）；NO_PLATFORM_SOUNDS 關掉系統嗶聲與震動，
     * 回饋改由 {@link #vibrate()} 自己震一次，避免兩層回饋疊加（design.md D1／D5）。
     */
    private static final int READER_FLAGS =
            NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V
            | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
            | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

    private static final long VIBRATE_MS = 50;

    /**
     * 前端是否要求感應中。Activity 暫停時系統會自動解除 Reader Mode，
     * 回到前景要靠這個旗標決定是否重新啟用（design.md D3）。
     */
    private volatile boolean scanning = false;

    // ---- 插件方法 ----

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        scanning = true;
        enableReaderModeIfPossible();
        call.resolve();
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        scanning = false;
        disableReaderMode();
        call.resolve();
    }

    /**
     * 開系統的 NFC 設定頁。沒有 NFC 硬體的裝置（例如 TV）可能沒有這個頁面，
     * 此時以 reject 回報而不是讓 App 崩潰。
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activity unavailable");
            return;
        }
        try {
            activity.startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("nfc settings unavailable");
        }
    }

    // ---- 生命週期 ----

    /**
     * 回到前景：若前端仍要求感應就重新啟用，並把最新狀態推給前端。
     * 這一步同時涵蓋「切出再切回」與「去系統設定開啟 NFC 後返回」兩個情境。
     */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (scanning) {
            enableReaderModeIfPossible();
        }
        notifyListeners("stateChanged", statusObject());
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // 系統會自行解除 Reader Mode；這裡不改 scanning，讓 resume 時知道要復原。
    }

    // ---- Reader Mode ----

    /**
     * 感應到卡片。在 binder 執行緒被呼叫，這裡只做震動與回報，不碰任何 View；
     * notifyListeners 由 Capacitor 派回 WebView（design.md「Risks」）。
     */
    @Override
    public void onTagDiscovered(Tag tag) {
        if (tag == null) return;
        byte[] id = tag.getId();
        if (id == null || id.length == 0) {
            Log.w(TAG, "tag discovered without id");
            return;
        }
        String uidHex = toUpperHex(id);
        Log.i(TAG, "tag discovered uidHex=" + uidHex + " length=" + id.length);

        vibrate();

        JSObject payload = new JSObject();
        payload.put("uidHex", uidHex);
        payload.put("uidLength", id.length);
        notifyListeners("tagDiscovered", payload);
    }

    private void enableReaderModeIfPossible() {
        final Activity activity = getActivity();
        final NfcAdapter adapter = adapter();
        if (activity == null || adapter == null || !adapter.isEnabled()) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    adapter.enableReaderMode(activity, NfcPlugin.this, READER_FLAGS, null);
                } catch (Exception e) {
                    Log.w(TAG, "enableReaderMode failed", e);
                }
            }
        });
    }

    private void disableReaderMode() {
        final Activity activity = getActivity();
        final NfcAdapter adapter = adapter();
        if (activity == null || adapter == null) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    adapter.disableReaderMode(activity);
                } catch (Exception e) {
                    Log.w(TAG, "disableReaderMode failed", e);
                }
            }
        });
    }

    // ---- 工具 ----

    private NfcAdapter adapter() {
        Context context = getContext();
        return context == null ? null : NfcAdapter.getDefaultAdapter(context);
    }

    /** supported：有 NFC 硬體；enabled：使用者已開啟。沒有硬體時兩者皆 false。 */
    private JSObject statusObject() {
        NfcAdapter adapter = adapter();
        JSObject obj = new JSObject();
        obj.put("supported", adapter != null);
        obj.put("enabled", adapter != null && adapter.isEnabled());
        return obj;
    }

    /** 依卡片回報的原始位元組順序、大寫、不分隔、每位元組固定兩位（規格「卡號格式」）。 */
    static String toUpperHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02X", b & 0xFF));
        }
        return sb.toString();
    }

    /** 短震一次作為讀到卡的回饋。取不到 Vibrator（例如 TV）就靜默略過。 */
    private void vibrate() {
        Context context = getContext();
        if (context == null) return;
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(VIBRATE_MS, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(VIBRATE_MS);
            }
        } catch (Exception e) {
            Log.w(TAG, "vibrate failed", e);
        }
    }
}
