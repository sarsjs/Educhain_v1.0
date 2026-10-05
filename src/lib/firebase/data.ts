import { collection, getDocs, addDoc, doc, deleteDoc, query, where, updateDoc, writeBatch, orderBy, serverTimestamp, getDoc, deleteField, limit, onSnapshot, arrayUnion, setDoc, Timestamp, runTransaction } from "firebase/firestore";
import { db, storage } from "./client";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import type { User, Group, Subject, TimetableEntry, Attendance, Message, Grade, CalendarEvent, SubstitutionRequest, CounselorCoverage, CounselorClassTakeover, CounselorIncidentReport, WorkLog, ActivityLog, ChatMessage, SchoolPresenceCheck, AcademicAssignment, AttendanceAppeal } from "@/lib/types";

const fetchData = async <T>(fetchFunction: () => Promise<T[]>, entityName: string): Promise<T[]> => {
    try {
        return await fetchFunction();
    } catch (error) {
        console.error(`Error fetching ${entityName}:`, error);
        return []; // Return an empty array on error to prevent crashes
    }
};

// Temporary counselor coverage: the titular counselor remains unchanged.
export const createSubstitutionRequest = async (request: Omit<SubstitutionRequest, 'id' | 'timestamp' | 'status'>) => {
    if (!request.groupIds.length) throw new Error("Debes seleccionar al menos un grupo.");
    if (request.startTime >= request.endTime) throw new Error("La hora de inicio debe ser menor que la hora de término.");
    const day = new Date(request.date + 'T12:00:00').getDay();
    if (day === 0 || day === 6) throw new Error("Las suplencias solo pueden programarse de lunes a viernes.");

    return await addDoc(collection(db, "substitution_requests"), {
        ...request,
        timestamp: serverTimestamp(),
        status: 'pending'
    });
};

export const fetchSubstitutionRequestsForCounselor = async (counselorId: string): Promise<SubstitutionRequest[]> => fetchData(async () => {
    const [incoming, outgoing] = await Promise.all([
        getDocs(query(collection(db, "substitution_requests"), where("toCounselorId", "==", counselorId))),
        getDocs(query(collection(db, "substitution_requests"), where("fromCounselorId", "==", counselorId))),
    ]);
    const map = new Map<string, SubstitutionRequest>();
    [...incoming.docs, ...outgoing.docs].forEach(item => {
        map.set(item.id, { id: item.id, ...item.data() } as unknown as SubstitutionRequest);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
}, 'counselor substitution requests');

export const fetchSubstitutionRequests = async (toCounselorId: string): Promise<SubstitutionRequest[]> => fetchData(async () => {
    const q = query(collection(db, "substitution_requests"), where("toCounselorId", "==", toCounselorId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as unknown as SubstitutionRequest))
        .filter(item => item.status === 'pending');
}, 'substitution requests');

export const handleSubstitutionRequest = async (
    requestId: string,
    status: 'accepted' | 'declined',
    requestBody?: SubstitutionRequest
) => {
    const requestRef = doc(db, "substitution_requests", requestId);
    await updateDoc(requestRef, { status });

    if (status === 'accepted' && requestBody) {
        const batch = writeBatch(db);

        requestBody.groupIds.forEach(groupId => {
            const coverageRef = doc(collection(db, "counselor_coverages"));
            batch.set(coverageRef, {
                groupId,
                primaryCounselorId: requestBody.fromCounselorId,
                substituteCounselorId: requestBody.toCounselorId,
                date: requestBody.date,
                startTime: requestBody.startTime,
                endTime: requestBody.endTime,
                reason: requestBody.message || "Cobertura temporal entre orientadores.",
                status: coverageDateTime(requestBody.date, requestBody.startTime) <= new Date() &&
                    new Date() <= coverageDateTime(requestBody.date, requestBody.endTime) ? 'active' : 'scheduled',
                createdBy: requestBody.toCounselorId,
                startsAt: Timestamp.fromDate(coverageDateTime(requestBody.date, requestBody.startTime)),
                endsAt: Timestamp.fromDate(coverageDateTime(requestBody.date, requestBody.endTime)),
                createdAt: serverTimestamp()
            } satisfies Omit<CounselorCoverage, 'id'>);
        });

        await batch.commit();

        await addDoc(collection(db, "messages"), {
            content: `Cobertura temporal: el orientador ${requestBody.toCounselorId} apoyará temporalmente los grupos acordados de ${requestBody.fromCounselorId}.`,
            recipientFilter: 'director',
            timestamp: serverTimestamp(),
            createdBy: requestBody.fromCounselorId,
            createdByRole: 'orientador'
        });
    }
};

export const fetchCounselorCoverages = async (
    groupIds: string[],
    date: string
): Promise<CounselorCoverage[]> => fetchData(async () => {
    if (groupIds.length === 0) return [];
    const q = query(
        collection(db, "counselor_coverages"),
        where("date", "==", date),
        where("groupId", "in", groupIds.slice(0, 30))
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CounselorCoverage));
}, 'counselor coverages');

const coverageDateTime = (date: string, time: string) => {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
};

export const fetchCounselorCoveragesForCounselor = async (
    counselorId: string,
    date?: string
): Promise<CounselorCoverage[]> => fetchData(async () => {
    const [asSubstitute, asPrimary] = await Promise.all([
        getDocs(query(collection(db, "counselor_coverages"), where("substituteCounselorId", "==", counselorId))),
        getDocs(query(collection(db, "counselor_coverages"), where("primaryCounselorId", "==", counselorId))),
    ]);
    const map = new Map<string, CounselorCoverage>();
    [...asSubstitute.docs, ...asPrimary.docs].forEach(item => {
        const coverage = { id: item.id, ...item.data() } as CounselorCoverage;
        if (!date || coverage.date === date) map.set(coverage.id, coverage);
    });
    return Array.from(map.values());
}, 'counselor coverages for counselor');

export const isCounselorCoverageActive = (coverage: CounselorCoverage, now = new Date()) => {
    if (coverage.status !== 'active') return false;
    const start = coverage.startsAt && typeof (coverage.startsAt as any).toDate === 'function'
        ? (coverage.startsAt as any).toDate()
        : coverageDateTime(coverage.date, coverage.startTime);
    const end = coverage.endsAt && typeof (coverage.endsAt as any).toDate === 'function'
        ? (coverage.endsAt as any).toDate()
        : coverageDateTime(coverage.date, coverage.endTime);
    return now >= start && now <= end;
};

export const closeCounselorCoverage = async (
    coverageId: string,
    counselorId: string,
    closingSummary: string
) => {
    const coverageRef = doc(db, "counselor_coverages", coverageId);
    const coverageSnap = await getDoc(coverageRef);
    if (!coverageSnap.exists()) throw new Error("La cobertura ya no existe.");
    const coverage = { id: coverageSnap.id, ...coverageSnap.data() } as CounselorCoverage;
    if (coverage.substituteCounselorId !== counselorId && coverage.primaryCounselorId !== counselorId) {
        throw new Error("No tienes autorización para cerrar esta cobertura.");
    }
    if (coverage.status !== 'active') throw new Error("La cobertura ya está cerrada.");
    await updateDoc(coverageRef, {
        status: 'expired',
        closedAt: serverTimestamp(),
        closedBy: counselorId,
        closingSummary: closingSummary.trim(),
    });
};

export const createCounselorClassTakeover = async (
    takeover: Omit<CounselorClassTakeover, 'id' | 'createdAt'>
) => {
    const coverageSnap = await getDoc(doc(db, "counselor_coverages", takeover.coverageId));
    if (!coverageSnap.exists()) throw new Error("La cobertura ya no existe.");
    const coverage = { id: coverageSnap.id, ...coverageSnap.data() } as CounselorCoverage;
    if (coverage.substituteCounselorId !== takeover.counselorId) {
        throw new Error("Solo el orientador sustituto puede tomar este grupo.");
    }
    if (!isCounselorCoverageActive(coverage)) {
        throw new Error("La cobertura no está activa en este momento.");
    }
    if (coverage.groupId !== takeover.groupId) {
        throw new Error("El grupo no corresponde a la cobertura.");
    }
    const timetableSnap = await getDoc(doc(db, "timetables", takeover.timetableId));
    if (!timetableSnap.exists()) throw new Error("La clase programada ya no existe.");
    const timetable = timetableSnap.data() as TimetableEntry;
    if (timetable.groupId !== takeover.groupId || timetable.subjectId !== takeover.subjectId) {
        throw new Error("La clase no corresponde al grupo o materia indicados.");
    }
    const subjectSnap = await getDoc(doc(db, "subjects", takeover.subjectId));
    if (!subjectSnap.exists()) throw new Error("La materia ya no existe.");
    const subject = subjectSnap.data() as Subject;
    const scheduledTeacherId = timetable.teacherId || subject.teacherId;
    if (!scheduledTeacherId || scheduledTeacherId !== takeover.teacherId) {
        throw new Error("El profesor indicado no corresponde a la clase programada.");
    }
    if (takeover.date !== coverage.date) throw new Error("La fecha no corresponde a la cobertura.");

    const takeoverId = `${takeover.coverageId}_${takeover.timetableId}`;
    const takeoverRef = doc(db, "counselor_class_takeovers", takeoverId);
    const existingTakeover = await getDoc(takeoverRef);
    if (existingTakeover.exists()) throw new Error("Esta clase ya fue tomada por el orientador.");
    await setDoc(takeoverRef, {
        ...takeover,
        createdAt: serverTimestamp(),
    });
    return takeoverRef;
};

export const fetchCounselorClassTakeovers = async (
    coverageIds: string[]
): Promise<CounselorClassTakeover[]> => fetchData(async () => {
    if (coverageIds.length === 0) return [];
    const results: CounselorClassTakeover[] = [];
    for (let i = 0; i < coverageIds.length; i += 30) {
        const chunk = coverageIds.slice(i, i + 30);
        const snapshot = await getDocs(query(
            collection(db, "counselor_class_takeovers"),
            where("coverageId", "in", chunk)
        ));
        results.push(...snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CounselorClassTakeover)));
    }
    return results;
}, 'counselor class takeovers');

