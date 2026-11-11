package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Assume;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * 選檔清單的完整掃描（design.md D20）：走訪找得到哪些檔、紀錄讀寫、哪些路徑可以拿去複製。
 *
 * 走訪漏了使用者只是找不到檔；路徑把關錯了則是讓 WebView 能叫原生端讀任意檔案，
 * 所以後者的反例要寫足。
 */
public class RadioMediaScannerTest {

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File touch(File root, String relative) throws Exception {
        File file = new File(root, relative);
        File parent = file.getParentFile();
        if (!parent.exists()) assertTrue(parent.mkdirs());
        FileOutputStream out = new FileOutputStream(file);
        out.write(new byte[]{1, 2, 3});
        out.close();
        return file;
    }

    private static List<String> names(RadioMediaScanner.Index index) {
        List<String> names = new ArrayList<String>();
        for (RadioMediaScanner.Entry e : index.entries) names.add(new File(e.path).getName());
        Collections.sort(names);
        return names;
    }

    // ---- walk ----

    @Test
    public void walkFindsNomediaAndHiddenFoldersButSkipsAppPrivateDirs() throws Exception {
        File root = temp.newFolder("storage");
        touch(root, "Music/a.mp3");
        touch(root, "LINE/voice/.nomedia");
        touch(root, "LINE/voice/b.MP3");
        touch(root, ".hidden/deep/c.mp4");
        touch(root, "d.mp4");
        touch(root, "Android/media/com.other/e.mp3");
        touch(root, "Android/data/com.other/files/private.mp3");
        touch(root, "Android/obb/com.other/private.mp4");
        touch(root, "Music/notes.txt");
        touch(root, "Music/voice.m4a");

        RadioMediaScanner.Index index = RadioMediaScanner.walk(
                Collections.singletonList(root.getAbsolutePath()), 1234L);

        assertEquals(Arrays.asList("a.mp3", "b.MP3", "c.mp4", "d.mp4", "e.mp3"), names(index));
        assertEquals(1234L, index.scannedAt);
        assertFalse(index.truncated);
        assertEquals(3L, index.entries.get(0).sizeBytes);
        assertTrue(index.entries.get(0).modifiedMs > 0);
    }

    @Test
    public void walkCoversEveryRootAndIgnoresMissingOnes() throws Exception {
        File internal = temp.newFolder("internal");
        File sd = temp.newFolder("sd");
        touch(internal, "Music/a.mp3");
        touch(sd, "Movies/b.mp4");

        RadioMediaScanner.Index index = RadioMediaScanner.walk(Arrays.asList(
                internal.getAbsolutePath(), sd.getAbsolutePath(),
                new File(temp.getRoot(), "missing").getAbsolutePath(), "", null), 1L);

        assertEquals(Arrays.asList("a.mp3", "b.mp4"), names(index));
    }

    // ---- 紀錄 ----

    @Test
    public void indexRoundTripsThroughJson() throws Exception {
        List<RadioMediaScanner.Entry> entries = new ArrayList<RadioMediaScanner.Entry>();
        entries.add(new RadioMediaScanner.Entry("/storage/emulated/0/LINE/早安 \"新聞\".mp3", 2048L, 1700000000000L));
        RadioMediaScanner.Index parsed = RadioMediaScanner.fromJson(
                RadioMediaScanner.toJson(new RadioMediaScanner.Index(99L, entries, true)));

        assertEquals(99L, parsed.scannedAt);
        assertTrue(parsed.truncated);
        assertEquals(1, parsed.entries.size());
        assertEquals("/storage/emulated/0/LINE/早安 \"新聞\".mp3", parsed.entries.get(0).path);
        assertEquals("早安 \"新聞\".mp3", parsed.entries.get(0).name());
        assertEquals(2048L, parsed.entries.get(0).sizeBytes);
        assertEquals(1700000000000L, parsed.entries.get(0).modifiedMs);
    }

    @Test
    public void brokenOrUnscannedIndexIsTreatedAsNeverScanned() {
        assertNull(RadioMediaScanner.fromJson(""));
        assertNull(RadioMediaScanner.fromJson("not json"));
        assertNull(RadioMediaScanner.fromJson("{\"files\":[]}"));
        assertNull(RadioMediaScanner.fromJson("{\"scannedAt\":0,\"files\":[]}"));
    }

    @Test
    public void indexSkipsEntriesWithoutPath() {
        RadioMediaScanner.Index parsed = RadioMediaScanner.fromJson(
                "{\"scannedAt\":5,\"files\":[{\"size\":1},null,{\"path\":\"/s/a.mp3\",\"size\":-4}]}");
        assertEquals(1, parsed.entries.size());
        assertEquals(0L, parsed.entries.get(0).sizeBytes);
    }

