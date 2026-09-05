// Destination-neutral consumer for the protected knowledge export.
// This module deliberately performs no network calls and has no gbrain SDK
// dependency. The caller supplies a bounded page reader and a destination
// adapter whose writes are scoped by its own credentials.

const PROTOCOL = 1;
const MAX_CHANGES = 100;
const MAX_PAGES = 1000;
const MAX_STATE_ENTRIES = 100000;

export class KnowledgeSyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function emptyKnowledgeSyncState() {
  return {protocol: PROTOCOL, epoch: null, cursor: null, throughRevision: 0, revisions: {}};
}

const clone = value => structuredClone(value);
const isRevision = value => Number.isSafeInteger(value) && value >= 0;
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const isCursor = value => value === null || (typeof value === 'string' && value.length <= 2048);

function fail(code) { throw new KnowledgeSyncError(code, 'Knowledge synchronization requires reconciliation'); }

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateState(input) {
  const state = input && typeof input === 'object' ? input : emptyKnowledgeSyncState();
  if (state.protocol !== PROTOCOL || (state.epoch !== null && typeof state.epoch !== 'string') ||
      !isCursor(state.cursor) || !isRevision(state.throughRevision) || !state.revisions || typeof state.revisions !== 'object' ||
      Array.isArray(state.revisions) || Object.keys(state.revisions).length > MAX_STATE_ENTRIES) fail('SYNC_STATE_INVALID');
  for (const [id, fence] of Object.entries(state.revisions)) {
    if (!isId(id) || !fence || typeof fence !== 'object' || !isRevision(fence.revision) || !['upsert', 'delete'].includes(fence.operation)) fail('SYNC_STATE_INVALID');
  }
  return clone(state);
}

function validatePage(page) {
  if (!page || page.protocol !== PROTOCOL || typeof page.epoch !== 'string' || !page.epoch ||
      !isRevision(page.throughRevision) || !Array.isArray(page.changes) || page.changes.length > MAX_CHANGES ||
      typeof page.hasMore !== 'boolean' || !isCursor(page.nextCursor) || (page.hasMore && !page.nextCursor)) fail('SYNC_PAGE_INVALID');
  const seen = new Set();
  for (const change of page.changes) {
    if (!change || !isId(change.id) || !isRevision(change.revision) || !['upsert', 'delete'].includes(change.operation)) fail('SYNC_PAGE_INVALID');
    if (seen.has(change.id)) fail('SYNC_PAGE_INVALID');
    seen.add(change.id);
    if (change.revision > page.throughRevision) fail('SYNC_PAGE_INVALID');
    if (change.operation === 'upsert' && (!change.record || typeof change.record !== 'object' || Array.isArray(change.record))) fail('SYNC_PAGE_INVALID');
    if (change.operation === 'delete' && Object.hasOwn(change, 'record')) fail('SYNC_PAGE_INVALID');
  }
  return page;
}

function expiry(change, now) {
  if (change.operation !== 'upsert') return change;
  const deadline = change.record?.retention?.expiresAt;
  if (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline))) return change;
  if (Date.parse(deadline) > now.getTime()) return change;
  return {id: change.id, revision: change.revision, operation: 'delete', reason: 'expired'};
}

async function readDestination(destination, id) {
  if (!destination || typeof destination.read !== 'function') fail('DESTINATION_CONTRACT');
  try { return await destination.read(id); }
  catch { throw new KnowledgeSyncError('DESTINATION_UNAVAILABLE', 'Knowledge destination is unavailable'); }
}

function destinationRevision(current) {
  return current && isRevision(current.revision) ? current.revision : null;
}

async function exactOutcome(current,change) {
  return destinationRevision(current)===change.revision && current.operation===change.operation &&
    (change.operation==='delete'||await digest(current.record)===await digest(change.record));
}

async function applyChange(destination, change) {
  const before = await readDestination(destination, change.id);
  const beforeRevision = destinationRevision(before);
  if (beforeRevision !== null && beforeRevision > change.revision) return 'stale';
  if (beforeRevision === change.revision && before.operation === 'delete' && change.operation === 'upsert') return 'delete-wins';
  const write = change.operation === 'delete' ? destination.delete : destination.upsert;
  if (typeof write !== 'function') fail('DESTINATION_CONTRACT');
  try {
    if (change.operation === 'delete') await write.call(destination, change.id, change.revision);
    else await write.call(destination, change.id, clone(change.record), change.revision);
  } catch {
    // A timeout is not permission to replay blindly. Read the destination and
    // accept only an exact, durable outcome.
    const afterUncertain = await readDestination(destination, change.id);
    if (!await exactOutcome(afterUncertain,change)) {
      throw new KnowledgeSyncError('DESTINATION_UNCERTAIN', 'Knowledge destination write needs reconciliation');
    }
    return 'confirmed-after-error';
  }
  const after = await readDestination(destination, change.id);
  if (!await exactOutcome(after,change)) {
    throw new KnowledgeSyncError('DESTINATION_RACE', 'Knowledge destination changed during synchronization');
  }
  return 'applied';
}

