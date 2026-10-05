'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Clock3, UserCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { fetchAttendanceByStudent, fetchAttendanceAppealsForStudent, createAttendanceAppeal, fetchAttendanceAppealsForTeacher, fetchAttendanceAppealsForCounselor, confirmAttendanceAppeal, fetchSubjects, fetchUsers, fetchGroups } from '@/lib/firebase/data';
import type { Attendance, AttendanceAppeal, Subject, User, Group } from '@/lib/types';

type Mode = 'student' | 'teacher' | 'counselor';

export function AttendanceAppealsPanel({ mode, userId }: { mode: Mode; userId?: string }) {
  const { profile } = useAuth();
  const id = userId || profile?.id;
  const [appeals, setAppeals] = React.useState<AttendanceAppeal[]>([]);
  const [absences, setAbsences] = React.useState<Attendance[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState<Record<string, string>>({});
  const { toast } = useToast();

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      if (mode === 'student') {
        const [attendance, currentAppeals, subjectList] = await Promise.all([
          fetchAttendanceByStudent(id),
          fetchAttendanceAppealsForStudent(id),
          fetchSubjects()
        ]);
        setAbsences(attendance.filter(a => !a.present).slice(0, 30));
        setAppeals(currentAppeals);
        setSubjects(subjectList);
      } else {
        const [currentAppeals, subjectList, userList, groupList] = await Promise.all([
          mode === 'teacher' ? fetchAttendanceAppealsForTeacher(id) : fetchAttendanceAppealsForCounselor(id),
          fetchSubjects(),
          fetchUsers(),
          fetchGroups()
        ]);
        setAppeals(currentAppeals);
        setSubjects(subjectList);
        setUsers(userList);
        setGroups(groupList);
      }
    } finally {
      setLoading(false);
    }
  }, [id, mode]);

  React.useEffect(() => { load(); }, [load]);

  const subjectName = (subjectId: string) => subjects.find(s => s.id === subjectId)?.name || 'Materia';
  const studentName = (studentId: string) => users.find(u => u.id === studentId)?.name || 'Alumno';
  const groupName = (groupId: string) => groups.find(g => g.id === groupId)?.name || 'Grupo';
  const appealByAttendance = new Map(appeals.map(a => [a.attendanceId, a]));

  const submit = async (attendance: Attendance) => {
    try {
      await createAttendanceAppeal(id!, attendance.id, message[attendance.id]);
      await load();
      toast({ title: 'Apelación enviada', description: 'Quedó en revisión por profesor y orientador.' });
    } catch (error) {
      toast({ title: 'No se pudo apelar', description: error instanceof Error ? error.message : 'Intenta nuevamente.', variant: 'destructive' });
    }
  };

  const confirm = async (appeal: AttendanceAppeal) => {
    try {
      await confirmAttendanceAppeal(appeal.id, mode === 'teacher' ? 'profesor' : 'orientador', id!);
      await load();
      toast({ title: 'Confirmación registrada', description: 'La revisión quedó actualizada.' });
    } catch (error) {
      toast({ title: 'No se pudo confirmar', description: error instanceof Error ? error.message : 'Intenta nuevamente.', variant: 'destructive' });
    }
  };

  if (loading) return <Card><CardContent className="p-5 text-sm text-muted-foreground">Cargando revisiones de asistencia...</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />{mode === 'student' ? 'Mis faltas y apelaciones' : 'Apelaciones de asistencia'}</CardTitle>
        <CardDescription>{mode === 'student' ? 'Si estabas presente y la tecnología falló, puedes apelar.' : 'BLE/GPS son evidencia, no autoridad. Confirma físicamente al alumno.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'student' && absences.map(attendance => {
          const appeal = appealByAttendance.get(attendance.id);
          return (
            <div key={attendance.id} className="rounded-xl border p-4 space-y-3">
              <div className="flex justify-between gap-3">
                <div><p className="font-semibold">Falta registrada en {subjectName(attendance.subjectId)}</p><p className="text-xs text-muted-foreground">{attendance.date}</p></div>
                <Badge variant="destructive">Falta</Badge>
              </div>
              {appeal ? (
                <p className="text-sm text-amber-700 flex gap-2 items-center">
                  <Clock3 className="h-4 w-4" />
                  {appeal.status === 'resolved' ? 'Asistencia corregida: presente' : 'Asistencia en revisión por profesor y orientador.'}
                </p>
              ) : (
                <>
                  <Textarea value={message[attendance.id] || ''} onChange={e => setMessage(v => ({ ...v, [attendance.id]: e.target.value }))} placeholder="Opcional: explica que estabas presente." />
                  <Button className="w-full" onClick={() => submit(attendance)}><UserCheck className="mr-2 h-4 w-4" />Apelar / Estoy presente</Button>
                </>
              )}
            </div>
          );
        })}
        {mode === 'student' && absences.length === 0 && <p className="text-sm text-muted-foreground">No tienes faltas registradas para apelar.</p>}
        {mode !== 'student' && appeals.map(appeal => (
          <div key={appeal.id} className="rounded-xl border p-4 space-y-3">
            <div className="flex justify-between gap-3">
              <div><p className="font-semibold">{studentName(appeal.studentId)}</p><p className="text-sm">{subjectName(appeal.subjectId)} · {groupName(appeal.groupId)} · {appeal.date}</p></div>
              <Badge>{appeal.status === 'pending' ? 'Pendiente' : appeal.status === 'teacher_confirmed' ? 'Profesor confirmó' : 'Orientador confirmó'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">“{appeal.studentMessage || 'Estoy presente; solicito revisión.'}”</p>
            <p className="text-xs text-muted-foreground">Evidencia original: {appeal.originalPresenceEvidence || 'sin verificación'} · GPS: {appeal.originalGpsStatusAtCheck || 'desconocido'}</p>
            <Button className="w-full" onClick={() => confirm(appeal)}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar presencia física</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
