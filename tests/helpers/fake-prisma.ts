import { vi } from "vitest";
import type { PrismaClient } from "@modelcontract/db";

type Json = Record<string, unknown>;

let counter = 0;
const nextId = () => `fake_${++counter}`;

/**
 * In-memory PrismaClient stand-in implementing exactly the delegate methods
 * the application uses (provider/model/contract/observation/
 * collectorVersion/demoState/driftEvent). Normal CI runs against this; opt-in
 * live runs use the real PrismaClient + PostgreSQL.
 */
export function createFakeDb() {
  const providers = new Map<string, Json>();
  const models = new Map<string, Json>();
  const contracts = new Map<string, Json>();
  const collectorVersions = new Map<string, Json>();
  const demoStates = new Map<string, Json>();
  const observations: Json[] = [];
  const driftEvents: Json[] = [];

  const db = {
    provider: {
      upsert: vi.fn(async (args: { where: { slug: string }; create: Json; update: Json }) => {
        const existing = providers.get(args.where.slug);
        if (existing) return { ...existing, ...args.update };
        const row = { id: nextId(), createdAt: new Date(), ...args.create };
        providers.set(args.where.slug, row);
        return row;
      }),
    },
    model: {
      upsert: vi.fn(
        async (args: {
          where: { providerId_modelId: { providerId: string; modelId: string } };
          create: Json;
          update: Json;
        }) => {
          const key = `${args.where.providerId_modelId.providerId}:${args.where.providerId_modelId.modelId}`;
          const existing = models.get(key);
          if (existing) return { ...existing, ...args.update };
          const row = { id: nextId(), createdAt: new Date(), ...args.create };
          models.set(key, row);
          return row;
        },
      ),
    },
    contract: {
      upsert: vi.fn(async (args: { where: { modelId: string }; create: Json; update: Json }) => {
        const existing = contracts.get(args.where.modelId);
        if (existing) return { ...existing, ...args.update };
        const row = { id: nextId(), createdAt: new Date(), ...args.create };
        contracts.set(args.where.modelId, row);
        return row;
      }),
      findMany: vi.fn(async () => [...contracts.values()]),
      findUnique: vi.fn(async (args: { where: { id: string } | { modelId: string } }) => {
        const w = args.where as Record<string, string>;
        if (w.id) {
          for (const c of contracts.values()) if (c.id === w.id) return c;
        }
        if (w.modelId) {
          return contracts.get(w.modelId) ?? null;
        }
        return null;
      }),
    },
    observation: {
      create: vi.fn(async (args: { data: Json }) => {
        const row = { id: nextId(), createdAt: new Date(), ...args.data };
        observations.push(row);
        return row;
      }),
    },
    collectorVersion: {
      upsert: vi.fn(
        async (args: {
          where: { collectorId_version: { collectorId: string; version: string } };
          create: Json;
          update: Json;
        }) => {
          const key = `${args.where.collectorId_version.collectorId}:${args.where.collectorId_version.version}`;
          const existing = collectorVersions.get(key);
          if (existing) return { ...existing, ...args.update };
          const row = { id: nextId(), createdAt: new Date(), ...args.create };
          collectorVersions.set(key, row);
          return row;
        },
      ),
    },
    driftEvent: {
      create: vi.fn(async (args: { data: Json }) => {
        const row = { id: nextId(), createdAt: new Date(), ...args.data };
        driftEvents.push(row);
        return row;
      }),
      findMany: vi.fn(async () => [...driftEvents]),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        for (const e of driftEvents) if (e.id === args.where.id) return e;
        return null;
      }),
    },
    demoState: {
      upsert: vi.fn(async (args: { where: { id: string }; create: Json; update: Json }) => {
        const existing = demoStates.get(args.where.id);
        if (existing) {
          const row = { ...existing, ...args.update, updatedAt: new Date() };
          demoStates.set(args.where.id, row);
          return row;
        }
        const row = { id: args.where.id, updatedAt: new Date(), ...args.create };
        demoStates.set(args.where.id, row);
        return row;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => demoStates.get(args.where.id) ?? null),
    },
    $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => {
      // Snapshot mutable stores before callback
      const snapObs = [...observations];
      const snapContracts = new Map(contracts);
      const snapDrift = [...driftEvents];
      try {
        return await fn(db);
      } catch (err) {
        // Restore on failure — simulates transaction rollback
        observations.length = 0;
        observations.push(...snapObs);
        contracts.clear();
        for (const [k, v] of snapContracts) contracts.set(k, v);
        driftEvents.length = 0;
        driftEvents.push(...snapDrift);
        throw err;
      }
    }),
  };

  return {
    ...db,
    /** Test accessors. */
    __observations: observations,
    __contracts: contracts,
    __driftEvents: driftEvents,
  } as unknown as FakeDb;
}

export type FakeDb = PrismaClient & {
  __observations: Json[];
  __contracts: Map<string, Json>;
  __driftEvents: Json[];
};

export type { PrismaClient };
