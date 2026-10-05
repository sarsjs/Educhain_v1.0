'use client';

import * as React from 'react';
import { useAuth } from '@/context/auth-context';
import {
  fetchStudentByEmail,
  fetchTimetableByGroup,
  fetchSubjects,
  fetchGradesByStudent,
  fetchUsers,
  fetchUserById,
  fetchGroups,
  logActivity
} from '@/lib/firebase/data';
import type { Student, TimetableEntry, Subject, Grade, Group, User } from '@/lib/types';
import { StudentSchedule } from '@/components/dashboard/student-schedule';
import { StudentGrades } from '@/components/dashboard/student-grades';
import { useAppConfig } from '@/context/config-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Camera,
  AlertCircle,
  UserCircle,
  ShieldCheck,
  KeyRound,
  MapPin,
  GraduationCap,
  CheckCircle2,
  MessageSquare,
  BookOpen,
  Trophy
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/stat-card';
import { AchievementShowcase } from '@/components/dashboard/achievement-showcase';
import { toPng } from 'html-to-image';
import { useToast } from '@/hooks/use-toast';
import { AttendanceAppealsPanel } from '@/components/dashboard/attendance-appeals-panel';
import { StudentBlePresence } from '@/components/dashboard/student-ble-presence';

export default function AlumnoPage() {
  const { profile: user } = useAuth();
  const { config } = useAppConfig();
  const [student, setStudent] = React.useState<Student | null>(null);
  const [schedule, setSchedule] = React.useState<TimetableEntry[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [grades, setGrades] = React.useState<Grade[]>([]);
  const [group, setGroup] = React.useState<Group | null>(null);
  const [tempCounselor, setTempCounselor] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  React.useEffect(() => {
    const loadStudentData = async () => {
      if (!user || !user.email) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        let currentStudent = await fetchStudentByEmail(user.email);
        if (!currentStudent && user.id) {
          const fallback = await fetchUserById(user.id);
          if (fallback && (fallback.role === 'estudiante' || fallback.role === 'alumno')) {
            currentStudent = fallback;
          }
        }
        if (!currentStudent) {
          setError('No se encontró tu perfil de estudiante.');
          return;
        }
        setStudent(currentStudent);

        const allSubjects = await fetchSubjects();
        setSubjects(allSubjects);

        if (currentStudent.groupId) {
          const [timetableData, gradesData, allGroups, allUsers] = await Promise.all([
            fetchTimetableByGroup(currentStudent.groupId),
            fetchGradesByStudent(currentStudent.id),
            fetchGroups(),
            fetchUsers()
          ]);
          setSchedule(timetableData);
          setGrades(gradesData);

          const studentGroup = allGroups.find(g => g.id === currentStudent.groupId);
          if (studentGroup) {
            setGroup(studentGroup);
            if (studentGroup.tempCounselorId) {
              const counselor = allUsers.find(u => u.id === studentGroup.tempCounselorId);
              setTempCounselor(counselor || null);
            }
          }
        } else {
          setSchedule([]);
          setGrades([]);
        }

      } catch (err) {
        console.error('Error loading student data:', err);
        setError('Ocurrió un error al cargar tu perfil. Verifica tu conexión o contacta a soporte.');
      } finally {
        setIsLoading(false);
      }
    };

    loadStudentData();
  }, [user]);

  // Cálculos para el Panel Principal
  const stats = React.useMemo(() => {
    if (!student) return null;

    const validGrades = grades.filter(g => g.grade !== null);
    const avg = validGrades.length > 0
      ? (validGrades.reduce((acc, curr) => acc + curr.grade!, 0) / validGrades.length).toFixed(1)
      : '0.0';

    return {
      average: avg,
      completedSubjects: validGrades.length,
      totalSubjects: subjects.length,
      attendanceRate: '92%' // Mock para visualización
    };
  }, [student, grades, subjects]);



  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-foreground">Hola, {student?.name?.split(' ')[0] || 'Estudiante'} </h1>
          <p className="text-muted-foreground font-medium">{config?.institutionName || 'Panel Académico Institucional EPO 264'}</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full border border-primary/20">
          <GraduationCap className="h-4 w-4 text-primary" />
          <span className="text-xs font-black uppercase text-primary">{group?.name || 'Sin Grupo'}</span>
        </div>
      </div>

      {/* Sistema de Gamificación - Vistazo Premium */}
      {config?.features.badges && (
        <AchievementShowcase
          xp={student?.xp || 750}
          level={student?.level || 3}
          unlockedBadges={student?.badges || ['reloj_precision', 'buscador_oro']}
          userName={student?.name?.split(' ')[0]}
        />
      )}

      {/* Stats Summary */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Promedio General"
          value={stats?.average || '0.0'}
          icon={Trophy}
          description="Rendimiento actual"
        />
        <StatCard
          title="Materias"
          value={`${stats?.completedSubjects || 0}/${stats?.totalSubjects || 0}`}
          icon={BookOpen}
          description="Progreso de ciclo"
        />
        <StatCard
          title="Asistencia"
          value={stats?.attendanceRate || '0%'}
          icon={CheckCircle2}
          description="Presencia en plantel"
        />
        <StatCard
          title="Mensajes"
          value="0"
          icon={MessageSquare}
          description="Nuevas notificaciones"
        />
      </div>

      {group?.absenceStatus?.isActive && (
        <Card className="border-blue-500/20 bg-blue-500/5 shadow-lg overflow-hidden">
          <CardContent className="pt-6 relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <ShieldCheck className="h-24 w-24 text-blue-500" />
            </div>
            <div className="flex items-start gap-5 relative z-10">
              <div className="p-3 bg-blue-500 rounded-2xl text-white shadow-lg shadow-blue-500/20">
                <UserCircle className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-blue-500 uppercase tracking-widest text-xs flex items-center gap-2">
                  Aviso de Suplencia Activa
                  <span className="animate-ping flex h-2 w-2 rounded-full bg-blue-500"></span>
                </h4>
                <p className="text-sm font-medium text-foreground leading-relaxed">
                  {group.absenceStatus.message || "Tu orientador titular ha notificado una ausencia temporal."}
                </p>
                {tempCounselor && (
                  <div className="pt-2">
                    <span className="text-[10px] font-black uppercase bg-blue-500 text-white px-2 py-1 rounded">
                      Suplente: {tempCounselor.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {student && <StudentBlePresence studentId={student.id} />}


      {
        isLoading ? (
          <p>Cargando tu información...</p>
        ) : error ? (
          <p className="text-red-500">{error}</p>
        ) : student?.groupId ? (
          <div className="space-y-6">
            <StudentSchedule schedule={schedule} subjects={subjects} />
            <StudentGrades grades={grades} subjects={subjects} />
          </div>
        ) : (
          <p>Aún no estás asignado a un grupo. Tu horario y calificaciones aparecerán aquí cuando se te asigne uno.</p>
        )
      }



    </div >
  );
}
