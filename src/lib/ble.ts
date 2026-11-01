// Live heart rate over Bluetooth LE (standard Heart Rate Service 0x180D).
// Garmin watches: Settings → Sensors → Wrist Heart Rate → Broadcast Heart Rate
// (or "Broadcast during activity"). Web Bluetooth works in Chrome (Android/desktop)
// and in the Bluefy browser on iPhone; Safari does not support it.

interface BTCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BTCharacteristic>;
}
interface BTServer {
  connected: boolean;
  getPrimaryService(s: string | number): Promise<{ getCharacteristic(c: string | number): Promise<BTCharacteristic> }>;
  disconnect(): void;
}
interface BTDevice extends EventTarget {
  name?: string;
  gatt?: { connect(): Promise<BTServer>; connected: boolean; disconnect(): void };
}
interface BTNavigator {
  bluetooth?: { requestDevice(o: unknown): Promise<BTDevice> };
}

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as BTNavigator).bluetooth;
}

export interface HRReading {
  bpm: number;
  rr: number[];
  at: number;
}

type Listener = (r: HRReading) => void;

class HeartRateMonitor {
  private device?: BTDevice;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: string) => void>();
  status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  deviceName = '';
  last?: HRReading;
  rrLog: number[] = [];

  onReading(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: (s: string) => void) {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private setStatus(s: HeartRateMonitor['status']) {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  async connect() {
    const bt = (navigator as unknown as BTNavigator).bluetooth;
    if (!bt) throw new Error('Bluetooth недоступен в этом браузере. На iPhone откройте приложение в браузере Bluefy.');
    this.setStatus('connecting');
    try {
      this.device = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      this.deviceName = this.device.name ?? 'Пульсометр';
      this.device.addEventListener('gattserverdisconnected', () => {
        this.setStatus('disconnected');
        this.reconnect();
      });
      await this.attach();
    } catch (e) {
      this.setStatus('disconnected');
      throw e;
    }
  }

  private async attach() {
    const server = await this.device!.gatt!.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (ev) => {
      const v = (ev.target as BTCharacteristic).value;
      if (v) this.handle(v);
    });
    await ch.startNotifications();
    this.setStatus('connected');
  }

  private async reconnect() {
    for (let i = 0; i < 5 && this.device && this.status !== 'connected'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        this.setStatus('connecting');
        await this.attach();
        return;
      } catch {
        this.setStatus('disconnected');
      }
    }
  }

  private handle(v: DataView) {
    const flags = v.getUint8(0);
    const is16 = flags & 0x01;
    let offset = 1;
    const bpm = is16 ? v.getUint16(offset, true) : v.getUint8(offset);
    offset += is16 ? 2 : 1;
    if (flags & 0x08) offset += 2; // energy expended
    const rr: number[] = [];
    if (flags & 0x10) {
      for (; offset + 1 < v.byteLength; offset += 2) rr.push(Math.round((v.getUint16(offset, true) / 1024) * 1000));
    }
    if (rr.length) {
      this.rrLog.push(...rr);
      if (this.rrLog.length > 600) this.rrLog = this.rrLog.slice(-600);
    }
    if (bpm > 0) {
      this.last = { bpm, rr, at: Date.now() };
      this.listeners.forEach((l) => l(this.last!));
    }
  }

  disconnect() {
    const d = this.device;
    this.device = undefined;
    d?.gatt?.disconnect();
    this.setStatus('disconnected');
  }
}

export const hrMonitor = new HeartRateMonitor();
