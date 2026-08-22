import crypto from "crypto";

export const generateClientReference = (length: number = 3, _target: string = ""): string => {
  const year = new Date().getFullYear();
  const randomPart = crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
  return `TXN-${year}-${randomPart}`;
};

export const generateClientReference_targetType = (
  targetType: string,
  length: number = 6,
): string => {
  const randomPart = crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
  const randomPart2 = crypto.randomBytes(2).toString("hex").slice(0, 4);

  // Hubtel rejects client references longer than 36 characters, so the
  // target type portion is truncated to keep the full reference within limit.
  const normalizedTarget = targetType.toUpperCase();
  const fixedOverhead = 4 + 1 + length + 1 + 4; // "TXN-" + "-" + random + "-" + randomPart2
  const trimmedTarget = normalizedTarget.slice(0, 36 - fixedOverhead);

  return `TXN-${trimmedTarget}-${randomPart}-${randomPart2}`;
};
