package com.mattpocock.avd;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

/**
 * 快速設定磚「連線車機」（OpenSpec car-bluetooth-connect）。
 *
 * 上車時下拉通知列一按：先以 {@link CarBluetooth#connect} 盡力把手機連到車機，
 * 連不上就直接開系統藍牙設定讓使用者點一下 —— 磚的存在意義就是省掉「找設定頁」
 * 那幾步。磚的狀態：已連線為亮、未連線為暗；尚未選擇車機時按下去開本 App。
 */
public class CarBluetoothTileService extends TileService {

    private static final String TAG = "CarBluetoothTile";

    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean busy = false;

    @Override
    public void onStartListening() {
        super.onStartListening();
        refresh();
    }

    @Override
    public void onClick() {
        super.onClick();
        final CarBluetoothStore.Device device = new CarBluetoothStore(this).get();
        if (device == null || !CarBluetooth.hasPermission(this)) {
            // 還沒設定：帶使用者到 App 的偏好設定選車機
            launch(getPackageManager().getLaunchIntentForPackage(getPackageName()));
            return;
        }
        if (busy) return;
        busy = true;
        apply(Tile.STATE_ACTIVE, device.name, "連線中…");

        new Thread(new Runnable() {
            @Override
            public void run() {
                CarBluetooth.Outcome outcome = CarBluetooth.connect(
                        CarBluetoothTileService.this, device, RadioAlarmConstants.CAR_BLUETOOTH_WAIT_MS);
                busy = false;
                boolean ok = outcome == CarBluetooth.Outcome.CONNECTED
                        || outcome == CarBluetooth.Outcome.ALREADY_CONNECTED;
                Log.d(TAG, "connect outcome: " + outcome);
                apply(ok ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE, device.name, ok ? "已連線" : "未連線");
                if (!ok) {
                    // 盡力而為沒成功：退回一鍵 —— 開藍牙設定，使用者點一下車機即可
                    launch(CarBluetooth.settingsIntent());
                }
            }
        }, "car-bt-tile").start();
    }

    private void refresh() {
        final CarBluetoothStore.Device device = new CarBluetoothStore(this).get();
        if (device == null) {
            apply(Tile.STATE_INACTIVE, getString(R.string.car_bluetooth_tile_label), "尚未選擇車機");
            return;
        }
        if (!CarBluetooth.hasPermission(this)) {
            apply(Tile.STATE_INACTIVE, device.name, "需要藍牙權限");
            return;
        }
        if (busy) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean connected = CarBluetooth.isConnected(CarBluetoothTileService.this, device.address);
                if (busy) return;
                apply(connected ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE,
                        device.name, connected ? "已連線" : "未連線");
            }
        }, "car-bt-tile-refresh").start();
    }

    /** 更新磚面；可自任何執行緒呼叫。磚已不在監聽（getQsTile 為 null）時略過。 */
    private void apply(final int state, final String label, final String subtitle) {
        main.post(new Runnable() {
            @Override
            public void run() {
                Tile tile = getQsTile();
                if (tile == null) return;
                tile.setState(state);
                tile.setLabel(label);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    tile.setSubtitle(subtitle);
                }
                tile.updateTile();
            }
        });
    }

    /**
     * 自磚啟動畫面並收起通知列。API 34 起只接受 PendingIntent（由 SystemUI 代為啟動，
     * 不受背景啟動限制）；更舊的版本用 Intent 版本。
     */
    private void launch(final Intent intent) {
        if (intent == null) return;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startActivityAndCollapse(PendingIntent.getActivity(
                                CarBluetoothTileService.this, 0, intent,
                                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
                    } else {
                        startActivityAndCollapse(intent);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "startActivityAndCollapse failed", e);
                }
            }
        });
    }
}
