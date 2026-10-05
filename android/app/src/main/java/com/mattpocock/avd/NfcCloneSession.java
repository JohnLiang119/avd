package com.mattpocock.avd;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/** 原生複製操作。只有本類別保有來源快照及一次性的寫入權。 */
public final class NfcCloneSession implements AutoCloseable {
    public static final long WAIT_MILLIS = 30_000;
    public static final long IO_MILLIS = 5_000;

    /** Adapter 只能存取 block 0；探索資訊必須來自這一次 Tag。 */
    public interface Card {
        Object discoveryToken();
        byte[] uid();
        NfcCloneData.Profile profile();
        void connect() throws IOException;
        boolean authenticate(boolean keyB) throws IOException;
        byte[] readBlock0() throws IOException;
        void writeBlock0(byte[] expected) throws IOException;
        void close() throws IOException;
    }

    /** 只回報可觀察的原因，不由 IOException 推論卡片世代。 */
    public static final class CardException extends IOException {
        public final String code;
        public CardException(String code) { super(code); this.code = code; }
        public CardException(String code, Throwable cause) { super(code, cause); this.code = code; }
    }

    public interface Listener {
        void onSourceReady(SourceReady event);
        void onResult(Result event);
    }

    public static final class SourceReady {
        public final String requestId;
        public final String sourceUidHex;
        public final NfcCloneData.Profile profile;
        public final List<String> availableModes;
        public final String block0Hex;
        SourceReady(Operation op) {
            requestId = op.id;
            sourceUidHex = NfcCloneData.hex(op.sourceUid);
            profile = op.sourceProfile;
            block0Hex = op.sourceBlock == null ? null : NfcCloneData.hex(op.sourceBlock);
            availableModes = Collections.unmodifiableList(op.sourceBlock == null
                ? Collections.singletonList(NfcCloneData.MODE_UID_ONLY)
                : Arrays.asList(NfcCloneData.MODE_FULL, NfcCloneData.MODE_UID_ONLY));
        }
    }

    public static final class Result {
        public final String requestId;
        public final String status;
        public final String stage;
        public final String code;
        public final boolean writeAttempted;
        public final boolean canVerify;
        Result(Operation op, String status, String code, boolean canVerify) {
            requestId = op.id;
            this.status = status;
            stage = op.stage;
            this.code = code;
            writeAttempted = op.writeAttempted;
            this.canVerify = canVerify;
        }
    }

    interface Cancellation { void cancel(); }
    interface Scheduler { Cancellation schedule(Runnable task, long millis); }

    private enum State { AWAITING_SOURCE, READING_SOURCE, SOURCE_READY,
        AWAITING_TARGET, PROCESSING_TARGET, VERIFY_CHOICE, AWAITING_VERIFY, VERIFYING }

    private static final class Operation {
        final String id;
        final byte[] sourceUid;
        State state = State.AWAITING_SOURCE;
        String stage = "source";
        NfcCloneData.Profile sourceProfile;
        byte[] sourceBlock;
        byte[] expected;
        String mode;
        boolean writeAttempted;
        Card card;
        Object previousToken;
        long waitDeadline;
        long ioDeadline;
        long timerVersion;
        Cancellation waitTimer;
        Cancellation ioTimer;
        Operation(String id, byte[] sourceUid) { this.id = id; this.sourceUid = sourceUid; }
    }

    private static final class StaleOperation extends RuntimeException { }

    private final Object lock = new Object();
    private final Listener listener;
    private final BooleanSupplier canOperate;
    private final NfcCloneData.Policy policy;
    private final Executor worker;
    private final Executor closer;
    private final Scheduler scheduler;
    private final LongSupplier clock;
    private final ExecutorService ownedWorker;
    private final ExecutorService ownedCloser;
    private final ScheduledExecutorService ownedScheduler;
    private Operation current;
    private boolean closed;

    public NfcCloneSession(Listener listener, BooleanSupplier canOperate) {
        this(listener, canOperate, NfcCloneData.NO_VERIFIED_HARDWARE);
    }

    public NfcCloneSession(Listener listener, BooleanSupplier canOperate, NfcCloneData.Policy policy) {
        this.listener = Objects.requireNonNull(listener);
        this.canOperate = Objects.requireNonNull(canOperate);
        this.policy = Objects.requireNonNull(policy);
        ownedWorker = Executors.newSingleThreadExecutor(r -> daemon(r, "nfc-clone-io"));
        ownedCloser = Executors.newCachedThreadPool(r -> daemon(r, "nfc-clone-close"));
        ownedScheduler = Executors.newSingleThreadScheduledExecutor(r -> daemon(r, "nfc-clone-deadline"));
        worker = ownedWorker;
        closer = ownedCloser;
        scheduler = (task, millis) -> {
            ScheduledFuture<?> future = ownedScheduler.schedule(task, millis, TimeUnit.MILLISECONDS);
            return () -> future.cancel(false);
        };
        clock = () -> TimeUnit.NANOSECONDS.toMillis(System.nanoTime());
    }

