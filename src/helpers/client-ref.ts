//generate random strings for payment api

export const generateClientReference = (length: number = 3, target: string = ""): string => {
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * Math.pow(10, length));
    const paddedNum = randomNum.toString().padStart(length, '0');
    return `TXN-${year}-${paddedNum}`;
}

export const generateClientReference_targetType = (
  targetType: string,
  length: number = 6
): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const randomNum = Math.floor(Math.random() * Math.pow(10, length));
  const paddedNum = randomNum.toString().padStart(length, "0");
  const randomNum2 = Math.floor(Math.random() * Math.pow(10, 4));
  const paddedNum2 = randomNum2.toString().padStart(4, "0");

  const normalizedTarget = targetType.toUpperCase();

  // Example: TXN-2026-05-TOUR-123-4821
  return `TXN-${normalizedTarget}-${paddedNum}-${paddedNum2}`;
};
