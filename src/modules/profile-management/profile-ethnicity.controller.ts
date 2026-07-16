import { Request, Response } from "express";
import { prisma } from "../../config/index.js";

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
      return res.status(401).json({ success: false, message: "Unauthorized", data: null });
    }

    const { ethnicity } = req.body as { ethnicity?: Ethnicity };

    if (ethnicity === undefined || ethnicity === null) {
      return res.status(400).json({
        success: false,
        message: "ethnicity is required",
        data: null,
      });
    }

    if (!EthnicityValues.includes(ethnicity)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ethnicity",
        data: null,
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { ethnicity: ethnicity as any },
      select: { id: true, ethnicity: true },
    });

    return res.status(200).json({
      success: true,
      message: "Ethnicity updated successfully.",
      data: updated,
    });
  } catch (error) {
    console.error("[setUserEthnicity]", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update ethnicity.",
      data: null,
    });
  }
}
