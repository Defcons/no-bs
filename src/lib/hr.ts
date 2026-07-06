/// <reference types="web-bluetooth" />
// Live heart rate over the standard BLE Heart Rate Service (0x180D).
// - Web build: Web Bluetooth (Chrome/Android). See project_gym_tracker.
// - Native app (Capacitor): @capacitor-community/bluetooth-le, since the Android
//   WebView has no Web Bluetooth. Same interface either way.
import { Capacitor } from "@capacitor/core";
import { BleClient, numberToUUID } from "@capacitor-community/bluetooth-le";

export type HrListener = (bpm: number) => void;

export interface HrMonitor {
  onData(fn: HrListener): () => void;
  connect(): Promise<void>;
  disconnect(): void | Promise<void>;
  readonly connected: boolean;
}

const HR_SERVICE = numberToUUID(0x180d);
const HR_MEASUREMENT = numberToUUID(0x2a37);

export function bluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}
// HR is available on the native app (native BLE) or a Web-Bluetooth browser.
export function hrAvailable(): boolean {
  return Capacitor.isNativePlatform() || bluetoothAvailable();
}

// Parse a Heart Rate Measurement characteristic value (see BLE HRS spec).
function parseHr(value: DataView): number {
  const flags = value.getUint8(0);
  return flags & 0x1 ? value.getUint16(1, true) : value.getUint8(1);
}

// --- Web Bluetooth implementation ------------------------------------------
class WebHeartRateMonitor implements HrMonitor {
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
    if (c.value) for (const l of this.listeners) l(parseHr(c.value));
  };

  async connect(): Promise<void> {
    if (!bluetoothAvailable()) throw new Error("Web Bluetooth not supported in this browser.");
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
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

// --- Native (Capacitor BLE) implementation ---------------------------------
class NativeHeartRateMonitor implements HrMonitor {
  private deviceId: string | null = null;
  private listeners = new Set<HrListener>();
  private onStatus?: (connected: boolean) => void;

  constructor(onStatus?: (connected: boolean) => void) {
    this.onStatus = onStatus;
  }

  onData(fn: HrListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async connect(): Promise<void> {
    await BleClient.initialize({ androidNeverForLocation: true });
    const device = await BleClient.requestDevice({ services: [HR_SERVICE] });
    await BleClient.connect(device.deviceId, () => {
      this.onStatus?.(false);
      this.deviceId = null;
    });
    this.deviceId = device.deviceId;
    await BleClient.startNotifications(device.deviceId, HR_SERVICE, HR_MEASUREMENT, (value) => {
      for (const l of this.listeners) l(parseHr(value));
    });
    this.onStatus?.(true);
  }

  async disconnect(): Promise<void> {
    const id = this.deviceId;
    this.deviceId = null;
    if (id) {
      try {
        await BleClient.stopNotifications(id, HR_SERVICE, HR_MEASUREMENT);
        await BleClient.disconnect(id);
      } catch {
        /* already gone */
      }
    }
    this.onStatus?.(false);
  }

  get connected(): boolean {
    return !!this.deviceId;
  }
}

export function createHrMonitor(onStatus?: (connected: boolean) => void): HrMonitor {
  return Capacitor.isNativePlatform() ? new NativeHeartRateMonitor(onStatus) : new WebHeartRateMonitor(onStatus);
}
