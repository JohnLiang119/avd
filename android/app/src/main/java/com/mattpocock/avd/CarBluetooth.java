package com.mattpocock.avd;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.NotificationCompat;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 車機藍牙：把手機連到已配對的車用藍牙（OpenSpec car-bluetooth-connect）。
 *
 * Android 12 起，`BluetoothA2dp.connect()` 這類「叫系統去連某台已配對裝置」的 API 一律
 * 要求 BLUETOOTH_PRIVILEGED，一般 App 呼叫會收到 SecurityException；本類別因此完全不碰
 * 它們。做法是對車機開一條 RFCOMM 連線（只需 BLUETOOTH_CONNECT）：連線本身多半會失敗
 * （車機不一定有 SPP 服務），但光是嘗試就會把手機與車機之間的底層 ACL 鏈路建起來，
 * 多數車機一看到手機連上就會自己把 A2DP／通話協定接回來。
 *
 * 這是「盡力而為」：成不成要看車機韌體。所以 {@link #connect} 的結果一定要讓呼叫端
 * 能退回「開系統藍牙設定讓使用者點一下」，而不是當成已經連上。
 *
 * 所有會等待的方法都會阻塞且會等主執行緒的回呼，MUST 在背景執行緒呼叫。
 */
public final class CarBluetooth {

    private static final String TAG = "CarBluetooth";

    /** Serial Port Profile。對沒有 SPP 的車機也無妨：SDP 查詢本身就會建立 ACL 鏈路。 */
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /** 等 profile proxy 回來的上限；系統通常數十毫秒內就回呼。 */
    private static final long PROXY_TIMEOUT_MS = 1500L;
    private static final long POLL_INTERVAL_MS = 500L;

    private CarBluetooth() {
    }

    public enum Outcome {
        /** 尚未選擇車機。 */
        NO_DEVICE,
        /** API 31 起需要的 BLUETOOTH_CONNECT 未授予。 */
        NO_PERMISSION,
        /** 手機沒有藍牙或藍牙關著。 */
        ADAPTER_OFF,
        /** 呼叫時已經連著，什麼都不必做。 */
        ALREADY_CONNECTED,
        /** 喚醒後在等待時間內接回了音訊協定。 */
        CONNECTED,
        /** 等待時間內沒接回來；呼叫端應退回藍牙設定。 */
        NOT_CONNECTED
    }

    /** 已配對裝置清單中的一項；kind 供介面把車用裝置排前面。 */
    public static final class Device {
        public final String address;
        public final String name;
        /** "car"（車用音訊）、"audio"（其他音訊裝置）或 "other"。 */
        public final String kind;

        Device(String address, String name, String kind) {
            this.address = address;
            this.name = (name == null || name.isEmpty()) ? address : name;
            this.kind = kind;
        }
    }

    // ---- 狀態查詢 ----

    /** API 31 起需要執行期權限 BLUETOOTH_CONNECT；更舊的版本上 BLUETOOTH 為安裝即授予。 */
    public static boolean hasPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isAdapterOn(Context context) {
        BluetoothAdapter adapter = adapter(context);
        return adapter != null && adapter.isEnabled();
    }

    private static BluetoothAdapter adapter(Context context) {
        BluetoothManager manager =
                (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    /** 已配對的裝置，車用音訊排最前、其他音訊裝置次之，同類依名稱。需要權限且藍牙開著。 */
    public static List<Device> bondedDevices(Context context) {
        List<Device> result = new ArrayList<Device>();
        BluetoothAdapter adapter = adapter(context);
        if (adapter == null || !hasPermission(context)) return result;

        Set<BluetoothDevice> bonded;
        try {
            bonded = adapter.getBondedDevices();
        } catch (SecurityException e) {
            Log.w(TAG, "getBondedDevices denied", e);
            return result;
        }
        if (bonded == null) return result;

        for (BluetoothDevice device : bonded) {
            String name = null;
            String kind = "other";
            try {
                name = device.getName();
                BluetoothClass clazz = device.getBluetoothClass();
                if (clazz != null) {
                    if (clazz.getDeviceClass() == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO) {
                        kind = "car";
                    } else if (clazz.getMajorDeviceClass() == BluetoothClass.Device.Major.AUDIO_VIDEO) {
                        kind = "audio";
                    }
                }
            } catch (SecurityException e) {
                Log.w(TAG, "device info denied", e);
            }
            result.add(new Device(device.getAddress(), name, kind));
        }

        Collections.sort(result, new Comparator<Device>() {
            @Override
            public int compare(Device a, Device b) {
                int ra = rank(a.kind);
                int rb = rank(b.kind);
                if (ra != rb) return ra - rb;
                return a.name.compareToIgnoreCase(b.name);
            }

            private int rank(String kind) {
                if ("car".equals(kind)) return 0;
                if ("audio".equals(kind)) return 1;
                return 2;
            }
        });
        return result;
    }

    /** 該裝置目前是否接著音訊協定（A2DP 或通話）。會阻塞，MUST 在背景執行緒呼叫。 */
    public static boolean isConnected(Context context, String address) {
        BluetoothAdapter adapter = adapter(context);
        if (adapter == null || !adapter.isEnabled() || !hasPermission(context)) return false;
        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            return false;
        }
        ProfileHandle a2dp = ProfileHandle.open(context, adapter, BluetoothProfile.A2DP);
        ProfileHandle headset = ProfileHandle.open(context, adapter, BluetoothProfile.HEADSET);
        try {
            return a2dp.isConnected(device) || headset.isConnected(device);
        } finally {
            a2dp.close();
            headset.close();
        }
    }

    // ---- 連線 ----

    /**
     * 盡力把手機連到車機，最多等 {@code waitMs} 毫秒。會阻塞，MUST 在背景執行緒呼叫。
     *
     * 流程：已連著就直接回報 → 對車機開 RFCOMM 連線把 ACL 鏈路喚起 → 每半秒查一次
     * 音訊協定是否接回 → 逾時回 {@link Outcome#NOT_CONNECTED}。RFCOMM 連線成功時會
     * 一直開著到等待結束才關，免得鏈路在車機來得及接回協定前就斷掉。
     */
    public static Outcome connect(Context context, CarBluetoothStore.Device target, long waitMs) {
        if (target == null) return Outcome.NO_DEVICE;
        if (!hasPermission(context)) return Outcome.NO_PERMISSION;
        BluetoothAdapter adapter = adapter(context);
        if (adapter == null || !adapter.isEnabled()) return Outcome.ADAPTER_OFF;

        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(target.address);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "invalid address: " + target.address);
            return Outcome.NO_DEVICE;
        }

        ProfileHandle a2dp = ProfileHandle.open(context, adapter, BluetoothProfile.A2DP);
        ProfileHandle headset = ProfileHandle.open(context, adapter, BluetoothProfile.HEADSET);
        Wake wake = null;
        try {
            if (a2dp.isConnected(device) || headset.isConnected(device)) {
                return Outcome.ALREADY_CONNECTED;
            }

            wake = Wake.start(device);
            long deadline = System.currentTimeMillis() + Math.max(POLL_INTERVAL_MS, waitMs);
            while (System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(POLL_INTERVAL_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return Outcome.NOT_CONNECTED;
                }
                if (a2dp.isConnected(device) || headset.isConnected(device)) {
                    Log.d(TAG, "car audio profile connected: " + target.name);
                    return Outcome.CONNECTED;
                }
            }
            Log.d(TAG, "car did not reconnect within " + waitMs + " ms: " + target.name);
            return Outcome.NOT_CONNECTED;
        } finally {
            if (wake != null) wake.close();
            a2dp.close();
            headset.close();
        }
    }

    /** 退回用：系統藍牙設定頁，使用者在那裡點一下車機即可連線。 */
    public static Intent settingsIntent() {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /**
     * 連不上時的一鍵入口：高優先通知，點下去開系統藍牙設定。鬧鐘前連線與連線排程共用。
     * 通知頻道在這裡建立 —— 排程由接收器觸發時，播放服務可能一次都沒起來過。
     */
    public static void notifyNotConnected(Context context, String deviceName, Outcome outcome) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        RadioAlarmConstants.CAR_BLUETOOTH_CHANNEL_ID, "車機藍牙",
                        NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("連不上車機時，點一下開啟藍牙設定");
                manager.createNotificationChannel(channel);
            }
            PendingIntent open = PendingIntent.getActivity(
                    context, 0, settingsIntent(),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String message = describe(outcome, deviceName) + "。點這裡開啟藍牙設定。";
            Notification notification = new NotificationCompat.Builder(
                    context, RadioAlarmConstants.CAR_BLUETOOTH_CHANNEL_ID)
                    .setContentTitle("車機未連線")
                    .setContentText(message)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                    .setSmallIcon(R.drawable.ic_car_bluetooth)
                    .setContentIntent(open)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .build();
            manager.notify(RadioAlarmConstants.CAR_BLUETOOTH_NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.e(TAG, "failed to show car bluetooth notification", e);
        }
    }

    /** 可直接顯示給使用者的結果說明。 */
    public static String describe(Outcome outcome, String deviceName) {
        String name = (deviceName == null || deviceName.isEmpty()) ? "車機" : deviceName;
        switch (outcome) {
            case NO_DEVICE: return "尚未選擇車機";
            case NO_PERMISSION: return "未授予藍牙權限，無法連線車機";
            case ADAPTER_OFF: return "手機的藍牙是關閉的";
            case ALREADY_CONNECTED: return name + " 已連線";
            case CONNECTED: return "已連線 " + name;
            case NOT_CONNECTED: return name + " 沒有回應，請在藍牙設定點一下它";
            default: return "";
        }
    }

    // ---- 內部 ----

    /**
     * 對車機開 RFCOMM 連線的那條執行緒。`connect()` 會阻塞到成功或頁面逾時（數秒），
     * 故放在自己的執行緒；呼叫端等夠了就 {@link #close()} 把它中止。
     */
    private static final class Wake {
        private final BluetoothSocket socket;

        private Wake(BluetoothSocket socket) {
            this.socket = socket;
        }

        static Wake start(BluetoothDevice device) {
            final BluetoothSocket socket;
            try {
                socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            } catch (IOException | SecurityException e) {
                Log.w(TAG, "cannot create rfcomm socket", e);
                return null;
            }
            Thread thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        socket.connect();
                        Log.d(TAG, "rfcomm connected (car has SPP)");
                    } catch (IOException | SecurityException e) {
                        // 預期中的結果：車機沒有 SPP，或鏈路建好後被對方拒絕。ACL 已經起來了。
                        Log.d(TAG, "rfcomm attempt ended: " + e.getMessage());
                    }
                }
            }, "car-bt-wake");
            thread.start();
            return new Wake(socket);
        }

        void close() {
            try {
                socket.close();
            } catch (IOException ignored) {
                // 關閉失敗沒有後續可做
            }
        }
    }

    /** 拿一次 profile proxy、重複查連線狀態、最後歸還。拿不到時所有查詢回 false。 */
    private static final class ProfileHandle {
        private final BluetoothAdapter adapter;
        private final int profile;
        private final BluetoothProfile proxy;

        private ProfileHandle(BluetoothAdapter adapter, int profile, BluetoothProfile proxy) {
            this.adapter = adapter;
            this.profile = profile;
            this.proxy = proxy;
        }

        static ProfileHandle open(Context context, BluetoothAdapter adapter, int profile) {
            final CountDownLatch latch = new CountDownLatch(1);
            final AtomicReference<BluetoothProfile> ref = new AtomicReference<BluetoothProfile>();
            boolean started = adapter.getProfileProxy(context, new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int p, BluetoothProfile proxy) {
                    ref.set(proxy);
                    latch.countDown();
                }

                @Override
                public void onServiceDisconnected(int p) {
                    latch.countDown();
                }
            }, profile);
            if (started) {
                try {
                    latch.await(PROXY_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            return new ProfileHandle(adapter, profile, ref.get());
        }

        boolean isConnected(BluetoothDevice device) {
            if (proxy == null) return false;
            try {
                return proxy.getConnectionState(device) == BluetoothProfile.STATE_CONNECTED;
            } catch (SecurityException e) {
                return false;
            }
        }

        void close() {
            if (proxy != null) adapter.closeProfileProxy(profile, proxy);
        }
    }
}
