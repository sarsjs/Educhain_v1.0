'use client';

import * as React from 'react';
import { useAuth } from '@/context/auth-context';
import { recordSchoolPresenceCheck } from '@/lib/firebase/data';
import { verifyUserLocation } from '@/lib/gps-utils';

const PRESENCE_MINUTES = [0, 5, 10, 15, 20] as const;
const ACTIVE_ROLES = ['director', 'orientador', 'profesor', 'estudiante', 'alumno'] as const;
type PresenceMinute = typeof PRESENCE_MINUTES[number];

function getTodayKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

function getCurrentSlot(date: Date): PresenceMinute | null {
    if (date.getHours() !== 7) return null;
    const minute = date.getMinutes();
    const slot = PRESENCE_MINUTES.find(value => minute === value);
    return slot ?? null;
}

function msUntilNextSlot(now: Date) {
    const next = new Date(now);
    next.setSeconds(0, 0);

    for (const minute of PRESENCE_MINUTES) {
        if (minute > now.getMinutes()) {
            next.setMinutes(minute);
            return Math.max(1000, next.getTime() - now.getTime());
        }
    }

    return Math.max(1000, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0, 0, 0).getTime() - now.getTime());
}

export function SchoolPresenceMonitor() {
    const { profile } = useAuth();
    const runningRef = React.useRef(false);
    const handledSlotsRef = React.useRef<Set<string>>(new Set());

    const runCheck = React.useCallback(async (expectedMinute?: PresenceMinute) => {
        if (!profile || !ACTIVE_ROLES.includes(profile.role as typeof ACTIVE_ROLES[number]) || !navigator.geolocation) {
            return;
        }

        const now = new Date();
        const minute = expectedMinute ?? getCurrentSlot(now);
        if (minute === null || now.getHours() !== 7) return;

        const date = getTodayKey(now);
        const checkTime = ('07:' + String(minute).padStart(2, '0')) as '07:00' | '07:05' | '07:10' | '07:15' | '07:20';
        const key = profile.id + '_' + date + '_' + checkTime;

        if (handledSlotsRef.current.has(key) || runningRef.current) return;
        runningRef.current = true;

        try {
            await new Promise<void>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    async position => {
                        try {
                            const result = await verifyUserLocation(position);
                            await recordSchoolPresenceCheck({
                                userId: profile.id,
                                date,
                                checkTime,
                                role: profile.role,
                                inside: result.isInside && !result.isMocked,
                                distanceMeters: Math.round(result.distance),
                                accuracyMeters: Math.round(position.coords.accuracy),
                                confidence: result.confidence,
                                isMocked: result.isMocked,
                                source: 'client-gps'
                            });
                            handledSlotsRef.current.add(key);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    },
                    reject,
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            });
        } catch (error) {
            console.error('Error en check de presencia escolar:', error);
        } finally {
            runningRef.current = false;
        }
    }, [profile]);

    React.useEffect(() => {
        if (!profile || !ACTIVE_ROLES.includes(profile.role as typeof ACTIVE_ROLES[number])) return;

        let timeout: ReturnType<typeof setTimeout> | undefined;
        let interval: ReturnType<typeof setInterval> | undefined;

        const schedule = () => {
            const now = new Date();

            if (now.getHours() === 7) {
                const currentSlot = getCurrentSlot(now);
                if (currentSlot !== null) {
                    void runCheck(currentSlot);
                }
            }

            const delay = msUntilNextSlot(now);
            timeout = setTimeout(() => {
                const next = new Date();
                if (next.getHours() === 7) {
                    const slot = getCurrentSlot(next);
                    if (slot !== null) void runCheck(slot);
                }
                schedule();
            }, delay);
        };

        schedule();

        // Recuperación: si el navegador despierta unos segundos tarde, intenta
        // detectar el intervalo actual sin generar duplicados.
        interval = setInterval(() => {
            const now = new Date();
            if (now.getHours() === 7) {
                const slot = getCurrentSlot(now);
                if (slot !== null) void runCheck(slot);
            }
        }, 30000);

        return () => {
            if (timeout) clearTimeout(timeout);
            if (interval) clearInterval(interval);
        };
    }, [profile, runCheck]);

    return null;
}
