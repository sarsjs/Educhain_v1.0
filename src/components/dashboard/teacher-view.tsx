"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";
import { IdCard } from "@/components/dashboard/id-card";
import {
  fetchSubjectsByTeacher,
  fetchStudentsByGroup,
  fetchGroupById,
  fetchTimetableBySubject,
  fetchAttendanceForDate,
  generateAttendanceToken,
} from "@/lib/firebase/data";
import { KeyRound, Timer, Users, BookOpen, CalendarDays, CheckCircle, XCircle } from "lucide-react";
import type { Attendance, Group, Student, Subject, TimetableEntry } from "@/lib/types";

const getLocalDate = () => {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
};

export function TeacherView() {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [timetables, setTimetables] = React.useState<TimetableEntry[]>([]);
  const [attendance, setAttendance] = React.useState<Attendance[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [activeToken, setActiveToken] = React.useState<{
    code: string;
    expiresAt: number;
    subjectId: string;
    groupId: string;
  } | null>(null);
  const [countdown, setCountdown] = React.useState(0);

  const today = getLocalDate();

  const loadData = React.useCallback(async () => {
    if (!profile?.id) return;

    setLoading(true);
    try {
      const [teacherSubjects, todayAttendance] = await Promise.all([
        fetchSubjectsByTeacher(profile.id),
        fetchAttendanceForDate(today),
      ]);

      const timetableResults = await Promise.all(
        teacherSubjects.map((subject) => fetchTimetableBySubject(subject.id))
      );
      const teacherTimetables = timetableResults.flat();
      const groupIds = [...new Set(teacherTimetables.map((entry) => entry.groupId))];

      const [groupResults, studentResults] = await Promise.all([
        Promise.all(groupIds.map((groupId) => fetchGroupById(groupId))),
        Promise.all(groupIds.map((groupId) => fetchStudentsByGroup(groupId))),
      ]);

      setSubjects(teacherSubjects);
      setStudents(studentResults.flat());
      setGroups(groupResults.filter((group): group is Group => group !== null));
      setTimetables(teacherTimetables);
      setAttendance(todayAttendance);
    } catch (error) {
      console.error("Failed to load teacher data:", error);
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos del profesor.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.id, toast, today]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!activeToken) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((activeToken.expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setActiveToken(null);
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [activeToken]);

  const handleStartAttendance = async (subjectId: string, groupId: string) => {
    try {
      const token = await generateAttendanceToken(subjectId, groupId);
      const expiresAt = Date.now() + 5 * 60 * 1000;

      setActiveToken({
        code: token.code,
        expiresAt,
        subjectId,
        groupId,
      });
      setCountdown(300);

      toast({
        title: "Pase de lista iniciado",
        description: "Comparte el código con los alumnos. Es válido durante 5 minutos.",
      });
    } catch (error) {
      console.error("Error generating attendance token:", error);
      toast({
        title: "No se pudo generar el código",
        description: "Verifica que la materia esté correctamente asignada al profesor.",
        variant: "destructive",
      });
    }
  };

  const attendanceFor = (groupId: string, studentId: string, subjectId: string) =>
    attendance.some(
      (record) =>
        record.groupId === groupId &&
        record.studentId === studentId &&
        record.subjectId === subjectId &&
        record.present === true
    );

  const getGroupIdsForSubject = (subjectId: string) =>
    [...new Set(
      timetables
        .filter((entry) => entry.subjectId === subjectId)
        .map((entry) => entry.groupId)
    )];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-muted-foreground">Cargando panel docente...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Panel del Profesor</h1>
          <p className="text-muted-foreground font-medium">
            Horarios y pase de lista digital
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          <CalendarDays className="h-3 w-3 mr-1" />
          {today}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <BookOpen className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-black">{subjects.length}</p>
              <p className="text-sm text-muted-foreground">Materias asignadas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-black">
                {new Set(timetables.map((entry) => entry.groupId)).size}
              </p>
              <p className="text-sm text-muted-foreground">Grupos con horario</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>Identificación digital</CardTitle>
            <CardDescription>Credencial del profesor.</CardDescription>
          </CardHeader>
          <CardContent>
            <IdCard
              name={profile.name}
              role="Profesor"
              cycle="Docencia"
              avatarUrl={profile.avatarUrl}
              idLabel={profile.id.slice(0, 6).toUpperCase()}
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {subjects.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No tienes materias asignadas.
            </CardContent>
          </Card>
        ) : (
          subjects.map((subject) => {
            const groupIds = getGroupIdsForSubject(subject.id);

            return (
              <Card key={subject.id}>
                <CardHeader>
                  <CardTitle>{subject.name}</CardTitle>
                  <CardDescription>
                    Grupos y pase de lista de esta materia.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {groupIds.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Esta materia no tiene grupos en el horario.
                    </p>
                  ) : (
                    groupIds.map((groupId) => {
                      const group = groups.find((item) => item.id === groupId);
                      const groupStudents = students.filter(
                        (student) => student.groupId === groupId
                      );
                      const isTokenActive =
                        activeToken?.subjectId === subject.id &&
                        activeToken.groupId === groupId;

                      return (
                        <div key={groupId} className="rounded-xl border p-4 space-y-4">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                              <h3 className="font-bold">
                                {group?.name || "Grupo"}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {groupStudents.length} estudiantes
                              </p>
                            </div>

                            {isTokenActive ? (
                              <div className="flex items-center gap-4 rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
                                <div>
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                                    Código
                                  </p>
                                  <p className="text-3xl font-black tracking-[0.25em] text-primary">
                                    {activeToken.code}
                                  </p>
                                </div>
                                <div className="border-l pl-4">
                                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                                    Expira
                                  </p>
                                  <p className="font-bold flex items-center gap-1">
                                    <Timer className="h-4 w-4" />
                                    {Math.floor(countdown / 60)}:
                                    {String(countdown % 60).padStart(2, "0")}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <Button
                                onClick={() => handleStartAttendance(subject.id, groupId)}
                              >
                                <KeyRound className="h-4 w-4 mr-2" />
                                Iniciar pase de lista
                              </Button>
                            )}
                          </div>

                          <div className="space-y-2">
                            {groupStudents.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No hay estudiantes registrados en este grupo.
                              </p>
                            ) : (
                              groupStudents.map((student) => {
                                const present = attendanceFor(
                                  groupId,
                                  student.id,
                                  subject.id
                                );

                                return (
                                  <div
                                    key={student.id}
                                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <Avatar className="h-8 w-8">
                                        <AvatarImage
                                          src={student.avatarUrl}
                                          alt={student.name}
                                        />
                                        <AvatarFallback>
                                          {student.name.charAt(0)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span className="font-medium truncate">
                                        {student.name}
                                      </span>
                                    </div>
                                    {present ? (
                                      <Badge>
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Presente
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline">
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Pendiente
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
