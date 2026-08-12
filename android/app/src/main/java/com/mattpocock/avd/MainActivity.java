package com.mattpocock.avd;

import com.getcapacitor.BridgeActivity;

import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    public static String sharedText = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YoutubeDlPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(android.content.Intent intent) {
        if (android.content.Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            sharedText = intent.getStringExtra(android.content.Intent.EXTRA_TEXT);
        }
    }
}
