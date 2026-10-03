'use client';

export const EDUCHAIN_BLE_SERVICE_UUID = '7d3f1a20-7c2b-4f7f-9e13-2640d7c5a901';
export const EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID = '7d3f1a21-7c2b-4f7f-9e13-2640d7c5a901';

export type BleDetection = {
  deviceId: string;
  name: string | null;
  rssi: number;
  detectedAt: number;
};

export type BleAttendanceSession = {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
};

let scanListener: { remove: () => Promise<void> } | null = null;

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function textToBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

async function getBle() {
  if (typeof window === 'undefined') {
    throw new Error('BLE solo está disponible en la aplicación móvil.');
  }

  const module = await import('@capgo/capacitor-bluetooth-low-energy');
  return module.BluetoothLowEnergy;
}

export async function startTeacherBleAttendance(
  durationMs = 60_000,
): Promise<BleAttendanceSession> {
  const ble = await getBle();
  const startedAt = Date.now();
  const sessionId = randomSessionId();

  await ble.initialize({ mode: 'peripheral' });
  await ble.requestPermissions();

  await ble.addGattService({
    service: EDUCHAIN_BLE_SERVICE_UUID,
    characteristics: [
      {
        uuid: EDUCHAIN_BLE_SESSION_CHARACTERISTIC_UUID,
        properties: {
          broadcast: false,
          read: true,
          write: false,
          writeWithoutResponse: false,
          notify: false,
          indicate: false,
          authenticatedSignedWrites: false,
          extendedProperties: false,
        },
        value: textToBytes(sessionId),
      },
    ],
  });

  await ble.startAdvertising({
    name: 'EduChain Pase',
    services: [EDUCHAIN_BLE_SERVICE_UUID],
    includeName: true,
    includeTxPowerLevel: true,
  });

  return {
    sessionId,
    startedAt,
    expiresAt: startedAt + durationMs,
  };
}

export async function stopTeacherBleAttendance(): Promise<void> {
  const ble = await getBle();
  await ble.stopAdvertising();
  await ble.removeGattService({ service: EDUCHAIN_BLE_SERVICE_UUID });
}

export async function startStudentBleScan(
  onDetection: (detection: BleDetection) => void,
): Promise<void> {
  const ble = await getBle();

  await ble.initialize({ mode: 'central' });
  await ble.requestPermissions();

  if (scanListener) {
    await scanListener.remove();
  }

  scanListener = await ble.addListener('deviceScanned', ({ device }) => {
    onDetection({
      deviceId: device.deviceId,
      name: device.name,
      rssi: device.rssi,
      detectedAt: Date.now(),
    });
  });

  await ble.startScan({
    services: [EDUCHAIN_BLE_SERVICE_UUID],
    allowDuplicates: true,
    timeout: 0,
  });
}

export async function stopStudentBleScan(): Promise<void> {
  const ble = await getBle();
  await ble.stopScan();

  if (scanListener) {
    await scanListener.remove();
    scanListener = null;
  }
}
