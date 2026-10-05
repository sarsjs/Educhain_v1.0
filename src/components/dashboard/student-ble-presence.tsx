'use client';

import * as React from 'react';
import { Bluetooth, BluetoothOff, Radio } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { startStudentBlePresence, stopStudentBlePresence } from '@/lib/ble-attendance';

export function StudentBlePresence({ studentId }: { studentId: string }) {
  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const { toast } = useToast();
  const stop = React.useCallback(async () => { try { await stopStudentBlePresence(); } catch (error) { console.warn('BLE student stop', error); } finally { setActive(false); } }, []);
  React.useEffect(() => () => { void stop(); }, [stop]);
  const start = async () => {
    setStarting(true);
    try { await startStudentBlePresence(studentId); setActive(true); toast({ title: 'Asistencia automática activa', description: 'EduChain buscará el pase de lista del profesor cercano.' }); }
    catch (error) { console.error(error); toast({ title: 'No se pudo activar Bluetooth', description: error instanceof Error ? error.message : 'Verifica Bluetooth y permisos del dispositivo.', variant: 'destructive' }); }
    finally { setStarting(false); }
  };
  return <Card className='border-primary/20 bg-primary/5'>
    <CardHeader><div className='flex items-center justify-between gap-3'><div>
      <CardTitle className='flex items-center gap-2 text-lg'>{active ? <Radio className='h-5 w-5 text-primary animate-pulse' /> : <Bluetooth className='h-5 w-5' />}Asistencia automática</CardTitle>
      <CardDescription>No necesitas introducir códigos. Cuando tu profesor active el pase, EduChain enviará tu identificación de alumno por Bluetooth.</CardDescription>
    </div><Badge variant={active ? 'default' : 'secondary'}>{active ? 'Buscando pase' : 'Inactivo'}</Badge></div></CardHeader>
    <CardContent><Button onClick={() => void (active ? stop() : start())} disabled={starting}>{active ? <><BluetoothOff className='mr-2 h-4 w-4' />Desactivar</> : <><Bluetooth className='mr-2 h-4 w-4' />Activar asistencia automática</>}</Button></CardContent>
  </Card>;
}