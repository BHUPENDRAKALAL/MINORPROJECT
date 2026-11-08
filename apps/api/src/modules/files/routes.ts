import multer from "multer";
import { z } from "zod";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import { ApiError } from "../../http/errors.ts";
import { SELF_UPLOAD_KINDS, type FilesService } from "./service.ts";

const FileBody = z.object({
  id: z.string(),
  kind: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  scanStatus: z.string(),
});

export function filesRoutes(service: FilesService, maxMb: number): RouteDef[] {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 5 } }).single("file");
  return [
    defineRoute({
      method: "post",
      path: "/files",
      routeClass: "BACKGROUND",
      access: "authenticated",
      summary: `Upload a file (multipart field "file", max ${maxMb} MB). Virus scan runs in the background.`,
      tags: ["files"],
      limit: { windowMs: 10 * 60_000, max: 40 },
      before: [
        (req, res, next) =>
          upload(req, res, (err: unknown) => {
            if (err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
              return next(new ApiError(413, "FILE_TOO_LARGE", `The file is larger than ${maxMb} MB.`));
            }
            next(err);
          }),
      ],
      request: { query: z.object({ kind: z.enum(SELF_UPLOAD_KINDS) }) },
      responses: { 201: { description: "Stored", schema: FileBody }, 415: { description: "File type not accepted" } },
      handler: async ({ query, auth, req, res }) => {
        if (!req.file) throw new ApiError(400, "NO_FILE", 'Attach a file in the "file" field.');
        res.status(201);
        return service.upload(auth.userId, query.kind, req.file);
      },
    }),
    defineRoute({
      method: "get",
      path: "/files/:id/link",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "A download link that works for 2 minutes (permission checked)",
      tags: ["files"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: { description: "Link", schema: z.object({ url: z.string(), expiresInSeconds: z.number() }) } },
      handler: ({ params, auth }) => service.link(auth, params.id),
    }),
  ];
}
