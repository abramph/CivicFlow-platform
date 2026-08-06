import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/lib/env";

function createS3Client() {
  const env = getServerEnv();
  return new S3Client({
    region: env.DO_SPACES_REGION,
    endpoint: env.DO_SPACES_ENDPOINT,
    forcePathStyle: false,
    credentials: {
      accessKeyId: env.DO_SPACES_ACCESS_KEY_ID,
      secretAccessKey: env.DO_SPACES_SECRET_ACCESS_KEY,
    },
  });
}

export function buildSafeObjectKey(prefix: string, fileName: string): string {
  const sanitizedPrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, "-").replace(/\/+$/g, "");
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .toLowerCase();

  const safeName = sanitizedName || "file.bin";
  return `${sanitizedPrefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
}

export async function uploadBufferToSpaces(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const env = getServerEnv();
  const s3 = createS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: params.key,
      Body: params.buffer,
      ContentType: params.contentType,
      ACL: "private",
      Metadata: params.metadata,
    })
  );

  return {
    bucket: env.DO_SPACES_BUCKET,
    key: params.key,
  };
}

export async function deleteObjectFromSpaces(key: string) {
  const env = getServerEnv();
  const s3 = createS3Client();

  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: key,
    })
  );
}

/**
 * Live, read-only reachability check for the configured Spaces bucket — a
 * HeadBucket call (no object read/write, no billable transfer), used only by
 * the Meeting Intelligence pilot diagnostics page. Never logs or returns
 * credentials; callers must catch and classify the thrown error themselves
 * (see platform-operations/meeting-intelligence.ts) rather than surface it
 * directly, since the AWS SDK's own error messages can include the endpoint
 * URL and bucket name.
 */
export async function verifySpacesBucketAccess(): Promise<void> {
  const env = getServerEnv();
  const s3 = createS3Client();
  await s3.send(new HeadBucketCommand({ Bucket: env.DO_SPACES_BUCKET }));
}

/**
 * Reads an object's full bytes into memory. Every other caller of this
 * module only ever needs a signed URL (handed to an external vendor, e.g.
 * meeting-intelligence's transcription provider) — the Resumable Import
 * Program's worker is the first caller that needs to parse a stored file's
 * own content itself, so this is a small, additive primitive alongside the
 * existing upload/delete/sign functions, not a new storage system.
 */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const env = getServerEnv();
  const s3 = createS3Client();

  const result = await s3.send(new GetObjectCommand({ Bucket: env.DO_SPACES_BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  const body = result.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function getSignedObjectUrl(key: string, expiresInSeconds = 600) {
  const env = getServerEnv();
  const s3 = createS3Client();

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds }
  );
}
