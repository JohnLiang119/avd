package com.mattpocock.avd;

import java.util.Arrays;

/** 複製資料的純函式；不依賴 Android，也不授予任何實體卡寫入權限。 */
public final class NfcCloneData {
    public static final String MODE_FULL = "full-block0";
    public static final String MODE_UID_ONLY = "uid-only";
    public static final int UID_LENGTH = 4;
    public static final int BLOCK_LENGTH = 16;
    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private NfcCloneData() { }

    /** 探索資訊快照；ATQA 永遠保留 Android API 回傳的原始順序。 */
    public static final class Profile {
        public final int type;
        public final int size;
        public final int sak;
        private final byte[] atqa;

        public Profile(int type, int size, int sak, byte[] atqa) {
            if (sak < 0 || sak > 255 || atqa == null || atqa.length != 2) {
                throw new IllegalArgumentException("invalid profile discovery data");
            }
            this.type = type;
            this.size = size;
            this.sak = sak;
            this.atqa = atqa.clone();
        }

        public byte[] atqa() {
            return atqa.clone();
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof Profile)) return false;
            Profile profile = (Profile) other;
            return type == profile.type && size == profile.size && sak == profile.sak
                    && Arrays.equals(atqa, profile.atqa);
        }

        @Override
        public int hashCode() {
            return 31 * (31 * (31 * type + size) + sak) + Arrays.hashCode(atqa);
        }
    }

    /**
     * 由原生流程提供的硬體證據閘門。探索資訊相同無法證明可寫或卡片世代；
     * 未來實作必須另外綁定已驗證的手機、目標型號與非 UID 位元組限制。
     * 測試可以注入測試替身；正式插件不得由前端資料開啟此閘門。
     */
    public interface Policy {
        boolean permits(Profile source, Profile target, String mode,
                byte[] sourceBlock0, byte[] targetBlock0);
    }

    /** 目前沒有實機證據：所有正式寫入都保持關閉。 */
    public static final Policy NO_VERIFIED_HARDWARE =
            (source, target, mode, sourceBlock0, targetBlock0) -> false;

    /** 嚴格接受八位 ASCII 十六進位；不截斷、不補零、不猜測分隔格式。 */
    public static byte[] parseUid(String text) {
        if (text == null || text.length() != UID_LENGTH * 2) {
            throw new IllegalArgumentException("UID must contain exactly four bytes");
        }
        byte[] uid = new byte[UID_LENGTH];
        for (int i = 0; i < uid.length; i++) {
            int high = hexDigit(text.charAt(i * 2));
            int low = hexDigit(text.charAt(i * 2 + 1));
            if (high < 0 || low < 0) throw new IllegalArgumentException("invalid UID hex");
            uid[i] = (byte) ((high << 4) | low);
        }
        return uid;
    }

    public static String hex(byte[] bytes) {
        if (bytes == null) throw new IllegalArgumentException("missing bytes");
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            out[i * 2] = HEX[(bytes[i] & 0xff) >>> 4];
            out[i * 2 + 1] = HEX[bytes[i] & 0x0f];
        }
        return new String(out);
    }

    public static byte bcc(byte[] uid) {
        requireUid(uid);
        return (byte) (uid[0] ^ uid[1] ^ uid[2] ^ uid[3]);
    }

    /** 驗證 UID／BCC 格式，不把廠商 bytes 5–15 一概當成 SAK／ATQA。 */
    public static void validateBlock0(byte[] uid, byte[] block) {
        requireUid(uid);
        requireBlock(block);
        for (int i = 0; i < UID_LENGTH; i++) {
            if (block[i] != uid[i]) throw new IllegalArgumentException("block UID mismatch");
        }
        if (block[4] != bcc(uid)) throw new IllegalArgumentException("block BCC mismatch");
    }

    /**
     * 只篩選本次資料規則的候選結構，不代表已有硬體支援證據。
     * 限 Classic 1K、單層 UID 的 SAK 08 與原始 ATQA 04 00；未推廣至 4K。
     */
    public static void requireSupported(Profile profile) {
        if (profile == null || profile.type != 0 || profile.size != 1024
                || profile.sak != 0x08 || profile.atqa[0] != 0x04 || profile.atqa[1] != 0x00) {
            throw new IllegalArgumentException("unsupported profile");
        }
    }

    public static void requireCompatible(Profile source, Profile target) {
        requireSupported(source);
        requireSupported(target);
        if (!source.equals(target)) throw new IllegalArgumentException("incompatible profiles");
    }

    /**
     * 完整模式的保守格式限制：只有明確採 bytes 5／6–7 作 SAK／ATQA 的
     * 候選格式可組裝；此檢查本身不能證明目標型號採用該格式或允許寫入。
     */
    public static void validateBlockProfile(Profile profile, byte[] block) {
        requireSupported(profile);
        requireBlock(block);
        if ((block[5] & 0xff) != profile.sak
                || block[6] != profile.atqa[0] || block[7] != profile.atqa[1]) {
            throw new IllegalArgumentException("unsupported full block format");
        }
    }

    /** 組出獨立的新陣列；呼叫者仍必須取得 Policy 允許才可執行寫入。 */
    public static byte[] build(String mode, byte[] sourceUid, Profile sourceProfile,
            byte[] sourceBlock0, byte[] targetUid, Profile targetProfile, byte[] targetBlock0) {
        requireUid(sourceUid);
        requireCompatible(sourceProfile, targetProfile);
        validateBlock0(targetUid, targetBlock0);
        // 即使選 UID 模式，已取得的損毀来源也不能被忽略而靜默降級。
        if (sourceBlock0 != null) validateBlock0(sourceUid, sourceBlock0);
        if (MODE_FULL.equals(mode)) {
            validateBlock0(sourceUid, sourceBlock0);
            validateBlockProfile(sourceProfile, sourceBlock0);
            validateBlockProfile(targetProfile, targetBlock0);
            return sourceBlock0.clone();
        }
        if (MODE_UID_ONLY.equals(mode)) {
            byte[] expected = targetBlock0.clone();
            System.arraycopy(sourceUid, 0, expected, 0, UID_LENGTH);
            expected[4] = bcc(sourceUid);
            return expected;
        }
        throw new IllegalArgumentException("unsupported clone mode");
    }

    /** 不接受空值或部分區塊；UID 相同但任一其他 byte 不同也不是驗證成功。 */
    public static boolean fullMatches(byte[] expected, byte[] actual) {
        return expected != null && actual != null && expected.length == BLOCK_LENGTH
                && actual.length == BLOCK_LENGTH && Arrays.equals(expected, actual);
    }

    private static void requireUid(byte[] uid) {
        if (uid == null || uid.length != UID_LENGTH) {
            throw new IllegalArgumentException("UID must contain exactly four bytes");
        }
    }

    private static void requireBlock(byte[] block) {
        if (block == null || block.length != BLOCK_LENGTH) {
            throw new IllegalArgumentException("block 0 must contain exactly sixteen bytes");
        }
    }

    private static int hexDigit(char digit) {
        if (digit >= '0' && digit <= '9') return digit - '0';
        if (digit >= 'A' && digit <= 'F') return digit - 'A' + 10;
        if (digit >= 'a' && digit <= 'f') return digit - 'a' + 10;
        return -1;
    }
}
