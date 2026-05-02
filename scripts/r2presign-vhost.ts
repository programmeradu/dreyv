import { createHash, createHmac } from "crypto";
import { neon } from "@neondatabase/serverless";

const accountId = process.env.R2_ACCOUNT_ID!;
const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
const bucket = process.env.R2_BUCKET!;

function awsEncode(v:string){return encodeURIComponent(v).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);}
function encodeKey(k:string){return k.split("/").map(awsEncode).join("/");}
function sha256Hex(s:string|Buffer){return createHash("sha256").update(s).digest("hex");}
function hmac(k:Buffer|string,v:string){return createHmac("sha256",k).update(v).digest();}

async function presignVhost(key:string, mime:string){
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g,"");
  const dateStamp = amzDate.slice(0,8);
  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const params: Record<string,string> = {
    "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
    "X-Amz-Credential":`${accessKeyId}/${credentialScope}`,
    "X-Amz-Date":amzDate,
    "X-Amz-Expires":"600",
    "X-Amz-SignedHeaders":"host",
    "response-content-disposition":`inline; filename="diag.png"`,
    "response-content-type":mime,
  };
  const query = Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${awsEncode(k)}=${awsEncode(v)}`).join("&");
  const canonicalUri = `/${encodeKey(key)}`;
  const canonicalRequest = ["GET",canonicalUri,query,`host:${host}\n`,"host","UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256",amzDate,credentialScope,sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${secretAccessKey}`,dateStamp);
  const kRegion = hmac(kDate,"auto");
  const kService = hmac(kRegion,"s3");
  const kSigning = hmac(kService,"aws4_request");
  const sig = createHmac("sha256",kSigning).update(stringToSign).digest("hex");
  return `https://${host}${canonicalUri}?${query}&X-Amz-Signature=${sig}`;
}

const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT storage_key, mime_type FROM media_studio_assets WHERE storage_key IS NOT NULL ORDER BY created_at DESC LIMIT 1` as any[];
const key = rows[0].storage_key;
const mime = rows[0].mime_type || "image/png";
console.log("key:", key);
const url = await presignVhost(key, mime);
console.log("URL:", url.slice(0,160)+"...");
const res = await fetch(url);
console.log("status:", res.status);
if(!res.ok) console.log((await res.text()).slice(0,500));
else console.log("OK content-type:", res.headers.get("content-type"), "len:", res.headers.get("content-length"));
