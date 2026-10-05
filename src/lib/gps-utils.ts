
/**
 * Haversine formula to calculate the distance between two points in meters.
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

export const SCHOOL_LOCATION = {
    // EPO 264: coordenadas proporcionadas para el plantel.
    latitude: 19.0801094,
    longitude: -98.8468597,
    radius: 150,
    name: "EPO 264"
};

export interface LocationScanResult {
    isInside: boolean;
    distance: number;
    isMocked: boolean;
    confidence: 'high' | 'medium' | 'low';
    error?: string;
}

/** Returns the distance in meters between two GPS coordinates. */
export function calculateCoordinateDistance(
    first: { latitude: number; longitude: number },
    second: { latitude: number; longitude: number }
): number {
    return calculateDistance(first.latitude, first.longitude, second.latitude, second.longitude);
}

/**
 * Validates that a student's GPS position is reasonably close to the teacher's
 * position. GPS indoors is noisy, so this is intentionally a soft proximity
 * check rather than an exact coordinate match.
 */
export function verifyProximityToTeacher(
    studentPosition: GeolocationPosition,
    teacherLocation: { latitude: number; longitude: number },
    radius = 75
): { isNear: boolean; distance: number } {
    const distance = calculateCoordinateDistance(
        { latitude: studentPosition.coords.latitude, longitude: studentPosition.coords.longitude },
        teacherLocation
    );
    return { isNear: distance <= radius, distance };
}

/**
 * Verifies if the user is within the school perimeter and checks for GPS spoofing.
 */
export async function verifyUserLocation(
    position: GeolocationPosition,
    customLocation?: { latitude: number; longitude: number; radius: number }
): Promise<LocationScanResult> {
    const { latitude, longitude, accuracy, speed } = position.coords;

    const targetLat = customLocation?.latitude ?? SCHOOL_LOCATION.latitude;
    const targetLon = customLocation?.longitude ?? SCHOOL_LOCATION.longitude;
    const targetRadius = customLocation?.radius ?? SCHOOL_LOCATION.radius;

    const distance = calculateDistance(
        latitude,
        longitude,
        targetLat,
        targetLon
    );

    const isInside = distance <= targetRadius;

    // --- Anti-spoofing heuristics ---
    let isMocked = false;
    let confidence: 'high' | 'medium' | 'low' = 'high';

    // 1. Accuracy is used only as a confidence signal. Very precise GPS is
    //    possible on real devices and must not be rejected as simulated by itself.
    if (accuracy > 100) {
        confidence = 'low';
    } else if (accuracy > 30) {
        confidence = 'medium';
    }

    // 2. Impossible speed (over ~120 km/h near the school)
    if (speed && speed > 33.3) { // 33.3 m/s = ~120 km/h
        isMocked = true;
        confidence = 'medium';
    }

    return {
        isInside,
        distance,
        isMocked,
        confidence,
        error: isMocked ? "Se detecto el uso de una ubicacion simulada" : undefined
    };
}
