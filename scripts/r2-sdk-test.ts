import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { neon } from "@neondatabase/serverless";

const accountId = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET!;
const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  forcePathStyle: false,
});

const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT storage_key, mime_type FROM media_studio_assets WHERE storage_key IS NOT NULL ORDER BY created_at DESC LIMIT 1` as any[];
const key = rows[0].storage_key as string;
console.log("key:", key, "bucket:", bucket);

// HEAD via SDK
try {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  console.log("HEAD ok. size:", head.ContentLength, "mime:", head.ContentType);
} catch (e:any) {
  console.log("HEAD failed:", e.name, e.message, e?.$metadata?.httpStatusCode);
}

// Presigned GET via SDK
const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 600 });
console.log("URL:", url.slice(0,160)+"...");
const res = await fetch(url);
console.log("GET status:", res.status);
if (!res.ok) console.log((await res.text()).slice(0,400));
else console.log("OK len:", res.headers.get("content-length"), "ct:", res.headers.get("content-type"));
