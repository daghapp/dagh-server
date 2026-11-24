import type { Gender } from "../../generated/prisma/enums.js";

export const VALID_GENDERS = [
  "MALE",
  "FEMALE",
  "OTHER",
  "NON_BINARY",
  "PREFER_NOT_TO_SAY",
] as const satisfies readonly Gender[];

const GENDER_ALIASES: Record<string, Gender> = {
  M: "MALE",
  MAN: "MALE",
  MALE: "MALE",
  BOY: "MALE",
  F: "FEMALE",
  W: "FEMALE",
  WOMAN: "FEMALE",
  FEMALE: "FEMALE",
  GIRL: "FEMALE",
  OTHER: "OTHER",
  NON_BINARY: "NON_BINARY",
  NONBINARY: "NON_BINARY",
  PREFER_NOT_TO_SAY: "PREFER_NOT_TO_SAY",
};

export function normalizeGender(value: string | null | undefined): Gender | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return GENDER_ALIASES[normalized] ?? null;
}

export function oppositeGenderPreference(myGender: string | null | undefined): Gender[] {
  const gender = normalizeGender(myGender);
  if (gender === "MALE") return ["FEMALE"];
  if (gender === "FEMALE") return ["MALE"];
  return [];
}

export function canDatingInteract(
  viewerGender: string | null | undefined,
  targetGender: string | null | undefined,
): boolean {
  const allowed = oppositeGenderPreference(viewerGender);
  const target = normalizeGender(targetGender);
  return target !== null && allowed.includes(target);
}
