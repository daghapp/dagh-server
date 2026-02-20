//generate random strings for payment api

export const generateClientReference = (length: number = 3): string => {
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * Math.pow(10, length));
    const paddedNum = randomNum.toString().padStart(length, '0');
    return `TXN-${year}-${paddedNum}`;
}