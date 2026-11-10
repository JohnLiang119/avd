package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 選檔清單（design.md D19）的純字串部分：哪些檔名算 mp3／mp4、資料夾怎麼顯示、
 * 日期取哪個、哪些 URI 可以拿去複製。
 *
 * 資料夾顯示錯了使用者只是認不出檔案在哪；URI 把關錯了則是讓 WebView 能叫原生端讀任意 URI，
 * 所以後者的反例要寫足。
 */
public class RadioMediaLibraryTest {

    // ---- hasExtension ----

    @Test
    public void extensionMatchesIgnoringCase() {
        assertTrue(RadioMediaLibrary.hasExtension("早安新聞.mp3", "mp3"));
        assertTrue(RadioMediaLibrary.hasExtension("SONG.MP3", "mp3"));
        assertTrue(RadioMediaLibrary.hasExtension("clip.Mp4", "mp4"));
        assertTrue(RadioMediaLibrary.hasExtension("  spaced.mp3  ", "mp3"));
    }

    @Test
    public void extensionRejectsOtherFormatsAndBareExtension() {
        assertFalse(RadioMediaLibrary.hasExtension("voice.m4a", "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension("song.mp3.part", "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension("mp3", "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension(".mp3", "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension("clip.mp4", "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension(null, "mp3"));
        assertFalse(RadioMediaLibrary.hasExtension("a.mp3", ""));
    }

    // ---- folderLabel ----

    @Test
    public void folderFromRelativePathOnPrimaryStorage() {
        assertEquals("Music/AVD", RadioMediaLibrary.folderLabel("Music/AVD/", "external_primary", "", ""));
        assertEquals("Download", RadioMediaLibrary.folderLabel("Download/", null, "", ""));
        assertEquals("Movies", RadioMediaLibrary.folderLabel("/Movies/", "external", "", ""));
    }

    @Test
    public void folderOnSdCardIsMarked() {
        assertEquals("SD 卡 · Music", RadioMediaLibrary.folderLabel("Music/", "1a2b-3c4d", "", ""));
        assertEquals("SD 卡", RadioMediaLibrary.folderLabel("/", "1a2b-3c4d", "", ""));
    }

    @Test
    public void folderFromAbsolutePathBeforeAndroid10() {
        String root = "/storage/emulated/0";
        assertEquals("Music/AVD",
                RadioMediaLibrary.folderLabel("", null, "/storage/emulated/0/Music/AVD/a.mp3", root));
        assertEquals("", RadioMediaLibrary.folderLabel(null, null, "/storage/emulated/0/a.mp3", root));
        // 不在內部儲存空間（SD 卡）：取整個上層路徑，不誤判為相對路徑
        assertEquals("/storage/1A2B-3C4D/Music",
                RadioMediaLibrary.folderLabel(null, null, "/storage/1A2B-3C4D/Music/a.mp3", root));
        // 前綴相同但不是同一個目錄
        assertEquals("/storage/emulated/01/Music",
                RadioMediaLibrary.folderLabel(null, null, "/storage/emulated/01/Music/a.mp3", root));
    }

    @Test
    public void folderEmptyWhenNothingKnown() {
        assertEquals("", RadioMediaLibrary.folderLabel(null, null, null, null));
        assertEquals("", RadioMediaLibrary.folderLabel("", "", "", ""));
    }

    // ---- dateMs ----

    @Test
    public void dateUsesModifiedThenAdded() {
        assertEquals(1700000000000L, RadioMediaLibrary.dateMs(1700000000L, 1600000000L));
        assertEquals(1600000000000L, RadioMediaLibrary.dateMs(0L, 1600000000L));
        assertEquals(0L, RadioMediaLibrary.dateMs(0L, 0L));
    }

    // ---- isMediaStoreUri ----

    @Test
    public void mediaStoreUrisAccepted() {
        assertTrue(RadioMediaLibrary.isMediaStoreUri("content://media/external/audio/media/123"));
        assertTrue(RadioMediaLibrary.isMediaStoreUri("content://media/external/video/media/9"));
    }

    @Test
    public void otherUrisRejected() {
        assertFalse(RadioMediaLibrary.isMediaStoreUri(null));
        assertFalse(RadioMediaLibrary.isMediaStoreUri(""));
        assertFalse(RadioMediaLibrary.isMediaStoreUri("content://media/"));
        assertFalse(RadioMediaLibrary.isMediaStoreUri("file:///data/data/com.mattpocock.avd/files/x.mp3"));
        assertFalse(RadioMediaLibrary.isMediaStoreUri("/storage/emulated/0/Music/a.mp3"));
        assertFalse(RadioMediaLibrary.isMediaStoreUri(
                "content://com.android.providers.downloads.documents/document/1"));
        assertFalse(RadioMediaLibrary.isMediaStoreUri("content://mediaevil/external/audio/media/1"));
        assertFalse(RadioMediaLibrary.isMediaStoreUri("content://media/../com.other/secret"));
    }
}
