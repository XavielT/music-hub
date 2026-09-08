package com.xaviel.musichub;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import android.util.Log;

/**
 * The bridge to {@link YoutubeBrowserActivity}, plus the download itself.
 *
 * The download runs here rather than in the WebView because googlevideo URLs
 * are bound to the client that asked for them: same connection, same
 * user-agent, same cookies. Handing the URL to the Angular layer to fetch
 * would drop all three and get a 403.
 */
@CapacitorPlugin(name = "YoutubeBrowser")
public class YoutubeBrowserPlugin extends Plugin {

    private static final String TAG = "MusicHubYT";

    private static final int MAX_REDIRECTS = 5;
    // A song is a few megabytes; anything past this is not one, and the
    // device should not be filled by a mistyped tap.
    private static final long MAX_BYTES = 100L * 1024 * 1024;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(getContext(), YoutubeBrowserActivity.class);
        String startUrl = call.getString("url");
        if (startUrl != null) intent.putExtra(YoutubeBrowserActivity.EXTRA_START_URL, startUrl);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Intent data = result.getData();
        JSObject picked = new JSObject();
        picked.put("cancelled", false);
        picked.put("audioUrl", data.getStringExtra(YoutubeBrowserActivity.RESULT_AUDIO_URL));
        picked.put("mime", data.getStringExtra(YoutubeBrowserActivity.RESULT_MIME));
        picked.put("userAgent", data.getStringExtra(YoutubeBrowserActivity.RESULT_USER_AGENT));
        picked.put("client", data.getStringExtra(YoutubeBrowserActivity.RESULT_CLIENT));
        picked.put("path", data.getStringExtra(YoutubeBrowserActivity.RESULT_PATH));
        picked.put("videoId", data.getStringExtra(YoutubeBrowserActivity.RESULT_VIDEO_ID));
        picked.put("title", data.getStringExtra(YoutubeBrowserActivity.RESULT_TITLE));
        picked.put("author", data.getStringExtra(YoutubeBrowserActivity.RESULT_AUTHOR));
        picked.put("duration", data.getIntExtra(YoutubeBrowserActivity.RESULT_DURATION, 0));
        call.resolve(picked);
    }

    /**
     * Fetches the captured stream and hands back base64.
     *
     * Base64 rather than a file path because the library stores audio as a
     * blob in IndexedDB, and the web layer cannot read an arbitrary file off
     * the device anyway. It costs a third in size over the wire between native
     * and the WebView, which for a five-megabyte song is a fair trade against
     * inventing a second storage path.
     */
    /**
     * Reads the file the page downloaded and hands it over as base64.
     *
     * The fetch itself happens in the WebView — measured: the same googlevideo
     * URL answers 206 to the page and 403 to HttpURLConnection whatever
     * headers it is given, because more than headers is being inspected. So
     * this no longer downloads anything; it carries what the browser got.
     */
    @PluginMethod
    public void readCapture(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Nothing was captured.");
            return;
        }
        new Thread(() -> {
            File file = new File(path);
            try {
                long size = file.length();
                if (size < 10_000) throw new Exception("The capture is empty.");
                if (size > MAX_BYTES) throw new Exception("That file is too large to add.");
                byte[] bytes = new byte[(int) size];
                try (InputStream in = new java.io.FileInputStream(file)) {
                    int off = 0, read;
                    while (off < bytes.length
                        && (read = in.read(bytes, off, bytes.length - off)) != -1) {
                        off += read;
                    }
                }
                JSObject done = new JSObject();
                done.put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                done.put("bytes", size);
                call.resolve(done);
            } catch (Exception err) {
                Log.e(TAG, "reading the capture failed", err);
                call.reject(err.getMessage() == null ? "Could not read the capture." : err.getMessage());
            } finally {
                if (!file.delete()) Log.w(TAG, "could not remove " + path);
            }
        }).start();
    }

}
