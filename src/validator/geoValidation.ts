import { z } from "zod";

// zod v4 uses top-level z.ipv4()/z.ipv6() instead of a .ip() string method.
export const verifyJurisdictionSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()]),
});