export const createCounselorIncidentReport = async (
    report: Omit<CounselorIncidentReport, 'id' | 'createdAt'>
) => {
    const coverageSnap = await getDoc(doc(db, "counselor_coverages", report.coverageId));
    if (!coverageSnap.exists()) throw new Error("La cobertura ya no existe.");

    const coverage = { id: coverageSnap.id, ...coverageSnap.data() } as CounselorCoverage;
    if (coverage.substituteCounselorId !== report.createdBy && coverage.primaryCounselorId !== report.createdBy) {
        throw new Error("No tienes autorización para registrar novedades de esta cobertura.");
    }
    if (!isCounselorCoverageActive(coverage) && report.createdByRole !== 'director') {
        throw new Error("La cobertura no está activa en este momento.");
    }

    return await addDoc(collection(db, "counselor_incident_reports"), {
        ...report,
        createdAt: serverTimestamp(),
    });
};

export const fetchCounselorIncidentReports = async (
    coverageIds: string[]
): Promise<CounselorIncidentReport[]> => fetchData(async () => {
    if (coverageIds.length === 0) return [];
    const results: CounselorIncidentReport[] = [];
    for (let i = 0; i < coverageIds.length; i += 30) {
        const chunk = coverageIds.slice(i, i + 30);
        const snapshot = await getDocs(query(
            collection(db, "counselor_incident_reports"),
            where("coverageId", "in", chunk)
        ));
        results.push(...snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CounselorIncidentReport)));
    }
    return results.sort((x, y) => (y.date + " " + y.time).localeCompare(x.date + " " + x.time));
}, 'counselor incident reports');

// Fetch functions
export const fetchUsers = async (): Promise<User[]> => fetchData(async () => {
    const querySnapshot = await getDocs(collection(db, "users"));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as User));
}, 'users');

export const fetchUserByEmail = async (email: string): Promise<User | null> => {
    try {
        const normalizedEmail = email.trim().toLowerCase();

        const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.warn(`No user profile found in Firestore for email: ${normalizedEmail}`);
            return null;
        }

        const userDoc = querySnapshot.docs[0];
        return { id: userDoc.id, ...userDoc.data() } as unknown as User;

    } catch (error) {
        console.error("Error fetching user by email:", error);
        return null;
    }
};

