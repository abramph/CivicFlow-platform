import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
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
