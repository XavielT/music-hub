package com.xaviel.musichub;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.concurrent.atomic.AtomicReference;

/**
 * YouTube, in a real browser, on the user's own connection.
 *
 * Every attempt to pull audio out of YouTube's API from inside this app has
 * failed, and the API is not the thing that works — a browser is. YouTube
 * serves a phone on a home connection perfectly happily; what it refuses is a
 * datacenter address and a client pretending to be something it is not. So
 * this is not a client pretending: it is the mobile site, in a WebView, with
 * the user browsing it.
 *
 * The download URL is never constructed or deciphered here. When the page
 * plays a track it fetches the audio itself, from googlevideo.com, with a
 * fully-signed URL — {@link #shouldInterceptRequest} watches those go past and
 * keeps the audio one. That sidesteps signature descrambling, PO tokens and
 * cookie files in one move, because the page already did all of it.
 */
public class YoutubeBrowserActivity extends Activity {

    public static final String EXTRA_START_URL = "startUrl";
    public static final String RESULT_AUDIO_URL = "audioUrl";
    public static final String RESULT_TITLE = "title";
    public static final String RESULT_AUTHOR = "author";
    public static final String RESULT_VIDEO_ID = "videoId";
    public static final String RESULT_DURATION = "duration";
    public static final String RESULT_MIME = "mime";
    public static final String RESULT_USER_AGENT = "userAgent";

    private static final String DEFAULT_URL = "https://m.youtube.com/";

    private WebView web;
    private TextView status;
    private Button take;

    // Written from the WebView's network thread, read from the UI thread.
    private final AtomicReference<String> audioUrl = new AtomicReference<>(null);
    private final AtomicReference<String> audioMime = new AtomicReference<>(null);

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        status = new TextView(this);
        status.setText("Find a song and press play. The button lights up once the audio starts.");
        status.setTextColor(Color.WHITE);
        status.setPadding(28, 28, 28, 20);
        status.setTextSize(13);
        root.addView(status);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // The default WebView UA makes YouTube serve a cut-down page that
        // never starts a media request, so there is nothing to catch.
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
                + "Chrome/122.0.0.0 Mobile Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isAudioStream(url)) {
                    // Returning null lets the request continue untouched — the
                    // page keeps playing, and we simply noted where it went.
                    audioUrl.set(stripRange(url));
                    audioMime.set(url.getQueryParameter("mime"));
                    runOnUiThread(() -> armButton());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                // Keep the user inside YouTube; anything else (an ad, a link in
                // a description) would otherwise leave them stranded in here.
                return host == null || !host.endsWith("youtube.com");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // A new video means the previously captured stream is stale.
                if (url != null && url.contains("/watch")) {
                    audioUrl.set(null);
                    disarmButton();
                }
            }
        });

        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(web, webParams);

        FrameLayout bar = new FrameLayout(this);
        bar.setPadding(24, 16, 24, 28);
        take = new Button(this);
        take.setAllCaps(false);
        take.setText("Waiting for the audio to start…");
        take.setEnabled(false);
        take.setOnClickListener(v -> finishWithCapture());
        FrameLayout.LayoutParams buttonParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        bar.addView(take, buttonParams);
        root.addView(bar);

        setContentView(root);

        String start = getIntent().getStringExtra(EXTRA_START_URL);
        web.loadUrl(start != null && !start.isEmpty() ? start : DEFAULT_URL);
    }

    /**
     * An adaptive audio stream, as opposed to the video half or a thumbnail.
     *
     * YouTube serves audio and video as separate googlevideo requests; the
     * audio one says so in `mime`. Some responses omit it, in which case the
     * itag is the fallback — the 139/140/141/25x family is audio.
     */
    private boolean isAudioStream(Uri url) {
        String host = url.getHost();
        if (host == null || !host.contains("googlevideo.com")) return false;
        if (url.getPath() == null || !url.getPath().contains("videoplayback")) return false;

        String mime = url.getQueryParameter("mime");
        if (mime != null) return mime.startsWith("audio");

        String itag = url.getQueryParameter("itag");
        if (itag == null) return false;
        switch (itag) {
            case "139": case "140": case "141":
            case "249": case "250": case "251":
            case "233": case "234":
                return true;
            default:
                return false;
        }
    }

    /**
     * The same URL without the byte range the player asked for.
     *
     * The page streams in chunks, so every captured URL carries a `range` of a
     * few hundred kilobytes. Dropping it asks for the whole track instead,
     * which is the one change made to what the page produced.
     */
    private String stripRange(Uri url) {
        Uri.Builder rebuilt = url.buildUpon().clearQuery();
        for (String name : url.getQueryParameterNames()) {
            if ("range".equals(name) || "rn".equals(name) || "rbuf".equals(name)) continue;
            for (String value : url.getQueryParameters(name)) {
                rebuilt.appendQueryParameter(name, value);
            }
        }
        return rebuilt.build().toString();
    }

    private void armButton() {
        if (take.isEnabled()) return;
        take.setEnabled(true);
        take.setText("Add this song to Music Hub");
        status.setText("Got it. Press the button to add this song.");
    }

    private void disarmButton() {
        take.setEnabled(false);
        take.setText("Waiting for the audio to start…");
        status.setText("Press play so the audio starts, then the button below.");
    }

    /** Asks the page what it is playing, then returns everything at once. */
    private void finishWithCapture() {
        final String url = audioUrl.get();
        if (url == null) {
            Toast.makeText(this, "No audio captured yet — press play first.", Toast.LENGTH_SHORT).show();
            return;
        }
        take.setEnabled(false);
        take.setText("Adding…");

        // videoDetails is what the page itself was handed, so the title and
        // artist match what the user is looking at rather than a second guess.
        String script =
            "(function(){try{var d=(window.ytInitialPlayerResponse||{}).videoDetails||{};"
                + "return JSON.stringify({id:d.videoId||'',title:d.title||document.title||'',"
                + "author:d.author||'',duration:parseInt(d.lengthSeconds||'0',10)});"
                + "}catch(e){return '{}';}})()";

        web.evaluateJavascript(script, value -> {
            Intent data = new Intent();
            data.putExtra(RESULT_AUDIO_URL, url);
            data.putExtra(RESULT_MIME, audioMime.get());
            data.putExtra(RESULT_USER_AGENT, web.getSettings().getUserAgentString());
            applyDetails(data, value);
            setResult(Activity.RESULT_OK, data);
            finish();
        });
    }

    /** evaluateJavascript hands back a JSON *string literal*, quotes and all. */
    private void applyDetails(Intent data, String raw) {
        try {
            String json = raw;
            if (json == null || "null".equals(json)) return;
            if (json.startsWith("\"")) {
                json = json.substring(1, json.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
            }
            org.json.JSONObject details = new org.json.JSONObject(json);
            data.putExtra(RESULT_VIDEO_ID, details.optString("id", ""));
            data.putExtra(RESULT_TITLE, details.optString("title", ""));
            data.putExtra(RESULT_AUTHOR, details.optString("author", ""));
            data.putExtra(RESULT_DURATION, details.optInt("duration", 0));
        } catch (Exception ignored) {
            // Metadata is a nicety; the audio is the point. The app falls back
            // to asking the user for a title.
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        setResult(Activity.RESULT_CANCELED);
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebViewClient(new WebViewClient());
            web.destroy();
        }
        super.onDestroy();
    }
}
