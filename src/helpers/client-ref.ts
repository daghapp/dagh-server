import crypto from "crypto";

export const generateClientReference = (length: number = 3, target: string = ""): string => {
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
  const now = new Date();
  const randomPart = crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
  const randomPart2 = crypto.randomBytes(2).toString("hex").slice(0, 4);

  const normalizedTarget = targetType.toUpperCase();

  return `TXN-${normalizedTarget}-${randomPart}-${randomPart2}`;
};
