package com.mattpocock.avd;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * 本地檔案頻道的副本管理：私有目錄的位置、複製、刪除。
 *
 * 所有副本都放在 {@code filesDir/radio_alarm/<channelId>/} 之下（design.md D15）。
 * 放私有目錄的理由是硬性的：不需任何儲存權限、不受使用者整理檔案與 SD 卡影響、
 * 隨 App 解除安裝一併清除 —— 也就是把「6 點時檔案讀不到」的每一條路都堵掉。
 *
 * 這個類別碰檔案系統與 ContentResolver，不在 JVM 測試範圍；能純字串判斷的部分
 * （路徑是否在私有目錄下）在 {@link RadioAlarmConfig#isValidLocalFilePath}。
 */
public final class RadioAlarmFiles {

    private static final String TAG = "RadioAlarmFiles";

    private RadioAlarmFiles() {
    }

    /** 所有本地檔案頻道副本的根目錄。 */
    public static File rootDir(Context context) {
        return new File(context.getFilesDir(), RadioAlarmConstants.LOCAL_FILES_DIR_NAME);
    }

    /** 根目錄的絕對路徑，供 {@link RadioAlarmConfig#fromJson(String, String)} 做路徑把關。 */
    public static String rootPath(Context context) {
        return rootDir(context).getAbsolutePath();
    }

    /** 某個頻道的副本資料夾。channelId 不合法時回傳 null —— 絕不讓 `..` 逃出根目錄。 */
    public static File channelDir(Context context, String channelId) {
        if (!isSafeChannelId(channelId)) return null;
        return new File(rootDir(context), channelId);
    }

    /** 新頻道的識別：只含字母與數字，可直接作為資料夾名稱。 */
    public static String newChannelId() {
        return "file" + System.currentTimeMillis();
    }

    /** 頻道 id 可作為資料夾名稱：非空、不含路徑分隔符與 `..`。 */
    public static boolean isSafeChannelId(String channelId) {
        if (channelId == null) return false;
        String id = channelId.trim();
        if (id.isEmpty() || id.contains("/") || id.contains("\\") || id.contains("..")) return false;
        return true;
    }

    /** 自選檔器回傳的 URI 取得原始檔名；取不到時退回 URI 的最後一段。 */
    public static String displayName(ContentResolver resolver, Uri uri) {
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "failed to query display name for " + uri, e);
        } finally {
            if (cursor != null) cursor.close();
        }
        String last = uri.getLastPathSegment();
        return last == null || last.trim().isEmpty() ? "檔案" : last.trim();
    }

    /**
     * 把顯示名稱整理成可用的檔名：換掉檔案系統不接受的字元、去掉控制字元、限制長度。
     * 只影響磁碟上的檔名，介面顯示的仍是原始名稱。
     */
    public static String sanitizeFileName(String name) {
        String text = name == null ? "" : name.trim();
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 32 || c == '/' || c == '\\' || c == ':' || c == '*' || c == '?'
                    || c == '"' || c == '<' || c == '>' || c == '|') {
                out.append('_');
            } else {
                out.append(c);
            }
        }
        String result = out.toString().trim();
        if (result.isEmpty() || ".".equals(result) || "..".equals(result)) result = "file";
        if (result.length() > 100) result = result.substring(0, 100);
        return result;
    }

    /**
     * 把一個來源複製成頻道資料夾下的副本。
     *
     * @param index 在清單中的序號（自 1 起），用作檔名前綴以避免同名覆蓋並保留順序
     * @return 副本的檔案
     * @throws IOException 來源打不開、寫入失敗（含空間不足）
     */
    public static File copyInto(ContentResolver resolver, Uri source, File dir, int index, String displayName)
            throws IOException {
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("無法建立資料夾 " + dir.getAbsolutePath());
        }
        File target = new File(dir, String.format(Locale.US, "%03d_%s", index, sanitizeFileName(displayName)));

        InputStream in = null;
        OutputStream out = null;
        try {
            in = resolver.openInputStream(source);
            if (in == null) throw new IOException("無法讀取來源檔案 " + displayName);
            out = new FileOutputStream(target);
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // 關閉輸入失敗不影響副本的正確性
                }
            }
            if (out != null) {
                try {
                    out.close();
                } catch (IOException ignored) {
                    // 已 flush；關閉失敗不影響副本的正確性
                }
            }
        }
        return target;
    }

    /**
     * 刪除某個頻道的整個副本資料夾。
     *
     * @return 資料夾已不存在（原本就沒有、或刪除成功）
     */
    public static boolean deleteChannelDir(Context context, String channelId) {
        File dir = channelDir(context, channelId);
        if (dir == null) return false;
        return deleteRecursively(dir);
    }

    private static boolean deleteRecursively(File file) {
        if (!file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        boolean deleted = file.delete();
        if (!deleted) Log.w(TAG, "failed to delete " + file.getAbsolutePath());
        return deleted;
    }
}
