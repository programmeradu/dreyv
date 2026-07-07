"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Zap, Lock, Loader2, ShieldAlert } from "lucide-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { ApprovalRequest } from "@/lib/wallet/transaction-executor";
import { RiskChip } from "@/components/webacy/RiskChip";
import type { RiskScore, RiskLevel } from "@/lib/webacy/types";

interface WalletSigningDialogProps {
  isOpen: boolean;
  approval: ApprovalRequest;
  tx?: Transaction | VersionedTransaction;
  isLoading?: boolean;
  /** Optional Webacy pre-sign summary for programs/destinations in this tx. */
  webacy?: { worst: RiskLevel; addresses: RiskScore[] } | null;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Dialog for requesting wallet signature and approval
 * Shows transaction details, fees, and risks before signing
 */
export function WalletSigningDialog({
  isOpen,
  approval,
  tx,
  isLoading = false,
  webacy = null,
  onApprove,
  onReject
}: WalletSigningDialogProps) {
  const [confirmedHighRisk, setConfirmedHighRisk] = useState(false);
  if (!isOpen) return null;

  const webacyFlagged = webacy?.addresses.filter((a) => a.level === "high" || a.level === "medium") ?? [];
  const requiresTwoTap = webacy?.worst === "high";
  const signDisabled = isLoading || (requiresTwoTap && !confirmedHighRisk);

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "high":
        return "border-red-500 bg-red-950";
      case "medium":
        return "border-yellow-500 bg-yellow-950";
      default:
        return "border-green-500 bg-green-950";
    }
  };

  const getRiskBadge = (risk: string) => {
    const colors = {
      high: "bg-red-900 text-red-200",
      medium: "bg-yellow-900 text-yellow-200",
      low: "bg-green-900 text-green-200"
    };
    return colors[risk as keyof typeof colors] || colors.low;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl border-slate-700 bg-slate-900">
        {/* Header */}
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <CardTitle className="text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-blue-400" />
                Approve Transaction
              </CardTitle>
              <CardDescription className="text-slate-400">
                Review the transaction details before signing with your wallet
              </CardDescription>
            </div>
            <div className={`inline-flex px-3 py-1 rounded text-xs font-semibold ${getRiskBadge(approval.riskLevel)}`}>
              {approval.riskLevel.toUpperCase()} RISK
            </div>
          </div>
        </CardHeader>

        {/* Content */}
        <CardContent className="space-y-6 pt-6">
          {/* Transaction Type */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">Transaction Type</h3>
            <div className="px-4 py-3 rounded bg-slate-800 border border-slate-700">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-white font-medium capitalize">{approval.type}</span>
              </div>
              <p className="text-slate-300 text-sm mt-2">{approval.description}</p>
            </div>
          </div>

          {/* Fee Information */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">Estimated Fee</h3>
            <div className="px-4 py-3 rounded bg-slate-800 border border-slate-700">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Transaction Fee:</span>
                <span className="text-white font-mono">◎ {approval.estimatedFee.toFixed(6)}</span>
              </div>
            </div>
          </div>

          {/* Webacy pre-sign risk band */}
          {webacy && webacy.addresses.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-violet-300" />
                  Address risk (Webacy)
                </h3>
                <RiskChip level={webacy.worst} size="md" />
              </div>
              <div className="px-4 py-3 rounded bg-slate-800 border border-slate-700 space-y-2 text-sm">
                {webacyFlagged.length === 0 ? (
                  <p className="text-slate-300">
                    Scored {webacy.addresses.length} program/destination addresses — none flagged.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {webacyFlagged.slice(0, 5).map((a) => (
                      <li key={a.subject} className="flex items-start gap-2">
                        <RiskChip level={a.level} showLabel={false} />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-slate-300 break-all">{a.subject}</div>
                          {a.flags.length > 0 && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              {a.flags.slice(0, 3).join(" · ").replace(/_/g, " ")}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-700/60">
                  Risk data by Webacy
                </p>
              </div>
            </div>
          )}


          {/* Risk Warning */}
          {approval.riskLevel !== "low" && (
            <div className={`space-y-2 px-4 py-3 rounded border ${getRiskColor(approval.riskLevel)}`}>
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <h3 className="text-sm font-semibold">Risk Warning</h3>
              </div>
              <ul className="space-y-1 ml-6 text-sm">
                {approval.riskLevel === "high" && (
                  <>
                    <li className="list-disc text-slate-200">
                      This is a large or complex transaction
                    </li>
                    <li className="list-disc text-slate-200">
                      Please verify all details carefully
                    </li>
                    <li className="list-disc text-slate-200">
                      Only proceed if you recognize the destination
                    </li>
                  </>
                )}
                {approval.riskLevel === "medium" && (
                  <>
                    <li className="list-disc text-slate-200">
                      Review the transaction parameters
                    </li>
                    <li className="list-disc text-slate-200">
                      Ensure the destination address is correct
                    </li>
                  </>
                )}
              </ul>
            </div>
          )}

          {/* Metadata / Details */}
          {approval.metadata && Object.keys(approval.metadata).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-200">Transaction Details</h3>
              <div className="px-4 py-3 rounded bg-slate-800 border border-slate-700">
                <dl className="space-y-2 text-sm">
                  {Object.entries(approval.metadata).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <dt className="text-slate-400 capitalize">
                        {key.replace(/_/g, " ")}:
                      </dt>
                      <dd className="text-slate-200 font-mono text-right">
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}

          {/* Safety Note */}
          <div className="px-4 py-3 rounded bg-blue-900/30 border border-blue-700/50 text-blue-200 text-xs">
            <p>
              <strong>Security Note:</strong> This transaction will be signed by your wallet. Only approve transactions you initiated and trust.
            </p>
          </div>

          {/* TX Details (if available) */}
          {tx && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-200">Transaction Status</h3>
              <div className="px-4 py-3 rounded bg-slate-800 border border-slate-700 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Ready to sign
                </div>
              </div>
            </div>
          )}
        </CardContent>

        {/* Footer with Actions */}
        <div className="border-t border-slate-700 p-6 space-y-3">
          {requiresTwoTap && (
            <label className="flex items-start gap-2 text-xs text-rose-200 bg-rose-950/40 border border-rose-800/60 rounded px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmedHighRisk}
                onChange={(e) => setConfirmedHighRisk(e.target.checked)}
                className="mt-0.5 accent-rose-500"
              />
              <span>
                Webacy flagged at least one address as <strong>high risk</strong>. I have reviewed the
                flags above and understand this transaction may be unsafe.
              </span>
            </label>
          )}
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={onReject}
              disabled={isLoading}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Reject
            </Button>
            <Button
              onClick={onApprove}
              disabled={signDisabled}
              className={
                requiresTwoTap
                  ? "bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Signing...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  {requiresTwoTap ? "Sign anyway" : "Approve & Sign"}
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default WalletSigningDialog;
