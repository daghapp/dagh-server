import { prisma } from "../config/prisma.js";

export async function getAccountId(accountName: string): Promise<string> {
  const account = await prisma.ledgerAccount.findUnique({
    where: { name: accountName },
  });

  if (!account) {
    throw new Error(`Ledger account not found: ${accountName}`);
  }

  return account.id;
}
