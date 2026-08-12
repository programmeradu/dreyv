import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const amount = searchParams.get("amount") || "0";
  const total = searchParams.get("total") || "0";
  const provider = searchParams.get("provider") || "stripe";

  const VIOLET = "#7c3aed";
  const INK = "#0b0a14";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          background: "radial-gradient(circle at 50% 0%, #f5f3ff 0%, #ffffff 100%)",
          fontFamily: "sans-serif",
          padding: "40px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255, 255, 255, 0.9)",
            border: "1px solid #ede9fe",
            boxShadow: "0 20px 40px rgba(124, 58, 237, 0.1)",
            borderRadius: "24px",
            padding: "60px",
            width: "800px",
          }}
        >
          <div
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              color: VIOLET,
              textTransform: "uppercase",
              letterSpacing: "4px",
              marginBottom: "20px",
            }}
          >
            Founder Rent Contribution
          </div>
          <div
            style={{
              fontSize: "80px",
              fontWeight: "900",
              color: INK,
              marginBottom: "10px",
              display: "flex",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: "50px", marginRight: "10px", color: VIOLET }}>€</span>
            {amount}
          </div>
          <div
            style={{
              fontSize: "20px",
              color: "#6b7280",
              marginBottom: "40px",
            }}
          >
            Paid via {provider.toUpperCase()}
          </div>
          
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "2px",
              backgroundColor: "#ede9fe",
              marginBottom: "40px",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              fontSize: "24px",
              color: INK,
            }}
          >
            <span style={{ fontWeight: "bold" }}>New Total Goal Progress:</span>
            <span style={{ color: VIOLET, fontWeight: "bold" }}>€{total} / €500</span>
          </div>

          <div
            style={{
              marginTop: "40px",
              fontSize: "24px",
              fontStyle: "italic",
              color: "#4b5563",
            }}
          >
            "The founder's stomach growls a little less today."
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
