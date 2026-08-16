// Confirmation manager: deterministic confirmation flows for safety-critical
// actions. Never uses AI-generated confirmations. Supports spoken "confirm" /
// "cancel" and on-screen confirm/cancel buttons.

import type { ConfirmationRequest, VoiceIntent, VoiceIntentName } from './voiceTypes';

export class ConfirmationManager {
  private active: ConfirmationRequest | null = null;
  private listeners = new Set<(req: ConfirmationRequest | null) => void>();

  subscribe(cb: (req: ConfirmationRequest | null) => void): () => void {
    this.listeners.add(cb);
    cb(this.active);
    return () => this.listeners.delete(cb);
  }

  get current(): ConfirmationRequest | null {
    return this.active;
  }

  /** Starts a confirmation flow. Returns false when one is already active. */
  request(intent: VoiceIntentName, message: string, onConfirm: () => void, onCancel?: () => void): boolean {
    if (this.active) return false;
    this.active = {
      id: `${intent}-${Date.now()}`,
      intent,
      message,
      onConfirm,
      onCancel: onCancel ?? (() => {}),
    };
    this.emit();
    return true;
  }

  confirm(): void {
    const req = this.active;
    if (!req) return;
    this.active = null;
    this.emit();
    req.onConfirm();
  }

  cancel(): void {
    const req = this.active;
    if (!req) return;
    this.active = null;
    this.emit();
    req.onCancel();
  }

  clear(): void {
    this.active = null;
    this.emit();
  }

  /** Routes a confirm/cancel intent to the active request, if any. */
  handleConfirmIntent(intent: VoiceIntent): boolean {
    if (intent.intent === 'confirm' && this.active) {
      this.confirm();
      return true;
    }
    if (intent.intent === 'cancel' && this.active) {
      this.cancel();
      return true;
    }
    return false;
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.active);
  }
}