    /** 測試可控制工作排程、關閉連線執行緒及單調時鐘，不需 Android runtime。 */
    NfcCloneSession(Listener listener, BooleanSupplier canOperate, NfcCloneData.Policy policy,
                    Executor worker, Executor closer, Scheduler scheduler, LongSupplier clock) {
        this.listener = listener;
        this.canOperate = canOperate;
        this.policy = policy;
        this.worker = worker;
        this.closer = closer;
        this.scheduler = scheduler;
        this.clock = clock;
        ownedWorker = null;
        ownedCloser = null;
        ownedScheduler = null;
    }

    private static Thread daemon(Runnable task, String name) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        return thread;
    }

    public void armSource(String requestId, String sourceUidHex) {
        if (requestId == null || requestId.trim().isEmpty() || requestId.length() > 128) {
            throw new IllegalArgumentException("invalid-request-id");
        }
        byte[] uid = NfcCloneData.parseUid(sourceUidHex);
        synchronized (lock) {
            if (closed || current != null || !canOperate.getAsBoolean()) {
                throw new IllegalStateException("clone-unavailable");
            }
            current = new Operation(requestId, uid);
            scheduleWaitLocked(current);
        }
    }

    public void armWrite(String requestId, String mode) {
        synchronized (lock) {
            Operation op = requireLocked(requestId);
            if (op.state != State.SOURCE_READY) throw new IllegalStateException("invalid-state");
            if (!NfcCloneData.MODE_UID_ONLY.equals(mode) && !NfcCloneData.MODE_FULL.equals(mode)) {
                throw new IllegalArgumentException("invalid-mode");
            }
            if (NfcCloneData.MODE_FULL.equals(mode) && op.sourceBlock == null) {
                throw new IllegalArgumentException("source-block-unavailable");
            }
            op.mode = mode;
            op.state = State.AWAITING_TARGET;
            op.stage = "target";
            scheduleWaitLocked(op);
        }
    }

    public void armVerify(String requestId) {
        synchronized (lock) {
            Operation op = requireLocked(requestId);
            if (op.state == State.SOURCE_READY && op.sourceBlock != null) {
                op.expected = op.sourceBlock.clone();
            } else if (op.state != State.VERIFY_CHOICE && op.state != State.AWAITING_VERIFY) {
                throw new IllegalStateException("invalid-state");
            }
            if (op.expected == null) throw new IllegalStateException("expected-block-unavailable");
            // 已待命的驗證不重設期限，避免重複 bridge 呼叫無限延長資料壽命。
            if (op.state == State.AWAITING_VERIFY) return;
            op.state = State.AWAITING_VERIFY;
            op.stage = "rediscovery";
            scheduleWaitLocked(op);
        }
    }

    public void disarm(String requestId) {
        synchronized (lock) {
            if (current != null && current.id.equals(requestId)) cancelLocked(current, "cancelled");
        }
    }

    public void cancel(String reason) {
        synchronized (lock) {
            if (current != null) cancelLocked(current, reason == null ? "cancelled" : reason);
        }
    }

    public boolean isActive() { synchronized (lock) { return current != null; } }

    /** 活動操作期間一律吃掉探索，避免目標進入一般讀卡歷史。 */
    public boolean onCard(Card card) {
        Objects.requireNonNull(card);
        synchronized (lock) {
            Operation op = current;
            if (op == null) return false;
            if (!ensureLiveLocked(op)) return true;
            State accepted = op.state;
            if (accepted != State.AWAITING_SOURCE && accepted != State.AWAITING_TARGET
                && accepted != State.AWAITING_VERIFY) return true;
            Object token = card.discoveryToken();
            if (token == null) {
                terminateLocked(op, "failed", "invalid-data");
                return true;
            }
            if (Objects.equals(token, op.previousToken)) return true;
            op.previousToken = token;
            op.card = card;
            cancelWaitLocked(op);
            op.state = accepted == State.AWAITING_SOURCE ? State.READING_SOURCE
                : accepted == State.AWAITING_TARGET ? State.PROCESSING_TARGET : State.VERIFYING;
            if (accepted != State.AWAITING_SOURCE) emitResultLocked(op, "processing", null, false);
            try {
                worker.execute(() -> process(op, card));
            } catch (RuntimeException rejected) {
                terminateLocked(op, op.writeAttempted ? "unknown" : "failed", "io-failed");
            }
            return true;
        }
    }

    private void process(Operation op, Card card) {
        try {
            check(op);
            synchronized (lock) {
                check(op);
                op.ioDeadline = clock.getAsLong() + IO_MILLIS;
                op.ioTimer = scheduler.schedule(() -> ioTimeout(op, card), IO_MILLIS);
            }
            if (op.state == State.READING_SOURCE) readSource(op, card);
            else if (op.state == State.PROCESSING_TARGET) processTarget(op, card);
            else if (op.state == State.VERIFYING) verify(op, card);
        } catch (StaleOperation ignored) {
            // 取消後或舊世代工作不得再發出事件。
        } catch (Exception error) {
            synchronized (lock) {
                if (current == op) {
                    if (op.writeAttempted && ("write".equals(op.stage) || "readback".equals(op.stage))) {
                        awaitVerificationLocked(op, code(error), false);
                    } else {
                        terminateLocked(op, op.writeAttempted ? "unknown" : "failed", code(error));
                    }
                }
            }
        } finally {
            safeClose(card);
            synchronized (lock) {
                if (op.card == card) op.card = null;
                cancelIoLocked(op);
            }
        }
    }

    private void readSource(Operation op, Card card) throws IOException {
        byte[] uid = card.uid();
        if (!Arrays.equals(op.sourceUid, uid)) throw new CardException("source-mismatch");
        NfcCloneData.Profile profile = card.profile();
        requireProfile(profile);
        check(op);
        card.connect();
        check(op);
        byte[] block = null;
        if (authenticate(op, card)) {
            try {
                check(op);
                block = card.readBlock0();
                check(op);
            } catch (CardException error) {
                if (!"access-denied".equals(error.code)) throw error;
                check(op);
            }
        }
        if (block != null) {
            NfcCloneData.validateBlock0(uid, block);
            NfcCloneData.validateBlockProfile(profile, block);
        }
        synchronized (lock) {
            check(op);
            op.sourceProfile = profile;
            op.sourceBlock = block == null ? null : block.clone();
            op.state = State.SOURCE_READY;
            cancelIoLocked(op);
            scheduleWaitLocked(op);
            try { listener.onSourceReady(new SourceReady(op)); } catch (RuntimeException ignored) { }
        }
    }

    private void processTarget(Operation op, Card card) throws IOException {
        byte[] uid = card.uid();
        NfcCloneData.Profile profile = card.profile();
        requireProfile(profile);
        requireCompatible(op.sourceProfile, profile);
        if (uid == null || uid.length != 4) throw new CardException("unsupported-profile");
        if (Arrays.equals(op.sourceUid, uid)) {
            synchronized (lock) {
                check(op);
                if (op.sourceBlock == null) terminateLocked(op, "failed", "same-uid");
                else {
                    op.expected = op.sourceBlock.clone();
                    awaitVerificationLocked(op, "same-uid", true);
                }
            }
            return;
        }
        check(op);
        card.connect();
        if (!authenticate(op, card)) throw new CardException("authentication-failed");
        check(op);
        byte[] targetBlock = card.readBlock0();
        check(op);
        byte[] expected = NfcCloneData.build(op.mode, op.sourceUid, op.sourceProfile,
            op.sourceBlock, uid, profile, targetBlock);
        if (!policy.permits(op.sourceProfile, profile, op.mode,
                op.sourceBlock == null ? null : op.sourceBlock.clone(), targetBlock.clone())) {
            throw new CardException("unsupported-profile");
        }
        synchronized (lock) {
            check(op);
            op.expected = expected.clone();
            op.stage = "write";
            // 取消與此短鎖競爭。此界線後一律保守視為可能已修改卡片。
            op.writeAttempted = true;
            emitResultLocked(op, "processing", null, false);
        }
        // 不持鎖等待卡片 I/O；一次性權利已消耗，絕不重試 writeBlock0。
        check(op);
        card.writeBlock0(expected.clone());
        synchronized (lock) {
            check(op);
            op.stage = "readback";
        }
        check(op);
        byte[] actual = card.readBlock0();
        synchronized (lock) {
            check(op);
            if (!NfcCloneData.fullMatches(expected, actual)) {
                terminateLocked(op, "failed", "verification-mismatch");
            } else {
                awaitVerificationLocked(op, null, false);
            }
        }
    }

    private void verify(Operation op, Card card) throws IOException {
        byte[] uid = card.uid();
        if (!Arrays.equals(op.sourceUid, uid)) throw new CardException("verification-mismatch");
        requireProfile(card.profile());
        requireCompatible(op.sourceProfile, card.profile());
        check(op);
        card.connect();
        if (!authenticate(op, card)) throw new CardException("authentication-failed");
        check(op);
        byte[] actual = card.readBlock0();
        synchronized (lock) {
            check(op);
            if (!NfcCloneData.fullMatches(op.expected, actual)) {
                terminateLocked(op, "failed", "verification-mismatch");
            } else {
                terminateLocked(op, op.writeAttempted ? "verified" : "matched-without-write", null);
            }
        }
    }

    private boolean authenticate(Operation op, Card card) throws IOException {
        check(op);
        boolean accepted = card.authenticate(false);
        check(op);
        if (accepted) return true;
        boolean keyB = card.authenticate(true);
        check(op);
        return keyB;
    }

    private static void requireProfile(NfcCloneData.Profile profile) throws CardException {
        try { NfcCloneData.requireSupported(profile); }
        catch (IllegalArgumentException error) { throw new CardException("unsupported-profile", error); }
    }

    private static void requireCompatible(NfcCloneData.Profile source, NfcCloneData.Profile target)
        throws CardException {
        try { NfcCloneData.requireCompatible(source, target); }
        catch (IllegalArgumentException error) { throw new CardException("unsupported-profile", error); }
    }

    private Operation requireLocked(String id) {
        if (current == null || !current.id.equals(id)) throw new IllegalStateException("stale-request");
        if (!ensureLiveLocked(current)) throw new IllegalStateException("clone-unavailable");
        return current;
    }

    private void check(Operation op) {
        synchronized (lock) {
            if (current != op || !ensureLiveLocked(op)) throw new StaleOperation();
        }
    }

    private boolean ensureLiveLocked(Operation op) {
        if (!canOperate.getAsBoolean()) {
            cancelLocked(op, "unavailable");
            return false;
        }
        long now = clock.getAsLong();
        if ((op.waitDeadline != 0 && now >= op.waitDeadline)
            || (op.ioDeadline != 0 && now >= op.ioDeadline)) {
            terminateLocked(op, op.writeAttempted ? "unknown" : "failed", "timeout");
            return false;
        }
        return true;
    }

    private void awaitVerificationLocked(Operation op, String code, boolean explicit) {
        op.state = explicit ? State.VERIFY_CHOICE : State.AWAITING_VERIFY;
        op.stage = "rediscovery";
        cancelIoLocked(op);
        scheduleWaitLocked(op);
        emitResultLocked(op, "verification-required", code, true);
    }

    private void scheduleWaitLocked(Operation op) {
        cancelWaitLocked(op);
        op.waitDeadline = clock.getAsLong() + WAIT_MILLIS;
        long version = ++op.timerVersion;
        op.waitTimer = scheduler.schedule(() -> {
            synchronized (lock) {
                if (current == op && op.timerVersion == version) {
                    terminateLocked(op, op.writeAttempted ? "unknown" : "failed", "timeout");
                }
            }
        }, WAIT_MILLIS);
    }

    private void ioTimeout(Operation op, Card card) {
        synchronized (lock) {
            if (current == op && op.card == card && op.ioDeadline != 0) {
                terminateLocked(op, op.writeAttempted ? "unknown" : "failed", "timeout");
            }
        }
    }

    private void cancelLocked(Operation op, String reason) {
        terminateLocked(op, op.writeAttempted ? "unknown" : "cancelled", reason);
    }

    private void terminateLocked(Operation op, String status, String code) {
        if (current != op) return;
        Result result = new Result(op, status, code, false);
        current = null;
        cancelWaitLocked(op);
        cancelIoLocked(op);
        Card card = op.card;
        op.card = null;
        op.sourceBlock = null;
        op.expected = null;
        op.sourceProfile = null;
        op.mode = null;
        op.previousToken = null;
        if (card != null) {
            try { closer.execute(() -> safeClose(card)); } catch (RuntimeException ignored) { }
        }
        try { listener.onResult(result); } catch (RuntimeException ignored) { }
    }

    private void emitResultLocked(Operation op, String status, String code, boolean canVerify) {
        if (current != op) return;
        try { listener.onResult(new Result(op, status, code, canVerify)); }
        catch (RuntimeException ignored) { }
    }

    private static void cancelWaitLocked(Operation op) {
        op.timerVersion++;
        op.waitDeadline = 0;
        if (op.waitTimer != null) op.waitTimer.cancel();
        op.waitTimer = null;
    }

    private static void cancelIoLocked(Operation op) {
        op.ioDeadline = 0;
        if (op.ioTimer != null) op.ioTimer.cancel();
        op.ioTimer = null;
    }

    private static String code(Exception error) {
        if (error instanceof CardException) return ((CardException) error).code;
        return error instanceof IllegalArgumentException ? "invalid-data" : "io-failed";
    }

    private static void safeClose(Card card) {
        try { card.close(); } catch (Exception ignored) { }
    }

    @Override public void close() {
        synchronized (lock) {
            if (closed) return;
            closed = true;
            if (current != null) cancelLocked(current, "destroyed");
        }
        if (ownedWorker != null) ownedWorker.shutdownNow();
        if (ownedScheduler != null) ownedScheduler.shutdownNow();
        if (ownedCloser != null) ownedCloser.shutdown();
    }
}