export const fetchUsersByRole = async (role: User['role']): Promise<User[]> => fetchData(async () => {
    const q = query(collection(db, "users"), where("role", "==", role));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as User));
}, 'users by role');

export const fetchUserById = async (id: string): Promise<User | null> => {
    try {
        const docRef = doc(db, "users", id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as unknown as User;
        }
        return null;
    } catch (error) {
        console.error("Error fetching user by id:", error);
        return null;
    }
};

export const fetchStudentByEmail = async (email: string): Promise<User | null> => {
    const user = await fetchUserByEmail(email);
    if (user && (user.role === 'estudiante' || user.role === 'alumno')) {
        return user;
    }
    return null;
};

export const fetchGroups = async (): Promise<Group[]> => fetchData(async () => {
    const querySnapshot = await getDocs(collection(db, "groups"));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Group));
}, 'groups');

export const fetchGroupsByCounselor = async (counselorId: string): Promise<Group[]> => fetchData(async () => {
    const q1 = query(collection(db, "groups"), where("counselorId", "==", counselorId));
    const q2 = query(collection(db, "groups"), where("tempCounselorId", "==", counselorId));

    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const groupsMap = new Map<string, Group>();

    snap1.docs.forEach(doc => {
        groupsMap.set(doc.id, { id: doc.id, ...doc.data() } as unknown as Group);
    });
    snap2.docs.forEach(doc => {
        groupsMap.set(doc.id, { id: doc.id, ...doc.data() } as unknown as Group);
    });

    // Una suplencia futura no da acceso antes de tiempo. Solo se agregan
    // coberturas que ya comenzaron y siguen vigentes.
    const now = new Date();
    const today = getTodayDateKey();
    const coverageSnap = await getDocs(query(
        collection(db, "counselor_coverages"),
        where("substituteCounselorId", "==", counselorId),
        where("date", "==", today)
    ));
    const activeCoverages = coverageSnap.docs
        .map(item => ({ id: item.id, ...item.data() } as CounselorCoverage))
        .filter(coverage => {
            if (coverage.status === 'cancelled' || coverage.status === 'expired') return false;
            const start = coverage.startsAt?.toDate?.() ?? coverageDateTime(coverage.date, coverage.startTime);
            const end = coverage.endsAt?.toDate?.() ?? coverageDateTime(coverage.date, coverage.endTime);
            return now >= start && now <= end;
        });

    if (activeCoverages.length > 0) {
        const coverageGroupIds = [...new Set(activeCoverages.map(c => c.groupId))];
        const allGroups = await fetchGroups();
        allGroups
            .filter(group => coverageGroupIds.includes(group.id))
            .forEach(group => groupsMap.set(group.id, {
                ...group,
                tempCounselorId: counselorId,
                absenceStatus: { isActive: true, message: 'Suplencia activa programada' }
            }));
    }

    return Array.from(groupsMap.values());
}, 'groups by counselor');

export const updateGroupAbsence = async (groupId: string, data: { tempCounselorId?: string, isActive: boolean, message?: string }) => {
    const groupRef = doc(db, "groups", groupId);
    await updateDoc(groupRef, {
        tempCounselorId: data.isActive ? data.tempCounselorId : deleteField(),
        absenceStatus: {
            isActive: data.isActive,
            message: data.message || ""
        }
    });
};

export const fetchGroupsBySubject = async (subjectId: string): Promise<Group[]> => fetchData(async () => {
    const timetableQuery = query(collection(db, "timetables"), where("subjectId", "==", subjectId));
    const timetableSnapshot = await getDocs(timetableQuery);
    const groupIds = [...new Set(timetableSnapshot.docs.map(doc => doc.data().groupId as string))];
    if (groupIds.length === 0) return [];
    const allGroups = await fetchGroups();
    return allGroups.filter(group => groupIds.includes(group.id));
}, 'groups by subject');

export const fetchSubjects = async (): Promise<Subject[]> => fetchData(async () => {
    const querySnapshot = await getDocs(collection(db, "subjects"));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Subject));
}, 'subjects');

export const fetchSubjectsByTeacher = async (teacherId: string): Promise<Subject[]> => fetchData(async () => {
    const q = query(collection(db, "subjects"), where("teacherId", "==", teacherId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Subject));
}, 'subjects by teacher');

export const fetchAcademicAssignments = async (groupIds?: string[]): Promise<AcademicAssignment[]> => fetchData(async () => {
    let q = query(collection(db, "academic_assignments"));
    if (groupIds && groupIds.length > 0) {
        const results: AcademicAssignment[] = [];
        for (let i = 0; i < groupIds.length; i += 30) {
            const chunk = groupIds.slice(i, i + 30);
            const snapshot = await getDocs(query(collection(db, "academic_assignments"), where("groupId", "in", chunk)));
            results.push(...snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AcademicAssignment)));
        }
        return results;
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AcademicAssignment));
}, 'academic assignments');

export const fetchAcademicAssignmentsByTeacher = async (teacherId: string): Promise<AcademicAssignment[]> => fetchData(async () => {
    const q = query(collection(db, "academic_assignments"), where("teacherId", "==", teacherId), where("active", "==", true));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as AcademicAssignment));
}, 'academic assignments by teacher');

