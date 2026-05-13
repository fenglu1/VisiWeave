import type { Hono } from "hono";
import { deleteGalleryOutput, getGalleryImages } from "../../domain/project/project-store.js";
import { errorResponse } from "../http/errors.js";

export function registerGalleryRoutes(app: Hono): void {
  app.get("/api/gallery", (c) => c.json(getGalleryImages()));

  app.delete("/api/gallery/:outputId", (c) => {
    const deleted = deleteGalleryOutput(c.req.param("outputId"));
    if (!deleted) {
      return c.json(errorResponse("not_found", "找不到请求的 Gallery 图片记录。"), 404);
    }

    return c.json({
      ok: true
    });
  });
}
