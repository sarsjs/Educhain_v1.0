package com.educhain.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelUuid;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;

public class BleAttendanceService extends Service {
    public static final String ACTION_START = "com.educhain.app.BLE_ATTENDANCE_START";
    public static final String ACTION_STOP = "com.educhain.app.BLE_ATTENDANCE_STOP";
    public static final String EXTRA_STUDENT_ID = "studentId";

    private static final String CHANNEL_ID = "educhain_ble_attendance";
    private static final int NOTIFICATION_ID = 2640;
    private static final String PREFS_NAME = "educhain_ble_attendance";
    private static final UUID SERVICE_UUID = UUID.fromString("7d3f1a20-7c2b-4f7f-9e13-2640d7c5a901");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("7d3f1a21-7c2b-4f7f-9e13-2640d7c5a901");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String studentId;
    private BluetoothLeScanner scanner;
    private BluetoothGatt connectedGatt;
    private boolean scanning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        studentId = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(EXTRA_STUDENT_ID, null);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(EXTRA_STUDENT_ID).apply();
            stopScanning();
            if (connectedGatt != null) {
                try { connectedGatt.disconnect(); connectedGatt.close(); } catch (Exception ignored) {}
                connectedGatt = null;
            }
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_START.equals(intent.getAction())) {
            String requestedStudentId = intent.getStringExtra(EXTRA_STUDENT_ID);
            if (requestedStudentId != null && !requestedStudentId.trim().isEmpty()) {
                studentId = requestedStudentId.trim();
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(EXTRA_STUDENT_ID, studentId).apply();
            }
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        startScanning();
        return START_STICKY;
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("EduChain · asistencia automática")
                .setContentText("Buscando el pase de lista del profesor cercano.")
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Asistencia automática", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantiene activa la detección Bluetooth de EduChain.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startScanning() {
        if (studentId == null || studentId.isEmpty() || scanning) return;
        if (!hasBluetoothPermissions()) {
            handler.postDelayed(this::startScanning, 5000);
            return;
        }
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            handler.postDelayed(this::startScanning, 5000);
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            handler.postDelayed(this::startScanning, 5000);
            return;
        }

        ScanFilter filter = new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID)).build();
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(Collections.singletonList(filter), settings, scanCallback);
            scanning = true;
        } catch (SecurityException | IllegalStateException error) {
            scanning = false;
            handler.postDelayed(this::startScanning, 5000);
        }
    }

    private void stopScanning() {
        if (scanner != null && scanning) {
            try { scanner.stopScan(scanCallback); } catch (SecurityException ignored) {}
        }
        scanning = false;
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (connectedGatt != null || result.getDevice() == null) return;
            stopScanning();
            BluetoothDevice device = result.getDevice();
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    connectedGatt = device.connectGatt(BleAttendanceService.this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
                } else {
                    connectedGatt = device.connectGatt(BleAttendanceService.this, false, gattCallback);
                }
            } catch (SecurityException error) {
                connectedGatt = null;
                handler.postDelayed(BleAttendanceService.this::startScanning, 2000);
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            scanning = false;
            handler.postDelayed(BleAttendanceService.this::startScanning, 3000);
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { gatt.discoverServices(); } catch (SecurityException error) { finishConnection(gatt); }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                finishConnection(gatt);
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) { finishConnection(gatt); return; }
            BluetoothGattService service = gatt.getService(SERVICE_UUID);
            BluetoothGattCharacteristic characteristic = service == null ? null : service.getCharacteristic(CHARACTERISTIC_UUID);
            if (characteristic == null) { finishConnection(gatt); return; }
            characteristic.setValue(studentId.getBytes(StandardCharsets.UTF_8));
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeCharacteristic(characteristic, studentId.getBytes(StandardCharsets.UTF_8), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                } else {
                    characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                    gatt.writeCharacteristic(characteristic);
                }
            } catch (SecurityException error) {
                finishConnection(gatt);
            }
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            finishConnection(gatt);
        }
    };

    private void finishConnection(BluetoothGatt gatt) {
        try { gatt.disconnect(); } catch (Exception ignored) {}
        try { gatt.close(); } catch (Exception ignored) {}
        if (connectedGatt == gatt) connectedGatt = null;
        handler.postDelayed(this::startScanning, 1200);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // START_STICKY allows Android to recreate this foreground service after task removal.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopScanning();
        if (connectedGatt != null) {
            try { connectedGatt.close(); } catch (Exception ignored) {}
            connectedGatt = null;
        }
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