export const addAcademicAssignment = async (assignment: Omit<AcademicAssignment, "id" | "createdAt" | "updatedAt">) => {
    const ref = doc(db, "academic_assignments", `${assignment.groupId}_${assignment.subjectId}_${assignment.teacherId}`);
    await setDoc(ref, {
        ...assignment,
        active: assignment.active ?? true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return ref.id;
};

export const updateAcademicAssignment = async (assignmentId: string, data: Partial<Omit<AcademicAssignment, "id">>) =>
    updateDoc(doc(db, "academic_assignments", assignmentId), { ...data, updatedAt: serverTimestamp() });

export const deleteAcademicAssignment = async (assignmentId: string) =>
    deleteDoc(doc(db, "academic_assignments", assignmentId));

export const fetchTimetableByGroup = async (groupId: string): Promise<TimetableEntry[]> => fetchData(async () => {
    const q = query(collection(db, "timetables"), where("groupId", "==", groupId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as TimetableEntry));
}, 'timetable by group');

export const fetchTimetableByGroups = async (groupIds: string[]): Promise<TimetableEntry[]> => {
    if (groupIds.length === 0) return [];
    const results = await Promise.all(groupIds.map(fetchTimetableByGroup));
    return results.flat();
};

export const fetchTimetableBySubject = async (subjectId: string): Promise<TimetableEntry[]> => fetchData(async () => {
    const q = query(collection(db, "timetables"), where("subjectId", "==", subjectId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as TimetableEntry));
}, 'timetable by subject');

export const fetchGroupById = async (groupId: string): Promise<Group | null> => {
    try {
        const snapshot = await getDoc(doc(db, "groups", groupId));
        return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as unknown as Group) : null;
    } catch (error) {
        console.error("Error fetching group by id:", error);
        return null;
    }
};

export const fetchAllTimetables = async (): Promise<TimetableEntry[]> => fetchData(async () => {
    const querySnapshot = await getDocs(collection(db, "timetables"));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as TimetableEntry));
}, 'all timetables');

export const fetchMessages = async (): Promise<Message[]> => fetchData(async () => {
    const q = query(collection(db, "messages"), orderBy("timestamp", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Message));
}, 'messages');

// Chat messages (1:1)
export const addChatMessage = async (message: Omit<ChatMessage, "id" | "createdAt">) => {
    return await addDoc(collection(db, "chat_messages"), {
        ...message,
        createdAt: serverTimestamp()
    });
};

export const subscribeChatMessages = (chatId: string, callback: (messages: ChatMessage[]) => void) => {
    const q = query(
        collection(db, "chat_messages"),
        where("chatId", "==", chatId),
        orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snapshot) => {
        const nextMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as ChatMessage));
        callback(nextMessages);
    });
};

export const fetchEventsByDate = async (date: string): Promise<CalendarEvent[]> => fetchData(async () => {
    const q = query(
        collection(db, "events"),
        orderBy("createdAt", "desc")
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as unknown as CalendarEvent))
        .filter(event => event.date === date);
}, 'events by date');

export const fetchAllEvents = async (): Promise<CalendarEvent[]> => fetchData(async () => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as CalendarEvent));
}, 'all events');

export const fetchAttendanceForDate = async (date: string): Promise<Attendance[]> => fetchData(async () => {
    const q = query(collection(db, "attendance"), where("date", "==", date));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Attendance));
}, 'attendance for date');

export const fetchAttendanceByStudent = async (studentId: string): Promise<Attendance[]> => fetchData(async () => {
    const q = query(collection(db, "attendance"), where("studentId", "==", studentId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as unknown as Attendance))
        .sort((a, b) => b.date.localeCompare(a.date));
}, 'attendance by student');

export const fetchAttendanceAppealsForStudent = async (studentId: string): Promise<AttendanceAppeal[]> => fetchData(async () => {
 const s=await getDocs(query(collection(db,"attendance_appeals"),where("studentId","==",studentId)));
 return s.docs.map(d=>({id:d.id,...d.data()} as AttendanceAppeal));
},'attendance appeals for student');
export const fetchAttendanceAppealsForTeacher = async (teacherId: string): Promise<AttendanceAppeal[]> => fetchData(async () => {
 const s=await getDocs(query(collection(db,"attendance_appeals"),where("teacherId","==",teacherId),where("status","in",['pending','counselor_confirmed'])));
 return s.docs.map(d=>({id:d.id,...d.data()} as AttendanceAppeal));
},'attendance appeals for teacher');
export const fetchAttendanceAppealsForCounselor = async (counselorId: string): Promise<AttendanceAppeal[]> => fetchData(async () => {
 const s=await getDocs(query(collection(db,"attendance_appeals"),where("counselorId","==",counselorId),where("status","in",['pending','teacher_confirmed'])));
 return s.docs.map(d=>({id:d.id,...d.data()} as AttendanceAppeal));
},'attendance appeals for counselor');
export const createAttendanceAppeal = async (studentId:string, attendanceId:string, studentMessage?:string) => {
 const ar=doc(db,"attendance",attendanceId), as=await getDoc(ar); if(!as.exists()) throw new Error("El registro de asistencia ya no existe.");
 const a={id:as.id,...as.data()} as Attendance; if(a.studentId!==studentId||a.present) throw new Error("Solo puedes apelar una falta propia.");
 const [gs,ss]=await Promise.all([getDoc(doc(db,"groups",a.groupId)),getDoc(doc(db,"subjects",a.subjectId))]);
 if(!gs.exists()||!ss.exists()) throw new Error("No se pudo determinar responsables.");
 const g=gs.data() as Group, s=ss.data() as Subject, teacherId=a.recordedByRole==='profesor'&&a.recordedBy?a.recordedBy:s.teacherId;
 if(!teacherId||!g.counselorId) throw new Error("No fue posible determinar al profesor y orientador responsables.");
 const ref=doc(db,"attendance_appeals",attendanceId+"_"+studentId), old=await getDoc(ref);
 if(old.exists()&&['pending','teacher_confirmed','counselor_confirmed'].includes(String(old.data().status))) return ref;
 await setDoc(ref,{attendanceId,studentId,teacherId,counselorId:g.counselorId,subjectId:a.subjectId,groupId:a.groupId,date:a.date,status:'pending',studentMessage:studentMessage?.trim()||'Estoy presente; solicito revisión de mi asistencia.',originalPresent:false,originalPresenceEvidence:a.presenceEvidence||'not_checked',originalGpsStatusAtCheck:a.gpsStatusAtCheck||'unknown',originalGpsDistanceMeters:a.gpsDistanceMeters,createdAt:serverTimestamp()});
 return ref;
};
export const confirmAttendanceAppeal = async (appealId:string, role:'profesor'|'orientador', userId:string) => {
 const ref=doc(db,"attendance_appeals",appealId);
 await runTransaction(db,async tx=>{
  const s=await tx.get(ref); if(!s.exists()) throw new Error("La apelación ya no existe.");
  const a={id:s.id,...s.data()} as AttendanceAppeal;
  if(role==='profesor'&&a.teacherId!==userId) throw new Error("No eres el profesor responsable.");
  if(role==='orientador'&&a.counselorId!==userId) throw new Error("No eres el orientador responsable.");
  const tc=role==='profesor'||Boolean(a.teacherConfirmedBy), oc=role==='orientador'||Boolean(a.counselorConfirmedBy), done=tc&&oc;
  const u:any=role==='profesor'?{teacherConfirmedBy:userId,teacherConfirmedAt:serverTimestamp()}:{counselorConfirmedBy:userId,counselorConfirmedAt:serverTimestamp()};
  u.status=done?'resolved':role==='profesor'?'teacher_confirmed':'counselor_confirmed';
  if(done){u.resolution='present';u.resolvedBy=userId;u.resolvedAt=serverTimestamp();u.resolutionReason='Presencia confirmada físicamente por profesor y orientador; discrepancia tecnológica.';tx.update(doc(db,"attendance",a.attendanceId),{present:true,source:'counselor',recordedBy:userId,recordedByRole:'orientador',appealResolved:true,appealResolvedAt:serverTimestamp(),appealResolvedBy:userId,appealResolutionReason:u.resolutionReason});}
  tx.update(ref,u);
 });
};

