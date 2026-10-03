'use client';

import * as React from 'react';
import {
  startStudentBleScan,
  startTeacherBleAttendance,
  stopStudentBleScan,
  stopTeacherBleAttendance,
  type BleDetection,
  type BleAttendanceSession,
} from '@/lib/ble-attendance';

export default function BleAttendanceTestPage() {
  const [role, setRole] = React.useState<'teacher' | 'student' | null>(null);
  const [session, setSession] = React.useState<BleAttendanceSession | null>(null);
  const [detections, setDetections] = React.useState<BleDetection[]>([]);
  const [error, setError] = React.useState('');
  const [running, setRunning] = React.useState(false);

  const startTeacher = async () => {
    setError('');
    try {
      const next = await startTeacherBleAttendance(60_000);
      setRole('teacher');
      setSession(next);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar BLE.');
    }
  };

  const startStudent = async () => {
    setError('');
    setDetections([]);
    try {
      await startStudentBleScan((detection) => {
        setDetections((current) => {
          const next = [detection, ...current.filter((item) => item.deviceId !== detection.deviceId)];
          return next.slice(0, 20);
        });
      });
      setRole('student');
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar el escaneo BLE.');
    }
  };

  const stop = async () => {
    try {
      if (role === 'teacher') await stopTeacherBleAttendance();
      if (role === 'student') await stopStudentBleScan();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo detener BLE.');
    } finally {
      setRunning(false);
      setSession(null);
    }
  };

  React.useEffect(() => () => {
    void (async () => {
      if (role === 'teacher') await stopTeacherBleAttendance().catch(() => undefined);
      if (role === 'student') await stopStudentBleScan().catch(() => undefined);
    })();
  }, [role]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-400">EduChain · laboratorio</p>
          <h1 className="mt-2 text-3xl font-black">Pase de lista BLE</h1>
          <p className="mt-2 text-sm text-slate-400">
            Prototipo técnico. Todavía no registra asistencias reales ni toca Firestore.
          </p>
        </div>

        {!running ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={startTeacher}
              className="rounded-2xl bg-emerald-500 p-6 text-left font-bold text-slate-950"
            >
              <span className="block text-lg">👨‍🏫 Modo profesor</span>
              <span className="mt-2 block text-sm font-normal opacity-80">
                Anuncia una sesión BLE temporal.
              </span>
            </button>
            <button
              onClick={startStudent}
              className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-left font-bold"
            >
              <span className="block text-lg">📱 Modo alumno</span>
              <span className="mt-2 block text-sm font-normal text-slate-400">
                Escanea sesiones EduChain cercanas.
              </span>
            </button>
          </div>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">Modo activo</p>
                <p className="text-xl font-bold">{role === 'teacher' ? 'Profesor' : 'Alumno'}</p>
              </div>
              <button onClick={stop} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold">
                Detener
              </button>
            </div>

            {role === 'teacher' && session && (
              <div className="mt-6 space-y-2 rounded-xl bg-slate-950 p-4">
                <p className="text-sm text-slate-400">Sesión temporal detectada por este dispositivo:</p>
                <code className="block break-all text-xs text-emerald-400">{session.sessionId}</code>
                <p className="text-xs text-slate-500">
                  Esta cadena no identifica al profesor ni contiene datos personales.
                </p>
              </div>
            )}

            {role === 'student' && (
              <div className="mt-6">
                <p className="mb-3 text-sm text-slate-400">
                  Dispositivos que anuncian EduChain cerca del teléfono:
                </p>
                {detections.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">
                    Esperando señal…
                  </p>
                ) : (
                  <div className="space-y-2">
                    {detections.map((detection) => (
                      <div key={detection.deviceId} className="rounded-xl bg-slate-950 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{detection.name || 'EduChain Pase'}</span>
                          <span className="text-sm text-emerald-400">{detection.rssi} dBm</span>
                        </div>
                        <code className="mt-1 block break-all text-[10px] text-slate-600">
                          {detection.deviceId}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200/80">
          <strong>Prueba:</strong> usa dos teléfonos con la app móvil de EduChain. En uno selecciona profesor y en el otro alumno.
          Después prueba dentro del mismo salón, con una pared de por medio y a diferentes distancias. El objetivo es medir
          detección y RSSI antes de convertir esto en asistencia automática.
        </div>
      </div>
    </main>
  );
}
