import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { alerts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { checkDatabaseAvailability } from '@/lib/db-utils';
import { checkRouteLimit } from '@/lib/rate-limit-middleware';
import { sendGasAlertVerificationEmail } from '@/lib/email-service';
export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    // Check if database is available
    const dbCheckResponse = checkDatabaseAvailability();
    if (dbCheckResponse) {
      return dbCheckResponse;
    }

    // Rate limit: alerts
    const rateLimit = await checkRouteLimit(request, 'alerts');
    if (!rateLimit.allowed) {
      return NextResponse.json({
        error: 'Rate limit exceeded',
        tier: rateLimit.tier,
        resetAt: rateLimit.resetAt.toISOString(),
      }, { status: 429 });
    }

    const { email, thresholdUsd, minGasUnits } = await request.json();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return NextResponse.json({
        error: "Valid email address is required",
        code: "INVALID_EMAIL"
      }, { status: 400 });
    }

    // Set defaults and validate thresholdUsd
    const finalThresholdUsd = thresholdUsd ?? 12.0;
    if (typeof finalThresholdUsd !== 'number' || finalThresholdUsd < 0.1 || finalThresholdUsd > 1000) {
      return NextResponse.json({
        error: "thresholdUsd must be a number between 0.1 and 1000",
        code: "INVALID_THRESHOLD_USD"
      }, { status: 400 });
    }

    // Set defaults and validate minGasUnits
    const finalMinGasUnits = minGasUnits ?? 100000;
    if (!Number.isInteger(finalMinGasUnits) || finalMinGasUnits < 1000 || finalMinGasUnits > 10000000) {
      return NextResponse.json({
        error: "minGasUnits must be an integer between 1000 and 10000000",
        code: "INVALID_MIN_GAS_UNITS"
      }, { status: 400 });
    }

    const conditionType = 'gas_below_usd_per_100k';
    const now = new Date();

    // Check for existing unverified alert with same email and conditionType
    const existingAlert = await db!.select()
      .from(alerts)
      .where(and(
        eq(alerts.email, email.toLowerCase()),
        eq(alerts.conditionType, conditionType),
        eq(alerts.verified, false)
      ))
      .limit(1);

    let alertRecord;

    if (existingAlert.length > 0) {
      // Update existing unverified alert
      const updatedAlert = await db!.update(alerts)
        .set({
          thresholdUsd: String(finalThresholdUsd),
          minGasUnits: finalMinGasUnits,
          active: true,
          updatedAt: now
        })
        .where(eq(alerts.id, existingAlert[0].id))
        .returning();

      alertRecord = updatedAlert[0];
    } else {
      // Generate random 12-character alphanumeric token
      const generateToken = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        const randomValues = new Uint32Array(12);
        globalThis.crypto.getRandomValues(randomValues);
        for (let i = 0; i < 12; i++) {
          const max = 256 - (256 % chars.length);
          let token = '';
          const buf = new Uint8Array(128);
          while (token.length < 12) {
            crypto.getRandomValues(buf);
            for (let j = 0; j < buf.length && token.length < 12; j++) {
              if (buf[j] < max) token += chars.charAt(buf[j] % chars.length);
            }
          }
        }
        return token;
      };

      const verifyToken = generateToken();

      // Create new alert
      const newAlert = await db!.insert(alerts)
        .values({
          email: email.toLowerCase(),
          conditionType,
          thresholdUsd: String(finalThresholdUsd),
          minGasUnits: finalMinGasUnits,
          verified: false,
          verifyToken,
          active: true,
          createdAt: now,
          updatedAt: now
        })
        .returning();

      alertRecord = newAlert[0];
    }

    // Send verification email via shared email-service (Resend under the hood)
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com').replace(/\/+$/, '');
    const verificationUrl = `${appUrl}/api/alerts/verify?token=${alertRecord.verifyToken}`;

    const emailRes = await sendGasAlertVerificationEmail({
      to: alertRecord.email,
      verificationUrl,
      thresholdUsd: Number(alertRecord.thresholdUsd),
      minGasUnits: alertRecord.minGasUnits,
    });

    if (!emailRes.success) {
      console.error('[alerts/subscribe] verification email failed:', emailRes.error);
      return NextResponse.json({
        error: 'Could not send verification email',
        code: 'EMAIL_SEND_FAILED',
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });

  } catch (error) {
    console.error('POST error:', error);
    return NextResponse.json({
      error: 'Internal server error: ' + error
    }, { status: 500 });
  }
}