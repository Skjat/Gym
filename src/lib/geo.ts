// GPS tracking for outdoor runs while the app is on screen.
export interface GeoPoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
  acc: number;
}

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class GeoTracker {
  points: GeoPoint[] = [];
  distanceM = 0;
  private watchId?: number;
  onUpdate?: () => void;

  start() {
    if (!('geolocation' in navigator) || this.watchId !== undefined) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p: GeoPoint = { t: pos.timestamp, lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
        if (p.acc > 35) return;
        const prev = this.points[this.points.length - 1];
        if (prev) {
          const d = haversine(prev, p);
          if (d < 2) return;
          if (d / Math.max(1, (p.t - prev.t) / 1000) > 12) return; // >43 km/h — GPS jump
          this.distanceM += d;
        }
        this.points.push(p);
        this.onUpdate?.();
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  stop() {
    if (this.watchId !== undefined) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = undefined;
  }

  /** Pace over the last ~60 s, sec/km. */
  currentPace(): number | undefined {
    const n = this.points.length;
    if (n < 2) return undefined;
    const last = this.points[n - 1];
    let d = 0;
    let i = n - 1;
    while (i > 0 && last.t - this.points[i - 1].t < 60000) {
      d += haversine(this.points[i - 1], this.points[i]);
      i--;
    }
    const dt = (last.t - this.points[i].t) / 1000;
    if (d < 20 || dt < 10) return undefined;
    return (dt / d) * 1000;
  }
}
