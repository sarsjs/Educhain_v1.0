'use client';

import * as React from 'react';
import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/context/auth-context';
import {
    fetchUsers,
    createSubstitutionRequest,
    fetchSubstitutionRequestsForCounselor,
    handleSubstitutionRequest
} from '@/lib/firebase/data';
import type { User, SubstitutionRequest, Group } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { UserCircle, UserCheck, UserX, Clock, Send, CalendarDays } from 'lucide-react';

interface SubstitutionManagerProps {
    myGroups: Group[];
    onUpdate: () => void;
}

const getNextWeekday = () => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    else if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
};

const toDateInput = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export function SubstitutionManager({ myGroups, onUpdate }: SubstitutionManagerProps) {
    const { profile: user } = useAuth();
    const { toast } = useToast();

    const [others, setOthers] = React.useState<User[]>([]);
    const [requests, setRequests] = React.useState<SubstitutionRequest[]>([]);
    const [isRequesting, setIsRequesting] = React.useState(false);
    const [selectedCounselorId, setSelectedCounselorId] = React.useState('');
    const [selectedGroupIds, setSelectedGroupIds] = React.useState<string[]>([]);
    const [requestDate, setRequestDate] = React.useState(toDateInput(getNextWeekday()));
    const [startTime, setStartTime] = React.useState('07:00');
    const [endTime, setEndTime] = React.useState('14:00');
    const [requestMessage, setRequestMessage] = React.useState('');
    const [dialogOpen, setDialogOpen] = React.useState(false);

    const loadData = React.useCallback(async () => {
        if (!user?.id) return;
        try {
            const [allUsers, reqs] = await Promise.all([
                fetchUsers(),
                fetchSubstitutionRequestsForCounselor(user.id)
            ]);
            setOthers(allUsers.filter(u => u.role === 'orientador' && u.id !== user.id));
            setRequests(reqs);
        } catch (error) {
            console.error(error);
        }
    }, [user?.id]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    const toggleGroup = (groupId: string) => {
        setSelectedGroupIds(prev =>
            prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
        );
    };

    const handleSendRequest = async () => {
        if (!selectedCounselorId || !user?.id || selectedGroupIds.length === 0) return;

        try {
            setIsRequesting(true);
            await createSubstitutionRequest({
                fromCounselorId: user.id,
                toCounselorId: selectedCounselorId,
                groupIds: selectedGroupIds,
                date: requestDate,
                startTime,
                endTime,
                message: requestMessage || `Solicitud de suplencia para el ${requestDate} de ${startTime} a ${endTime}.`
            });

            toast({
                title: 'Solicitud programada',
                description: 'El orientador seleccionado recibirá la solicitud. Si acepta, la suplencia quedará programada para esa fecha.'
            });
            setDialogOpen(false);
            setRequestMessage('');
            loadData();
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'No se pudo enviar la solicitud.',
                variant: 'destructive'
            });
        } finally {
            setIsRequesting(false);
        }
    };

    const handleAction = async (request: SubstitutionRequest, action: 'accepted' | 'declined') => {
        try {
            await handleSubstitutionRequest(request.id, action, request);
            toast({
                title: action === 'accepted' ? 'Suplencia aceptada' : 'Solicitud rechazada',
                description: action === 'accepted'
                    ? `Quedó programada para ${request.date} de ${request.startTime} a ${request.endTime}.`
                    : 'Se ha notificado el rechazo.'
            });
            loadData();
            onUpdate();
        } catch (error) {
            toast({ title: 'Error', description: 'No se pudo procesar la acción.', variant: 'destructive' });
        }
    };

    const incomingPending = requests.filter(r => r.toCounselorId === user?.id && r.status === 'pending');
    const scheduled = requests.filter(r => r.fromCounselorId === user?.id && r.status === 'accepted');

    return (
        <div className="space-y-4">
            {incomingPending.length > 0 && (
                <div className="space-y-3">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                        <Clock className="h-3 w-3 animate-pulse" /> Solicitudes de Suplencia
                    </p>
                    {incomingPending.map(req => {
                        const fromUser = others.find(u => u.id === req.fromCounselorId);
                        return (
                            <Card key={req.id} className="border-blue-200 bg-blue-50/30 overflow-hidden">
                                <CardContent className="p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 bg-blue-100 rounded-full">
                                            <UserCircle className="h-5 w-5 text-blue-600" />
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <p className="text-sm font-bold">{fromUser?.name || 'Un compañero'}</p>
                                            <p className="text-xs text-muted-foreground">{req.message}</p>
                                            <p className="text-xs font-semibold">
                                                {req.date} · {req.startTime}–{req.endTime} · {req.groupIds.length} grupo(s)
                                            </p>
                                            <div className="flex gap-2">
                                                <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" onClick={() => handleAction(req, 'accepted')}>
                                                    <UserCheck className="h-4 w-4 mr-2" /> Aceptar
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-8 border-blue-200 text-blue-700 hover:bg-blue-100" onClick={() => handleAction(req, 'declined')}>
                                                    <UserX className="h-4 w-4 mr-2" /> Rechazar
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {scheduled.length > 0 && (
                <Card className="border-emerald-200 bg-emerald-50/30">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-emerald-600" />
                            Suplencias programadas
                        </CardTitle>
                        <CardDescription>Al llegar la fecha y horario, EduChain activa automáticamente el acceso temporal a esos grupos.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {scheduled.map(req => (
                            <div key={req.id} className="rounded-lg border bg-background p-3 text-xs">
                                <div className="font-bold">{req.date} · {req.startTime}–{req.endTime}</div>
                                <div className="text-muted-foreground">{req.groupIds.length} grupo(s) · Solicitud aceptada</div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" className="w-full border-dashed border-slate-300 hover:border-primary hover:text-primary transition-all">
                        <Send className="h-4 w-4 mr-2" /> Programar Suplencia
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Programar suplencia</DialogTitle>
                        <DialogDescription>
                            Selecciona al orientador, los grupos y el día que necesitas cubrir. La transferencia será temporal y comenzará automáticamente en la fecha y horario acordados.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Orientador suplente</label>
                            <select
                                value={selectedCounselorId}
                                onChange={e => setSelectedCounselorId(e.target.value)}
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                            >
                                <option value="">Selecciona un orientador...</option>
                                {others.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Grupos que cubrirá</label>
                            <div className="rounded-lg border p-3 space-y-2 max-h-40 overflow-y-auto">
                                {myGroups.filter(g => g.counselorId === user?.id).map(group => (
                                    <label key={group.id} className="flex items-center gap-3 cursor-pointer">
                                        <Checkbox checked={selectedGroupIds.includes(group.id)} onCheckedChange={() => toggleGroup(group.id)} />
                                        <span className="text-sm">{group.name}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">{selectedGroupIds.length} grupo(s) seleccionado(s)</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-2 sm:col-span-1">
                                <label className="text-sm font-medium">Día</label>
                                <Input
                                    type="date"
                                    value={requestDate}
                                    min={toDateInput(new Date())}
                                    onChange={e => setRequestDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Desde</label>
                                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Hasta</label>
                                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Motivo o mensaje (opcional)</label>
                            <Input value={requestMessage} onChange={e => setRequestMessage(e.target.value)} placeholder="Ej. Tengo permiso médico el viernes." />
                        </div>

                        <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                            <p className="text-xs text-amber-800">
                                <strong>Importante:</strong> El orientador B no tendrá acceso ahora. Solo después de aceptar y cuando llegue el día/hora programados se habilitará la cobertura de los grupos seleccionados. Al terminar, el acceso temporal se cierra.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSendRequest} disabled={isRequesting || !selectedCounselorId || selectedGroupIds.length === 0}>
                            {isRequesting ? 'Enviando...' : 'Enviar solicitud'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
