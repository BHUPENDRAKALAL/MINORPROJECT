import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env.ts";

/**
 * Private file storage behind one small interface (BACKEND-DESIGN.md §8).
 * Files are never public: downloads go through short-lived signed links.
 * Tests use the in-memory version; everything else talks S3 (SeaweedFS in dev).
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A link that works for `seconds` and then stops. */
  signedUrl(key: string, seconds: number, downloadName?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Creates the bucket if it doesn't exist (called at start-up). */
  ensureReady(): Promise<void>;
}

type S3Env = Pick<Env, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY" | "S3_SECRET_KEY" | "S3_FORCE_PATH_STYLE">;

export function s3Storage(env: S3Env): Storage {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  const Bucket = env.S3_BUCKET;
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async signedUrl(key, seconds, downloadName) {
      const disposition = downloadName ? `inline; filename="${downloadName.replace(/["\\\r\n]/g, "_")}"` : undefined;
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async ensureReady() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },
  };
}

/** In-memory storage for tests. */
export function memoryStorage(): Storage & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async signedUrl(key, seconds) {
      if (!objects.has(key)) throw new Error(`No object ${key}`);
      return `memory://${key}?expires=${seconds}`;
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) throw new Error(`No object ${key}`);
      return o.body;
    },
    async remove(key) {
      objects.delete(key);
    },
    async ensureReady() {},
  };
}
