'use client';

import * as React from 'react';
import { BookOpen, CalendarDays, Plus, Trash2, Users, UserPlus, Link2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  addAcademicAssignment, addGroup, addSubject, addTeacher, addTimetableEntry,
  deleteAcademicAssignment, deleteTimetableEntry, fetchAcademicAssignments,
  fetchGroups, fetchGroupsByCounselor, fetchSubjects, fetchTimetableByGroups,
  fetchUsers, updateAcademicAssignment, updateGroup, updateSubject, updateUser
} from '@/lib/firebase/data';
import type { AcademicAssignment, Group, Subject, TimetableEntry, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const days = ['Lunes','Martes','Miércoles','Jueves','Viernes'] as const;
type Mode = 'director' | 'orientador';

const minutes = (value: string) => {
  const [h,m] = value.split(':').map(Number);
  return h * 60 + m;
};
const rangeParts = (value: string) => {
  const [a,b] = value.split(' - ');
  return [a,b] as [string,string];
};
const overlaps = (a: string, b: string) => {
  const [as,ae] = rangeParts(a), [bs,be] = rangeParts(b);
  return minutes(as) < minutes(be) && minutes(bs) < minutes(ae);
};

export function AcademicPlanning({ mode }: { mode: Mode }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [groups,setGroups] = React.useState<Group[]>([]);
  const [teachers,setTeachers] = React.useState<User[]>([]);
  const [subjects,setSubjects] = React.useState<Subject[]>([]);
  const [assignments,setAssignments] = React.useState<AcademicAssignment[]>([]);
  const [entries,setEntries] = React.useState<TimetableEntry[]>([]);
  const [loading,setLoading] = React.useState(true);

  const [groupName,setGroupName] = React.useState('');
  const [semester,setSemester] = React.useState('1');
  const [teacherName,setTeacherName] = React.useState('');
  const [teacherEmail,setTeacherEmail] = React.useState('');
  const [subjectName,setSubjectName] = React.useState('');
  const [groupId,setGroupId] = React.useState('');
  const [subjectId,setSubjectId] = React.useState('');
  const [teacherId,setTeacherId] = React.useState('');
  const [day,setDay] = React.useState<typeof days[number]>('Lunes');
  const [start,setStart] = React.useState('07:00');
  const [end,setEnd] = React.useState('07:50');
  const [scheduleGroupId,setScheduleGroupId] = React.useState('');
  const [assignmentId,setAssignmentId] = React.useState('');

  const load = React.useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const visibleGroups = mode === 'director'
        ? await fetchGroups()
        : await fetchGroupsByCounselor(profile.id);
      const groupIds = visibleGroups.map(g => g.id);
      const [users, subs, asgs, tt] = await Promise.all([
        fetchUsers(),
        fetchSubjects(),
        fetchAcademicAssignments(groupIds),
        fetchTimetableByGroups(groupIds),
      ]);
      setGroups(visibleGroups.filter(g => g.active !== false));
      setTeachers(users.filter(u => u.role === 'profesor' && u.status !== 'inactive'));
      setSubjects(subs.filter(s => s.active !== false));
      setAssignments(asgs.filter(a => a.active !== false));
      setEntries(tt);
      if (!groupId && visibleGroups[0]) setGroupId(visibleGroups[0].id);
      if (!scheduleGroupId && visibleGroups[0]) setScheduleGroupId(visibleGroups[0].id);
    } catch (e) {
      console.error(e);
      toast({ title:'No se pudo cargar la planeación', description:'Revisa la conexión.', variant:'destructive' });
    } finally { setLoading(false); }
  }, [mode, profile, toast, groupId, scheduleGroupId]);

  React.useEffect(() => { load(); }, [load]);

  const createGroup = async () => {
    if (!profile || !groupName.trim()) return;
    await addGroup({
      name: groupName.trim(),
      semester: Number(semester),
      cycleId: 'actual',
      counselorId: mode === 'orientador' ? profile.id : '',
      active: true,
    });
    setGroupName('');
    toast({title:'Grupo creado'});
    await load();
  };

  const createTeacher = async () => {
    if (!teacherName.trim() || !teacherEmail.trim()) return;
    try {
      await addTeacher({name:teacherName.trim(), email:teacherEmail.trim()});
      setTeacherName(''); setTeacherEmail('');
      toast({title:'Profesor creado', description:'Se creó su cuenta de acceso.'});
      await load();
    } catch (e:any) {
      toast({title:'No se pudo crear el profesor', description:e?.message || 'Revisa el correo.', variant:'destructive'});
    }
  };

  const createSubject = async () => {
    if (!subjectName.trim()) return;
    await addSubject({name:subjectName.trim(), active:true});
    setSubjectName('');
    toast({title:'Materia creada'});
    await load();
  };

  const createAssignment = async () => {
    if (!groupId || !subjectId || !teacherId) return;
    const duplicate = assignments.some(a => a.groupId === groupId && a.subjectId === subjectId && a.active !== false);
    if (duplicate) {
      toast({title:'Asignación duplicada', description:'Ese grupo ya tiene esa materia asignada.', variant:'destructive'});
      return;
    }
    await addAcademicAssignment({groupId, subjectId, teacherId, active:true});
    toast({title:'Asignación creada'});
    await load();
  };

  const removeAssignment = async (id:string) => {
    await deleteAcademicAssignment(id);
    await load();
  };

  const createSchedule = async () => {
    if (!scheduleGroupId || !assignmentId) return;
    if (minutes(start) >= minutes(end)) {
      toast({title:'Horario inválido', description:'La hora inicial debe ser menor que la final.', variant:'destructive'});
      return;
    }
    const assignment = assignments.find(a => a.id === assignmentId);
    if (!assignment || assignment.groupId !== scheduleGroupId) {
      toast({title:'Asignación inválida', description:'Selecciona una asignación del grupo elegido.', variant:'destructive'});
      return;
    }
    const time = start + ' - ' + end;
    const conflict = entries.find(e =>
      e.day === day && e.groupId === scheduleGroupId && overlaps(e.time,time)
    );
    const teacherConflict = entries.find(e =>
      e.day === day && e.teacherId === assignment.teacherId && overlaps(e.time,time)
    );
    if (conflict || teacherConflict) {
      toast({title:'Empalme detectado', description: conflict ? 'El grupo ya tiene clase en ese horario.' : 'El profesor ya tiene otra clase en ese horario.', variant:'destructive'});
      return;
    }
    await addTimetableEntry({
      groupId:scheduleGroupId,
      subjectId:assignment.subjectId,
      teacherId:assignment.teacherId,
      day,
      time,
    });
    toast({title:'Horario creado'});
    await load();
  };

  const removeSchedule = async (id:string) => {
    await deleteTimetableEntry(id);
    await load();
  };


  const editGroup = async (group: Group) => {
    const name = window.prompt('Nombre del grupo:', group.name);
    if (!name?.trim()) return;
    const semesterValue = window.prompt('Semestre (1-6):', String(group.semester));
    const nextSemester = Number(semesterValue);
    if (!Number.isInteger(nextSemester) || nextSemester < 1 || nextSemester > 6) return;
    await updateGroup(group.id, { name: name.trim(), semester: nextSemester });
    await load();
  };

  const editTeacher = async (teacher: User) => {
    const name = window.prompt('Nombre del profesor:', teacher.name);
    if (!name?.trim()) return;
    await updateUser(teacher.id, { name: name.trim() });
    await load();
  };

  const deactivateTeacher = async (teacher: User) => {
    const used = assignments.some(a => a.teacherId === teacher.id && a.active !== false);
    if (used) {
      toast({ title:'No se puede retirar todavía', description:'Primero retira sus asignaciones académicas. El historial de horarios y asistencia se conserva.', variant:'destructive' });
      return;
    }
    if (!window.confirm(`¿Dar de baja a ${teacher.name}? Su historial no se eliminará.`)) return;
    await updateUser(teacher.id, { status:'inactive' });
    await load();
  };

  const editSubject = async (subject: Subject) => {
    const name = window.prompt('Nombre de la materia:', subject.name);
    if (!name?.trim()) return;
    await updateSubject(subject.id, { name: name.trim() });
    await load();
  };

  const deactivateSubject = async (subject: Subject) => {
    const used = assignments.some(a => a.subjectId === subject.id && a.active !== false);
    if (used) {
      toast({ title:'No se puede retirar todavía', description:'Primero retira sus asignaciones. El historial de horarios y asistencia se conserva.', variant:'destructive' });
      return;
    }
    if (!window.confirm(`¿Retirar la materia ${subject.name}? Su historial no se eliminará.`)) return;
    await updateSubject(subject.id, { active:false });
    await load();
  };

  const groupLabel = (id:string) => {
    const g=groups.find(x=>x.id===id);
    return g ? `${g.semester}° ${g.name}` : id;
  };
  const teacherLabel = (id:string) => teachers.find(x=>x.id===id)?.name || id;
  const subjectLabel = (id:string) => subjects.find(x=>x.id===id)?.name || id;

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Planeación académica</h1>
        <p className="text-muted-foreground">
          {mode === 'director' ? 'Vista unificada de toda la escuela.' : 'Administra tus grupos y arma sus horarios sin depender del director.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5"/>Grupos</CardTitle><CardDescription>Semestre y grupo.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2"><Input placeholder="Ej. Grupo A" value={groupName} onChange={e=>setGroupName(e.target.value)}/><Input className="w-24" type="number" min="1" max="6" value={semester} onChange={e=>setSemester(e.target.value)}/></div>
            <Button onClick={createGroup} className="w-full"><Plus className="h-4 w-4 mr-2"/>Agregar grupo</Button>
            <div className="space-y-1 max-h-48 overflow-auto">{groups.map(g=><div key={g.id} className="flex justify-between items-center gap-2 text-sm border rounded p-2"><span>{g.semester}° {g.name}</span><div className="flex items-center gap-2"><Badge variant="outline">{mode==='director'?'Unificado':'A mi cargo'}</Badge><Button variant="ghost" size="sm" onClick={()=>editGroup(g)}>Editar</Button></div></div>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5"/>Profesores</CardTitle><CardDescription>Catálogo independiente de docentes.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Nombre completo" value={teacherName} onChange={e=>setTeacherName(e.target.value)}/>
            <Input type="email" placeholder="Correo de acceso" value={teacherEmail} onChange={e=>setTeacherEmail(e.target.value)}/>
            <Button onClick={createTeacher} className="w-full"><Plus className="h-4 w-4 mr-2"/>Agregar profesor</Button>
            <div className="space-y-1 max-h-48 overflow-auto">{teachers.map(u=><div key={u.id} className="flex justify-between items-center gap-2 text-sm border rounded p-2"><div>{u.name}<div className="text-xs text-muted-foreground">{u.email}</div></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={()=>editTeacher(u)}>Editar</Button><Button variant="ghost" size="sm" onClick={()=>deactivateTeacher(u)}>Retirar</Button></div></div>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5"/>Materias</CardTitle><CardDescription>Catálogo independiente de asignaturas.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Nombre de la materia" value={subjectName} onChange={e=>setSubjectName(e.target.value)}/>
            <Button onClick={createSubject} className="w-full"><Plus className="h-4 w-4 mr-2"/>Agregar materia</Button>
            <div className="space-y-1 max-h-48 overflow-auto">{subjects.map(s=><div key={s.id} className="flex justify-between items-center gap-2 text-sm border rounded p-2"><span>{s.name}</span><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={()=>editSubject(s)}>Editar</Button><Button variant="ghost" size="sm" onClick={()=>deactivateSubject(s)}>Retirar</Button></div></div>)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5"/>Asignaciones</CardTitle><CardDescription>Primero se define quién imparte qué materia a qué grupo. Una materia puede tener distintos profesores según el grupo.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Select value={groupId} onValueChange={setGroupId}><SelectTrigger><SelectValue placeholder="Grupo"/></SelectTrigger><SelectContent>{groups.map(g=><SelectItem key={g.id} value={g.id}>{groupLabel(g.id)}</SelectItem>)}</SelectContent></Select>
            <Select value={subjectId} onValueChange={setSubjectId}><SelectTrigger><SelectValue placeholder="Materia"/></SelectTrigger><SelectContent>{subjects.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            <Select value={teacherId} onValueChange={setTeacherId}><SelectTrigger><SelectValue placeholder="Profesor"/></SelectTrigger><SelectContent>{teachers.map(t=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
            <Button onClick={createAssignment}><Plus className="h-4 w-4 mr-2"/>Asignar</Button>
          </div>
          <div className="space-y-2">{assignments.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"><div><b>{groupLabel(a.groupId)}</b> · {subjectLabel(a.subjectId)} · {teacherLabel(a.teacherId)}</div><Button variant="outline" size="sm" onClick={()=>removeAssignment(a.id)}><Trash2 className="h-4 w-4"/></Button></div>)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5"/>Horario</CardTitle><CardDescription>El horario usa la asignación profesor–materia–grupo y evita empalmes del grupo y del profesor.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <Select value={scheduleGroupId} onValueChange={v=>{setScheduleGroupId(v);setAssignmentId('')}}><SelectTrigger><SelectValue placeholder="Grupo"/></SelectTrigger><SelectContent>{groups.map(g=><SelectItem key={g.id} value={g.id}>{groupLabel(g.id)}</SelectItem>)}</SelectContent></Select>
            <Select value={assignmentId} onValueChange={setAssignmentId}><SelectTrigger><SelectValue placeholder="Materia / profesor"/></SelectTrigger><SelectContent>{assignments.filter(a=>a.groupId===scheduleGroupId).map(a=><SelectItem key={a.id} value={a.id}>{subjectLabel(a.subjectId)} · {teacherLabel(a.teacherId)}</SelectItem>)}</SelectContent></Select>
            <Select value={day} onValueChange={v=>setDay(v as typeof days[number])}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{days.map(d=><SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
            <Input type="time" value={start} onChange={e=>setStart(e.target.value)}/>
            <Input type="time" value={end} onChange={e=>setEnd(e.target.value)}/>
            <Button onClick={createSchedule}><Plus className="h-4 w-4 mr-2"/>Agregar</Button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {entries.sort((a,b)=>a.day.localeCompare(b.day)||a.time.localeCompare(b.time)).map(e=><div key={e.id} className="border rounded-lg p-3 flex justify-between gap-2"><div><b>{groupLabel(e.groupId)}</b><div className="text-sm">{subjectLabel(e.subjectId)}</div><div className="text-xs text-muted-foreground">{teacherLabel(e.teacherId || '')} · {e.day} · {e.time}</div></div><Button variant="ghost" size="icon" onClick={()=>removeSchedule(e.id)}><Trash2 className="h-4 w-4"/></Button></div>)}
            {!loading && entries.length===0 && <p className="text-sm text-muted-foreground">Todavía no hay clases programadas.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
