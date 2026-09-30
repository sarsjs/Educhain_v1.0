'use client';

import * as React from 'react';
import {
  ClipboardList,
  Calendar,
  BookCopy,
  Users,
} from 'lucide-react';
import { StatCard } from './stat-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  fetchGroupsByCounselor,
  fetchSubjects,
  fetchUsersByRole,
  fetchTimetableByGroups,
  fetchStudentsByGroup,
  fetchSecurityAlerts,
  fetchAttendanceForDate,
  fetchSchoolPresenceChecks,
  fetchSubstitutionRequests,
  createSubstitutionRequest,
  handleSubstitutionRequest,
  fetchCounselorCoveragesForCounselor,
  fetchCounselorIncidentReports,
  createCounselorIncidentReport,
  closeCounselorCoverage,
  isCounselorCoverageActive,
  addStudent,
  addTimetableEntry,
} from '@/lib/firebase/data';
import type { Student, Group, Subject, TimetableEntry, SecurityAlert, User, SubstitutionRequest, CounselorCoverage, CounselorIncidentReport, CounselorIncidentType } from '@/lib/types';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { SecurityAlerts } from './security-alerts';
import { IdCard } from './id-card';
import { MessagePanel } from './message-panel';
import { RealTimeAttendance } from './real-time-attendance';
import { NotificationPanel } from './notification-panel';

