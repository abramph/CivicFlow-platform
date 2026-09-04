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

/**
 * fix/report-export-queue-hardening follow-up: the AWS SDK v3 NodeHttpHandler
 * defaults to requestTimeout=0 (disabled) and, even when a timeout IS set,
 * only warns rather than throws unless throwOnRequestTimeout is explicit —
 * so without this config a stuck PutObject/GetObject could hang indefinitely.
 * That matters specifically for the report-export queue: an upload that
 * never resolves also never reaches the post-upload renewReportExportLease
 * call, so the row's lease keeps counting down toward reclaim by another
 * worker with no way to know the first attempt is merely stuck rather than
 * crashed. 120s is comfortably below REPORT_EXPORT_LEASE_MS (300s) — leaving
 * ~180s of lease for failure handling to run after a timeout — while staying
 * well above what even the largest upload in this app (150MB meeting
 * recordings, MAX_FILE_SIZE_BYTES) needs on a DO-to-Spaces transfer.
 */
export const SPACES_REQUEST_TIMEOUT_MS = 120_000;
const SPACES_CONNECTION_TIMEOUT_MS = 10_000;

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
    requestHandler: {
      requestTimeout: SPACES_REQUEST_TIMEOUT_MS,
      connectionTimeout: SPACES_CONNECTION_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  });
}

/**
 * fix/report-export-queue-hardening follow-up: defense-in-depth for the
 * Content-Disposition header. Callers (e.g. buildReportFilename ->
 * sanitizeFilenameSegment) already produce a safe name, but this function
 * doesn't trust that unconditionally — it strips CRLF and other C0 control
 * characters (HTTP header/response-splitting risk if a raw \r\n ever
 * reached here) and quote characters (would otherwise break out of the
 * quoted filename="..." value) directly at the point the header is built,
 * so the safety guarantee lives here rather than depending entirely on
 * every current and future caller having sanitized correctly upstream.
 * Also bounds length defensively, independent of any caller-side limit.
 */
export function sanitizeContentDispositionFilename(name: string): string {
  return (
    name
      .replace(/[\x00-\x1f\x7f"]/g, "")
      // Path separators: not a server-side traversal risk here (this value
      // only ever reaches a browser's advisory Content-Disposition save
      // dialog, never a filesystem path this app constructs), but stripped
      // anyway as defense in depth against a suggested filename that looks
      // like a directory path.
      .replace(/[/\\]/g, "-")
      .slice(0, 150)
      .trim() || "download"
  );
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
  /** Sets the object's Content-Disposition so a browser download shows this
   * name even when `key` itself is an opaque/deterministic identifier (see
   * buildDeterministicVolunteerReportObjectKey) rather than a human-readable
   * filename. Optional — omitted callers keep the prior default behavior
   * (browser derives a name from the key/URL). */
  downloadFilename?: string;
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
      ContentDisposition: params.downloadFilename
        ? `attachment; filename="${sanitizeContentDispositionFilename(params.downloadFilename)}"`
        : undefined,
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
