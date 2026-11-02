package com.mattpocock.avd;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

/**
 * 開系統藍牙設定的透明中繼頁（OpenSpec car-bluetooth-connect）。
 *
 * 先讓「自動點選車機」服務待命，再開系統藍牙設定，然後立刻結束、不留在最近使用。
 * 為什麼要中繼：「車機未連線」通知與連線排程的常駐通知被點的時間不固定，只有在真正
 * 開啟設定頁的那一刻設定待命，15 秒的待命時間才準。磚與主畫面鈕也走這裡，入口一致。
 */
public class CarBluetoothSettingsActivity extends Activity {

    private static final String TAG = "CarBtSettings";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CarBluetoothAutoTapService.arm(this);
        try {
            startActivity(CarBluetooth.systemSettingsIntent());
        } catch (Exception e) {
            Log.e(TAG, "cannot open bluetooth settings", e);
            CarBluetoothAutoTapService.disarm();
        }
        finish();
    }
}
