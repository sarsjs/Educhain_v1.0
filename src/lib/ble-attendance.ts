// src/lib/ble-attendance.ts
'use client';

import { Capacitor, registerPlugin } from '@capacitor/core';

const BleBackgroundAttendance = registerPlugin<{
  startStudentScan(options: { studentId: string }): Promise<{ started: boolean }>;
  stopStudentScan(): Promise<void>;
}>('BleBackgroundAttendance');

export const EDUCHAIN_BLE_SERVICE_UUID = '7d3f1a20-7c2b-4f7f-9e13-2640d7c5a901';
export const EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID = '7d3f1a21-7c2b-4f7f-9e13-2640d7c5a901';

export type BleStudentDetection = {
  deviceId: string;
  studentId: string;
  rssi: number;
  detectedAt: number;
};

export type BleAttendanceSession = {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
};

let centralConnectedListener: { remove: () => Promise<void> } | null = null;
let writeRequestListener: { remove: () => Promise<void> } | null = null;
let scanListener: { remove: () => Promise<void> } | null = null;
let studentBle: Awaited<ReturnType<typeof getBle>> | null = null;

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function textToBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

function bytesToText(value: number[]): string {
  return new TextDecoder().decode(new Uint8Array(value));
}

async function getBle() {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) {
    throw new Error('El pase automático BLE requiere la aplicación móvil de EduChain.');
  }
  const module = await import('@capgo/capacitor-bluetooth-low-energy');
  return module.BluetoothLowEnergy;
}

/** Check first so an already-approved permission is not requested on every app launch. */
async function ensureBlePermissions(ble: Awaited<ReturnType<typeof getBle>>): Promise<void> {
  let permissions = await ble.checkPermissions();
  if (permissions.bluetooth !== 'granted' || permissions.location !== 'granted') {
    // Android 11 and earlier need location permission for BLE scanning. On Android 12+
    // the plugin requests Bluetooth permissions; an optional location status may remain prompt.
    permissions = await ble.requestPermissions();
  }
  if (permissions.bluetooth !== 'granted') {
    throw new Error('Necesitas permitir Bluetooth para activar la asistencia automática. Revisa los permisos de EduChain en Ajustes.');
  }
}


export async function startTeacherBleAttendance(
  onStudentDetected: (detection: BleStudentDetection) => void,
  durationMs = 60_000,
): Promise<BleAttendanceSession> {
  const ble = await getBle();
  const startedAt = Date.now();
  const sessionId = randomSessionId();

  await ble.initialize({ mode: 'peripheral' });
  await ensureBlePermissions(ble);

  await ble.addGattService({
    service: EDUCHAIN_BLE_SERVICE_UUID,
    characteristics: [{
      uuid: EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID,
      properties: {
        broadcast: false,
        read: true,
        write: true,
        writeWithoutResponse: false,
        notify: false,
        indicate: false,
        authenticatedSignedWrites: false,
        extendedProperties: false,
      },
      value: textToBytes(sessionId),
    }],
  });

  centralConnectedListener = await ble.addListener('centralConnected', async ({ deviceId }) => {
    try {
      const { rssi } = await ble.readRssi({ deviceId });
      console.debug('EduChain BLE central conectado', deviceId, rssi);
    } catch (error) {
      console.warn('No se pudo leer RSSI BLE', error);
    }
  });

  writeRequestListener = await ble.addListener('gattCharacteristicWriteRequest', async (event) => {
    if (
      event.service.toLowerCase() !== EDUCHAIN_BLE_SERVICE_UUID.toLowerCase() ||
      event.characteristic.toLowerCase() !== EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID.toLowerCase()
    ) return;

    const studentId = bytesToText(event.value).trim();
    if (!studentId) return;

    let rssi = -999;
    try {
      const result = await ble.readRssi({ deviceId: event.deviceId });
      rssi = result.rssi;
    } catch {
      // RSSI puede no estar disponible en todos los dispositivos.
    }

    onStudentDetected({
      deviceId: event.deviceId,
      studentId,
      rssi,
      detectedAt: Date.now(),
    });
  });

  await ble.startAdvertising({
    name: 'EduChain Pase',
    services: [EDUCHAIN_BLE_SERVICE_UUID],
    includeName: true,
    includeTxPowerLevel: true,
  });

  return { sessionId, startedAt, expiresAt: startedAt + durationMs };
}

export async function stopTeacherBleAttendance(): Promise<void> {
  const ble = await getBle();
  await ble.stopAdvertising();
  await ble.removeGattService({ service: EDUCHAIN_BLE_SERVICE_UUID });
  if (centralConnectedListener) {
    await centralConnectedListener.remove();
    centralConnectedListener = null;
  }
  if (writeRequestListener) {
    await writeRequestListener.remove();
    writeRequestListener = null;
  }
}

export async function startStudentBlePresence(studentId: string): Promise<void> {
  const ble = await getBle();

  await ble.initialize({ mode: 'central' });
  await ensureBlePermissions(ble);

  if (Capacitor.getPlatform() === 'android') {
    // Native foreground service keeps scanning even when Android backgrounds the WebView.
    await BleBackgroundAttendance.startStudentScan({ studentId });
    studentBle = ble;
    return;
  }

  if (scanListener) await scanListener.remove();

  scanListener = await ble.addListener('deviceScanned', async ({ device }) => {
    if (!device.serviceUuids?.some(
      uuid => uuid.toLowerCase() === EDUCHAIN_BLE_SERVICE_UUID.toLowerCase()
    )) return;

    try {
      await ble.stopScan();
      await ble.connect({ deviceId: device.deviceId });
      await ble.discoverServices({ deviceId: device.deviceId });
      await ble.writeCharacteristic({
        deviceId: device.deviceId,
        service: EDUCHAIN_BLE_SERVICE_UUID,
        characteristic: EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID,
        value: textToBytes(studentId),
        type: 'withResponse',
      });
      try { await ble.disconnect({ deviceId: device.deviceId }); } catch (disconnectError) { console.warn('No se pudo cerrar la conexión BLE', disconnectError); }
      // Resume scanning so later classes can be detected without another student action.
      await ble.startScan({
        services: [EDUCHAIN_BLE_SERVICE_UUID],
        allowDuplicates: false,
        timeout: 0,
      });
    } catch (error) {
      console.warn('No se pudo enviar la presencia BLE', error);
      try {
        await ble.startScan({
          services: [EDUCHAIN_BLE_SERVICE_UUID],
          allowDuplicates: false,
          timeout: 0,
        });
      } catch (scanError) {
        console.warn('No se pudo reanudar la búsqueda BLE', scanError);
      }
    }
  });

  await ble.startScan({
    services: [EDUCHAIN_BLE_SERVICE_UUID],
    allowDuplicates: false,
    timeout: 0,
  });
  studentBle = ble;
}

export async function stopStudentBlePresence(): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await BleBackgroundAttendance.stopStudentScan();
    if (scanListener) {
      await scanListener.remove();
      scanListener = null;
    }
    studentBle = null;
    return;
  }

  const ble = studentBle ?? await getBle();
  await ble.stopScan();

  if (scanListener) {
    await scanListener.remove();
    scanListener = null;
  }
  studentBle = null;
}
