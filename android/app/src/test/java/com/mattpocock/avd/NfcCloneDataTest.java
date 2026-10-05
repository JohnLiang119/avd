package com.mattpocock.avd;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Arrays;

import org.junit.Test;

/** 釘住真正寫入前的資料契約；這些測試不代表實體手機或卡片已通過相容性驗證。 */
public class NfcCloneDataTest {
    private static final NfcCloneData.Profile PROFILE =
            new NfcCloneData.Profile(0, 1024, 8, new byte[] {4, 0});
    private static final byte[] SOURCE_UID = {0, 10, (byte) 255, (byte) 129};
    private static final byte[] TARGET_UID = {4, 3, 2, 1};

    private static byte[] block(byte[] uid) {
        byte[] bytes = new byte[] {0, 0, 0, 0, 0, 8, 4, 0,
                (byte) 0xff, (byte) 0x80, 0, 1, 2, 3, 4, 5};
        System.arraycopy(uid, 0, bytes, 0, 4);
        bytes[4] = (byte) (uid[0] ^ uid[1] ^ uid[2] ^ uid[3]);
        return bytes;
    }

    private static void rejects(Runnable action) {
        try {
            action.run();
            fail("應拒絕無效的複製資料");
        } catch (IllegalArgumentException expected) {
            // 預期的輸入拒絕。
        }
    }

    @Test
    public void uidHexPreservesLeadingZerosAndByteOrder() {
        assertArrayEquals(SOURCE_UID, NfcCloneData.parseUid("000aFF81"));
        assertEquals("000AFF81", NfcCloneData.hex(SOURCE_UID));
        assertEquals("", NfcCloneData.hex(new byte[0]));
        assertEquals((byte) 0x74, NfcCloneData.bcc(SOURCE_UID));
    }

    @Test
    public void uidParserRejectsWrongLengthsSeparatorsAndNonAscii() {
        for (String invalid : new String[] {null, "", "000AFF8", "000AFF810", "04123456789012",
                "04123456789012345678", "00 0A FF 81", "000AFF8G", "０００ＡＦＦ８１"}) {
            rejects(() -> NfcCloneData.parseUid(invalid));
        }
        rejects(() -> NfcCloneData.bcc(new byte[7]));
        rejects(() -> NfcCloneData.bcc(null));
        rejects(() -> NfcCloneData.hex(null));
    }

    @Test
    public void profileIsImmutableAndUsesRawAtqaOrder() {
        byte[] atqa = {4, 0};
        NfcCloneData.Profile profile = new NfcCloneData.Profile(0, 1024, 8, atqa);
        atqa[0] = 0;
        profile.atqa()[0] = 0;
        assertArrayEquals(new byte[] {4, 0}, profile.atqa());
        assertEquals(PROFILE, profile);
        assertEquals(PROFILE.hashCode(), profile.hashCode());
        NfcCloneData.requireSupported(profile);
        rejects(() -> NfcCloneData.requireSupported(
                new NfcCloneData.Profile(0, 1024, 8, new byte[] {0, 4})));
        rejects(() -> new NfcCloneData.Profile(0, 1024, 8, null));
        rejects(() -> new NfcCloneData.Profile(0, 1024, 8, new byte[1]));
        rejects(() -> new NfcCloneData.Profile(0, 1024, 256, new byte[2]));
    }

    @Test
    public void unsupportedTypeSizeSakAndAtqaCannotBecomeCompatible() {
        NfcCloneData.requireCompatible(PROFILE, PROFILE);
        for (NfcCloneData.Profile invalid : new NfcCloneData.Profile[] {
                null,
                new NfcCloneData.Profile(1, 1024, 8, new byte[] {4, 0}),
                new NfcCloneData.Profile(0, 4096, 0x18, new byte[] {2, 0}),
                new NfcCloneData.Profile(0, 1024, 0x18, new byte[] {4, 0}),
                new NfcCloneData.Profile(0, 1024, 8, new byte[] {0x44, 0})}) {
            rejects(() -> NfcCloneData.requireCompatible(PROFILE, invalid));
            rejects(() -> NfcCloneData.requireCompatible(invalid, PROFILE));
        }
    }

    @Test
    public void blocksRequireExactlySixteenBytesAndMatchingUidAndBcc() {
        NfcCloneData.validateBlock0(SOURCE_UID, block(SOURCE_UID));
        for (int length : new int[] {0, 4, 15, 17, 32}) {
            rejects(() -> NfcCloneData.validateBlock0(SOURCE_UID, new byte[length]));
        }
        rejects(() -> NfcCloneData.validateBlock0(SOURCE_UID, null));
        rejects(() -> NfcCloneData.validateBlock0(new byte[7], new byte[16]));
        rejects(() -> NfcCloneData.validateBlock0(TARGET_UID, block(SOURCE_UID)));
        byte[] badBcc = block(SOURCE_UID);
        badBcc[4] ^= 1;
        rejects(() -> NfcCloneData.validateBlock0(SOURCE_UID, badBcc));
    }

