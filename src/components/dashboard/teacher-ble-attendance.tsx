'use client';

import * as React from 'react';
import { Bluetooth, BluetoothOff, Radio, UserCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { Student } from '@/lib/types';
import { startTeacherBleAttendance, stopTeacherBleAttendance, type BleStudentDetection } from '@/lib/ble-attendance';

type Props = { students: Student[]; onDetectedStudent: (studentId: string) => void; };

export function TeacherBleAttendance({ students, onDetectedStudent }: Props) {
  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [detections, setDetections] = React.useState<Record<string, BleStudentDetection>>({});
  const { toast } = useToast();
  const stop = React.useCallback(async () => { try { await stopTeacherBleAttendance(); } catch (error) { console.warn('BLE stop', error); } finally { setActive(false); } }, []);
  React.useEffect(() => () => { void stop(); }, [stop]);
  const start = async () => {
    setStarting(true); setDetections({});
    try {
      await startTeacherBleAttendance((detection) => {
        const student = students.find(s => s.id === detection.studentId);
        if (!student) return;
        setDetections(prev => ({ ...prev, [student.id]: detection }));
        onDetectedStudent(student.id);
      }, 60_000);
      setActive(true);
      toast({ title: 'Pase automático activo', description: 'EduChain está esperando los dispositivos de los alumnos.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'No se pudo iniciar Bluetooth', description: error instanceof Error ? error.message : 'Verifica Bluetooth y permisos del dispositivo.', variant: 'destructive' });
    } finally { setStarting(false); }
  };
  const detectedStudents = students.filter(s => detections[s.id]);
  return (
    <Card className='border-primary/20 bg-primary/5'>
      <CardHeader><div className='flex items-center justify-between gap-3'><div>
        <CardTitle className='flex items-center gap-2 text-lg'>{active ? <Radio className='h-5 w-5 text-primary animate-pulse' /> : <Bluetooth className='h-5 w-5' />}Pase automático por Bluetooth</CardTitle>
        <CardDescription>Detecta dispositivos cercanos de alumnos de este grupo. La detección es evidencia; el profesor conserva la decisión final.</CardDescription>
      </div><Badge variant={active ? 'default' : 'secondary'}>{active ? 'Activo' : 'Inactivo'}</Badge></div></CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex flex-col sm:flex-row gap-3'>
          {!active ? <Button onClick={start} disabled={starting} className='w-full sm:w-auto'><Bluetooth className='mr-2 h-4 w-4' />{starting ? 'Iniciando...' : 'Iniciar pase automático'}</Button> : <Button onClick={() => void stop()} variant='outline' className='w-full sm:w-auto'><BluetoothOff className='mr-2 h-4 w-4' />Detener pase automático</Button>}
          <div className='flex items-center text-xs text-muted-foreground'>{detectedStudents.length} de {students.length} alumnos detectados</div>
        </div>
        {active && detectedStudents.length > 0 && <div className='rounded-xl border bg-background p-3 space-y-2'><p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Detectados</p>{detectedStudents.map(student => { const detection = detections[student.id]; return <div key={student.id} className='flex items-center justify-between gap-3 rounded-lg border p-2'><div className='flex items-center gap-2 min-w-0'><UserCheck className='h-4 w-4 text-green-600 shrink-0' /><span className='text-sm font-medium truncate'>{student.name}</span></div><span className='text-xs text-muted-foreground shrink-0'>RSSI {detection.rssi === -999 ? 'N/D' : detection.rssi + ' dBm'}</span></div>; })}</div>}
        {active && detectedStudents.length === 0 && <p className='text-xs text-muted-foreground'>Acércate con un teléfono de alumno que tenga EduChain abierto y el Bluetooth activado para probar la detección.</p>}
      </CardContent>
    </Card>
  );
}