export const fetchGradesBySubjectAndGroup = async (subjectId: string, groupId: string): Promise<Grade[]> => fetchData(async () => {
    const q = query(collection(db, "grades"), where("subjectId", "==", subjectId), where("groupId", "==", groupId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Grade));
}, 'grades by subject and group');

export const fetchGradesByStudent = async (studentId: string): Promise<Grade[]> => fetchData(async () => {
    const q = query(collection(db, "grades"), where("studentId", "==", studentId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as Grade));
}, 'grades by student');

// Funciones para obtener destinatarios según roles

// Para profesores: obtener sus estudiantes
export const fetchTeacherStudents = async (teacherId: string): Promise<User[]> => {
    try {
        // Primero obtener las materias del profesor
        const subjects = await fetchSubjectsByTeacher(teacherId);
        const subjectIds = subjects.map(subject => subject.id);

        if (subjectIds.length === 0) {
            return [];
        }

        // Obtener horarios basados en esas materias
        const timetableResults = await Promise.all(
            subjectIds.map(subjectId => fetchTimetableBySubject(subjectId))
        );
        const groupIds = [...new Set(
            timetableResults.flat().map(entry => entry.groupId)
        )];

        if (groupIds.length === 0) {
            return [];
        }

        const studentsByGroup = await Promise.all(
            groupIds.map(groupId => fetchStudentsByGroup(groupId))
        );
        return studentsByGroup.flat();
    } catch (error) {
        console.error("Error fetching teacher students:", error);
        return [];
    }
};

// Para orientadores: obtener estudiantes de sus grupos
export const fetchCounselorStudents = async (counselorId: string): Promise<User[]> => {
    try {
        const groups = await fetchGroupsByCounselor(counselorId);
        const groupIds = groups.map(group => group.id);

        if (groupIds.length === 0) {
            return [];
        }

        const allUsers = await fetchUsers();
        return allUsers.filter(user =>
            (user.role === 'estudiante' || user.role === 'alumno') && groupIds.includes(user.groupId)
        );
    } catch (error) {
        console.error("Error fetching counselor students:", error);
        return [];
    }
};

// Para estudiantes: obtener su orientador
export const fetchStudentCounselor = async (student: User): Promise<User | null> => {
    try {
        if (!student.groupId) {
            return null;
        }

        const group = await fetchGroups();
        const studentGroup = group.find(g => g.id === student.groupId);

        if (!studentGroup || !studentGroup.counselorId) {
            return null;
        }

        const counselors = await fetchUsers();
        return counselors.find(user => user.id === studentGroup.counselorId && user.role === 'orientador') || null;
    } catch (error) {
        console.error("Error fetching student counselor:", error);
        return null;
    }
};

// Corrección de la función para obtener profesores de un grupo
export const fetchStudentTeachersByGroupId = async (groupId: string): Promise<User[]> => {
    try {
        // Obtener horarios del grupo
        const timetableEntries = await fetchTimetableByGroup(groupId);
        const subjectIds = [...new Set(timetableEntries.map(entry => entry.subjectId))];

        if (subjectIds.length === 0) {
            return [];
        }

        // Obtener materias y sus profesores
        const allSubjects = await fetchSubjects();
        const teacherIds = [...new Set(
            allSubjects
                .filter(subject => subjectIds.includes(subject.id))
                .map(subject => subject.teacherId)
        )];

        // Obtener profesores
        const allUsers = await fetchUsers();
        return allUsers.filter(user =>
            user.role === 'profesor' &&
            teacherIds.includes(user.id)
        );
    } catch (error) {
        console.error("Error fetching student teachers:", error);
        return [];
    }
};

// Para estudiantes: obtener profesores de su grupo
export const fetchStudentTeachers = async (student: User): Promise<User[]> => {
    if (!student.groupId) {
        return [];
    }
    return await fetchStudentTeachersByGroupId(student.groupId);
};

export const fetchTimetableByTeacher = async (teacherId: string): Promise<TimetableEntry[]> => fetchData(async () => {
    const q = query(collection(db, "timetables"), where("teacherId", "==", teacherId));
    const querySnapshot = await getDocs(q);
    const direct = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as TimetableEntry));

    // Compatibilidad: horarios antiguos todavía pueden no tener teacherId.
    const legacySubjects = await fetchSubjectsByTeacher(teacherId);
    const legacyResults = await Promise.all(
        legacySubjects.map((subject) => fetchTimetableBySubject(subject.id))
    );
    const legacy = legacyResults.flat().filter((entry) => !entry.teacherId);
    const seen = new Set(direct.map((entry) => entry.id));
    return [...direct, ...legacy.filter((entry) => !seen.has(entry.id))];
}, 'timetable by teacher');

