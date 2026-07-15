// Local event bus — stands in for Kafka. Persisted so Send and Receive share it.
// Phase 2: replace publish/inboxFor with Kafka produce / consume via the sidecar.
import type { BusMessage } from "../types";
import { load, save } from "./storage";

const KEY = "bus";

export function all(): BusMessage[] {
  return load<BusMessage[]>(KEY, []);
}
export function publish(msg: BusMessage): void {
  const list = all();
  list.unshift(msg);
  save(KEY, list);
}
export function update(id: string, patch: Partial<BusMessage>): void {
  save(KEY, all().map((m) => (m.id === id ? { ...m, ...patch } : m)));
}
// Events addressed TO this profile (by idp) = its inbox.
export function inboxFor(idp: string): BusMessage[] {
  return all().filter((m) => m.toIdp === idp);
}
// Events FROM this profile = its outbox.
export function outboxFor(profileId: string): BusMessage[] {
  return all().filter((m) => m.fromProfileId === profileId);
}
