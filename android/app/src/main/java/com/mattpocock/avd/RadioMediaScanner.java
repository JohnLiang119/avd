package com.mattpocock.avd;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 選檔清單的完整掃描（design.md D20）：直接走訪手機所有資料夾找 mp3／mp4，補上 MediaStore
 * 不索引的部分（有 {@code .nomedia} 的資料夾、隱藏資料夾、系統還沒索引到的檔）。
 *
 * 走訪整個儲存區要幾秒到幾十秒，所以**掃完就記錄**在私有目錄的一份 JSON 裡，之後開清單
 * 直接讀紀錄，不再重掃；使用者按「重新掃描」才再走訪一次。MediaStore 的部分每次開清單
 * 仍即時查詢（很快），故一般資料夾裡的新檔不必重掃也會出現。
 *
 * 需要「所有檔案存取權」（API 30+ 的 {@code MANAGE_EXTERNAL_STORAGE}，使用者須到系統設定手動開）；
 * 沒開時清單維持只列 MediaStore。{@code Android/data}、{@code Android/obb} 即使開了也讀不到，直接跳過。
 *
 * 走訪、路徑把關、紀錄的讀寫都不碰 Android 類別，以 JUnit 釘住。
 */
public final class RadioMediaScanner {

    private static final String TAG = "RadioMediaScanner";

    /** 紀錄檔，放在 {@code filesDir} 下。 */
    static final String INDEX_FILE = "radio_media_index.json";

    /** 一次掃描最多記錄幾個檔；超過即停（清單本身上限更小，見 {@link RadioMediaLibrary#MAX_ITEMS}）。 */
    static final int MAX_FILES = 20000;

    /** 資料夾最深走幾層；正常的手機不會超過，主要防循環連結。 */
    static final int MAX_DEPTH = 24;

    private RadioMediaScanner() {
    }

    /** 掃到的一個檔案。 */
    public static final class Entry {
        public final String path;
        public final long sizeBytes;
        public final long modifiedMs;

        Entry(String path, long sizeBytes, long modifiedMs) {
            this.path = path;
            this.sizeBytes = sizeBytes;
            this.modifiedMs = modifiedMs;
        }

        public String name() {
            int slash = path.lastIndexOf('/');
            return slash < 0 ? path : path.substring(slash + 1);
        }
    }

    /** 一次完整掃描的紀錄。 */
    public static final class Index {
        /** 掃描完成的時間（毫秒）；從未掃描為 0。 */
        public final long scannedAt;
        public final List<Entry> entries;
        /** 掃到 {@link #MAX_FILES} 即停，沒走完。 */
        public final boolean truncated;

        Index(long scannedAt, List<Entry> entries, boolean truncated) {
            this.scannedAt = scannedAt;
            this.entries = entries;
            this.truncated = truncated;
        }
    }

    // ---- 權限與儲存區 ----

