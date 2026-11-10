package com.mattpocock.avd;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * 選檔清單的資料來源：以 MediaStore 列出這支手機上所有 mp3 與 mp4（design.md D19）。
 *
 * 使用者要的是「不必記得檔案在哪個資料夾」—— MediaStore 是系統維護的全裝置媒體索引
 * （{@code external} 涵蓋所有外部儲存區，含 SD 卡），一次查詢即得，不必遍歷目錄；
 * 遍歷在 scoped storage 下本來也讀不到別的 App 的資料夾。
 *
 * 這裡只列清單，不碰副本：選中的檔案仍由 {@link RadioAlarmFiles#copyInto} 複製進私有目錄
 * （D15「複製而非引用」不變），故日後撤銷讀取權限不影響已建好的頻道。
 *
 * 純字串的部分（副檔名、資料夾顯示字串、URI 把關、日期取捨）抽成靜態方法，以 JUnit 釘住；
 * 查詢本身碰 ContentResolver，不在 JVM 測試範圍。
 */
public final class RadioMediaLibrary {

    private static final String TAG = "RadioMediaLibrary";

    /** 一次最多回傳幾筆。上千筆的 JSON 走 Capacitor 橋接與 WebView 渲染都會明顯變慢。 */
    public static final int MAX_ITEMS = 5000;

    public static final String KIND_AUDIO = "audio";
    public static final String KIND_VIDEO = "video";

    /** MediaStore 的 content URI 前綴；{@link #isMediaStoreUri} 只放行這個。 */
    static final String MEDIA_URI_PREFIX = "content://media/";

    /** MediaStore 欄位名稱。直接寫字串：各 API 版本的常數散在不同類別，值都相同。 */
    private static final String COL_ID = "_id";
    private static final String COL_DISPLAY_NAME = "_display_name";
    private static final String COL_SIZE = "_size";
    private static final String COL_DATE_MODIFIED = "date_modified";
    private static final String COL_DATE_ADDED = "date_added";
    private static final String COL_DURATION = "duration";
    private static final String COL_RELATIVE_PATH = "relative_path";
    private static final String COL_VOLUME_NAME = "volume_name";
    private static final String COL_DATA = "_data";

    private RadioMediaLibrary() {
    }

    /** 清單上的一個檔案。uri 是 MediaStore 的 content URI，複製時直接開它。 */
    public static final class Item {
        public final String uri;
        public final String displayName;
        public final String folder;
        public final String kind;
        public final long sizeBytes;
        public final long modifiedMs;
        public final long durationMs;

        Item(String uri, String displayName, String folder, String kind,
             long sizeBytes, long modifiedMs, long durationMs) {
            this.uri = uri;
            this.displayName = displayName;
            this.folder = folder;
            this.kind = kind;
            this.sizeBytes = sizeBytes;
            this.modifiedMs = modifiedMs;
            this.durationMs = durationMs;
        }
    }

    public static final class ScanResult {
        public final List<Item> items;
        /** 超過 {@link #MAX_ITEMS}，只留最新的那些。 */
        public final boolean truncated;

        ScanResult(List<Item> items, boolean truncated) {
            this.items = items;
            this.truncated = truncated;
        }
    }

    // ---- 權限 ----

    /** 讀得到別的 App 的 mp3：API 33+ 看 READ_MEDIA_AUDIO，以下看 READ_EXTERNAL_STORAGE。 */
    public static boolean canReadAudio(Context context) {
        return granted(context, Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    /** 讀得到別的 App 的 mp4：API 33+ 看 READ_MEDIA_VIDEO，以下看 READ_EXTERNAL_STORAGE。 */
    public static boolean canReadVideo(Context context) {
        return granted(context, Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_VIDEO
                : Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    private static boolean granted(Context context, String permission) {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    // ---- 查詢 ----

    /**
     * 列出 mp3（Audio 表）與 mp4（Video 表），依日期新到舊。
     *
     * 沒有讀取權限時不拋例外：MediaStore 仍會回傳本 App 自己寫入的檔（AVD 下載的那些），
     * 清單照樣可用，缺了哪類由呼叫端以 {@link #canReadAudio}／{@link #canReadVideo} 說明。
     */
    public static ScanResult scan(Context context) {
        List<Item> all = new ArrayList<Item>();
        boolean truncated = false;
        truncated |= query(context, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, "mp3", KIND_AUDIO, all);
        truncated |= query(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "mp4", KIND_VIDEO, all);

        Collections.sort(all, new Comparator<Item>() {
            @Override
            public int compare(Item a, Item b) {
                return Long.compare(b.modifiedMs, a.modifiedMs);
            }
        });
        if (all.size() > MAX_ITEMS) {
            all = new ArrayList<Item>(all.subList(0, MAX_ITEMS));
            truncated = true;
        }
        return new ScanResult(all, truncated);
    }

    /** @return 是否因上限而沒讀完 */
    private static boolean query(Context context, Uri collection, String extension, String kind, List<Item> out) {
        boolean scoped = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        String[] projection = scoped
                ? new String[]{COL_ID, COL_DISPLAY_NAME, COL_SIZE, COL_DATE_MODIFIED, COL_DATE_ADDED,
                        COL_DURATION, COL_RELATIVE_PATH, COL_VOLUME_NAME}
                : new String[]{COL_ID, COL_DISPLAY_NAME, COL_SIZE, COL_DATE_MODIFIED, COL_DATE_ADDED,
                        COL_DURATION, COL_DATA};
        String storageRoot = scoped ? "" : Environment.getExternalStorageDirectory().getAbsolutePath();

        Cursor cursor = null;
        int added = 0;
        try {
            cursor = context.getContentResolver().query(
                    collection,
                    projection,
                    COL_DISPLAY_NAME + " LIKE ?",
                    new String[]{"%." + extension},
                    COL_DATE_MODIFIED + " DESC");
            if (cursor == null) return false;

            int idCol = cursor.getColumnIndex(COL_ID);
            int nameCol = cursor.getColumnIndex(COL_DISPLAY_NAME);
            int sizeCol = cursor.getColumnIndex(COL_SIZE);
            int modifiedCol = cursor.getColumnIndex(COL_DATE_MODIFIED);
            int addedCol = cursor.getColumnIndex(COL_DATE_ADDED);
            int durationCol = cursor.getColumnIndex(COL_DURATION);
            int relativeCol = cursor.getColumnIndex(COL_RELATIVE_PATH);
            int volumeCol = cursor.getColumnIndex(COL_VOLUME_NAME);
            int dataCol = cursor.getColumnIndex(COL_DATA);

            while (cursor.moveToNext()) {
                if (added >= MAX_ITEMS) return true;
                String name = stringAt(cursor, nameCol);
                // LIKE 的大小寫行為依 provider 而定，這裡再以副檔名確認一次
                if (!hasExtension(name, extension)) continue;
                long id = cursor.getLong(idCol);
                String folder = folderLabel(
                        stringAt(cursor, relativeCol),
                        stringAt(cursor, volumeCol),
                        stringAt(cursor, dataCol),
                        storageRoot);
                out.add(new Item(
                        ContentUris.withAppendedId(collection, id).toString(),
                        name.trim(),
                        folder,
                        kind,
                        longAt(cursor, sizeCol),
                        dateMs(longAt(cursor, modifiedCol), longAt(cursor, addedCol)),
                        longAt(cursor, durationCol)));
                added++;
            }
            return false;
        } catch (Exception e) {
            // 單一類別查不到（例如某些廠牌的 MediaStore 欄位缺漏）不該讓另一類也列不出來
            Log.w(TAG, "MediaStore query failed for " + collection, e);
            return false;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private static String stringAt(Cursor cursor, int column) {
        if (column < 0 || cursor.isNull(column)) return "";
        String value = cursor.getString(column);
        return value == null ? "" : value;
    }

    private static long longAt(Cursor cursor, int column) {
        if (column < 0 || cursor.isNull(column)) return 0L;
        return cursor.getLong(column);
    }

    // ---- 純函式（JUnit 釘住） ----

    /** 檔名是否以 {@code .ext} 結尾（不分大小寫）；只有副檔名、沒有主檔名的不算。 */
    static boolean hasExtension(String name, String extension) {
        if (name == null || extension == null || extension.isEmpty()) return false;
        String n = name.trim().toLowerCase(Locale.ROOT);
        String suffix = "." + extension.toLowerCase(Locale.ROOT);
        return n.length() > suffix.length() && n.endsWith(suffix);
    }

    /**
     * 清單上顯示的資料夾，如 {@code Music/AVD}；在儲存區根目錄時為空字串。
     *
     * API 29+ 用 {@code relative_path}（如 {@code Music/AVD/}），不在內部儲存空間
     * （{@code external_primary}）的加上「SD 卡 · 」—— 兩邊可能有同名資料夾。
     * 更舊的版本只有絕對路徑 {@code _data}：在 storageRoot 之下的取相對路徑，否則取整個上層路徑。
     */
    static String folderLabel(String relativePath, String volumeName, String dataPath, String storageRoot) {
        String rel = trimSlashes(relativePath);
        if (relativePath != null && !relativePath.trim().isEmpty()) {
            boolean primary = volumeName == null || volumeName.trim().isEmpty()
                    || "external_primary".equals(volumeName.trim())
                    || "external".equals(volumeName.trim());
            if (primary) return rel;
            return rel.isEmpty() ? "SD 卡" : "SD 卡 · " + rel;
        }
        if (dataPath == null || dataPath.trim().isEmpty()) return "";
        String path = dataPath.trim();
        int slash = path.lastIndexOf('/');
        String parent = slash <= 0 ? "" : path.substring(0, slash);
        String root = trimTrailingSlashes(storageRoot == null ? "" : storageRoot.trim());
        if (!root.isEmpty() && (parent.equals(root) || parent.startsWith(root + "/"))) {
            return trimSlashes(parent.substring(root.length()));
        }
        return parent;
    }

    /** 清單排序與顯示用的日期（毫秒）：修改時間，沒有時退回加入 MediaStore 的時間（D19）。 */
    static long dateMs(long modifiedSeconds, long addedSeconds) {
        long seconds = modifiedSeconds > 0 ? modifiedSeconds : addedSeconds;
        return seconds > 0 ? seconds * 1000L : 0L;
    }

    /**
     * 是否為 MediaStore 的 content URI。{@code copyRadioAlarmMediaFiles} 的輸入來自 WebView，
     * 只放行這一種，不讓它變成「讀任意 URI」的通道（D19）。
     */
    static boolean isMediaStoreUri(String uri) {
        if (uri == null) return false;
        String u = uri.trim();
        if (!u.startsWith(MEDIA_URI_PREFIX) || u.length() == MEDIA_URI_PREFIX.length()) return false;
        return !u.contains("..") && !u.contains("\\");
    }

    private static String trimSlashes(String value) {
        if (value == null) return "";
        String v = value.trim();
        int start = 0;
        while (start < v.length() && v.charAt(start) == '/') start++;
        return trimTrailingSlashes(v.substring(start));
    }

    private static String trimTrailingSlashes(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') end--;
        return value.substring(0, end);
    }
}
