import statuses from 'escpos/statuses';

export type StatusLevel = 'ok' | 'warning' | 'error';

export interface StatusEntry {
  bit: number | string;
  value: number | string;
  label: string;
  status: StatusLevel;
}

export interface StatusClassReport {
  className: string;
  byte: number;
  bits: string;
  statuses: StatusEntry[];
}

export interface StatusReport {
  ok: boolean;
  raw: number[];
  statuses: StatusClassReport[];
}

const STATUS_CLASSES = [
  (statuses as any).PrinterStatus,
  (statuses as any).RollPaperSensorStatus,
  (statuses as any).OfflineCauseStatus,
  (statuses as any).ErrorCauseStatus
];

export function parseStatusBytes(bytes: number[]): StatusReport {
  const raw = bytes.slice(0, STATUS_CLASSES.length);
  const reports = STATUS_CLASSES.map((StatusClass, index) => {
    const byte = raw[index] ?? 0;
    return new StatusClass(byte).toJSON() as StatusClassReport;
  });
  const ok = reports.every((report) => report.statuses.every((entry) => entry.status !== 'error'));
  return { ok, raw, statuses: reports };
}
