import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";

const PAGE = 50;

/**
 * The in-app notification list (every notice the app sends is also written here).
 * Links are stored as full URLs for emails; the list returns the in-app path too.
 */
export function notificationRoutes(db: Db, webAppUrl: string): RouteDef[] {
  const pathOf = (link: string | null) => {
    if (!link) return null;
    if (link.startsWith(webAppUrl)) return link.slice(webAppUrl.length) || "/";
    return link.startsWith("/") ? link : null;
  };
  return [
    defineRoute({
      method: "get",
      path: "/me/notifications",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "My notifications, newest first, and how many are unread",
      tags: ["notifications"],
      request: { query: z.object({ before: z.coerce.date().optional(), unreadOnly: z.enum(["true", "false"]).optional() }) },
      responses: { 200: { description: "Notifications" } },
      handler: async ({ auth, query }) => {
        const [items, unread] = await Promise.all([
          db.notification.findMany({
            where: { userId: auth.userId, ...(query.before ? { createdAt: { lt: query.before } } : {}), ...(query.unreadOnly === "true" ? { readAt: null } : {}) },
            orderBy: { createdAt: "desc" },
            take: PAGE + 1,
            select: { id: true, channel: true, title: true, body: true, link: true, readAt: true, createdAt: true },
          }),
          db.notification.count({ where: { userId: auth.userId, readAt: null } }),
        ]);
        return {
          unread,
          items: items.slice(0, PAGE).map((n) => ({ ...n, path: pathOf(n.link) })),
          more: items.length > PAGE,
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/me/notifications/unread-count",
      routeClass: "HOT",
      access: "authenticated",
      summary: "How many notifications I haven't read (for the badge in the side panel)",
      tags: ["notifications"],
      responses: { 200: { description: "Count" } },
      handler: async ({ auth }) => ({ unread: await db.notification.count({ where: { userId: auth.userId, readAt: null } }) }),
    }),
    defineRoute({
      method: "post",
      path: "/me/notifications/read",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "Mark some (ids) or all of my notifications as read",
      tags: ["notifications"],
      request: { body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) },
      responses: { 200: { description: "Unread count after" } },
      handler: async ({ auth, body }) => {
        await db.notification.updateMany({
          where: { userId: auth.userId, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) },
          data: { readAt: new Date() },
        });
        return { unread: await db.notification.count({ where: { userId: auth.userId, readAt: null } }) };
      },
    }),
  ];
}
