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
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No URL to download.");
            return;
        }
        String userAgent = call.getString("userAgent", "");

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String current = url;
                for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
                    connection = (HttpURLConnection) new URL(current).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(30000);
                    connection.setReadTimeout(60000);
                    if (userAgent != null && !userAgent.isEmpty()) {
                        connection.setRequestProperty("User-Agent", userAgent);
                    }
                    // googlevideo wants to know who is asking; without this it
                    // answers 403 to a request it otherwise just served.
                    connection.setRequestProperty("Referer", "https://m.youtube.com/");
                    connection.setRequestProperty("Origin", "https://m.youtube.com");
                    String cookies = android.webkit.CookieManager.getInstance().getCookie(current);
                    if (cookies != null) connection.setRequestProperty("Cookie", cookies);

                    int code = connection.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == 307 || code == 308) {
                        String next = connection.getHeaderField("Location");
                        connection.disconnect();
                        if (next == null) throw new Exception("Redirect with no target");
                        current = new URL(new URL(current), next).toString();
                        continue;
                    }
                    if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
                        throw new Exception("YouTube answered " + code);
                    }
                    break;
                }

                long expected = connection.getContentLengthLong();
                if (expected > MAX_BYTES) throw new Exception("That file is too large to add.");

                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                long total = 0;
                try (InputStream in = connection.getInputStream()) {
                    int read;
                    while ((read = in.read(chunk)) != -1) {
                        total += read;
                        if (total > MAX_BYTES) throw new Exception("That file is too large to add.");
                        buffer.write(chunk, 0, read);
                        if (expected > 0) {
                            JSObject progress = new JSObject();
                            progress.put("loaded", total);
                            progress.put("total", expected);
                            progress.put("percent", (int) (total * 100 / expected));
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }

                if (total < 10_000) throw new Exception("The download came back empty.");

                JSObject done = new JSObject();
                done.put("base64", android.util.Base64.encodeToString(
                    buffer.toByteArray(), android.util.Base64.NO_WRAP));
                done.put("bytes", total);
                call.resolve(done);
            } catch (Exception err) {
                call.reject(err.getMessage() == null ? "Download failed." : err.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }
}
