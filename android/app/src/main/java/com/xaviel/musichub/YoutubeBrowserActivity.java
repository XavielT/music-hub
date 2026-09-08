package com.xaviel.musichub;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
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
 * <p><b>This does not currently work, and the log says why.</b> Measured on
 * 2026-09-08 against two client user-agents: the page's player response
 * carries 29 adaptive formats and <em>not one of them has a URL</em>
 * ("withUrl=0 sabrOnly=true"). YouTube's web clients have moved to SABR, where
 * media comes from one protobuf-driven endpoint that multiplexes audio and
 * video instead of per-format URLs.
 *
 * <p>Two approaches were tried and both are dead ends for the same reason.
 * Intercepting requests never fires: Android's WebView loads media outside the
 * path {@code shouldInterceptRequest} sits on, so the hook stayed silent while
 * a song was audibly playing. Reading the page's own player response does
 * fire, and finds formats with no URLs in them.
 *
 * <p>What works from this phone is yt-dlp — proven the same day, downloading
 * over the home connection through a tunnel. yt-dlp does not use the web
 * page; it speaks the client APIs that still return URLs. That is the shape
 * any working version of this has to take.
 */
public class YoutubeBrowserActivity extends Activity {

    private static final String TAG = "MusicHubYT";

    public static final String EXTRA_START_URL = "startUrl";
    public static final String RESULT_AUDIO_URL = "audioUrl";
    public static final String RESULT_TITLE = "title";
    public static final String RESULT_AUTHOR = "author";
    public static final String RESULT_VIDEO_ID = "videoId";
    public static final String RESULT_DURATION = "duration";
    public static final String RESULT_MIME = "mime";
    public static final String RESULT_USER_AGENT = "userAgent";

    private static final String DEFAULT_URL = "https://m.youtube.com/";

    // Cycled by a long-press on the status line, so a run can try each without
    // a rebuild.
    private static final String[] USER_AGENTS = {
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
            + "Chrome/122.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
            + "Version/17.4 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
            + "Version/17.4 Safari/605.1.15",
        "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) "
            + "Version/16.0 Safari/605.1.15",
    };

    private int uaIndex() {
        return getSharedPreferences("ytbrowser", MODE_PRIVATE).getInt("ua", 0);
    }

    private WebView web;
    private TextView status;
    private Button take;

    // Written from the WebView's network thread, read from the UI thread.
    private final AtomicReference<String> audioUrl = new AtomicReference<>(null);
    private final AtomicReference<String> audioMime = new AtomicReference<>(null);
    // What the page says it is playing, refreshed by the poller.
    private org.json.JSONObject details;
    private String currentId;
    private String loggedFor;
    private int probes;

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
        status.setOnLongClickListener(v -> {
            int next = (uaIndex() + 1) % USER_AGENTS.length;
            getSharedPreferences("ytbrowser", MODE_PRIVATE).edit().putInt("ua", next).apply();
            Toast.makeText(this, "Client " + next + " — reopen to apply.", Toast.LENGTH_SHORT).show();
            return true;
        });
        status.setTextSize(13);
        root.addView(status);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // The default WebView UA makes YouTube serve a cut-down page that
        // never starts a media request, so there is nothing to catch.
        // Which client YouTube thinks it is talking to decides whether the
        // page gets plain format URLs or SABR-only. Chosen by experiment, not
        // by taste: see the log line "player … withUrl=".
        settings.setUserAgentString(USER_AGENTS[uaIndex()]);
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
                    // Nothing here: YouTube is a single-page app, so this
                    // fires once for the whole session. The poller below is
                    // what notices a new video.
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