export const fetchSubjectById = async (subjectId: string): Promise<Subject | null> => fetchData(async () => {
    const snapshot = await getDoc(doc(db, "subjects", subjectId));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as unknown as Subject) : null;
}, 'subject by id');

export const fetchSubjectsByIds = async (subjectIds: string[]): Promise<Subject[]> => {
    if (subjectIds.length === 0) return [];
    const results = await Promise.all(subjectIds.map(fetchSubjectById));
    return results.filter((subject): subject is Subject => subject !== null);
};

// Functions for the unified user model
export const fetchStudents = async (): Promise<User[]> => fetchData(async () => {
    const q = query(
        collection(db, "users"),
        where("role", "in", ["estudiante", "alumno"])
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as User));
}, 'students');

export const fetchStudentsByGroup = async (groupId: string): Promise<User[]> => fetchData(async () => {
    const q = query(
        collection(db, "users"),
        where("role", "in", ["estudiante", "alumno"]),
        where("groupId", "==", groupId)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as User));
}, 'students by group');

// Función para obtener un usuario por ID


// Funciones para manejar imágenes en Firebase Storage
export const uploadStudentPhoto = async (userId: string, file: File): Promise<string> => {
    try {
        // Subir foto al bucket en la carpeta 'fotos'
        const photoRef = ref(storage, `fotos/${userId}/${file.name}`);
        await uploadBytes(photoRef, file);
        const photoUrl = await getDownloadURL(photoRef);

        // Actualizar el avatarUrl del usuario
        await updateDoc(doc(db, "users", userId), {
            avatarUrl: photoUrl
        });

        return photoUrl;
    } catch (error) {
        console.error('Error uploading student photo:', error);
        throw error;
    }
};

export const uploadCredentialImage = async (userId: string, file: File): Promise<string> => {
    try {
        // Subir credencial al bucket en la carpeta 'credenciales'
        const credentialRef = ref(storage, `credenciales/${userId}/${file.name}`);
        await uploadBytes(credentialRef, file);
        const credentialUrl = await getDownloadURL(credentialRef);
        return credentialUrl;
    } catch (error) {
        console.error('Error uploading credential image:', error);
        throw error;
    }
};

export const deleteStudentPhoto = async (userId: string, photoUrl: string): Promise<void> => {
    try {
        // Extraer el nombre del archivo de la URL para eliminarlo de storage
        const photoPath = photoUrl.split('/fotos/')[1].split('?')[0]; // Extraer parte del path
        const photoRef = ref(storage, `fotos/${userId}/${photoPath}`);
        await deleteObject(photoRef);

        // Remover la referencia de la base de datos
        await updateDoc(doc(db, "users", userId), {
            avatarUrl: null
        });
    } catch (error) {
        console.error('Error deleting student photo:', error);
        throw error;
    }
};

// Add/Update functions
export const addGroup = async (group: Omit<Group, "id">) => await addDoc(collection(db, "groups"), group);
export const updateGroup = async (groupId: string, data: Partial<Group>) => await updateDoc(doc(db, "groups", groupId), data);
// Renamed updateStudent to updateUser and targeting 'users' collection
// Enhanced for unified user model compatibility
export const updateUser = async (userId: string, data: Partial<User>) => {
    // Prepare update data, ensuring we don't accidentally change the role field unless explicitly allowed
    const updateData = { ...data };

    // Remove the id field if present as it should not be updated
    if (updateData.id) {
        delete updateData.id;
    }

    // Ensure role field is not accidentally changed in regular updates
    if (updateData.role !== undefined) {
        // In a production environment, role changes should likely be restricted
        // and performed only through specific administrative functions
        console.warn(`Updating role for user ${userId}. Ensure this is intentional.`);
    }

    // Perform the update
    return await updateDoc(doc(db, "users", userId), updateData);
};

export const assignBadgeToStudent = async (studentId: string, badgeId: string) => {
    return await updateDoc(doc(db, "users", studentId), {
        badges: arrayUnion(badgeId)
    });
};

