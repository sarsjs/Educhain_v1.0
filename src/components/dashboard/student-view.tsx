"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";
import { IdCard } from "@/components/dashboard/id-card";
import {
  fetchUserById,
  fetchSubjects,
  fetchTimetableByGroup,
  fetchAttendanceByStudent,
  verifyAttendanceToken,
  registerAttendanceFromToken,
} from "@/lib/firebase/data";
import { verifyUserLocation } from "@/lib/gps-utils";
import { KeyRound, ShieldCheck, MapPin, CheckCircle, Clock3 } from "lucide-react";
import type { Attendance, Subject, TimetableEntry, User } from "@/lib/types";

const daysOfWeek: TimetableEntry["day"][] = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
];

const getLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
};

export function StudentView() {
  const { profile, loading: authLoading, signOut } = useAuth();
  const { toast } = useToast();
  const isStudent = profile?.role === "estudiante" || profile?.role === "alumno";

  const [student, setStudent] = React.useState<User | null>(null);
  const [timetable, setTimetable] = React.useState<TimetableEntry[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [attendance, setAttendance] = React.useState<Attendance[]>([]);
  const [fetching, setFetching] = React.useState(false);
  const [validationCode, setValidationCode] = React.useState("");
  const [isVerifying, setIsVerifying] = React.useState(false);

  const subjectMap = React.useMemo(
    () => Object.fromEntries(subjects.map((subject) => [subject.id, subject.name])),
    [subjects]
  );

  const today = getLocalDate();
  const currentDayIndex = new Date().getDay();
  const currentDay: TimetableEntry["day"] | null = currentDayIndex >= 1 && currentDayIndex <= 5 ? daysOfWeek[currentDayIndex - 1] : null;

  const loadData = React.useCallback(async () => {
    if (!profile?.email) return;

    setFetching(true);
    try {
      const [record, subjectsData] = await Promise.all([
        fetchUserById(profile.id),
        fetchSubjects(),
      ]);

      if (!record || !record.groupId) {
        setStudent(record);
        setTimetable([]);
        setAttendance([]);
        return;
      }

      const [entries, attendanceData] = await Promise.all([
        fetchTimetableByGroup(record.groupId),
        fetchAttendanceByStudent(record.id),
      ]);

      setStudent(record);
      setSubjects(subjectsData);
      setTimetable(entries);
      setAttendance(attendanceData);
    } catch (error) {
      console.error("Error loading student data:", error);
      toast({
        title: "Error al cargar datos",
        description: "Intenta nuevamente más tarde.",
        variant: "destructive",
      });
    } finally {
      setFetching(false);
    }
  }, [profile?.id, toast]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVerifyAttendance = async () => {
    if (!student?.groupId) {
      toast({
        title: "Perfil incompleto",
        description: "Tu expediente no tiene un grupo asignado.",
        variant: "destructive",
      });
      return;
    }

    if (!/^\d{4}$/.test(validationCode)) {
      toast({
        title: "Código incompleto",
        description: "Debes ingresar exactamente 4 dígitos.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);

    try {
      if (!navigator.geolocation) {
        throw new Error("Geolocalización no disponible");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const gpsResult = await verifyUserLocation(position);

      if (!gpsResult.isInside) {
        toast({
          title: "Fuera de rango",
          description: "Debes estar dentro del plantel para marcar asistencia.",
          variant: "destructive",
        });
        return;
      }

      if (gpsResult.isMocked) {
        toast({
          title: "Seguridad GPS",
          description: "Se detectó una ubicación no válida.",
          variant: "destructive",
        });
        return;
      }

      const token = await verifyAttendanceToken(student.groupId, validationCode);

      if (!token) {
        toast({
          title: "Código inválido",
          description: "El código es incorrecto o ya expiró.",
          variant: "destructive",
        });
        return;
      }

      const result = await registerAttendanceFromToken({
        studentId: student.id,
        groupId: student.groupId,
        tokenId: token.tokenId,
        subjectId: token.subjectId,
        date: today,
        timetableId: token.timetableId,
      });

      if (result.alreadyRegistered) {
        toast({
          title: "Ya registrada",
          description: "Tu asistencia para esta materia ya estaba registrada.",
        });
      } else {
        toast({
          title: "Asistencia confirmada",
          description: "Tu asistencia quedó guardada correctamente.",
        });
      }

      setValidationCode("");

      const updatedAttendance = await fetchAttendanceByStudent(student.id);
      setAttendance(updatedAttendance);
    } catch (error) {
      console.error("Attendance verification error:", error);
      toast({
        title: "No se registró la asistencia",
        description:
          "No fue posible validar tu ubicación o guardar el registro. Intenta nuevamente.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const getEntriesForDay = (day: TimetableEntry["day"]) =>
    timetable
      .filter((entry) => entry.day === day)
      .sort((a, b) => a.time.localeCompare(b.time));

  const isPresentToday = (subjectId: string) =>
    attendance.some(
      (record) =>
        record.date === today &&
        record.subjectId === subjectId &&
        record.present === true
    );

  if (authLoading || fetching) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando tu panel...</p>
      </div>
    );
  }

  if (!profile || !isStudent) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center gap-4 px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Este panel está disponible únicamente para estudiantes registrados.
          </CardDescription>
        </Card>
        <Button variant="secondary" onClick={() => signOut()}>
          Cerrar sesión
        </Button>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-[400px] flex items-center justify-center px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <CardTitle>Expediente no encontrado</CardTitle>
          <CardDescription>
            No encontramos tu expediente en EduChain. Contacta al orientador para actualizar tus datos.
          </CardDescription>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mi identificación digital</CardTitle>
          <CardDescription>Tu credencial oficial de EduChain.</CardDescription>
        </CardHeader>
        <CardContent>
          <IdCard
            name={student.name}
            role="Estudiante"
            cycle={student.groupId || "Sin grupo"}
            avatarUrl={student.avatarUrl}
            idLabel={student.id.slice(0, 6).toUpperCase()}
          />
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-lg text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Registrar asistencia</CardTitle>
              <CardDescription>
                Ingresa el código de 4 dígitos que muestra tu profesor.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={validationCode}
                onChange={(event) =>
                  setValidationCode(event.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="0000"
                className="pl-10 h-11 text-lg tracking-[0.5em] font-black text-center"
                disabled={isVerifying}
              />
            </div>
            <Button
              className="h-11 w-full sm:w-auto px-8"
              onClick={handleVerifyAttendance}
              disabled={isVerifying || validationCode.length !== 4}
            >
              {isVerifying ? "Verificando..." : "Registrar asistencia"}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>Se comprobará tu ubicación dentro del plantel antes de registrar.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mi horario</CardTitle>
          <CardDescription>Horario asociado a tu grupo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {daysOfWeek.map((day) => {
            const entries = getEntriesForDay(day);

            return (
              <div key={day}>
                <h3 className="font-bold mb-2">{day}</h3>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">Sin clases programadas.</p>
                ) : (
                  <div className="grid gap-2">
                    {entries.map((entry) => {
                      const present = isPresentToday(entry.subjectId);

                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {subjectMap[entry.subjectId] || "Materia"}
                              </p>
                              <p className="text-xs text-muted-foreground">{entry.time}</p>
                            </div>
                          </div>
                          {present ? (
                            <Badge variant={entry.day === currentDay ? "default" : "outline"} className="shrink-0">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {entry.day === currentDay ? "Presente hoy" : "Presente"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0">Pendiente</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de asistencia</CardTitle>
          <CardDescription>Registros guardados en EduChain.</CardDescription>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no tienes registros de asistencia.</p>
          ) : (
            <div className="space-y-2">
              {attendance.slice(0, 15).map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {subjectMap[record.subjectId] || "Materia"}
                    </p>
                    <p className="text-xs text-muted-foreground">{record.date}</p>
                  </div>
                  <Badge variant={record.present ? "default" : "destructive"}>
                    {record.present ? "Presente" : "Falta"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