    /**
     * 能否直接走訪所有資料夾：API 30+ 看「所有檔案存取權」，以下看 READ_EXTERNAL_STORAGE
     * （當時的儲存權限本來就涵蓋整個外部儲存區）。
     */
    public static boolean canScanAllFiles(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * 所有外部儲存區的根目錄（內部儲存空間在第一個，其後是 SD 卡等）。
     * 由本 App 在各儲存區的專屬資料夾（{@code <root>/Android/data/<pkg>/files}）往上推得。
     */
    public static List<String> storageRoots(Context context) {
        List<String> roots = new ArrayList<String>();
        File[] dirs = context.getExternalFilesDirs(null);
        if (dirs != null) {
            for (File dir : dirs) {
                String root = dir == null ? "" : volumeRootOf(dir.getAbsolutePath());
                if (!root.isEmpty() && !roots.contains(root)) roots.add(root);
            }
        }
        if (roots.isEmpty()) {
            roots.add(Environment.getExternalStorageDirectory().getAbsolutePath());
        }
        return roots;
    }

    /** {@code /storage/emulated/0/Android/data/pkg/files} → {@code /storage/emulated/0}；不含該段時為空字串。 */
    static String volumeRootOf(String appFilesDir) {
        if (appFilesDir == null) return "";
        int at = appFilesDir.indexOf("/Android/data/");
        return at <= 0 ? "" : appFilesDir.substring(0, at);
    }

    // ---- 走訪 ----

    /**
     * 走訪各儲存區找 mp3／mp4。含隱藏資料夾與有 {@code .nomedia} 的資料夾；
     * 跳過各儲存區的 {@code Android/data}、{@code Android/obb}（讀不到）與循環連結。
     */
    public static Index walk(List<String> roots, long now) {
        List<Entry> found = new ArrayList<Entry>();
        Set<String> visited = new HashSet<String>();
        boolean truncated = false;

        for (String root : roots) {
            if (root == null || root.trim().isEmpty()) continue;
            File rootDir = new File(root);
            Set<String> skipped = new HashSet<String>();
            skipped.add(new File(rootDir, "Android/data").getAbsolutePath());
            skipped.add(new File(rootDir, "Android/obb").getAbsolutePath());

            ArrayDeque<File> dirs = new ArrayDeque<File>();
            ArrayDeque<Integer> depths = new ArrayDeque<Integer>();
            dirs.push(rootDir);
            depths.push(0);
            while (!dirs.isEmpty()) {
                File dir = dirs.pop();
                int depth = depths.pop();
                if (!visited.add(canonicalOrAbsolute(dir))) continue;
                File[] children = dir.listFiles();
                if (children == null) continue;
                for (File child : children) {
                    if (child.isDirectory()) {
                        if (depth < MAX_DEPTH && !skipped.contains(child.getAbsolutePath())) {
                            dirs.push(child);
                            depths.push(depth + 1);
                        }
                    } else if (isWantedName(child.getName())) {
                        if (found.size() >= MAX_FILES) {
                            truncated = true;
                            break;
                        }
                        found.add(new Entry(child.getAbsolutePath(), child.length(), child.lastModified()));
                    }
                }
                if (truncated) break;
            }
            if (truncated) break;
        }
        return new Index(now, found, truncated);
    }

    private static String canonicalOrAbsolute(File file) {
        try {
            return file.getCanonicalPath();
        } catch (IOException e) {
            return file.getAbsolutePath();
        }
    }

    static boolean isWantedName(String name) {
        return RadioMediaLibrary.hasExtension(name, "mp3") || RadioMediaLibrary.hasExtension(name, "mp4");
    }

    /** 檔名對應的種類：mp4 為影片，其餘（mp3）為音訊。 */
    static String kindOf(String name) {
        return RadioMediaLibrary.hasExtension(name, "mp4")
                ? RadioMediaLibrary.KIND_VIDEO : RadioMediaLibrary.KIND_AUDIO;
    }

    /**
     * 清單上顯示的資料夾：相對於所在儲存區的路徑；不在第一個儲存區（內部儲存空間）的加「SD 卡 · 」。
     * 不在任何已知儲存區下的回傳上層的絕對路徑。
     */
    static String folderOf(String path, List<String> roots) {
        int slash = path.lastIndexOf('/');
        String parent = slash <= 0 ? "" : path.substring(0, slash);
        for (int i = 0; i < roots.size(); i++) {
            String root = roots.get(i);
            if (parent.equals(root) || parent.startsWith(root + "/")) {
                String rel = parent.length() == root.length() ? "" : parent.substring(root.length() + 1);
                if (i == 0) return rel;
                return rel.isEmpty() ? "SD 卡" : "SD 卡 · " + rel;
            }
        }
        return parent;
    }

    /**
     * 這個路徑能不能拿去複製：必須是某個儲存區底下的 mp3／mp4，且不含 {@code ..}。
     * {@code copyRadioAlarmMediaFiles} 的輸入來自 WebView，不讓它變成「讀任意檔案」的通道
     * （私有目錄、系統檔一律拒絕）。呼叫端須先把路徑正規化（canonical）再傳進來。
     */
    static boolean isAllowedPath(String path, List<String> roots) {
        if (path == null || roots == null) return false;
        if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) return false;
        if (!isWantedName(path.substring(path.lastIndexOf('/') + 1))) return false;
        for (String root : roots) {
            if (root == null || root.trim().isEmpty()) continue;
            if (!path.startsWith(root + "/")) continue;
            String rel = path.substring(root.length() + 1);
            return !rel.startsWith("Android/data/") && !rel.startsWith("Android/obb/");
        }
        return false;
    }