export const addBadgeSuggestion = async (payload: { studentId?: string; badgeName: string; notes?: string; suggestedBy: string; suggestedByRole: User['role'] }) => {
    return await addDoc(collection(db, "badge_suggestions"), {
        ...payload,
        createdAt: serverTimestamp()
    });
};
export const addSubject = async (subject: Omit<Subject, "id">) => await addDoc(collection(db, "subjects"), { ...subject, active: subject.active ?? true });
export const updateSubject = async (subjectId: string, data: Partial<Subject>) => await updateDoc(doc(db, "subjects", subjectId), data);
export const addTimetableEntry = async (entry: Omit<TimetableEntry, "id">) => await addDoc(collection(db, "timetables"), entry);
// Función para enviar mensajes a múltiples destinatarios según filtros
export const addMessage = async (message: Omit<Message, "id" | "timestamp">) => {
    // Para mantener compatibilidad con la estructura actual, primero guardamos el mensaje general
    const docRef = await addDoc(collection(db, "messages"), {
        ...message,
        timestamp: serverTimestamp()
    });

    // Aquí es donde expandiríamos la funcionalidad para enviar a múltiples destinatarios
    // según el filtro de destinatarios, pero por ahora guardamos el mensaje base
    return docRef;
};
export const addEvent = async (event: Omit<CalendarEvent, "id" | "createdAt">) => {
    const docRef = await addDoc(collection(db, "events"), {
        ...event,
        visibility: event.visibility && event.visibility.length > 0 ? event.visibility : ['personal'],
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// Function to add a student using Cloud Functions for unified user model
export const addTeacher = async (teacherData: { name: string; email: string; password?: string }) => {
    const functions = getFunctions();
    const createUser = httpsCallable(functions, 'createUser');
    return await createUser({ ...teacherData, role: 'profesor' });
};

export const deleteUserAccount = async (userId: string) => {
    const functions = getFunctions();
    const deleteUser = httpsCallable(functions, 'deleteUser');
    return await deleteUser({ uid: userId });
};

export const addStudent = async (studentData: Omit<User, "id" | "role"> & { groupId?: string }) => {
    const functions = getFunctions();
    const createUser = httpsCallable(functions, 'createUser');

    const result = await createUser({
        ...studentData,
        role: 'estudiante' as const,
        groupId: studentData.groupId
    });

    return result;
};

export const deleteEvent = async (eventId: string) => {
    await deleteDoc(doc(db, "events", eventId));
};

export const setAttendanceBatch = async (records: Omit<Attendance, "id">[]) => {
    const batch = writeBatch(db);
    for (const record of records) {
        const docId = `${record.studentId}_${record.date}_${record.subjectId}`;
        const attendanceRef = doc(db, "attendance", docId);
        batch.set(attendanceRef, record, { merge: true });
    }
    await batch.commit();
};

/**
 * Auditoría directiva del pase de lista.
 * El director puede volver a pasar lista aunque el profesor ya haya guardado
 * su registro. Si contradice una evidencia física negativa, se exige motivo
 * y queda un rastro inmutable de quién hizo la corrección y cuándo.
 */
export const directorAuditAttendance = async (
    records: Array<{
        studentId: string;
        date: string;
        subjectId: string;
        groupId: string;
        timetableId?: string;
        present: boolean;
        presenceEvidence: Attendance['presenceEvidence'];
        gpsDistanceMeters?: number;
        gpsStatusAtCheck?: Attendance['gpsStatusAtCheck'];
        overrideReason?: string;
    }>,
    directorId: string
) => {
    if (!directorId) throw new Error("Se requiere el director que realiza la auditoría.");

    const batch = writeBatch(db);
    for (const record of records) {
        if (record.present && record.presenceEvidence === 'not_detected') {
            if (!record.overrideReason?.trim()) {
                throw new Error("Para marcar presente a un alumno no detectado se requiere justificar la excepción.");
            }
        }

        const docId = `${record.studentId}_${record.date}_${record.subjectId}`;
        const attendanceRef = doc(db, "attendance", docId);
        batch.set(attendanceRef, {
            ...record,
            source: 'director_audit',
            recordedBy: directorId,
            recordedByRole: 'director',
            directorOverride: record.present && record.presenceEvidence === 'not_detected',
            directorOverrideReason: record.overrideReason?.trim() || null,
            directorOverrideAt: serverTimestamp(),
            directorOverrideBy: directorId,
        }, { merge: true });
    }
    await batch.commit();

    await addDoc(collection(db, "activity_logs"), {
        action: 'AUDITORIA_DIRECTIVA_ASISTENCIA',
        details: `El director realizó una segunda verificación del pase de lista de ${records.length} alumno(s).`,
        targetId: records[0]?.groupId,
        targetType: 'group',
        createdBy: directorId,
        creatorName: 'Director',
        creatorRole: 'director',
        timestamp: serverTimestamp(),
    });
};

export const setGradeBatch = async (records: Omit<Grade, "id" | "createdAt">[]) => {
    const batch = writeBatch(db);
    for (const record of records) {
        const docId = `${record.studentId}_${record.subjectId}_${record.partial}`;
        const gradeRef = doc(db, "grades", docId);
        batch.set(gradeRef, { ...record, createdAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
};


export const deleteTimetableEntry = async (entryId: string) => await deleteDoc(doc(db, "timetables", entryId));

export const deleteMessage = async (messageId: string) => await deleteDoc(doc(db, "messages", messageId));

// Delete functions
export const deleteGroup = async (groupId: string) => await deleteDoc(doc(db, "groups", groupId));
export const deleteSubject = async (subjectId: string) => await deleteDoc(doc(db, "subjects", subjectId));
// This function is for deleting a user doc directly, but the callable cloud function is preferred.
export const deleteUser = async (userId: string) => await deleteDoc(doc(db, "users", userId));

export const sendMessage = async (message: Omit<Message, "id" | "timestamp">) => {
    return await addDoc(collection(db, "messages"), {
        ...message,
        timestamp: serverTimestamp()
    });
};

/**
 * Guarda una observación de presencia general en el plantel.
 * El ID es determinista por usuario/día/intervalo para evitar duplicados.
 */
export const recordSchoolPresenceCheck = async (check: Omit<SchoolPresenceCheck, "id" | "createdAt">) => {
    const scopeId = check.groupId || 'school';
    const id = check.userId + "_" + check.date + "_" + check.checkTime.replace(":", "") + "_" + scopeId;
    const ref = doc(db, "school_presence_checks", id);
    await setDoc(ref, { ...check, createdAt: serverTimestamp() }, { merge: true });
    return id;
};

export const fetchSchoolPresenceChecks = async (date: string, userId?: string, groupIds?: string[]): Promise<SchoolPresenceCheck[]> => fetchData(async () => {
    let q = query(collection(db, "school_presence_checks"), where("date", "==", date));
    if (userId) q = query(q, where("userId", "==", userId));
    else if (groupIds && groupIds.length > 0) q = query(q, where("groupId", "in", groupIds.slice(0, 30)));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SchoolPresenceCheck));
}, "school presence checks");

export const updateUserStatus = async (userId: string, status: 'inside' | 'outside' | 'coming' | 'unknown', userName?: string) => {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
        gpsStatus: status,
        lastGpsUpdate: serverTimestamp()
    });

    // Check-in logic for staff
    if (userName && (status === 'inside' || status === 'outside')) {
        await registerWorkCheck(userId, userName, status);
    }
};

const registerWorkCheck = async (userId: string, userName: string, status: 'inside' | 'outside') => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(
        collection(db, "work_logs"),
        where("userId", "==", userId),
        where("date", "==", today)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty && status === 'inside') {
        const now = new Date();
        const isLate = now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() > 15);

        await addDoc(collection(db, "work_logs"), {
            userId,
            userName,
            date: today,
            checkIn: serverTimestamp(),
            status: isLate ? 'late' : 'present'
        });
    } else if (!snapshot.empty && status === 'outside') {
        const logDoc = snapshot.docs[0];
        const logId = logDoc.id;
        const logData = logDoc.data();

        let hours = 0;
        if (logData.checkIn) {
            const checkInDate = logData.checkIn.toDate ? logData.checkIn.toDate() : new Date(logData.checkIn);
            const now = new Date();
            hours = (now.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
        }

        await updateDoc(doc(db, "work_logs", logId), {
            checkOut: serverTimestamp(),
            totalHours: Number(hours.toFixed(2))
        });
    }
};

export const fetchWorkLogs = async (date?: string, userId?: string): Promise<WorkLog[]> => fetchData(async () => {
    const targetDate = date || new Date().toISOString().split('T')[0];
    let q = query(
        collection(db, "work_logs"),
        where("date", "==", targetDate)
    );

    if (userId) {
        q = query(q, where("userId", "==", userId));
    }

    q = query(q, orderBy("checkIn", "desc"));

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as WorkLog));
}, 'work logs');


