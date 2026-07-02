/// <reference types="web-bluetooth" />
// Live heart rate over Web Bluetooth, standard Heart Rate Service (0x180D).
// Works in Chrome on Android with any compliant strap and (on Android) the
// Powerbeats Pro 2 once HR is enabled in the Beats app. See project_gym_tracker.
// Requires HTTPS (or localhost) and a user gesture to start.

export type HrListener = (bpm: number) => void;

export function bluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

// Parse a Heart Rate Measurement characteristic value (see BLE HRS spec).
function parseHr(value: DataView): number {
  const flags = value.getUint8(0);
  return flags & 0x1 ? value.getUint16(1, true) : value.getUint8(1);
}

export class HeartRateMonitor {
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private listeners = new Set<HrListener>();
  private onStatus?: (connected: boolean) => void;

  constructor(onStatus?: (connected: boolean) => void) {
    this.onStatus = onStatus;
  }

  onData(fn: HrListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private handle = (e: Event) => {
    const c = e.target as BluetoothRemoteGATTCharacteristic;
    if (c.value) {
      const bpm = parseHr(c.value);
      for (const l of this.listeners) l(bpm);
    }
  };

  async connect(): Promise<void> {
    if (!bluetoothAvailable()) throw new Error("Web Bluetooth not supported in this browser.");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
    this.device.addEventListener("gattserverdisconnected", () => this.onStatus?.(false));
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService("heart_rate");
    this.char = await service.getCharacteristic("heart_rate_measurement");
    await this.char.startNotifications();
    this.char.addEventListener("characteristicvaluechanged", this.handle);
    this.onStatus?.(true);
  }

  disconnect(): void {
    try {
      this.char?.removeEventListener("characteristicvaluechanged", this.handle);
      this.device?.gatt?.disconnect();
    } finally {
      this.onStatus?.(false);
      this.device = null;
      this.char = null;
    }
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected;
  }
}