    @Test
    public void uidOnlyPreservesEveryNonUidByteWithoutGuessingManufacturerFormat() {
        byte[] target = block(TARGET_UID);
        for (int i = 5; i < 16; i++) target[i] = (byte) (0xf0 + i);
        byte[] original = target.clone();
        byte[] expected = NfcCloneData.build(NfcCloneData.MODE_UID_ONLY, SOURCE_UID, PROFILE,
                null, TARGET_UID, PROFILE, target);
        assertArrayEquals(SOURCE_UID, Arrays.copyOfRange(expected, 0, 4));
        assertEquals((byte) 0x74, expected[4]);
        assertArrayEquals(Arrays.copyOfRange(original, 5, 16), Arrays.copyOfRange(expected, 5, 16));
        assertArrayEquals(original, target);
        assertNotSame(target, expected);
        NfcCloneData.validateBlock0(SOURCE_UID, expected);
    }

    @Test
    public void fullModeCopiesAllSixteenSourceBytesAndDoesNotAliasInputs() {
        byte[] source = block(SOURCE_UID);
        byte[] target = block(TARGET_UID);
        target[15] = 42;
        byte[] expected = NfcCloneData.build(NfcCloneData.MODE_FULL, SOURCE_UID, PROFILE,
                source, TARGET_UID, PROFILE, target);
        assertArrayEquals(source, expected);
        assertNotSame(source, expected);
        expected[15] = 99;
        assertEquals(5, source[15]);
        assertEquals(42, target[15]);
    }

    @Test
    public void fullModeRejectsMissingSourceAndTailFormatMismatchWithoutFallback() {
        rejects(() -> NfcCloneData.build(NfcCloneData.MODE_FULL, SOURCE_UID, PROFILE,
                null, TARGET_UID, PROFILE, block(TARGET_UID)));
        for (int offset : new int[] {5, 6, 7}) {
            byte[] invalid = block(SOURCE_UID);
            invalid[offset] ^= 1;
            rejects(() -> NfcCloneData.build(NfcCloneData.MODE_FULL, SOURCE_UID, PROFILE,
                    invalid, TARGET_UID, PROFILE, block(TARGET_UID)));
            byte[] invalidTarget = block(TARGET_UID);
            invalidTarget[offset] ^= 1;
            rejects(() -> NfcCloneData.build(NfcCloneData.MODE_FULL, SOURCE_UID, PROFILE,
                    block(SOURCE_UID), TARGET_UID, PROFILE, invalidTarget));
        }
    }

    @Test
    public void eitherModeRejectsBadTargetAndAlreadyReadInvalidSource() {
        for (String mode : new String[] {NfcCloneData.MODE_FULL, NfcCloneData.MODE_UID_ONLY}) {
            byte[] invalidTarget = block(TARGET_UID);
            invalidTarget[4] ^= 1;
            rejects(() -> NfcCloneData.build(mode, SOURCE_UID, PROFILE,
                    block(SOURCE_UID), TARGET_UID, PROFILE, invalidTarget));
            byte[] invalidSource = block(SOURCE_UID);
            invalidSource[4] ^= 1;
            rejects(() -> NfcCloneData.build(mode, SOURCE_UID, PROFILE,
                    invalidSource, TARGET_UID, PROFILE, block(TARGET_UID)));
            rejects(() -> NfcCloneData.build(mode, SOURCE_UID, PROFILE,
                    block(SOURCE_UID), TARGET_UID,
                    new NfcCloneData.Profile(0, 4096, 0x18, new byte[] {2, 0}), block(TARGET_UID)));
        }
        rejects(() -> NfcCloneData.build("automatic", SOURCE_UID, PROFILE,
                block(SOURCE_UID), TARGET_UID, PROFILE, block(TARGET_UID)));
        rejects(() -> NfcCloneData.build(null, SOURCE_UID, PROFILE,
                block(SOURCE_UID), TARGET_UID, PROFILE, block(TARGET_UID)));
    }

    @Test
    public void verificationRequiresEveryByteAndCompleteBlocks() {
        byte[] expected = block(SOURCE_UID);
        assertTrue(NfcCloneData.fullMatches(expected, expected.clone()));
        for (int i = 0; i < 16; i++) {
            byte[] mismatch = expected.clone();
            mismatch[i] ^= 1;
            assertFalse(NfcCloneData.fullMatches(expected, mismatch));
        }
        assertFalse(NfcCloneData.fullMatches(null, null));
        assertFalse(NfcCloneData.fullMatches(new byte[4], new byte[4]));
        assertFalse(NfcCloneData.fullMatches(expected, Arrays.copyOf(expected, 17)));
    }

    @Test
    public void structurallyValidDataNeverEnablesUnverifiedProductionWrites() {
        for (String mode : new String[] {NfcCloneData.MODE_FULL, NfcCloneData.MODE_UID_ONLY}) {
            assertFalse(NfcCloneData.NO_VERIFIED_HARDWARE.permits(PROFILE, PROFILE, mode,
                    block(SOURCE_UID), block(TARGET_UID)));
        }
    }
}