/**
 * Generates a temporary 4-digit code for a class session.
 */
export const generateAttendanceToken = async (subjectId: string, groupId: string, timetableId: string, options?: { coverageId?: string; createdBy?: string; createdByRole?: User['role']; teacherLocation?: { latitude: number; longitude: number; accuracy?: number } }) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const date = getTodayDateKey();
    const tokenData = {
        subjectId,
        groupId,
        timetableId,
        code,
        date,
        ...(options?.coverageId ? { coverageId: options.coverageId, takeoverId: options.coverageId + "_" + timetableId } : {}),
        ...(options?.createdBy ? { createdBy: options.createdBy } : {}),
        ...(options?.createdByRole ? { createdByRole: options.createdByRole } : {}),
        ...(options?.teacherLocation ? { teacherLocation: options.teacherLocation } : {}),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes validity
        createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, "attendance_tokens"), tokenData);
    return { id: docRef.id, code };
};

/**
 * Verifies if a code is valid for a specific student's class.
 */
export const verifyAttendanceToken = async (groupId: string, code: string) => {
    const now = new Date();
    const q = query(
        collection(db, "attendance_tokens"),
        where("groupId", "==", groupId),
        where("code", "==", code)
    );

    if (querySnapshot.empty) return null;

    // There can be more than one token with the same 4-digit code over time.
    // Pick the currently valid token for today instead of trusting the first result.
    const today = getTodayDateKey();
    const validToken = querySnapshot.docs.find((snapshot) => {
        const tokenDoc = snapshot.data();
        const expiresAt = tokenDoc.expiresAt?.toDate?.() ?? new Date(tokenDoc.expiresAt);
        return (
            tokenDoc.date === today &&
            now <= expiresAt &&
            tokenDoc.teacherLocation?.latitude != null &&
            tokenDoc.teacherLocation?.longitude != null
        );
    });

    if (!validToken) return null;

    const tokenDoc = validToken.data();

    return {
        tokenId: validToken.id,
        subjectId: tokenDoc.subjectId as string,
        groupId: tokenDoc.groupId as string,
        date: tokenDoc.date as string,
        timetableId: tokenDoc.timetableId as string,
        expiresAt: tokenDoc.expiresAt,
        teacherLocation: tokenDoc.teacherLocation as { latitude: number; longitude: number; accuracy?: number },
    };
};

export const registerAttendanceFromToken = async ({
    studentId,
    groupId,
    tokenId,
    subjectId,
    date,
    timetableId,
    studentLocation,
    distanceToTeacher,
}: {
    studentId: string;
    groupId: string;
    tokenId: string;
    subjectId: string;
    date: string;
    timetableId: string;
    studentLocation: { latitude: number; longitude: number; accuracy?: number };
    distanceToTeacher: number;
}) => {
    const attendanceId = studentId + "_" + date + "_" + timetableId;
    const attendanceRef = doc(db, "attendance", attendanceId);
    const existing = await getDoc(attendanceRef);

    if (existing.exists()) {
        return { id: attendanceId, alreadyRegistered: true };
    }

    await setDoc(attendanceRef, {
        studentId,
        groupId,
        subjectId,
        timetableId,
        date,
        present: true,
        tokenId,
        studentLocation,
        distanceToTeacher,
        createdAt: serverTimestamp(),
    });

    return { id: attendanceId, alreadyRegistered: false };
};

/**
 * Registers an activity in the system audit log.
 */
export const logActivity = async (activity: Omit<ActivityLog, 'id' | 'timestamp'>) => {
    try {
        await addDoc(collection(db, "activity_logs"), {
            ...activity,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error logging activity:", error);
    }
};

export const fetchActivityLogs = async (limitCount = 100): Promise<ActivityLog[]> => {
    try {
        const q = query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(limitCount));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as ActivityLog));
    } catch (error) {
        console.error("Error fetching activity logs:", error);
        return [];
    }
};

/**
 * App Configuration (White Label Settings)
 */
export const DEFAULT_APP_CONFIG: Omit<AppConfig, 'id'> = {
    appName: "EduChain",
    institutionName: "Panel Institucional EPO 264",
    terminology: {
        orientador: "Orientador",
        semestre: "Semestre",
        grado: "Grado",
        alumno: "Alumno"
    },
    geofence: {
        enabled: true,
        center: { lat: 19.0801094, lng: -98.8468597 }, // EPO 264
        radius: 150
    },
    features: {
        badges: true,
        attendanceGps: true,
        attendanceQr: true,
        grades: true
    },
    theme: {
        primaryColor: "#8B1A2B"
    }
};

export const fetchAppConfig = async (): Promise<AppConfig> => {
    try {
        const querySnapshot = await getDocs(collection(db, "app_settings"));
        if (querySnapshot.empty) {
            // Initialize if not exists
            const docRef = await addDoc(collection(db, "app_settings"), DEFAULT_APP_CONFIG);
            return { id: docRef.id, ...DEFAULT_APP_CONFIG };
        }
        const doc = querySnapshot.docs[0];
        return { id: doc.id, ...doc.data() } as AppConfig;
    } catch (error) {
        console.error("Error fetching app config:", error);
        return { id: 'default', ...DEFAULT_APP_CONFIG };
    }
};

export const updateAppConfig = async (configId: string, updates: Partial<AppConfig>) => {
    try {
        const docRef = doc(db, "app_settings", configId);
        await updateDoc(docRef, updates);
    } catch (error) {
        console.error("Error updating app config:", error);
        throw error;
    }
};


export const getTodayDateKey = () => {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
};
