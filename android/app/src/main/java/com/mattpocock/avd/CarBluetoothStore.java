package com.mattpocock.avd;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 車機藍牙的持久化：使用者選定的那一台已配對裝置（OpenSpec car-bluetooth-connect）。
 *
 * 與 {@link RadioAlarmStore} 同樣是「原生端為權威來源的設定」：鬧鐘響起前要連車機，
 * 那一刻 WebView 多半沒在執行，前端的儲存埠讀不到；快速設定磚也在 WebView 之外運作。
 * 前端因此不另存副本，每次開設定都經插件回來讀。
 *
 * 獨立的 SharedPreferences 檔，理由同 RadioAlarmStore：讀取時機與生命週期不同的東西
 * 不混在一起。
 */
public final class CarBluetoothStore {

    private static final String PREFS_NAME = "avd_car_bluetooth";
    private static final String KEY_ADDRESS = "address";
    private static final String KEY_NAME = "name";

    /** 選定的裝置：MAC 位址是識別，名稱只用來顯示（配對當下的名稱，之後不再更新）。 */
    public static final class Device {
        public final String address;
        public final String name;

        public Device(String address, String name) {
            this.address = address;
            this.name = (name == null || name.isEmpty()) ? address : name;
        }
    }

    private final SharedPreferences prefs;

    public CarBluetoothStore(Context context) {
        this.prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** 尚未選擇時回傳 null。 */
    public Device get() {
        String address = prefs.getString(KEY_ADDRESS, "");
        if (address == null || address.isEmpty()) return null;
        return new Device(address, prefs.getString(KEY_NAME, ""));
    }

    public void set(String address, String name) {
        prefs.edit()
                .putString(KEY_ADDRESS, address == null ? "" : address)
                .putString(KEY_NAME, name == null ? "" : name)
                .apply();
    }

    public void clear() {
        prefs.edit().remove(KEY_ADDRESS).remove(KEY_NAME).apply();
    }
}
