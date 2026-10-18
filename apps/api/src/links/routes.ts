import { Hono } from "hono";
import { z } from "zod";
import { requireRole, type Env } from "../http.js";
import { getLinkPreview } from "./preview.js";

export const linkRoutes = new Hono<Env>();
linkRoutes.get("/link-preview", async (c) => {
  requireRole(c);
  const url = z.url().max(2048).parse(c.req.query("url"));
  c.header("Cache-Control", "no-store");
  return c.json({ preview: await getLinkPreview(url) });
});
