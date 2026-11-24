import { z } from "zod";
import { normalizeGender } from "../helpers/dating-gender.js";

export const genderSchema = z.string().transform((value, ctx) => {
  const gender = normalizeGender(value);
  if (!gender) {
    ctx.addIssue({ code: "custom", message: "Invalid gender value" });
    return z.NEVER;
  }
  return gender;
});

export const genderPreferenceSchema = z.array(genderSchema);