        Log.i(TAG, "browser opened, client index " + uaIndex());
        String start = getIntent().getStringExtra(EXTRA_START_URL);
        web.loadUrl(start != null && !start.isEmpty() ? start : DEFAULT_URL);
        web.postDelayed(this::pollPlayer, 2500);
    }

    /**
     * Asks the page what it is playing, every couple of seconds.
     *
     * Two things ruled out the tidier options. `onPageFinished` fires once,
     * because YouTube is a single-page app and changing video never reloads.
     * And `shouldInterceptRequest` never sees the media at all — Android's
     * WebView loads `<video>` content outside the path that hook sits on,
     * which is why the interception version armed nothing while the song was
     * audibly playing.
     *
     * So this reads what the page was handed. `ytInitialPlayerResponse` is the
     * same object the player itself works from, and it lists every format with
     * a URL already signed.
     */
    private void pollPlayer() {
        if (isFinishing() || isDestroyed()) return;
        web.evaluateJavascript(PLAYER_SCRIPT, value -> {
            String json = unwrap(value);
            if (probes < 6) {
                probes++;
                Log.i(TAG, "poll#" + probes + " " + (json == null ? "null" : json));
            }
            if (json != null && !json.equals("{}")) applyPlayer(json);
            web.postDelayed(this::pollPlayer, POLL_MS);
        });
    }

    private static final long POLL_MS = 1500;

    /**
     * Picks the best audio-only format with a usable URL.
     *
     * Sorted by bitrate: m4a (itag 140) over opus where both are offered,
     * because the library stores m4a and the phone plays it without a
     * conversion step.
     */
    private static final String PLAYER_SCRIPT =
        "(function(){try{"
            + "var p=window.ytInitialPlayerResponse||"
            + "(window.ytcfg&&ytcfg.data_&&ytcfg.data_.PLAYER_VARS)||{};"
            + "if(!p.streamingData){var mp=document.querySelector('#movie_player');"
            + "  if(mp&&mp.getPlayerResponse){try{p=mp.getPlayerResponse()||p;}catch(e){}}}"
            + "if(!p.streamingData){var v=document.querySelector('video');"
            + "  if(v&&v.src){return JSON.stringify({videoSrc:v.src.slice(0,120),"
            + "    id:'',note:'only a media element'});}}"
            + "var s=p.streamingData||{};var d=p.videoDetails||{};"
            + "var all=(s.adaptiveFormats||[]).concat(s.formats||[]);"
            + "var audio=all.filter(function(f){"
            + "  return f.url && (f.mimeType||'').indexOf('audio')===0;});"
            + "audio.sort(function(a,b){"
            + "  var am=(a.mimeType||'').indexOf('mp4')>-1?1:0;"
            + "  var bm=(b.mimeType||'').indexOf('mp4')>-1?1:0;"
            + "  if(am!==bm) return bm-am;"
            + "  return (b.bitrate||0)-(a.bitrate||0);});"
            + "var best=audio[0];"
            + "return JSON.stringify({id:d.videoId||'',title:d.title||'',"
            + "author:d.author||'',duration:parseInt(d.lengthSeconds||'0',10),"
            + "adaptive:(s.adaptiveFormats||[]).length,"
            + "withUrl:audio.length,"
            + "sabrOnly:!!s.serverAbrStreamingUrl&&audio.length===0,"
            + "itag:best?best.itag:0,mime:best?(best.mimeType||'').slice(0,25):'',"
            + "url:best?best.url:''});"
            + "}catch(e){return JSON.stringify({error:String(e)});}})()";

    /** evaluateJavascript returns a JSON *string literal*, quotes and all. */
    private String unwrap(String raw) {
        if (raw == null || "null".equals(raw)) return null;
        if (!raw.startsWith("\"")) return raw;
        try {
            return new org.json.JSONTokener(raw).nextValue().toString();
        } catch (Exception e) {
            return null;
        }
    }

    private void applyPlayer(String json) {
        try {
            org.json.JSONObject p = new org.json.JSONObject(json);
            String id = p.optString("id", "");
            if (id.isEmpty()) return;
            if (!id.equals(loggedFor)) {
                loggedFor = id;
                Log.i(TAG, "player " + id + " adaptive=" + p.optInt("adaptive")
                    + " withUrl=" + p.optInt("withUrl") + " sabrOnly=" + p.optBoolean("sabrOnly")
                    + " itag=" + p.optInt("itag") + " mime=" + p.optString("mime"));
            }
            String url = p.optString("url", "");
            if (url.isEmpty()) {
                if (!id.equals(currentId)) { currentId = id; disarmButton(); }
                return;
            }
            audioUrl.set(url);
            audioMime.set(p.optString("mime", "audio/mp4"));
            details = p;
            currentId = id;
            armButton();
        } catch (Exception err) {
            Log.w(TAG, "could not read the player response", err);
        }
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

    /** Everything the poller already gathered, handed back in one go. */
    private void finishWithCapture() {
        final String url = audioUrl.get();
        if (url == null) {
            Toast.makeText(this, "No audio yet — press play first.", Toast.LENGTH_SHORT).show();
            return;
        }
        take.setEnabled(false);
        take.setText("Adding…");

        Intent data = new Intent();
        data.putExtra(RESULT_AUDIO_URL, url);
        data.putExtra(RESULT_MIME, audioMime.get());
        data.putExtra(RESULT_USER_AGENT, web.getSettings().getUserAgentString());
        if (details != null) {
            data.putExtra(RESULT_VIDEO_ID, details.optString("id", ""));
            data.putExtra(RESULT_TITLE, details.optString("title", ""));
            data.putExtra(RESULT_AUTHOR, details.optString("author", ""));
            data.putExtra(RESULT_DURATION, details.optInt("duration", 0));
        }
        setResult(Activity.RESULT_OK, data);
        finish();
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