export function CounselorView({ currentUser }: { currentUser: User }) {
  const [students, setStudents] = React.useState<Student[]>([]);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [teachers, setTeachers] = React.useState<User[]>([]);
  const [timetable, setTimetable] = React.useState<TimetableEntry[]>([]);
  const [securityAlerts, setSecurityAlerts] = React.useState<SecurityAlert[]>([]);
  const [attendance, setAttendance] = React.useState<import('@/lib/types').Attendance[]>([]);
  const [presenceChecks, setPresenceChecks] = React.useState<import('@/lib/types').SchoolPresenceCheck[]>([]);
  const [otherCounselors, setOtherCounselors] = React.useState<User[]>([]);
  const [substitutionRequests, setSubstitutionRequests] = React.useState<SubstitutionRequest[]>([]);
  const [coverageRecords, setCoverageRecords] = React.useState<CounselorCoverage[]>([]);
  const [incidentReports, setIncidentReports] = React.useState<CounselorIncidentReport[]>([]);
  const [reportCoverageId, setReportCoverageId] = React.useState('');
  const [reportType, setReportType] = React.useState<CounselorIncidentType>('late_arrival');
  const [reportStudentId, setReportStudentId] = React.useState('');
  const [reportSummary, setReportSummary] = React.useState('');
  const [reportAction, setReportAction] = React.useState('');
  const [closingCoverageId, setClosingCoverageId] = React.useState('');
  const [closingSummary, setClosingSummary] = React.useState('');
  const [substituteId, setSubstituteId] = React.useState('');
  const [substituteGroupIds, setSubstituteGroupIds] = React.useState<string[]>([]);
  const [substituteDate, setSubstituteDate] = React.useState('');
  const [substituteStart, setSubstituteStart] = React.useState('07:00');
  const [substituteEnd, setSubstituteEnd] = React.useState('09:00');
  const [substituteMessage, setSubstituteMessage] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const { toast } = useToast();
  const { profile } = useAuth();

  const assignedGroups = groups.filter((g) => g.counselorId === currentUser.id || g.tempCounselorId === currentUser.id);
  const assignedGroupIds = assignedGroups.map((g) => g.id);

  const assignedStudents = students.filter((s) => assignedGroupIds.includes(s.groupId));
  const assignedStudentIds = assignedStudents.map((s) => s.id);
  const assignedTimetable = timetable.filter((t) => assignedGroupIds.includes(t.groupId));
  const assignedAlerts = securityAlerts.filter((a) => assignedStudentIds.includes(a.studentId));

  const totalStudents = assignedStudents.length;
  const detectedStudentIds = new Set(
    presenceChecks
      .filter(check => check.inside && !check.isMocked)
      .map(check => check.userId)
  );
  const detectedStudents = assignedStudents.filter(student => detectedStudentIds.has(student.id)).length;
  const assignedTeacherIds = new Set(
    assignedTimetable.map(entry => entry.teacherId).filter(Boolean) as string[]
  );
  const detectedTeacherIds = new Set(
    presenceChecks
      .filter(check => check.inside && !check.isMocked && check.role === 'profesor')
      .map(check => check.userId)
  );
  const detectedAssignedTeachers = teachers.filter(
    teacher => assignedTeacherIds.has(teacher.id) && detectedTeacherIds.has(teacher.id)
  ).length;


  const [addStudentOpen, setAddStudentOpen] = React.useState(false);
  const [newStudentName, setNewStudentName] = React.useState('');
  const [newStudentEmail, setNewStudentEmail] = React.useState('');
  const [newStudentGroupId, setNewStudentGroupId] = React.useState(
    assignedGroupIds[0] ?? ''
  );

  const [addScheduleOpen, setAddScheduleOpen] = React.useState(false);
  const [newScheduleDay, setNewScheduleDay] = React.useState<TimetableEntry['day']>('Lunes');
  const [newScheduleTime, setNewScheduleTime] = React.useState('');
  const [newScheduleSubjectId, setNewScheduleSubjectId] = React.useState('');
  const [newScheduleTeacherId, setNewScheduleTeacherId] = React.useState('');
  const [newScheduleGroupId, setNewScheduleGroupId] = React.useState(
    assignedGroupIds[0] ?? ''
  );

  const daysOfWeek: TimetableEntry['day'][] = [
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
  ];

  const loadData = React.useCallback(async () => {
    try {
      const today = new Date();
      const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const [groupsData, subjectsData, teachersData, alertsData, attendanceData, counselorsData, requestsData, coveragesData] = await Promise.all([
        fetchGroupsByCounselor(currentUser.id),
        fetchSubjects(),
        fetchUsersByRole('profesor'),
        fetchSecurityAlerts(),
        fetchAttendanceForDate(todayKey),
        fetchUsersByRole('orientador'),
        fetchSubstitutionRequests(currentUser.id),
        fetchCounselorCoveragesForCounselor(currentUser.id, todayKey),
      ]);
      const assignedGroupIds = groupsData.map((group) => group.id);
      const coverageGroupIds = [...new Set(coveragesData.map((coverage) => coverage.groupId))];
      const relevantGroupIds = [...new Set([...assignedGroupIds, ...coverageGroupIds])];
      const [studentResults, timetableData, reportData] = await Promise.all([
        Promise.all(relevantGroupIds.map((groupId) => fetchStudentsByGroup(groupId))),
        fetchTimetableByGroups(assignedGroupIds),
        fetchCounselorIncidentReports(coveragesData.map((coverage) => coverage.id)),
      ]);
      setStudents(studentResults.flat());
      setGroups(groupsData);
      setSubjects(subjectsData);
      setTeachers(teachersData);
      setOtherCounselors(counselorsData.filter(counselor => counselor.id !== currentUser.id));
      setSubstitutionRequests(requestsData);
      setCoverageRecords(coveragesData);
      setIncidentReports(reportData);
      setTimetable(timetableData);
      setSecurityAlerts(alertsData);
      setAttendance(attendanceData);
      setPresenceChecks(await fetchSchoolPresenceChecks(todayKey, undefined, assignedGroupIds));
    } catch (error) {
      console.error('Failed to load data', error);
      toast({ title: 'Error', description: 'Failed to load data from the server.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddStudent = async () => {
    if (!newStudentName || !newStudentGroupId || !newStudentEmail) {
      toast({
        title: 'Datos incompletos',
        description: 'Por favor ingresa el nombre, correo y selecciona un grupo.',
      });
      return;
    }
    const avatarSeed = Math.floor(Math.random() * 1000);
    const avatarUrl = `https://picsum.photos/seed/${avatarSeed}/100/100`;
    const gradeList = subjects.map((s) => ({ subjectId: s.id, grade: null }));

    try {
      await addStudent({
        name: newStudentName,
        email: newStudentEmail,
        avatarUrl,
        groupId: newStudentGroupId,
        grades: gradeList,
      });

      setNewStudentName('');
      setNewStudentEmail('');
      setNewStudentGroupId(assignedGroupIds[0] ?? '');
      setAddStudentOpen(false);
      toast({
        title: 'Estudiante inscrito',
        description: `Se inscribió a ${newStudentName}.`,
      });
      loadData();
    } catch (error) {
      console.error('Failed to add student', error);
      toast({ title: 'Error', description: 'Failed to inscribe the student.' });
    }
  };

  const handleAddSchedule = async () => {
    if (!newScheduleTime || !newScheduleSubjectId || !newScheduleTeacherId || !newScheduleGroupId) {
      toast({
        title: 'Datos incompletos',
        description: 'Completa todos los campos del horario.',
      });
      return;
    }

    try {
      await addTimetableEntry({
        groupId: newScheduleGroupId,
        subjectId: newScheduleSubjectId,
        teacherId: newScheduleTeacherId,
        day: newScheduleDay,
        time: newScheduleTime,
      });

      setNewScheduleDay('Lunes');
      setNewScheduleTime('');
      setNewScheduleSubjectId(subjects[0]?.id ?? '');
      setNewScheduleTeacherId('');
      setNewScheduleGroupId(assignedGroupIds[0] ?? '');
      setAddScheduleOpen(false);
      toast({
        title: 'Horario agregado',
        description: `Se agregó la clase al horario.`,
      });
      loadData();
    } catch (error) {
      console.error('Failed to add schedule', error);
      toast({ title: 'Error', description: 'Failed to add the schedule.' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-12 w-12 bg-primary/20 rounded-full" />
          <p className="text-sm font-medium text-muted-foreground tracking-widest uppercase">Cargando Panel de Orientación...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-foreground">Portal del Orientador </h1>
          <p className="text-muted-foreground font-medium">Control Escolar y Seguimiento de Grupos</p>
        </div>
        <div className="px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
          <span className="text-xs font-black uppercase text-primary">Gestión de Turno</span>
        </div>
      </div>
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <StatCard
          title='Total de Estudiantes'
          value={totalStudents.toString()}
          icon={Users}
          description='En tus grupos gestionados'
        />
        <StatCard
          title='Grupos Gestionados'
          value={assignedGroups.length.toString()}
          icon={ClipboardList}
          description='Grupos bajo tu supervisión'
        />
        <StatCard
          title='Materias'
          value={subjects.length.toString()}
          icon={BookCopy}
          description='Disponibles en el plan de estudios'
        />
        <StatCard
          title='Clases Programadas'
          value={assignedTimetable.length.toString()}
          icon={Calendar}
          description='Total de clases por semana'
        />
      </div>

      {assignedAlerts.length > 0 && (
        <div className='grid grid-cols-1 gap-6'>
          <SecurityAlerts alerts={assignedAlerts} students={students} />
        </div>
      )}

      <RealTimeAttendance students={assignedStudents} attendance={attendance} />

      <Card>
        <CardHeader>
          <CardTitle>Presencia escolar 07:00–07:20</CardTitle>
          <CardDescription>
            Lecturas GPS válidas de tus grupos. La falta de lectura no se interpreta automáticamente como ausencia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Estudiantes detectados</p>
              <p className="text-3xl font-black">{detectedStudents} / {totalStudents}</p>
              <p className="text-xs text-muted-foreground mt-1">Al menos una detección dentro del plantel.</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Profesores vinculados a tus grupos detectados</p>
              <p className="text-3xl font-black">{detectedAssignedTeachers}</p>
              <p className="text-xs text-muted-foreground mt-1">La lectura docente se vincula al primer grupo de las dos primeras horas.</p>
            </div>
          </div>
        </CardContent>
      </Card>


      {profile?.role === 'orientador' && (
        <Card>
          <CardHeader>
            <CardTitle>Identificación digital</CardTitle>
            <CardDescription>Tu credencial oficial para el turno.</CardDescription>
          </CardHeader>
          <CardContent>
            <IdCard
              name={currentUser.name}
              role='Orientador'
              cycle='Orientación'
              avatarUrl={currentUser.avatarUrl}
              idLabel={currentUser.id.slice(0, 6).toUpperCase()}
            />
          </CardContent>
        </Card>
      )}

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle>Inscripción de Estudiantes</CardTitle>
                <CardDescription>
                  Inscribe nuevos estudiantes y asígnalos a tus grupos.
                </CardDescription>
              </div>
              {/* Dialog for enrolling a new student */}
              <Dialog open={addStudentOpen} onOpenChange={setAddStudentOpen}>
                <DialogTrigger asChild>
                  <Button>Inscribir Estudiante</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Inscribir Nuevo Estudiante</DialogTitle>
                    <DialogDescription>
                      Proporciona la información del estudiante para inscribirlo en uno de tus grupos.
                    </DialogDescription>
                  </DialogHeader>
                  <div className='space-y-4'>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Nombre</label>
                      <Input
                        value={newStudentName}
                        onChange={(e) => setNewStudentName(e.target.value)}
                        placeholder='Nombre del estudiante'
                      />
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Email</label>
                      <Input
                        value={newStudentEmail}
                        onChange={(e) => setNewStudentEmail(e.target.value)}
                        placeholder='Email del estudiante'
                        type='email'
                      />
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Profesor</label>
                      <Select value={newScheduleTeacherId} onValueChange={setNewScheduleTeacherId}>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Seleccionar profesor' />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.map((teacher) => (
                            <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Grupo</label>
                      <Select
                        value={newStudentGroupId}
                        onValueChange={(value) => setNewStudentGroupId(value)}
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Seleccionar grupo' />
                        </SelectTrigger>
                        <SelectContent>
                          {assignedGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter className='mt-4'>
                    <Button onClick={handleAddStudent}>Inscribir</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Grupo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedStudents.map((student) => {
                  const group = groups.find(g => g.id === student.groupId);
                  return (
                    <TableRow key={student.id}>
                      <TableCell>
                        <div className='flex items-center gap-3'>
                          <Avatar className='h-8 w-8'>
                            <AvatarImage src={student.avatarUrl} alt={student.name} />
                            <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span className='font-medium'>{student.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{group?.name || 'N/A'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle>Gestión de Horarios</CardTitle>
                <CardDescription>
                  Crea horarios y asigna materias a los profesores.
                </CardDescription>
              </div>
              {/* Dialog for adding a new schedule entry */}
              <Dialog open={addScheduleOpen} onOpenChange={setAddScheduleOpen}>
                <DialogTrigger asChild>
                  <Button>Nuevo Horario</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nuevo Horario</DialogTitle>
                    <DialogDescription>
                      Completa la información para programar una nueva clase.
                    </DialogDescription>
                  </DialogHeader>
                  <div className='space-y-4'>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Día</label>
                      <Select
                        value={newScheduleDay}
                        onValueChange={(value) => setNewScheduleDay(value as TimetableEntry['day'])}
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Seleccionar día' />
                        </SelectTrigger>
                        <SelectContent>
                          {daysOfWeek.map((day) => (
                            <SelectItem key={day} value={day}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Hora</label>
                      <Input
                        value={newScheduleTime}
                        onChange={(e) => setNewScheduleTime(e.target.value)}
                        placeholder='Ej. 10:00 - 11:00'
                      />
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Materia</label>
                      <Select
                        value={newScheduleSubjectId}
                        onValueChange={(value) => setNewScheduleSubjectId(value)}
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Seleccionar materia' />
                        </SelectTrigger>
                        <SelectContent>
                          {subjects.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-2'>
                      <label className='block text-sm font-medium'>Grupo</label>
                      <Select
                        value={newScheduleGroupId}
                        onValueChange={(value) => setNewScheduleGroupId(value)}
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Seleccionar grupo' />
                        </SelectTrigger>
                        <SelectContent>
                          {assignedGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter className='mt-4'>
                    <Button onClick={handleAddSchedule}>Agregar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Materia</TableHead>
                  <TableHead>Grupo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedTimetable.sort((a, b) => daysOfWeek.indexOf(a.day) - daysOfWeek.indexOf(b.day)).map((entry) => {
                  const subject = subjects.find(s => s.id === entry.subjectId);
                  const group = groups.find(g => g.id === entry.groupId);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className='font-medium'>{entry.day}</TableCell>
                      <TableCell>{entry.time}</TableCell>
                      <TableCell>{subject?.name || 'N/A'}</TableCell>
                      <TableCell>{group?.name || 'N/A'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cobertura temporal de orientación</CardTitle>
          <CardDescription>Solicita apoyo sin cambiar al orientador titular.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Select value={substituteId} onValueChange={setSubstituteId}>
              <SelectTrigger><SelectValue placeholder="Orientador de apoyo" /></SelectTrigger>
              <SelectContent>{otherCounselors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" value={substituteDate} onChange={e => setSubstituteDate(e.target.value)} />
            <Input type="time" value={substituteStart} onChange={e => setSubstituteStart(e.target.value)} />
            <Input type="time" value={substituteEnd} onChange={e => setSubstituteEnd(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {assignedGroups.map(group => {
              const selected = substituteGroupIds.includes(group.id);
              return <Button key={group.id} type="button" variant={selected ? 'default' : 'outline'} onClick={() => setSubstituteGroupIds(ids => selected ? ids.filter(id => id !== group.id) : [...ids, group.id])}>{group.name}</Button>;
            })}
          </div>
          <Input value={substituteMessage} onChange={e => setSubstituteMessage(e.target.value)} placeholder="Motivo o indicación (opcional)" />
          <Button disabled={!substituteId || !substituteDate || !substituteGroupIds.length} onClick={async () => {
            try {
              await createSubstitutionRequest({
                fromCounselorId: currentUser.id,
                toCounselorId: substituteId,
                groupIds: substituteGroupIds,
                date: substituteDate,
                startTime: substituteStart,
                endTime: substituteEnd,
                message: substituteMessage || undefined,
              });
              setSubstituteGroupIds([]);
              setSubstituteMessage('');
              toast({ title: 'Solicitud enviada', description: 'Queda pendiente de aceptación.' });
            } catch (error) {
              console.error(error);
              toast({ title: 'Error', description: 'No se pudo enviar la solicitud.' });
            }
          }}>Solicitar apoyo</Button>

          {substitutionRequests.length > 0 && <div className="space-y-3 border-t pt-4">
            <p className="font-semibold">Solicitudes recibidas</p>
            {substitutionRequests.map(request => <div key={request.id} className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
              <div><p className="font-medium">Cobertura del {request.date}</p><p className="text-sm text-muted-foreground">{request.startTime}–{request.endTime} · {request.groupIds.length} grupo(s)</p>{request.message && <p className="text-sm mt-1">{request.message}</p>}</div>
              <div className="flex gap-2">
                <Button onClick={async () => { await handleSubstitutionRequest(request.id, 'accepted', request); setSubstitutionRequests(items => items.filter(item => item.id !== request.id)); toast({ title: 'Cobertura aceptada', description: 'El titular del grupo no cambió.' }); }}>Aceptar</Button>
                <Button variant="outline" onClick={async () => { await handleSubstitutionRequest(request.id, 'declined'); setSubstitutionRequests(items => items.filter(item => item.id !== request.id)); }}>Rechazar</Button>
              </div>
            </div>)}
          </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bitácora de novedades durante sustituciones</CardTitle>
          <CardDescription>
            Registra cualquier situación ocurrida mientras cubres a otro orientador. No modifica automáticamente la asistencia: deja constancia de lo sucedido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {coverageRecords.filter((coverage) => isCounselorCoverageActive(coverage)).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tienes una cobertura activa en este momento.</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cobertura / grupo</label>
                  <Select value={reportCoverageId} onValueChange={(value) => { setReportCoverageId(value); setReportStudentId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar grupo cubierto" /></SelectTrigger>
                    <SelectContent>
                      {coverageRecords.filter((coverage) => isCounselorCoverageActive(coverage)).map((coverage) => {
                        const group = groups.find((item) => item.id === coverage.groupId);
                        return <SelectItem key={coverage.id} value={coverage.id}>{group?.name || coverage.groupId} · {coverage.startTime}–{coverage.endTime}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tipo de novedad</label>
                  <Select value={reportType} onValueChange={(value) => setReportType(value as CounselorIncidentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="late_arrival">Llegada tarde</SelectItem>
                      <SelectItem value="attendance_exception">Excepción de asistencia</SelectItem>
                      <SelectItem value="student_incident">Incidencia con alumno</SelectItem>
                      <SelectItem value="teacher_incident">Incidencia con profesor</SelectItem>
                      <SelectItem value="group_incident">Incidencia del grupo</SelectItem>
                      <SelectItem value="other">Otra novedad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {reportCoverageId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Alumno involucrado (opcional)</label>
                  <Select value={reportStudentId || "none"} onValueChange={(value) => setReportStudentId(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ninguno</SelectItem>
                      {students.filter((student) => {
                        const coverage = coverageRecords.find((item) => item.id === reportCoverageId);
                        return coverage?.groupId === student.groupId;
                      }).map((student) => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Qué ocurrió</label>
                <Input value={reportSummary} onChange={(event) => setReportSummary(event.target.value)} placeholder="Ej. El alumno llegó 15 minutos tarde; se permitió su ingreso y se registró la situación." />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Qué se hizo / resolución (opcional)</label>
                <Input value={reportAction} onChange={(event) => setReportAction(event.target.value)} placeholder="Ej. Se permitió el acceso y se informó al alumno." />
              </div>
              <Button disabled={!reportCoverageId || !reportSummary.trim()} onClick={async () => {
                const coverage = coverageRecords.find((item) => item.id === reportCoverageId);
                const student = students.find((item) => item.id === reportStudentId);
                if (!coverage) return;
                const now = new Date();
                const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
                try {
                  await createCounselorIncidentReport({
                    coverageId: coverage.id,
                    groupId: coverage.groupId,
                    date: coverage.date,
                    time,
                    type: reportType,
                    studentId: student?.id,
                    studentName: student?.name,
                    summary: reportSummary.trim(),
                    actionTaken: reportAction.trim() || undefined,
                    createdBy: currentUser.id,
                    createdByName: currentUser.name,
                    createdByRole: 'orientador',
                  });
                  setReportSummary('');
                  setReportAction('');
                  setReportStudentId('');
                  setIncidentReports(await fetchCounselorIncidentReports(coverageRecords.map((item) => item.id)));
                  toast({ title: 'Novedad registrada', description: 'Quedó asentada en la bitácora de la cobertura.' });
                } catch (error) {
                  console.error(error);
                  toast({ title: 'No se pudo registrar', description: error instanceof Error ? error.message : 'La cobertura ya no está activa.' });
                }
              }}>Registrar novedad</Button>
            </>
          )}
          {coverageRecords.filter((coverage) => coverage.status === 'active').length > 0 && (
            <div className="border-t pt-4 space-y-3">
              <p className="font-semibold">Cierre de cobertura</p>
              <p className="text-sm text-muted-foreground">Al terminar, deja constancia de cómo concluyó la sustitución. Si no ocurrió nada, también se registra.</p>
              <Select value={closingCoverageId} onValueChange={setClosingCoverageId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar cobertura a cerrar" /></SelectTrigger>
                <SelectContent>
                  {coverageRecords.filter((coverage) => coverage.status === 'active').map((coverage) => {
                    const group = groups.find((item) => item.id === coverage.groupId);
                    return <SelectItem key={coverage.id} value={coverage.id}>{group?.name || coverage.groupId} · {coverage.date} · {coverage.startTime}–{coverage.endTime}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
              <Input value={closingSummary} onChange={(event) => setClosingSummary(event.target.value)} placeholder="Ej. Cobertura concluida sin incidencias." />
              <Button disabled={!closingCoverageId || !closingSummary.trim()} onClick={async () => {
                try {
                  await closeCounselorCoverage(closingCoverageId, currentUser.id, closingSummary);
                  setCoverageRecords(await fetchCounselorCoveragesForCounselor(currentUser.id, todayKey));
                  setClosingCoverageId('');
                  setClosingSummary('');
                  toast({ title: 'Cobertura cerrada', description: 'El cierre quedó asentado en el historial.' });
                } catch (error) {
                  console.error(error);
                  toast({ title: 'No se pudo cerrar', description: error instanceof Error ? error.message : 'Intenta nuevamente.' });
                }
              }}>Cerrar cobertura</Button>
            </div>
          )}

          {incidentReports.length > 0 && (
            <div className="border-t pt-4 space-y-3">
              <p className="font-semibold">Novedades registradas</p>
              {incidentReports.slice(0, 10).map((report) => {
                const group = groups.find((item) => item.id === report.groupId);
                return <div key={report.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{group?.name || report.groupId} · {report.date} {report.time}</p>
                    <span className="text-xs rounded-full bg-muted px-2 py-1">{report.type}</span>
                  </div>
                  {report.studentName && <p className="text-sm mt-1"><strong>Alumno:</strong> {report.studentName}</p>}
                  <p className="text-sm mt-1"><strong>Situación:</strong> {report.summary}</p>
                  {report.actionTaken && <p className="text-sm mt-1"><strong>Acción:</strong> {report.actionTaken}</p>}
                  <p className="text-xs text-muted-foreground mt-2">Registró: {report.createdByName}</p>
                </div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6">
        <NotificationPanel />
      </div>

      <div className="grid grid-cols-1 gap-6">
      </div>
    </div>
  );
}
