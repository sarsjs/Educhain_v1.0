package com.educhain.app;

import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BleBackgroundAttendance")
public class BleBackgroundAttendancePlugin extends Plugin {
    @PluginMethod
    public void startStudentScan(PluginCall call) {
        String studentId = call.getString("studentId");
        if (studentId == null || studentId.trim().isEmpty()) {
            call.reject("Falta el identificador del alumno.");
            return;
        }

        Intent intent = new Intent(getContext(), BleAttendanceService.class);
        intent.setAction(BleAttendanceService.ACTION_START);
        intent.putExtra(BleAttendanceService.EXTRA_STUDENT_ID, studentId.trim());
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo iniciar la asistencia Bluetooth en segundo plano: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void stopStudentScan(PluginCall call) {
        Intent intent = new Intent(getContext(), BleAttendanceService.class);
        intent.setAction(BleAttendanceService.ACTION_STOP);
        try {
            getContext().startService(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No se pudo detener la asistencia Bluetooth: " + error.getMessage(), error);
        }
    }
}
