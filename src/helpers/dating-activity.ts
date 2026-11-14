import { prisma } from "../config/prisma.js";

export const DatingEntityType = {
  BLOCK: "BLOCK",
  REPORT: "REPORT",
  SWIPE: "SWIPE",
} as const;

export type DatingEntityType = (typeof DatingEntityType)[keyof typeof DatingEntityType];

export interface LogDatingActivityInput {
  actorId: string;
  entityType: DatingEntityType;
  entityId: string;
  action: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export function logDatingActivity(input: LogDatingActivityInput) {
  return prisma.datingActivityLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      note: input.note ?? null,
      ...(input.metadata ? { metadata: input.metadata as object } : {}),
    },
  });
}