    // ---- 顯示 ----

    @Test
    public void folderIsRelativeToItsVolume() {
        List<String> roots = Arrays.asList("/storage/emulated/0", "/storage/1A2B-3C4D");
        assertEquals("LINE/voice", RadioMediaScanner.folderOf("/storage/emulated/0/LINE/voice/a.mp3", roots));
        assertEquals("", RadioMediaScanner.folderOf("/storage/emulated/0/a.mp3", roots));
        assertEquals("SD 卡 · Music", RadioMediaScanner.folderOf("/storage/1A2B-3C4D/Music/a.mp3", roots));
        assertEquals("SD 卡", RadioMediaScanner.folderOf("/storage/1A2B-3C4D/a.mp3", roots));
        assertEquals("/mnt/other", RadioMediaScanner.folderOf("/mnt/other/a.mp3", roots));
        // 名稱只是前綴相同的另一個儲存區不算在內
        assertEquals("/storage/emulated/01/Music", RadioMediaScanner.folderOf("/storage/emulated/01/Music/a.mp3", roots));
    }

    @Test
    public void kindFollowsExtension() {
        assertEquals("video", RadioMediaScanner.kindOf("clip.MP4"));
        assertEquals("audio", RadioMediaScanner.kindOf("song.mp3"));
    }

    @Test
    public void volumeRootDerivedFromAppFilesDir() {
        assertEquals("/storage/emulated/0",
                RadioMediaScanner.volumeRootOf("/storage/emulated/0/Android/data/com.mattpocock.avd/files"));
        assertEquals("/storage/1A2B-3C4D",
                RadioMediaScanner.volumeRootOf("/storage/1A2B-3C4D/Android/data/com.mattpocock.avd/files"));
        assertEquals("", RadioMediaScanner.volumeRootOf("/data/user/0/com.mattpocock.avd/files"));
        assertEquals("", RadioMediaScanner.volumeRootOf(null));
    }

    // ---- isAllowedPath ----

    @Test
    public void mediaUnderStorageRootsAllowed() {
        List<String> roots = Arrays.asList("/storage/emulated/0", "/storage/1A2B-3C4D");
        assertTrue(RadioMediaScanner.isAllowedPath("/storage/emulated/0/LINE/.cache/a.mp3", roots));
        assertTrue(RadioMediaScanner.isAllowedPath("/storage/emulated/0/a.MP4", roots));
        assertTrue(RadioMediaScanner.isAllowedPath("/storage/1A2B-3C4D/Music/b.mp3", roots));
        assertTrue(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Android/media/com.other/c.mp3", roots));
    }

    @Test
    public void everythingElseRejected() {
        List<String> roots = Collections.singletonList("/storage/emulated/0");
        assertFalse(RadioMediaScanner.isAllowedPath(null, roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/a.mp3", null));
        // 私有目錄與系統檔
        assertFalse(RadioMediaScanner.isAllowedPath("/data/data/com.mattpocock.avd/files/a.mp3", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/data/user/0/com.mattpocock.avd/shared_prefs/x.mp3", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/system/media/audio/a.mp3", roots));
        // 往上跳出儲存區
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/../../../data/data/x/a.mp3", roots));
        // 名稱只是前綴相同
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/01/a.mp3", roots));
        // 不是 mp3／mp4
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Download/secret.txt", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Download/a.mp3.part", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Download/.mp3", roots));
        // 其他 App 的私有目錄
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Android/data/com.other/files/a.mp3", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/Android/obb/com.other/a.mp4", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0/a\\b.mp3", roots));
        // 儲存區根目錄本身、空的根目錄
        assertFalse(RadioMediaScanner.isAllowedPath("/storage/emulated/0", roots));
        assertFalse(RadioMediaScanner.isAllowedPath("/a.mp3", Collections.singletonList("")));
    }

    @Test
    public void allowedFileMustExistUnderRoot() throws Exception {
        // 路徑把關以 Android 的「/」分隔為準；在 Windows 上跑測試時略過
        Assume.assumeTrue(File.separatorChar == '/');
        File root = temp.newFolder("storage");
        File inside = touch(root, "LINE/a.mp3");
        File outside = touch(temp.newFolder("elsewhere"), "b.mp3");
        List<String> roots = Collections.singletonList(root.getAbsolutePath());

        assertTrue(RadioMediaScanner.isAllowedFile(inside, roots));
        assertFalse(RadioMediaScanner.isAllowedFile(outside, roots));
        assertFalse(RadioMediaScanner.isAllowedFile(new File(root, "LINE/missing.mp3"), roots));
        assertFalse(RadioMediaScanner.isAllowedFile(
                new File(root, "LINE/../../elsewhere/b.mp3"), roots));
    }
}
