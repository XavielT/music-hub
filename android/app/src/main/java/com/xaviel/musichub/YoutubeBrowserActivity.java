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

import java.io.File;
import java.io.FileOutputStream;
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
    public static final String RESULT_CLIENT = "client";
    public static final String RESULT_PATH = "path";

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
    private File downloadFile;
    private FileOutputStream downloadOut;
    private String currentId;
    private String loggedFor;
    private volatile String harvestedPot;
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
        web.addJavascriptInterface(new Bridge(), "MusicHubBridge");
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
        web.evaluateJavascript(RESOLVE_SCRIPT, state -> web.evaluateJavascript(
            "window.__mhAudio", value -> {
                String json = unwrap(value);
                if (json != null && !"null".equals(json)) applyPlayer(json);
                web.postDelayed(this::pollPlayer, POLL_MS);
            }));
    }

    private static final long POLL_MS = 1500;

    /**
     * Resolves the playable audio URL for whatever the page is showing.
     *
     * Measured on 2026-09-08: the web page's own player response carries 25-29
     * formats and none with a URL — YouTube's web clients are SABR-only now.
     * The ANDROID and IOS clients still answer with plain signed URLs, and
     * asking for them *from inside the page* means the request goes out with
     * the site's own cookies, API key and origin, from the phone's connection.
     * That is the whole trick, and it is why this cannot live on a server.
     */
    private static final String RESOLVE_SCRIPT = "(function(){\n  var pr = window.ytInitialPlayerResponse || null;\n  var mp = document.querySelector('#movie_player');\n  if ((!pr || !pr.videoDetails) && mp && mp.getPlayerResponse) {\n    try { pr = mp.getPlayerResponse(); } catch (e) {}\n  }\n  var id = (pr && pr.videoDetails) ? pr.videoDetails.videoId : null;\n  if (!id) { var m = location.href.match(/[?&]v=([\\w-]{11})/); if (m) id = m[1]; }\n  if (!id) { window.__mhAudio = null; return 'no-video'; }\n  if (window.__mhAudioFor === id) return 'done';\n  if (window.__mhBusy === id) return 'busy';\n  window.__mhBusy = id;\n\n  var key = (window.ytcfg && ytcfg.get) ? ytcfg.get('INNERTUBE_API_KEY') : null;\n\n  // The web page itself is SABR-only now: 29 formats, no URLs. The ANDROID and\n  // IOS clients still answer with plain, signed URLs, and asking from inside\n  // the page means the request carries the site's own cookies and key.\n  var clients = [\n    {clientName:'ANDROID', clientVersion:'20.10.38', osName:'Android', osVersion:'14',\n     androidSdkVersion:34, hl:'en'},\n    {clientName:'IOS', clientVersion:'20.10.4', deviceMake:'Apple', deviceModel:'iPhone16,2',\n     osName:'iPhone', osVersion:'18.3.2.22D82', hl:'en'}\n  ];\n\n  function score(f){\n    var mime = f.mimeType || '';\n    // m4a first, whatever the bitrate: every device this library syncs to can\n    // play AAC, and opus in webm is a coin toss on Apple hardware.\n    var isM4a = mime.indexOf('audio/mp4') === 0 ? 1 : 0;\n    return isM4a * 1e9 + (f.bitrate || 0);\n  }\n\n  function attempt(i){\n    if (i >= clients.length) {\n      window.__mhAudio = JSON.stringify({id:id, error:'No client returned a playable audio URL.'});\n      window.__mhAudioFor = id; window.__mhBusy = null; return;\n    }\n    fetch('/youtubei/v1/player?key=' + key + '&prettyPrint=false', {\n      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'omit',\n      body: JSON.stringify({videoId:id, context:{client:clients[i]},\n        contentCheckOk:true, racyCheckOk:true})\n    }).then(function(r){ return r.json(); }).then(function(j){\n      var sd = j.streamingData || {};\n      var det = j.videoDetails || (pr && pr.videoDetails) || {};\n      var audio = (sd.adaptiveFormats || []).filter(function(f){\n        return f.url && (f.mimeType || '').indexOf('audio') === 0;\n      }).sort(function(a,b){ return score(b) - score(a); });\n      if (!audio.length) { attempt(i + 1); return; }\n      var best = audio[0];\n      window.__mhAudio = JSON.stringify({\n        id: id, url: best.url, itag: best.itag,\n        mime: (best.mimeType || '').split(';')[0],\n        size: parseInt(best.contentLength || '0', 10),\n        client: clients[i].clientName,\n        title: det.title || '', author: det.author || '',\n        duration: parseInt(det.lengthSeconds || '0', 10)\n      });\n      window.__mhAudioFor = id; window.__mhBusy = null;\n    }).catch(function(e){ attempt(i + 1); });\n  }\n  attempt(0);\n  return 'resolving';\n})()\n";

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

            String url = p.optString("url", "");
            if (url.isEmpty()) {
                if (!id.equals(currentId)) {
                    currentId = id;
                    disarmButton();
                    String why = p.optString("error", "");
                    if (!why.isEmpty()) {
                        Log.w(TAG, "no audio for " + id + ": " + why);
                        runOnUiThread(() -> status.setText(why));
                    }
                }
                return;
            }

            if (!id.equals(loggedFor)) {
                loggedFor = id;
                Log.i(TAG, "resolved " + id + " via " + p.optString("client")
                    + " itag=" + p.optInt("itag") + " " + p.optString("mime")
                    + " " + p.optLong("size") + " bytes");
            }
            // The resolved URL is metered to about a megabyte without a token.
            // With the player's own token appended it is served whole.
            if (harvestedPot != null && !url.contains("&pot=")) {
                url = url + "&pot=" + harvestedPot;
                Log.i(TAG, "appended harvested pot to the audio URL");
            }
            audioUrl.set(url);
            audioMime.set(p.optString("mime", "audio/mp4"));
            details = p;
            currentId = id;
            armButton();
        } catch (Exception err) {
            Log.w(TAG, "could not read the resolved audio", err);
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

    /**
     * Downloads inside the page, then hands back a file path.
     *
     * Not in Java, and this was measured rather than assumed: the very same
     * URL answers 206 to `fetch` from the page and 403 to HttpURLConnection,
     * whatever headers, user-agent or cookies it is given. googlevideo is
     * looking at more than the headers — the TLS handshake among it — and the
     * only client that looks like a browser here is the actual browser.
     *
     * A path rather than the bytes because an Intent goes through Binder,
     * which gives up around a megabyte, and a song is several.
     */
    private void finishWithCapture() {
        final String url = audioUrl.get();
        if (url == null) {
            Toast.makeText(this, "No audio yet — press play first.", Toast.LENGTH_SHORT).show();
            return;
        }
        take.setEnabled(false);
        take.setText("Downloading…");
        try {
            downloadFile = new File(getCacheDir(), "yt-capture.bin");
            if (downloadFile.exists() && !downloadFile.delete()) throw new Exception("stale file");
            downloadOut = new FileOutputStream(downloadFile);
        } catch (Exception err) {
            Log.e(TAG, "cannot open the capture file", err);
            Toast.makeText(this, "No room to save that.", Toast.LENGTH_SHORT).show();
            take.setEnabled(true);
            return;
        }
        web.evaluateJavascript(DOWNLOAD_JS, v -> Log.i(TAG, "download " + v));
    }

    private static final String DOWNLOAD_JS = "(function(){\n  // Three things learned by measuring, and the code is shaped by all three.\n  //\n  // 1. googlevideo answers 403 to \"give me the whole file\" and 206 to the same\n  //    bytes asked for as a range. The player only ever asks for ranges.\n  // 2. A URL is good for about a megabyte and then starts refusing, whatever\n  //    the range size \u2014 measured at exactly 1048576 with 256 KB chunks and at\n  //    327680 when the third chunk jumped to 1 MB.\n  // 3. Asking the player API again returns a fresh URL, and a fresh URL comes\n  //    with a fresh allowance. So a long song is a handful of URLs rather than\n  //    one, which is a fair trade against implementing proof-of-origin tokens.\n  var CHUNK = 262144;\n  var got = 0;\n  var url = null, total = 0;\n  var refreshes = 0;\n\n  function current(){\n    var a = window.__mhAudio ? JSON.parse(window.__mhAudio) : null;\n    if (!a || !a.url) return false;\n    url = a.url; total = a.size || 0;\n    return true;\n  }\n\n  function refresh(then){\n    if (refreshes > 40) { MusicHubBridge.failed('Gave up refreshing the link.'); return; }\n    refreshes++;\n    var oldUrl = url;\n    // Clearing both markers makes the resolver run again on its next poll.\n    // Waiting on the id would never finish: it is the same video, so the id\n    // does not change \u2014 the URL is the thing that does.\n    window.__mhAudioFor = null;\n    window.__mhBusy = null;\n    var waited = 0;\n    (function wait(){\n      var a = window.__mhAudio ? JSON.parse(window.__mhAudio) : null;\n      if (a && a.url && a.url !== oldUrl) {\n        url = a.url;\n        if (a.size) total = a.size;\n        then();\n        return;\n      }\n      waited += 250;\n      if (waited > 20000) { MusicHubBridge.failed('The link would not refresh.'); return; }\n      setTimeout(wait, 250);\n    })();\n  }\n\n  function step(){\n    if (total > 0 && got >= total) { MusicHubBridge.done(got); return; }\n    var end = total > 0 ? Math.min(got + CHUNK, total) - 1 : got + CHUNK - 1;\n    fetch(url, {headers: {'Range': 'bytes=' + got + '-' + end}}).then(function(r){\n      if (r.status === 403 && got > 0) { refresh(step); return null; }\n      if (r.status !== 206 && r.status !== 200) {\n        MusicHubBridge.failed('YouTube answered ' + r.status + ' at byte ' + got);\n        return null;\n      }\n      return r.arrayBuffer();\n    }).then(function(buf){\n      if (!buf) return;\n      var bytes = new Uint8Array(buf);\n      if (!bytes.length) { MusicHubBridge.done(got); return; }\n      var SLICE = 192 * 1024;\n      for (var i = 0; i < bytes.length; i += SLICE) {\n        var part = bytes.subarray(i, i + SLICE);\n        var bin = '';\n        for (var j = 0; j < part.length; j++) bin += String.fromCharCode(part[j]);\n        MusicHubBridge.chunk(btoa(bin));\n      }\n      got += bytes.length;\n      MusicHubBridge.progress(got, total);\n      if (total <= 0 && bytes.length < CHUNK) { MusicHubBridge.done(got); return; }\n      step();\n    }).catch(function(e){ MusicHubBridge.failed(String(e).slice(0, 120)); });\n  }\n\n  if (!current()) { MusicHubBridge.failed('Nothing resolved to download.'); return 'no-url'; }\n  step();\n  return 'started';\n})()\n";

    /** Called from the page as the bytes arrive. */
    private class Bridge {
        @android.webkit.JavascriptInterface
        public void chunk(String base64) {
            try {
                downloadOut.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT));
            } catch (Exception err) {
                failed("Could not save the audio.");
            }
        }

        @android.webkit.JavascriptInterface
        public void progress(long done, long total) {
            int percent = total > 0 ? (int) (done * 100 / total) : 0;
            runOnUiThread(() -> take.setText("Downloading… " + percent + "%"));
        }

        @android.webkit.JavascriptInterface
        public void done(long bytes) {
            runOnUiThread(() -> finishWithFile(bytes));
        }

        @android.webkit.JavascriptInterface
        public void failed(String why) {
            Log.w(TAG, "in-page download failed: " + why);
            runOnUiThread(() -> {
                closeQuietly();
                Toast.makeText(YoutubeBrowserActivity.this, why, Toast.LENGTH_LONG).show();
                take.setEnabled(true);
                take.setText("Add this song to Music Hub");
            });
        }
    }

    private void closeQuietly() {
        try { if (downloadOut != null) downloadOut.close(); } catch (Exception ignored) { }
        downloadOut = null;
    }

    private void finishWithFile(long bytes) {
        closeQuietly();
        if (bytes < 10_000) {
            Toast.makeText(this, "That came back empty.", Toast.LENGTH_SHORT).show();
            take.setEnabled(true);
            return;
        }
        Log.i(TAG, "downloaded " + bytes + " bytes in the page");
        Intent data = new Intent();
        data.putExtra(RESULT_PATH, downloadFile.getAbsolutePath());
        data.putExtra(RESULT_AUDIO_URL, audioUrl.get());
        data.putExtra(RESULT_MIME, audioMime.get());
        data.putExtra(RESULT_USER_AGENT, web.getSettings().getUserAgentString());
        if (details != null) {
            data.putExtra(RESULT_CLIENT, details.optString("client", ""));
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
