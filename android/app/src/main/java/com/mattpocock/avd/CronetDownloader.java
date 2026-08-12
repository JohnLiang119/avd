package com.mattpocock.avd;

import android.content.Context;
import android.util.Log;
import org.chromium.net.CronetEngine;
import org.chromium.net.UrlRequest;
import org.chromium.net.UrlResponseInfo;
import org.chromium.net.CronetException;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.WritableByteChannel;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class CronetDownloader {
    private static final String TAG = "CronetDownloader";
    private static CronetEngine cronetEngine;
    private final Executor executor = Executors.newSingleThreadExecutor();
    private UrlRequest currentRequest;
    
    public interface DownloadCallback {
        void onProgress(int percent, String speedStr);
        void onSuccess(File downloadedFile);
        void onError(Exception e);
    }

    public static synchronized void init(Context context) {
        if (cronetEngine == null) {
            CronetEngine.Builder builder = new CronetEngine.Builder(context);
            cronetEngine = builder.build();
        }
    }

    public void cancel() {
        if (currentRequest != null) {
            currentRequest.cancel();
            currentRequest = null;
        }
    }

    public void download(String url, Map<String, String> headers, File destFile, DownloadCallback callback) {
        if (cronetEngine == null) {
            callback.onError(new IllegalStateException("CronetEngine not initialized"));
            return;
        }

        UrlRequest.Callback requestCallback = new UrlRequest.Callback() {
            private WritableByteChannel channel;
            private FileOutputStream fos;
            private long totalBytes = -1;
            private long downloadedBytes = 0;
            private int lastPercent = -1;
            private long startTime = 0;
            private long lastUpdateTime = 0;

            @Override
            public void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String newLocationUrl) {
                request.followRedirect();
            }

            @Override
            public void onResponseStarted(UrlRequest request, UrlResponseInfo info) {
                int httpStatusCode = info.getHttpStatusCode();
                if (httpStatusCode >= 400) {
                    request.cancel();
                    callback.onError(new Exception("HTTP Error: " + httpStatusCode));
                    return;
                }

                Map<String, java.util.List<String>> responseHeaders = info.getAllHeaders();
                if (responseHeaders.containsKey("Content-Length")) {
                    try {
                        totalBytes = Long.parseLong(responseHeaders.get("Content-Length").get(0));
                    } catch (Exception e) {
                        Log.w(TAG, "Failed to parse Content-Length", e);
                    }
                }

                try {
                    startTime = System.currentTimeMillis();
                    fos = new FileOutputStream(destFile);
                    channel = Channels.newChannel(fos);
                    request.read(ByteBuffer.allocateDirect(1024 * 512)); // 512KB buffer
                } catch (Exception e) {
                    request.cancel();
                    callback.onError(e);
                }
            }

            @Override
            public void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer byteBuffer) {
                byteBuffer.flip();
                try {
                    channel.write(byteBuffer);
                    downloadedBytes += byteBuffer.limit();
                    
                    if (totalBytes > 0) {
                        int percent = (int) ((downloadedBytes * 100) / totalBytes);
                        long now = System.currentTimeMillis();
                        if (percent != lastPercent || now - lastUpdateTime > 500) {
                            lastPercent = percent;
                            lastUpdateTime = now;
                            long diff = now - startTime;
                            String speedStr = "";
                            if (diff > 0) {
                                long speedBps = (downloadedBytes * 1000) / diff;
                                if (speedBps > 1024 * 1024) {
                                    speedStr = String.format("%.1f MB/s", speedBps / (1024.0 * 1024.0));
                                } else if (speedBps > 1024) {
                                    speedStr = String.format("%.1f KB/s", speedBps / 1024.0);
                                } else {
                                    speedStr = speedBps + " B/s";
                                }
                            }
                            callback.onProgress(percent, speedStr);
                        }
                    }
                    
                    byteBuffer.clear();
                    request.read(byteBuffer);
                } catch (Exception e) {
                    request.cancel();
                    closeQuietly();
                    callback.onError(e);
                }
            }

            @Override
            public void onSucceeded(UrlRequest request, UrlResponseInfo info) {
                closeQuietly();
                currentRequest = null;
                callback.onSuccess(destFile);
            }

            @Override
            public void onFailed(UrlRequest request, UrlResponseInfo info, CronetException error) {
                closeQuietly();
                currentRequest = null;
                callback.onError(error);
            }

            @Override
            public void onCanceled(UrlRequest request, UrlResponseInfo info) {
                closeQuietly();
                currentRequest = null;
                callback.onError(new Exception("Download canceled"));
            }

            private void closeQuietly() {
                try {
                    if (channel != null) channel.close();
                    if (fos != null) fos.close();
                } catch (Exception e) {
                    Log.w(TAG, "Error closing stream", e);
                }
            }
        };

        UrlRequest.Builder requestBuilder = cronetEngine.newUrlRequestBuilder(url, requestCallback, executor);
        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                requestBuilder.addHeader(entry.getKey(), entry.getValue());
            }
        }
        
        currentRequest = requestBuilder.build();
        currentRequest.start();
    }
}
