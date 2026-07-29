// Local outbox log — a record of events THIS app has produced (real Kafka/REST
// sends), for the Outbox view. Not a simulated inbox: incoming events come only
// from live Kafka consumption (see src/lib/inboxStore.ts).
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
// Events FROM this profile = its outbox.
export function outboxFor(profileId: string): BusMessage[] {
  return all().filter((m) => m.fromProfileId === profileId);
}
