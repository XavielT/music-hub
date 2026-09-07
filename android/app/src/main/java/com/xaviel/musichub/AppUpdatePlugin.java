package com.xaviel.musichub;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

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
 * In-app updates for the sideloaded Android build.
 *
 * Music Hub is not on Play Store, so there is nothing to update it for us:
 * this downloads the APK attached to the latest GitHub release and opens the
 * system package installer with it. The install itself is always the user's
 * decision — Android shows its own confirmation, and rejects any APK that is
 * not signed with the same key as the installed one.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_NAME = "music-hub-update.apk";
    private static final int MAX_REDIRECTS = 5;

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName);
            result.put(
                "versionCode",
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode
            );
            result.put("packageName", info.packageName);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read the app version: " + e.getMessage());
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isInstallAllowed());
        call.resolve(result);
    }

    /**
     * Sends the user to the one system screen that can grant "install unknown
     * apps" for this app, and reports back whether they turned it on.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (isInstallAllowed()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "installSettingsResult");
    }

    @ActivityCallback
    private void installSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject payload = new JSObject();
        payload.put("granted", isInstallAllowed());
        call.resolve(payload);
    }

    /**
     * Streams the APK into the app's cache directory. Runs on its own thread —
     * a release APK is several MB and must never touch the UI thread.
     */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A download url is required.");
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            File target = new File(getContext().getCacheDir(), APK_NAME);
            try {
                String current = url;
                int redirects = 0;
                while (true) {
                    connection = (HttpURLConnection) new URL(current).openConnection();
                    connection.setConnectTimeout(30000);
                    connection.setReadTimeout(60000);
                    connection.setInstanceFollowRedirects(false);
                    int status = connection.getResponseCode();
                    // GitHub answers the download URL with a redirect to its
                    // asset host; HttpURLConnection will not follow that on
                    // its own once the scheme or host changes.
                    boolean redirected =
                        status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == HttpURLConnection.HTTP_SEE_OTHER ||
                        status == 307 ||
                        status == 308;
                    if (!redirected) {
                        if (status != HttpURLConnection.HTTP_OK) {
                            call.reject("The download failed (HTTP " + status + ").");
                            return;
                        }
                        break;
                    }
                    if (++redirects > MAX_REDIRECTS) {
                        call.reject("The download was redirected too many times.");
                        return;
                    }
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    if (location == null) {
                        call.reject("The download was redirected without a target.");
                        return;
                    }
                    current = new URL(new URL(current), location).toString();
                }

                long total = connection.getContentLength();
                // A half-written APK from an earlier attempt must not survive.
                if (target.exists() && !target.delete()) {
                    call.reject("Could not clear the previous download.");
                    return;
                }

                byte[] buffer = new byte[16 * 1024];
                long loaded = 0;
                long lastReported = -1;
                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(target)) {
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        loaded += read;
                        long percent = total > 0 ? (loaded * 100 / total) : -1;
                        // One event per whole percent: the WebView bridge is
                        // not free, and 16 kB chunks would flood it.
                        if (percent != lastReported) {
                            lastReported = percent;
                            JSObject progress = new JSObject();
                            progress.put("loaded", loaded);
                            progress.put("total", total > 0 ? total : 0);
                            progress.put("percent", percent);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                    out.flush();
                }

                if (total > 0 && loaded != total) {
                    target.delete();
                    call.reject("The download ended early — check the connection and try again.");
                    return;
                }

                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                call.resolve(result);
            } catch (Exception e) {
                target.delete();
                call.reject("The download failed: " + e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        File apk = path != null && !path.isEmpty()
            ? new File(path)
            : new File(getContext().getCacheDir(), APK_NAME);
        if (!apk.exists()) {
            call.reject("The downloaded update is no longer there. Download it again.");
            return;
        }
        if (!isInstallAllowed()) {
            call.reject("This app is not allowed to install updates yet.");
            return;
        }

        try {
            // A file:// uri is illegal since Android 7; the installer gets a
            // content:// uri from the FileProvider already declared in the
            // manifest, plus one-shot read permission on it.
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = getActivity();
            if (activity != null) activity.startActivity(intent);
            else getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("The installer could not be opened: " + e.getMessage());
        }
    }

    private boolean isInstallAllowed() {
        // Before Android 8 this was a single device-wide setting, and the
        // installer prompts for it itself.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }
}
