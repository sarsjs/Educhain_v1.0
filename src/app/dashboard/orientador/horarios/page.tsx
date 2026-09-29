'use client';

import * as React from 'react';
import { TimetableManager } from '@/components/dashboard/timetable-manager';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  addTimetableEntry,
  deleteTimetableEntry,
  fetchAllTimetables,
  fetchGroupsByCounselor,
  fetchSubjects,
  fetchUsers,
} from '@/lib/firebase/data';
import type { TimetableEntry, Group, Subject, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CounselorSchedulePage() {
  const { profile: user } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [entries, setEntries] = React.useState<TimetableEntry[]>([]);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [teachers, setTeachers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(true);

  const loadData = React.useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [counselorGroups, allEntries, allSubjects, users] = await Promise.all([
        fetchGroupsByCounselor(user.id),
        fetchAllTimetables(),
        fetchSubjects(),
        fetchUsers(),
      ]);
      setGroups(counselorGroups);
      setEntries(allEntries);
      setSubjects(allSubjects);
      setTeachers(users.filter((u) => u.role === 'profesor'));
    } catch (error) {
      console.error(error);
      toast({
        title: 'No se pudo cargar el horario',
        description: 'Revisa tu conexión e inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = async (entry: Omit<TimetableEntry, 'id'>) => {
    await addTimetableEntry(entry);
    await loadData();
  };

  const handleDelete = async (entryId: string) => {
    await deleteTimetableEntry(entryId);
    await loadData();
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Horarios de tus grupos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Gestiona el horario de los grupos que tienes asignados y verifica que los docentes no se empalmen.
          </p>
        </CardContent>
      </Card>

      <TimetableManager
        entries={entries}
        subjects={subjects}
        groups={groups}
        teachers={teachers}
        onAddEntry={handleAdd}
        onDeleteEntry={handleDelete}
        loading={loading}
      />
    </div>
  );
}
