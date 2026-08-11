import { Hono } from "hono";
import type { ApiBindings } from "../../lib/bindings";
import { tenantAccessMiddleware } from "./auth";
import type { DashboardVariables } from "./types";
import { adminDashboardRoutes } from "./routes/admin";
import { alertsDashboardRoutes } from "./routes/alerts";
import { catalogDashboardRoutes } from "./routes/catalog";
import { conversationsDashboardRoutes } from "./routes/conversations";
import { diagnosticsDashboardRoutes } from "./routes/diagnostics";
import { lunchRemindersDashboardRoutes } from "./routes/lunch-reminders";
import { menuDashboardRoutes } from "./routes/menu";
import { notificationsDashboardRoutes } from "./routes/notifications";
import { ordersDashboardRoutes } from "./routes/orders";
import { publicCartaRoutes } from "./routes/public-carta";
import { publicProfileRoutes } from "./routes/public-profile";
import { settingsDashboardRoutes } from "./routes/settings";
import { uploadsDashboardRoutes } from "./routes/uploads";

export const dashboardRoutes = new Hono<{
  Bindings: ApiBindings;
  Variables: DashboardVariables;
}>();

dashboardRoutes.route("/", adminDashboardRoutes);
dashboardRoutes.route("/", publicCartaRoutes);
dashboardRoutes.route("/", publicProfileRoutes);
dashboardRoutes.use("/:tenantSlug/*", tenantAccessMiddleware);
dashboardRoutes.route("/", ordersDashboardRoutes);
dashboardRoutes.route("/", conversationsDashboardRoutes);
dashboardRoutes.route("/", notificationsDashboardRoutes);
dashboardRoutes.route("/", lunchRemindersDashboardRoutes);
dashboardRoutes.route("/", alertsDashboardRoutes);
dashboardRoutes.route("/", settingsDashboardRoutes);
dashboardRoutes.route("/", catalogDashboardRoutes);
dashboardRoutes.route("/", uploadsDashboardRoutes);
dashboardRoutes.route("/", diagnosticsDashboardRoutes);
dashboardRoutes.route("/", menuDashboardRoutes);
