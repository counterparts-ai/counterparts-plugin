import { isDay, isRecurrence } from "../time.js";
import { RECURRING_META } from "./operational.js";
export function recurrenceOfRow(row) {
  if (!isDay(row.event_date))
    return null;
  if (!row.meta.includes(`"${RECURRING_META}"`))
    return null;
  let rule;
  try {
    rule = JSON.parse(row.meta)[RECURRING_META];
  } catch {
    return null;
  }
  return isRecurrence(rule) ? rule : null;
}
export function memoryWhere(filter) {
  const where = [];
  const args = [];
  if (filter.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.band) {
    where.push("band = ?");
    args.push(filter.band);
  }
  if (filter.archived !== undefined) {
    where.push("archived = ?");
    args.push(filter.archived ? 1 : 0);
  }
  if (filter.source !== undefined) {
    where.push("source = ?");
    args.push(filter.source);
  }
  if (filter.learnedOnFrom !== undefined) {
    where.push("learned_on >= ?");
    args.push(filter.learnedOnFrom);
  }
  if (filter.originRef !== undefined) {
    where.push("origin_ref = ?");
    args.push(filter.originRef);
  }
  if (filter.bornFromDay !== undefined) {
    where.push("birth_day >= ?");
    args.push(filter.bornFromDay);
  }
  if (filter.originSession !== undefined) {
    where.push("origin_session = ?");
    args.push(filter.originSession);
  }
  if (filter.about !== undefined) {
    where.push("about = ?");
    args.push(filter.about);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}
