package com.capacitor.ffmpeg.kit;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.FFmpegSessionCompleteCallback;
import com.arthenica.ffmpegkit.LogCallback;
import com.arthenica.ffmpegkit.Statistics;
import com.arthenica.ffmpegkit.StatisticsCallback;

/**
 * Patched FFmpeg bridge for Audio and Video Tool.
 * Fixes the upstream plugin: resolves the promise on completion and reports
 * processed time (ms) so the UI can show a real percentage bar.
 */
@CapacitorPlugin(name = "Ffmpegkit")
public class FfmpegkitPlugin extends Plugin {

    @PluginMethod
    public void exec(PluginCall call) {
        String command = call.getString("command");
        String name = call.getString("name");
        if (command == null || command.trim().isEmpty()) {
            call.reject("Empty FFmpeg command");
            return;
        }
        final String cmdName = (name == null) ? "" : name;

        FFmpegKit.executeAsync(
            command,
            new FFmpegSessionCompleteCallback() {
                @Override
                public void apply(FFmpegSession session) {
                    long returnCode = (session.getReturnCode() == null) ? -1 : session.getReturnCode().getValue();
                    JSObject done = new JSObject();
                    done.put("name", cmdName);
                    done.put("returnCode", returnCode);
                    done.put("output", session.getOutput() == null ? "" : session.getOutput());
                    notifyListeners("complete", done);

                    JSObject result = new JSObject();
                    result.put("name", cmdName);
                    result.put("returnCode", returnCode);
                    result.put("output", done.getString("output"));
                    call.resolve(result);
                }
            },
            new LogCallback() {
                @Override
                public void apply(com.arthenica.ffmpegkit.Log log) {
                    JSObject ret = new JSObject();
                    ret.put("name", cmdName);
                    ret.put("log", log.getMessage());
                    notifyListeners("log", ret);
                }
            },
            new StatisticsCallback() {
                @Override
                public void apply(Statistics statistics) {
                    JSObject ret = new JSObject();
                    ret.put("name", cmdName);
                    ret.put("time", statistics.getTime());
                    ret.put("fps", statistics.getVideoFps());
                    ret.put("speed", statistics.getSpeed());
                    ret.put("sessionId", statistics.getSessionId());
                    notifyListeners("stream", ret);
                }
            }
        );
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FFmpegKit.cancel();
        call.resolve();
    }
}
