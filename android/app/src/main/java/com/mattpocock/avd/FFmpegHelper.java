package com.mattpocock.avd;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class FFmpegHelper {
    private static final String TAG = "FFmpegHelper";
    private Process currentProcess;

    public interface MergeCallback {
        void onSuccess(File outputFile);
        void onError(Exception e);
    }

    private String getFFmpegPath(Context context) {
        File nativeLibraryDir = new File(context.getApplicationInfo().nativeLibraryDir);
        File ffmpegBin = new File(nativeLibraryDir, "libffmpeg.so");
        if (ffmpegBin.exists()) {
            return ffmpegBin.getAbsolutePath();
        }
        return "ffmpeg"; // fallback
    }

    public void cancel() {
        if (currentProcess != null) {
            currentProcess.destroy();
            currentProcess = null;
        }
    }

    public void mergeVideoAndAudio(Context context, File videoFile, File audioFile, File outputFile, MergeCallback callback) {
        if (!videoFile.exists() || !audioFile.exists()) {
            callback.onError(new Exception("Video or audio file not found"));
            return;
        }

        List<String> cmd = new ArrayList<>();
        cmd.add(getFFmpegPath(context));
        cmd.addAll(Arrays.asList("-y", "-i", videoFile.getAbsolutePath(), "-i", audioFile.getAbsolutePath(), "-c", "copy", outputFile.getAbsolutePath()));

        Log.d(TAG, "Running FFmpeg command: " + String.join(" ", cmd));
        runProcess(cmd, outputFile, callback);
    }
    
    public void convertToMp3(Context context, File inputFile, File outputFile, MergeCallback callback) {
        if (!inputFile.exists()) {
            callback.onError(new Exception("Input file not found"));
            return;
        }

        List<String> cmd = new ArrayList<>();
        cmd.add(getFFmpegPath(context));
        cmd.addAll(Arrays.asList("-y", "-i", inputFile.getAbsolutePath(), "-q:a", "0", "-map", "a", outputFile.getAbsolutePath()));

        Log.d(TAG, "Running FFmpeg command: " + String.join(" ", cmd));
        runProcess(cmd, outputFile, callback);
    }

    private void runProcess(List<String> cmd, File outputFile, MergeCallback callback) {
        new Thread(() -> {
            try {
                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.redirectErrorStream(true);
                currentProcess = pb.start();

                BufferedReader reader = new BufferedReader(new InputStreamReader(currentProcess.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    Log.d(TAG, "FFmpeg: " + line);
                }

                int resultCode = currentProcess.waitFor();
                if (resultCode == 0) {
                    callback.onSuccess(outputFile);
                } else {
                    callback.onError(new Exception("FFmpeg failed with exit code: " + resultCode));
                }
            } catch (Exception e) {
                callback.onError(e);
            } finally {
                currentProcess = null;
            }
        }).start();
    }
}
