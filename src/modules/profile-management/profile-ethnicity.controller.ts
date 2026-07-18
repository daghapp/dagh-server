import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";

const EthnicityValues = [
  "African",
  "Asian",
  "Black_African_American",
  "Caribbean",
  "Caucassian_White",
  "Hispanic_Latino",
  "Middle_Eastern",
  "Mixed",
  "Native_American_Indigenous",
  "Pacific_Islander",
  "Other",
] as const;

type Ethnicity = (typeof EthnicityValues)[number];

export async function setUserEthnicity(req: Request, res: Response) {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return fail(res, 401, "Unauthorized");
    }

    const { ethnicity } = req.body as { ethnicity?: Ethnicity };

    if (ethnicity === undefined || ethnicity === null) {
      return fail(res, 400, "ethnicity is required");
    }

    if (!EthnicityValues.includes(ethnicity)) {
      return fail(res, 400, "Invalid ethnicity");
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ethnicity: ethnicity as
          | "African"
          | "Asian"
          | "Black_African_American"
          | "Caribbean"
          | "Caucassian_White"
          | "Hispanic_Latino"
          | "Middle_Eastern"
          | "Mixed"
          | "Native_American_Indigenous"
          | "Pacific_Islander"
          | "Other",
      },
      select: { id: true, ethnicity: true },
    });

    return ok(res, updated, "Ethnicity updated successfully.");
  } catch (error) {
    console.error("[setUserEthnicity]", error);
    return fail(res, 500, "Failed to update ethnicity.");
  }
}
