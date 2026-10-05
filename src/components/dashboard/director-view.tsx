'use client';

import * as React from 'react';
import { School, Users, User as UserIcon, FolderKanban, UserCheck, GraduationCap, AlertTriangle, ShieldCheck, MapPin, Clock } from 'lucide-react';
import { StatCard } from './stat-card';
import { fetchUsers, fetchGroups, fetchStudents, fetchSubjects, fetchSchoolPresenceChecks } from '@/lib/firebase/data';
import type { Group, User, Student, Subject, SchoolPresenceCheck } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { NotificationPanel } from './notification-panel';
import { WorkAttendanceTable } from './work-attendance-table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function DirectorView() {
  const [staffList, setStaffList] = React.useState<User[]>([]);
  const [groupList, setGroupList] = React.useState<Group[]>([]);
  const [cycleList, setCycleList] = React.useState<string[]>([]);
  const [studentList, setStudentList] = React.useState<Student[]>([]);
  const [presenceChecks, setPresenceChecks] = React.useState<SchoolPresenceCheck[]>([]);
  const { toast } = useToast();

  const [integrityAlerts, setIntegrityAlerts] = React.useState<string[]>([]);

  const analyzeIntegrity = React.useCallback((users: User[], groups: Group[], students: Student[], subjects: Subject[]) => {
    const alerts: string[] = [];

    // 1. Alumnos sin grupo
    const studentsWithoutGroup = students.filter(s => !s.groupId || s.groupId === 'none' || s.groupId === '');
    if (studentsWithoutGroup.length > 0) {
      alerts.push(` INTEGRIDAD: Hay ${studentsWithoutGroup.length} alumnos sin grupo asignado.`);
    }

    // 2. Grupos sin orientador
    const groupsWithoutCounselor = groups.filter(g => !g.counselorId && !g.directorInChargeId);
    if (groupsWithoutCounselor.length > 0) {
      alerts.push(` INTEGRIDAD: ${groupsWithoutCounselor.length} grupos no tienen orientador.`);
    }

    // 3. Materias sin profesor
    const subjectsWithoutTeacher = subjects.filter(s => !s.teacherId);
    if (subjectsWithoutTeacher.length > 0) {
      alerts.push(` INTEGRIDAD: ${subjectsWithoutTeacher.length} materias no tienen profesor.`);
    }

    // 4. Grupos vacíos
    const groupsWithStudents = new Set(students.map(s => s.groupId).filter(Boolean));
    const emptyGroups = groups.filter(g => !groupsWithStudents.has(g.id));
    if (emptyGroups.length > 0) {
      alerts.push(` AVISO: ${emptyGroups.length} grupo(s) no tienen alumnos inscritos.`);
    }

    setIntegrityAlerts(alerts);
  }, []);

  const loadData = React.useCallback(async () => {
    try {
      const [users, groupsData, studentsData, subjectsData] = await Promise.all([
        fetchUsers(),
        fetchGroups(),
        fetchStudents(),
        fetchSubjects()
      ]);

      setStaffList(users);
      setGroupList(groupsData);
      setStudentList(studentsData);

      const today = new Date();
      const dateKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      setPresenceChecks(await fetchSchoolPresenceChecks(dateKey));

      // Analizar integridad para notificaciones sintéticas
      analyzeIntegrity(users, groupsData, studentsData, subjectsData);
    } catch (error) {
      console.error('Error loading Firebase data', error);
      toast({
        title: 'Error al cargar datos',
        description: 'No se pudieron obtener los datos del servidor.',
        variant: 'destructive',
      });
    }
  }, [toast, analyzeIntegrity]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    const uniqueCycles = Array.from(new Set(groupList.map((group) => group.cycleId))).filter(Boolean);
    setCycleList(uniqueCycles);
  }, [groupList]);

  const totalCycles = cycleList.length;
  const totalGroups = groupList.length;
  const counsellorsCount = staffList.filter((u) => u.role === 'orientador').length;
  const teacherCount = staffList.filter((u) => u.role === 'profesor').length;
  const directorCount = staffList.filter((u) => u.role === 'director').length;
  const totalStudents = studentList.length;

  // Presencia general real: una persona queda detectada si tuvo al menos
  // una lectura válida dentro del plantel durante la ventana 07:00-07:20.
  const detectedUserIds = new Set(
    presenceChecks.filter(check => check.inside && !check.isMocked).map(check => check.userId)
  );
  const studentsPresent = studentList.filter(student => detectedUserIds.has(student.id)).length;

  // Identificar grupos sin cobertura (Orientador fuera o desconocido sin suplente)
  const unattendedGroups = groupList.filter(group => {
    const counselor = staffList.find(u => u.id === group.counselorId);
    const hasSubstitute = !!group.tempCounselorId;
    const directorInCharge = !!group.directorInChargeId;
    const isCounselorMissing = counselor?.gpsStatus === 'outside' || counselor?.gpsStatus === 'unknown';
    return isCounselorMissing && !hasSubstitute && !directorInCharge;
  });



  if (staffList.length === 0 && groupList.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-12 w-12 bg-primary/20 rounded-full" />
          <p className="text-sm font-medium text-muted-foreground tracking-widest uppercase">Cargando Tablero Directivo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-foreground uppercase">ADMINISTRACIÓN CENTRAL </h1>
          <p className="text-muted-foreground font-medium uppercase text-xs tracking-widest">Panel de Control Estratégico EPO 264</p>
        </div>
        <div className="px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
          <span className="text-xs font-black uppercase text-primary">Estado del Plantel: Operativo</span>
        </div>
      </div>
      {/* Alertas de Cobertura Crítica */}
      {unattendedGroups.length > 0 && (
        <Card className="border-destructive/20 bg-destructive/10 shadow-xl border-2 overflow-hidden ring-4 ring-destructive/10">
          <CardHeader className="pb-3 bg-destructive/20">
            <div className="flex items-center gap-3 text-destructive">
              <div className="p-2 bg-destructive rounded-lg text-white">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl font-black italic tracking-tighter uppercase transition-colors">Alerta de Cobertura Crítica</CardTitle>
                <CardDescription className="text-destructive font-medium">
                  Hay {unattendedGroups.length} grupos sin supervisión activa en este momento.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {unattendedGroups.map(group => {
                const counselor = staffList.find(u => u.id === group.counselorId);
                const lastSeen = counselor?.lastGpsUpdate ? (counselor.lastGpsUpdate as any).toDate() : null;

                return (
                  <div key={group.id} className="bg-card p-4 rounded-xl border border-destructive/20 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow">
                    <div className="space-y-1">
                      <p className="font-black text-foreground tracking-tight">{group.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Titular: {counselor?.name}</p>
                      {lastSeen && (
                        <div className="flex items-center gap-1 text-destructive mt-1">
                          <Clock className="h-3 w-3" />
                          <p className="text-[10px] font-black uppercase">
                            Ausente hace: {formatDistanceToNow(lastSeen, { locale: es })}
                          </p>
                        </div>
                      )}
                    </div>
                    <Link href="/dashboard/director/estructura">
                      <Button size="sm" variant="destructive" className="h-8 font-bold text-[10px] uppercase tracking-widest px-4 shadow-lg shadow-red-200">Cubrir</Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* El director tiene control global y puede quedar formalmente a cargo de cualquier grupo.
          El orientador titular, si existe, permanece registrado para conservar el historial. */}
      {groupList.some(group => group.directorInChargeId) && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-black uppercase tracking-wide">Grupos a cargo del Director</CardTitle>
            <CardDescription>Estos grupos pueden estar bajo responsabilidad directa del director aunque tengan o no orientador titular.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {groupList.filter(group => group.directorInChargeId).map(group => (
                <span key={group.id} className="rounded-full border bg-background px-3 py-1 text-xs font-semibold">
                  {group.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid - High Density XL */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Personal"
          value={(counsellorsCount + teacherCount).toString()}
          icon={Users}
          description="Docentes y apoyo"
        />
        <StatCard
          title="Presencia"
          value={`${studentsPresent}`}
          icon={UserCheck}
          description={`detectados 07:00-07:20 de ${totalStudents}`}
        />
        <StatCard
          title="Maestros"
          value={teacherCount.toString()}
          icon={GraduationCap}
          description="Frente a grupo"
        />
        <StatCard
          title="Grupos"
          value={totalGroups.toString()}
          icon={School}
          description="Ciclo escolar"
        />
        <StatCard
          title="Orientadores"
          value={counsellorsCount.toString()}
          icon={UserIcon}
          description="Seguimiento"
        />
        <StatCard
          title="Ciclos"
          value={totalCycles.toString()}
          icon={FolderKanban}
          description="Historial digital"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <div className="xl:col-span-8 flex">
          <WorkAttendanceTable className="flex-1" />
        </div>
        <div className="xl:col-span-4 flex">
          <NotificationPanel className="flex-1" integrityAlerts={integrityAlerts} />
        </div>
      </div>

      <div className="pt-8 border-t border-border">
      </div>
    </div>
  );
}