    /** 正規化後再以 {@link #isAllowedPath} 把關；正規化失敗（路徑不合法）即拒絕。 */
    public static boolean isAllowedFile(File file, List<String> roots) {
        try {
            String canonical = file.getCanonicalPath();
            // 內部儲存空間常以連結呈現（/sdcard → /storage/emulated/0），根目錄也一併正規化再比
            List<String> canonicalRoots = new ArrayList<String>();
            for (String root : roots) {
                canonicalRoots.add(root);
                canonicalRoots.add(new File(root).getCanonicalPath());
            }
            return isAllowedPath(canonical, canonicalRoots) && file.isFile();
        } catch (IOException e) {
            return false;
        }
    }

    // ---- 紀錄 ----

    static String toJson(Index index) throws Exception {
        JSONArray files = new JSONArray();
        for (Entry e : index.entries) {
            JSONObject o = new JSONObject();
            o.put("path", e.path);
            o.put("size", e.sizeBytes);
            o.put("modified", e.modifiedMs);
            files.put(o);
        }
        JSONObject root = new JSONObject();
        root.put("scannedAt", index.scannedAt);
        root.put("truncated", index.truncated);
        root.put("files", files);
        return root.toString();
    }

    /** 解析紀錄；格式不對、沒有掃描時間的一律視為「從未掃描」（回傳 null）。 */
    static Index fromJson(String text) {
        try {
            JSONObject root = new JSONObject(text);
            long scannedAt = root.optLong("scannedAt", 0L);
            if (scannedAt <= 0) return null;
            JSONArray files = root.optJSONArray("files");
            List<Entry> entries = new ArrayList<Entry>();
            for (int i = 0; files != null && i < files.length(); i++) {
                JSONObject o = files.optJSONObject(i);
                String path = o == null ? "" : o.optString("path", "");
                if (path.isEmpty()) continue;
                entries.add(new Entry(path, Math.max(0L, o.optLong("size", 0L)), Math.max(0L, o.optLong("modified", 0L))));
            }
            return new Index(scannedAt, entries, root.optBoolean("truncated", false));
        } catch (Exception e) {
            return null;
        }
    }

    /** 讀上次的掃描紀錄；沒有或壞掉回傳 null。 */
    public static Index load(Context context) {
        File file = new File(context.getFilesDir(), INDEX_FILE);
        if (!file.isFile()) return null;
        InputStream in = null;
        try {
            in = new FileInputStream(file);
            byte[] bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = in.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return fromJson(new String(bytes, 0, offset, StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "failed to read scan index", e);
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // 讀完了，關閉失敗無妨
                }
            }
        }
    }

    /** 寫入紀錄：先寫暫存檔再改名，中途被殺不會留下半份紀錄。寫不進去只記 log，這次的結果照樣回傳。 */
    public static void save(Context context, Index index) {
        File target = new File(context.getFilesDir(), INDEX_FILE);
        File temp = new File(context.getFilesDir(), INDEX_FILE + ".tmp");
        OutputStream out = null;
        try {
            out = new FileOutputStream(temp);
            out.write(toJson(index).getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.close();
            out = null;
            if (!temp.renameTo(target)) {
                Log.w(TAG, "failed to replace scan index");
                temp.delete();
            }
        } catch (Exception e) {
            Log.w(TAG, "failed to write scan index", e);
            temp.delete();
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException ignored) {
                    // 已失敗，暫存檔會被刪
                }
            }
        }
    }

    /**
     * 取得掃描結果：有紀錄且未要求重掃就直接用紀錄，否則走訪一次並記錄。
     * 呼叫前須確認 {@link #canScanAllFiles}。
     */
    public static Index loadOrScan(Context context, boolean rescan) {
        Index index = rescan ? null : load(context);
        if (index != null) return index;
        index = walk(storageRoots(context), System.currentTimeMillis());
        save(context, index);
        return index;
    }
}
