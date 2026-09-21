package com.mattpocock.avd;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 產生一段指定秒數的靜音 WAV（16 kHz、單聲道、16 位元 PCM）。
 *
 * 股票報價頻道用它當作句與句之間的停頓：語音引擎對句號的停頓長度不可控，
 * 使用者要的是「停頓幾秒可調」，於是每句各合成一個檔、中間夾這個檔，整串交給播放器。
 *
 * 純 Java（只用 java.io），可在 JVM 測試 WAV 標頭與長度。
 */
public final class SilenceWav {

    public static final int SAMPLE_RATE = 16000;
    public static final int CHANNELS = 1;
    public static final int BITS_PER_SAMPLE = 16;

    private SilenceWav() {
    }

    /** 指定秒數的靜音需要多少位元組的樣本資料。 */
    public static int dataBytesFor(double seconds) {
        if (Double.isNaN(seconds) || seconds <= 0) return 0;
        long frames = Math.round(seconds * SAMPLE_RATE);
        return (int) (frames * CHANNELS * (BITS_PER_SAMPLE / 8));
    }

    /**
     * 寫出靜音檔。已存在且大小正確就不重寫（同一個停頓秒數每天都會用到）。
     *
     * @return 寫出的檔案
     * @throws IOException 寫入失敗
     */
    public static File write(File out, double seconds) throws IOException {
        int dataBytes = dataBytesFor(seconds);
        long expectedLength = 44L + dataBytes;
        if (out.isFile() && out.length() == expectedLength) return out;

        File dir = out.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("無法建立資料夾 " + dir.getAbsolutePath());
        }

        OutputStream os = null;
        try {
            os = new FileOutputStream(out);
            os.write(header(dataBytes));
            byte[] zeros = new byte[8192];
            int remaining = dataBytes;
            while (remaining > 0) {
                int n = Math.min(remaining, zeros.length);
                os.write(zeros, 0, n);
                remaining -= n;
            }
            os.flush();
        } finally {
            if (os != null) {
                try {
                    os.close();
                } catch (IOException ignored) {
                    // 已 flush
                }
            }
        }
        return out;
    }

    /** 44 位元組的標準 RIFF/WAVE PCM 標頭。 */
    public static byte[] header(int dataBytes) {
        int byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
        int blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
        byte[] h = new byte[44];
        putAscii(h, 0, "RIFF");
        putIntLE(h, 4, 36 + dataBytes);
        putAscii(h, 8, "WAVE");
        putAscii(h, 12, "fmt ");
        putIntLE(h, 16, 16);              // fmt chunk 長度
        putShortLE(h, 20, (short) 1);     // PCM
        putShortLE(h, 22, (short) CHANNELS);
        putIntLE(h, 24, SAMPLE_RATE);
        putIntLE(h, 28, byteRate);
        putShortLE(h, 32, (short) blockAlign);
        putShortLE(h, 34, (short) BITS_PER_SAMPLE);
        putAscii(h, 36, "data");
        putIntLE(h, 40, dataBytes);
        return h;
    }

    private static void putAscii(byte[] b, int offset, String text) {
        for (int i = 0; i < text.length(); i++) b[offset + i] = (byte) text.charAt(i);
    }

    private static void putIntLE(byte[] b, int offset, int value) {
        b[offset] = (byte) (value & 0xff);
        b[offset + 1] = (byte) ((value >> 8) & 0xff);
        b[offset + 2] = (byte) ((value >> 16) & 0xff);
        b[offset + 3] = (byte) ((value >> 24) & 0xff);
    }

    private static void putShortLE(byte[] b, int offset, short value) {
        b[offset] = (byte) (value & 0xff);
        b[offset + 1] = (byte) ((value >> 8) & 0xff);
    }
}
