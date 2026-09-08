package com.xaviel.musichub;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins are not discovered automatically — they have to be
        // registered before the bridge starts.
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(YoutubeBrowserPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
