// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// ناوبری مشترک نماها.

export type ViewId =
  | 'overview'
  | 'streams'
  | 'stream-detail'
  | 'detections'
  | 'events'
  | 'analytics'
  | 'models'
  | 'sessions'
  | 'settings';

export interface Nav {
  navigate: (view: ViewId, opts?: { streamId?: string; streamName?: string }) => void;
}
