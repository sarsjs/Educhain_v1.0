'use client';

import * as React from 'react';
import { Bluetooth, BluetoothOff, Radio } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { startStudentBlePresence, stopStudentBlePresence } from '@/lib/ble-attendance';

const AUTO_ATTENDANCE_KEY = 'educhain:ble-auto-attendance:';

export function StudentBlePresence({ studentId }: { studentId: string }) {
  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [configured, setConfigured] = React.useState(false);
  const autoStartAttempted = React.useRef<string | null>(null);
  const { toast } = useToast();

  const start = React.useCallback(async (isAutomaticRetry = false) => {
    if (!studentId || starting) return;
    setStarting(true);
    try {
      await startStudentBlePresence(studentId);
      // Save the student's opt-in only after permissions and BLE startup succeed.
      window.localStorage.setItem(AUTO_ATTENDANCE_KEY + studentId, 'enabled');
      setConfigured(true);
      setActive(true);
      if (!isAutomaticRetry) {
        toast({
          title: 'Asistencia automática configurada',
          description: 'Listo. EduChain recordará esta elección e intentará activarse automáticamente cuando abras la app.',
        });
      }
    } catch (error) {
      console.error('No se pudo activar la asistencia BLE', error);
      setActive(false);
      if (!isAutomaticRetry) {
        toast({
          title: 'No se pudo activar Bluetooth',
          description: error instanceof Error ? error.message : 'Verifica Bluetooth y los permisos de EduChain.',
          variant: 'destructive',
        });
      }
    } finally {
      setStarting(false);
    }
  }, [studentId, starting, toast]);

  React.useEffect(() => {
    if (!studentId || autoStartAttempted.current === studentId) return;
    autoStartAttempted.current = studentId;

    const saved = window.localStorage.getItem(AUTO_ATTENDANCE_KEY + studentId) === 'enabled';
    setConfigured(saved);
    if (saved) {
      // Permissions are checked by the BLE service; Android is not prompted again
      // when Bluetooth permission is already granted.
      void start(true);
    }
  }, [studentId, start]);

  const stop = async () => {
    try {
      await stopStudentBlePresence();
      window.localStorage.removeItem(AUTO_ATTENDANCE_KEY + studentId);
      setConfigured(false);
      setActive(false);
      toast({ title: 'Asistencia automática pausada', description: 'Puedes volver a configurarla cuando quieras.' });
    } catch (error) {
      console.warn('BLE student stop', error);
      toast({ title: 'No se pudo pausar Bluetooth', description: 'Inténtalo de nuevo.', variant: 'destructive' });
    }
  };

  return (
    <Card className='border-primary/20 bg-primary/5'>
      <CardHeader>
        <div className='flex items-center justify-between gap-3'>
          <div>
            <CardTitle className='flex items-center gap-2 text-lg'>
              {active ? <Radio className='h-5 w-5 text-primary animate-pulse' /> : <Bluetooth className='h-5 w-5' />}
              Asistencia automática
            </CardTitle>
            <CardDescription>
              Configúrala una vez. Después EduChain recordará tu elección e intentará buscar el pase del profesor al abrir la app, sin códigos ni activación diaria.
            </CardDescription>
          </div>
          <Badge variant={active ? 'default' : 'secondary'}>
            {starting ? 'Conectando…' : active ? 'Activa' : configured ? 'Pendiente de conexión' : 'Sin configurar'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-2'>
        <Button onClick={() => void (active ? stop() : start(false))} disabled={starting}>
          {active
            ? <><BluetoothOff className='mr-2 h-4 w-4' />Pausar asistencia</>
            : <><Bluetooth className='mr-2 h-4 w-4' />{starting ? 'Activando…' : configured ? 'Reintentar conexión' : 'Configurar una sola vez'}</>}
        </Button>
        <p className='text-xs text-muted-foreground'>
          En Android, el servicio en segundo plano puede mostrar una notificación. El sistema puede detenerlo si fuerzas el cierre de EduChain o restringes su batería.
        </p>
      </CardContent>
    </Card>
  );
}