async function consumePage(pageInput, stateInput, destination, now) {
  const page = validatePage(pageInput);
  const state = validateState(stateInput);
  if (state.epoch !== null && state.epoch !== page.epoch) fail('SYNC_EPOCH_MISMATCH');
  if (page.throughRevision < state.throughRevision) fail('SYNC_CHECKPOINT_ROLLBACK');
  if (page.hasMore && page.nextCursor === state.cursor) fail('SYNC_CURSOR_STALLED');
  const next = {...state, epoch: page.epoch, throughRevision: page.throughRevision, cursor: page.nextCursor, revisions: {...state.revisions}};
  let applied = 0, skipped = 0;
  for (const raw of page.changes) {
    const change = expiry(raw, now);
    const prior = next.revisions[change.id];
    const priorRevision = prior && isRevision(prior.revision) ? prior.revision : null;
    if (priorRevision !== null && priorRevision > change.revision) { skipped++; continue; }
    if (priorRevision === change.revision && prior.operation === 'delete' && change.operation === 'upsert') { skipped++; continue; }
    if (priorRevision === change.revision && prior.operation === change.operation) {
      const existing = await readDestination(destination, change.id);
      if (await exactOutcome(existing,change)) { skipped++; continue; }
    }
    const outcome = await applyChange(destination, change);
    if (outcome === 'stale' || outcome === 'delete-wins') { skipped++; continue; }
    next.revisions[change.id] = {revision: change.revision, operation: change.operation};
    applied++;
  }
  return {state: next, applied, skipped};
}

// Pulls pages until the source says it is caught up. stateStore.save is called
// only after every change in a page has a durable destination outcome.
export async function syncKnowledgeExport({fetchPage, stateStore, destination, now = new Date(), maxPages = MAX_PAGES}) {
  if (typeof fetchPage !== 'function' || !stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') fail('SYNC_CONTRACT');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) fail('SYNC_INPUT');
  let state = validateState(await stateStore.load());
  let pages = 0, applied = 0, skipped = 0;
  while (pages < maxPages) {
    const page = await fetchPage(state.cursor);
    const result = await consumePage(page, state, destination, now);
    await stateStore.save(clone(result.state));
    state = result.state; pages++; applied += result.applied; skipped += result.skipped;
    if (!page.hasMore) return {state: clone(state), pages, applied, skipped};
  }
  throw new KnowledgeSyncError('SYNC_PAGE_LIMIT', 'Knowledge export did not finish within the page limit');
}

// Runs independently of source polling so an offline consumer cannot retain an
// expired record merely because no new source revision was emitted.
export async function expireKnowledge({stateStore, destination, now = new Date()}) {
  if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function' ||
      !destination || typeof destination.list !== 'function') fail('EXPIRY_CONTRACT');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('SYNC_INPUT');
  const state = validateState(await stateStore.load());
  const next = {...state, revisions: {...state.revisions}};
  let expired = 0;
  const entries = await destination.list();
  if (!Array.isArray(entries) || entries.length > 10000) fail('DESTINATION_INVALID');
  for (const entry of entries) {
    const record = entry?.record;
    const revision = destinationRevision(entry);
    if (!isId(entry?.id) || revision === null || entry.operation !== 'upsert' || !record) continue;
    const deadline = record.retention?.expiresAt;
    if (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) > now.getTime()) continue;
    const change = {id: entry.id, revision, operation: 'delete', reason: 'expired'};
    const prior = next.revisions[entry.id];
    if (prior?.revision > revision) continue;
    if (prior?.revision === revision && prior.operation === 'delete') continue;
    const outcome=await applyChange(destination, change);
    if (outcome==='stale'||outcome==='delete-wins') continue;
    next.revisions[entry.id] = {revision, operation: 'delete'}; expired++;
  }
  if (expired) await stateStore.save(clone(next));
  return {state: clone(next), expired};
}
