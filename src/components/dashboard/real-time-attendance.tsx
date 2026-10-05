'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCheck, UserX } from "lucide-react";
import type { Attendance, User } from "@/lib/types";

interface Props {
  students: User[];
  attendance: Attendance[];
}

export function RealTimeAttendance({ students, attendance }: Props) {
  const presentIds = new Set(
    attendance.filter((record) => record.present).map((record) => record.studentId)
  );

  const present = students.filter((student) => presentIds.has(student.id));
  const pending = students.filter((student) => !presentIds.has(student.id));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              Asistencia de hoy
            </CardTitle>
            <CardDescription>
              Registro real de asistencia guardado en EduChain.
            </CardDescription>
          </div>
          <Badge variant="outline">
            {present.length}/{students.length} presentes
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-2">
            Presentes
          </h4>
          <div className="grid gap-2 md:grid-cols-2">
            {present.map((student) => (
              <StatusItem key={student.id} student={student} present />
            ))}
            {present.length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no hay asistencias registradas.</p>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-2">
            Sin registro
          </h4>
          <div className="grid gap-2 md:grid-cols-2">
            {pending.map((student) => (
              <StatusItem key={student.id} student={student} present={false} />
            ))}
            {pending.length === 0 && (
              <p className="text-sm text-muted-foreground">Todos tienen asistencia registrada.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusItem({ student, present }: { student: User; present: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="h-8 w-8">
          <AvatarImage src={student.avatarUrl} alt={student.name} />
          <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium truncate">{student.name}</span>
      </div>

      {present ? (
        <Badge>
          <UserCheck className="h-3 w-3 mr-1" />
          Presente
        </Badge>
      ) : (
        <Badge variant="outline">
          <UserX className="h-3 w-3 mr-1" />
          Sin registro
        </Badge>
      )}
    </div>
  );
}
