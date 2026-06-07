// Считает дельту между «что сейчас знает Xray» (Set<email>) и «что
// должно быть» (XrayClient[]). Возвращает списки add/remove чтобы
// caller сделал минимальные gRPC-вызовы.
//
// Соль в том что email — наш primary key (уникальный per UUID), не
// сам UUID. UUIDы Xray по gRPC не отдаёт (security feature),
// поэтому весь diff происходит по email-label'ам.

import type { XrayClient } from './xray-grpc-client.ts';

export interface DiffResult {
  /** Клиенты которых нет в Xray, но должны быть. */
  toAdd: XrayClient[];
  /** Email-label'ы которые есть в Xray, но не должно быть. */
  toRemove: string[];
  /** Совпавшие — ничего не делаем. Для логов. */
  unchanged: number;
}

export function computeDiff(
  desiredClients: XrayClient[],
  currentEmails: Set<string>,
): DiffResult {
  const toAdd: XrayClient[] = [];
  const desiredEmails = new Set<string>();

  for (const c of desiredClients) {
    desiredEmails.add(c.email);
    if (!currentEmails.has(c.email)) {
      toAdd.push(c);
    }
  }

  const toRemove: string[] = [];
  for (const email of currentEmails) {
    if (!desiredEmails.has(email)) {
      toRemove.push(email);
    }
  }

  const unchanged = desiredClients.length - toAdd.length;
  return { toAdd, toRemove, unchanged };
}
