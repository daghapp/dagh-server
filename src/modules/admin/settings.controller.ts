import { Request, Response } from "express";
import { getSettingTab, updateSettingTab, SETTING_TABS, type SettingTab } from "../../helpers/settings.js";
import { logAdminActivity, AdminEntityType } from "../../helpers/admin-activity.js";
import { ok, fail } from "../../helpers/response.js";

function parseTab(raw: unknown): SettingTab | null {
  return typeof raw === "string" && (SETTING_TABS as readonly string[]).includes(raw)
    ? (raw as SettingTab)
    : null;
}

export class AdminSettingsController {
  /** GET /admin/settings/:tab — general | security | notifications | membership. */
  async getTab(req: Request, res: Response) {
    try {
      const tab = parseTab(req.params.tab);
      if (!tab) return fail(res, 400, `Unknown settings tab. Expected one of: ${SETTING_TABS.join(", ")}`);
      return ok(res, { tab, settings: await getSettingTab(tab) });
    } catch (error) {
      console.error("[settings] get failed:", error);
      return fail(res, 500, "Failed to load settings");
    }
  }

  /** PUT /admin/settings/:tab — shallow-merge patch. Super Administrator only. */
  async updateTab(req: Request, res: Response) {
    try {
      const tab = parseTab(req.params.tab);
      if (!tab) return fail(res, 400, `Unknown settings tab. Expected one of: ${SETTING_TABS.join(", ")}`);
      const patch = (req.body ?? {}) as Record<string, unknown>;
      if (typeof patch !== "object" || Array.isArray(patch)) {
        return fail(res, 400, "Request body must be a settings object");
      }
      const merged = await updateSettingTab(tab, patch, req.user?.id);
      await logAdminActivity({
        actorId: req.user!.id,
        entityType: AdminEntityType.SETTINGS,
        entityId: tab,
        action: "SETTINGS_UPDATED",
        note: `Settings tab "${tab}" updated`,
        metadata: { tab, keys: Object.keys(patch) },
      });
      return ok(res, { tab, settings: merged }, "Settings updated");
    } catch (error) {
      console.error("[settings] update failed:", error);
      return fail(res, 500, "Failed to update settings");
    }
  }
}
