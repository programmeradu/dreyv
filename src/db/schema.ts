import {
  pgTable,
  serial,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';

// Postgres bytea column for storing artifact bodies inline (Neon-backed).
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// ─── Users (SIWS Auth — synced from Supabase Auth) ────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull().unique(),
  // Optional EVM wallet (read-only link until SIWE is added; not unique because
  // a power-user can swap chains and we accept the latest connect).
  evmWalletAddress: text('evm_wallet_address'),
  email: text('email'),                          // optional, collected during onboarding/settings
  displayName: text('display_name'),
  avatarSeed: text('avatar_seed'),
  role: text('role').notNull().default('user'), // user | creator | admin
  tier: text('tier').notNull().default('free'), // free | mini | max
  tierExpiresAt: timestamp('tier_expires_at'), // null = never expires (free tier or lifetime)
  isFoundingMember: boolean('is_founding_member').notNull().default(false), // first 200 signups → effective Mini access
  foundingNumber: integer('founding_number'), // 1..200 unique, null otherwise
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  organizationName: text('organization_name'),
  supabaseUserId: text('supabase_user_id').unique(), // Supabase Auth uid
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('users_wallet_idx').on(table.walletAddress),
  supabaseIdx: index('users_supabase_idx').on(table.supabaseUserId),
  tierIdx: index('users_tier_idx').on(table.tier),
  evmWalletIdx: index('users_evm_wallet_idx').on(table.evmWalletAddress),
}));

// ─── AI Runs ──────────────────────────────────────────────────────────
export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  shortId: text('short_id').notNull().unique(),
  prompt: text('prompt').notNull(),
  planResult: jsonb('plan_result').notNull(),
  toolResult: jsonb('tool_result'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  userId: uuid('user_id').references(() => users.id),
  runLabel: text('run_label'),
  meta: jsonb('meta'),
});

// ─── Learn Tables ─────────────────────────────────────────────────────
export const learnInputs = pgTable('learn_inputs', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  intent: text('intent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const learnClicks = pgTable('learn_clicks', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const learnKeywords = pgTable('learn_keywords', {
  id: serial('id').primaryKey(),
  keyword: text('keyword').notNull().unique(),
  score: numeric('score', { precision: 10, scale: 4 }).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const learnSuggestions = pgTable('learn_suggestions', {
  id: serial('id').primaryKey(),
  text: text('text').notNull().unique(),
  weight: numeric('weight', { precision: 10, scale: 4 }).notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Knowledge Memory ─────────────────────────────────────────────────
export const knowledgeEntries = pgTable('knowledge_entries', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(), // browser_research | browser_scrape | browser_screenshot | kb_study | architect | manual
  sourceUrl: text('source_url'),
  title: text('title'),
  summary: text('summary'),
  content: text('content'), // full raw content (capped at 50KB by service)
  contentType: text('content_type').notNull().default('markdown'), // markdown | json | html | screenshot_meta
  tags: jsonb('tags'), // string[]
  userId: uuid('user_id').references(() => users.id),
  expiresAt: timestamp('expires_at'), // optional TTL
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sourceIdx: index('knowledge_entries_source_idx').on(table.source),
  sourceUrlIdx: index('knowledge_entries_source_url_idx').on(table.sourceUrl),
  userIdx: index('knowledge_entries_user_idx').on(table.userId),
  createdAtIdx: index('knowledge_entries_created_at_idx').on(table.createdAt),
}));

// ─── Alerts ───────────────────────────────────────────────────────────
export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  conditionType: text('condition_type').notNull().default('gas_below_usd_per_100k'),
  thresholdUsd: numeric('threshold_usd', { precision: 18, scale: 6 }).notNull(),
  minGasUnits: integer('min_gas_units').notNull().default(100000),
  verified: boolean('verified').notNull().default(false),
  verifyToken: text('verify_token').unique(),
  active: boolean('active').notNull().default(true),
  lastNotifiedAt: timestamp('last_notified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('alerts_email_idx').on(table.email),
  activeIdx: index('alerts_active_idx').on(table.active),
  verifiedIdx: index('alerts_verified_idx').on(table.verified),
}));

// ─── DCA Bots ─────────────────────────────────────────────────────────
export const dcaBots = pgTable('dca_bots', {
  id: text('id').primaryKey(), // dca_abc123
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  buyTokenMint: text('buy_token_mint').notNull(),
  buyTokenSymbol: text('buy_token_symbol').notNull(),
  paymentTokenMint: text('payment_token_mint').notNull(),
  paymentTokenSymbol: text('payment_token_symbol').notNull(),
  amountUsd: numeric('amount_usd', { precision: 18, scale: 6 }).notNull(),
  frequency: text('frequency').notNull(), // daily, weekly, biweekly, monthly
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  maxSlippage: numeric('max_slippage', { precision: 6, scale: 4 }).notNull().default('0.5'),
  status: text('status').notNull().default('active'), // active, paused, completed, failed
  walletAddress: text('wallet_address').notNull(),
  nextExecution: timestamp('next_execution'),
  executionCount: integer('execution_count').notNull().default(0),
  totalInvested: numeric('total_invested', { precision: 18, scale: 6 }).notNull().default('0'),
  totalReceived: numeric('total_received', { precision: 18, scale: 6 }).notNull().default('0'),
  delegationAmount: numeric('delegation_amount', { precision: 18, scale: 6 }),
  delegationExpiry: timestamp('delegation_expiry'),
  lastExecutionAttempt: timestamp('last_execution_attempt'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  pauseReason: text('pause_reason'),
  encryptedKeypair: text('encrypted_keypair'), // AES-256-GCM encrypted delegate keypair (per-bot)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('dca_bots_user_idx').on(table.userId),
  walletIdx: index('dca_bots_wallet_idx').on(table.walletAddress),
  statusIdx: index('dca_bots_status_idx').on(table.status),
  nextExecutionIdx: index('dca_bots_next_execution_idx').on(table.nextExecution),
}));

export const dcaExecutions = pgTable('dca_executions', {
  id: serial('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => dcaBots.id, { onDelete: 'cascade' }),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
  paymentAmount: numeric('payment_amount', { precision: 18, scale: 6 }).notNull(),
  receivedAmount: numeric('received_amount', { precision: 18, scale: 6 }).notNull(),
  price: numeric('price', { precision: 18, scale: 6 }).notNull(),
  slippage: numeric('slippage', { precision: 6, scale: 4 }).notNull(),
  txSignature: text('tx_signature'),
  gasUsed: numeric('gas_used', { precision: 18, scale: 9 }).notNull(),
  status: text('status').notNull(), // success, failed, pending
  errorMessage: text('error_message'),
  jupiterQuoteId: text('jupiter_quote_id'),
  errorCode: text('error_code'),
  retryCount: integer('retry_count').notNull().default(0),
  jupiterRoute: jsonb('jupiter_route'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  botIdx: index('dca_executions_bot_idx').on(table.botId),
  statusIdx: index('dca_executions_status_idx').on(table.status),
  executedAtIdx: index('dca_executions_executed_at_idx').on(table.executedAt),
}));

// ─── Agent Executions ─────────────────────────────────────────────────
export const agentExecutions = pgTable('agent_executions', {
  id: text('id').primaryKey(), // exec_abc123xyz
  userId: uuid('user_id').notNull().references(() => users.id),
  walletAddress: text('wallet_address').notNull(),
  strategy: text('strategy').notNull(),
  status: text('status').notNull(), // PENDING, PLANNING, SIMULATING, SUCCESS, FAILED, CANCELLED
  progress: integer('progress').notNull().default(0),
  input: jsonb('input').notNull(),
  result: jsonb('result'),
  error: text('error'),
  estimatedGas: numeric('estimated_gas', { precision: 18, scale: 9 }),
  actualGas: numeric('actual_gas', { precision: 18, scale: 9 }),
  transactionSignature: text('transaction_signature'),
  approvalRequired: boolean('approval_required').notNull().default(false),
  approvalId: text('approval_id'),
  approvedAt: timestamp('approved_at'),
  duration: integer('duration'),
  retryCount: integer('retry_count').notNull().default(0),
  steps: jsonb('steps'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('agent_executions_user_idx').on(table.userId),
  walletIdx: index('agent_executions_wallet_idx').on(table.walletAddress),
  strategyIdx: index('agent_executions_strategy_idx').on(table.strategy),
  statusIdx: index('agent_executions_status_idx').on(table.status),
  createdAtIdx: index('agent_executions_created_at_idx').on(table.createdAt),
}));

export const agentApprovals = pgTable('agent_approvals', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => agentExecutions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  walletAddress: text('wallet_address').notNull(),
  message: text('message').notNull(),
  details: jsonb('details'),
  estimatedFee: numeric('estimated_fee', { precision: 18, scale: 9 }),
  riskLevel: text('risk_level'),
  approved: boolean('approved'),
  signature: text('signature'),
  rejectionReason: text('rejection_reason'),
  expiresAt: timestamp('expires_at').notNull(),
  respondedAt: timestamp('responded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  executionIdx: index('agent_approvals_execution_idx').on(table.executionId),
  userIdx: index('agent_approvals_user_idx').on(table.userId),
  expiresAtIdx: index('agent_approvals_expires_at_idx').on(table.expiresAt),
}));

// ─── Marketplace ──────────────────────────────────────────────────────
export const miniApps = pgTable('mini_apps', {
  id: text('id').primaryKey(), // app_abc123
  name: text('name').notNull(),
  description: text('description').notNull(),
  code: jsonb('code').notNull(), // { files: { ... } }
  contractCode: text('contract_code'),
  programId: text('program_id'),
  version: text('version').notNull().default('1.0.0'),

  // Creator
  creatorId: uuid('creator_id').references(() => users.id),
  creatorWallet: text('creator_wallet').notNull(),
  creatorShare: numeric('creator_share', { precision: 4, scale: 2 }).notNull().default('0.80'),

  // Marketplace
  isPublished: boolean('is_published').notNull().default(false),
  priceUsdc: numeric('price_usdc', { precision: 18, scale: 6 }).notNull().default('0'),
  category: text('category').notNull().default('utility'),
  tags: jsonb('tags'), // string[]

  // Hybrid Storage
  codeHash: text('code_hash'),
  arweaveTxId: text('arweave_tx_id'),
  manifest: jsonb('manifest'),
  screenshotUrl: text('screenshot_url'), // Supabase Storage URL

  // Security
  securityScore: integer('security_score'),
  lastScanAt: timestamp('last_scan_at'),

  // Stats
  installs: integer('installs').notNull().default(0),
  rating: numeric('rating', { precision: 3, scale: 2 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index('mini_apps_creator_idx').on(table.creatorWallet),
  creatorIdIdx: index('mini_apps_creator_id_idx').on(table.creatorId),
  categoryIdx: index('mini_apps_category_idx').on(table.category),
  isPublishedIdx: index('mini_apps_is_published_idx').on(table.isPublished),
}));

export const userInstalledApps = pgTable('user_installed_apps', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  appId: text('app_id').notNull().references(() => miniApps.id, { onDelete: 'cascade' }),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  uninstalledAt: timestamp('uninstalled_at'),
  dockOrder: integer('dock_order').notNull().default(0),
  pinned: boolean('pinned').notNull().default(false),
  lastOpenedAt: timestamp('last_opened_at'),
  settings: jsonb('settings'),
}, (table) => ({
  userIdx: index('user_installed_apps_user_idx').on(table.userId),
  appIdx: index('user_installed_apps_app_idx').on(table.appId),
  userAppIdx: index('user_installed_apps_user_app_idx').on(table.userId, table.appId),
}));

export const reviews = pgTable('reviews', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull().references(() => miniApps.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  reviewerWallet: text('reviewer_wallet').notNull(),
  rating: integer('rating').notNull(), // 1-5
  comment: text('comment'),
  signature: text('signature').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  appIdx: index('reviews_app_idx').on(table.appId),
  reviewerIdx: index('reviews_reviewer_idx').on(table.reviewerWallet),
}));

export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull().references(() => miniApps.id),
  buyerId: uuid('buyer_id').references(() => users.id),
  buyerWallet: text('buyer_wallet').notNull(),
  txSignature: text('tx_signature').notNull(),
  amountUsdc: numeric('amount_usdc', { precision: 18, scale: 6 }).notNull(),
  creatorPayout: numeric('creator_payout', { precision: 18, scale: 6 }).notNull(),
  keystoneFee: numeric('keystone_fee', { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  appIdx: index('purchases_app_idx').on(table.appId),
  buyerIdx: index('purchases_buyer_idx').on(table.buyerWallet),
}));

// ─── User Settings ────────────────────────────────────────────────────
export const userSettings = pgTable('user_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  theme: text('theme').notNull().default('dark'), // dark | light | system
  network: text('network').notNull().default('mainnet-beta'), // mainnet-beta | devnet | testnet
  rpcEndpoint: text('rpc_endpoint'), // custom RPC URL
  currency: text('currency').notNull().default('USD'),
  language: text('language').notNull().default('en'),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  emailAlerts: boolean('email_alerts').notNull().default(false),
  pushAlerts: boolean('push_alerts').notNull().default(false),
  slippageTolerance: numeric('slippage_tolerance', { precision: 6, scale: 4 }).notNull().default('0.5'),
  autoApproveBelow: numeric('auto_approve_below', { precision: 18, scale: 6 }), // auto-approve txns below this SOL amount
  defaultVaultAddress: text('default_vault_address'),
  preferences: jsonb('preferences'), // catch-all for future prefs
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('user_settings_user_idx').on(table.userId),
}));

// ─── Analytics Snapshots ──────────────────────────────────────────────
export const analyticsSnapshots = pgTable('analytics_snapshots', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletAddress: text('wallet_address').notNull(),
  totalValueUsd: numeric('total_value_usd', { precision: 18, scale: 6 }).notNull(),
  solBalance: numeric('sol_balance', { precision: 18, scale: 9 }).notNull(),
  tokenBalances: jsonb('token_balances').notNull(), // { mint, symbol, amount, valueUsd }[]
  defiPositions: jsonb('defi_positions'), // { protocol, type, valueUsd, apy }[]
  yieldEarned: numeric('yield_earned', { precision: 18, scale: 6 }),
  pnl24h: numeric('pnl_24h', { precision: 18, scale: 6 }),
  pnl7d: numeric('pnl_7d', { precision: 18, scale: 6 }),
  pnl30d: numeric('pnl_30d', { precision: 18, scale: 6 }),
  snapshotAt: timestamp('snapshot_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('analytics_snapshots_user_idx').on(table.userId),
  walletIdx: index('analytics_snapshots_wallet_idx').on(table.walletAddress),
  snapshotAtIdx: index('analytics_snapshots_at_idx').on(table.snapshotAt),
}));

// ─── Airdrop Claims ──────────────────────────────────────────────────
export const airdropClaims = pgTable('airdrop_claims', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  walletAddress: text('wallet_address').notNull(),
  protocolName: text('protocol_name').notNull(),
  protocolSlug: text('protocol_slug').notNull(),
  tokenSymbol: text('token_symbol'),
  tokenMint: text('token_mint'),
  estimatedValue: numeric('estimated_value', { precision: 18, scale: 6 }),
  status: text('status').notNull().default('eligible'), // eligible | claimed | expired | ineligible
  eligibilityChecked: boolean('eligibility_checked').notNull().default(false),
  claimedAt: timestamp('claimed_at'),
  claimTxSignature: text('claim_tx_signature'),
  deadline: timestamp('deadline'),
  source: text('source').notNull(), // airdrops.io | manual | defi-scan
  sourceUrl: text('source_url'),
  metadata: jsonb('metadata'), // extra data from source
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('airdrop_claims_wallet_idx').on(table.walletAddress),
  statusIdx: index('airdrop_claims_status_idx').on(table.status),
  protocolIdx: index('airdrop_claims_protocol_idx').on(table.protocolSlug),
  deadlineIdx: index('airdrop_claims_deadline_idx').on(table.deadline),
}));

// ─── Foresight Predictions ───────────────────────────────────────────
export const foresightPredictions = pgTable('foresight_predictions', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  walletAddress: text('wallet_address'),
  predictionType: text('prediction_type').notNull(), // price | yield | risk | market_trend
  targetAsset: text('target_asset'), // SOL, ETH, or protocol slug
  targetMint: text('target_mint'),
  timeframeHours: integer('timeframe_hours').notNull(), // 1, 4, 24, 168 (1w)
  predictedValue: numeric('predicted_value', { precision: 18, scale: 6 }),
  actualValue: numeric('actual_value', { precision: 18, scale: 6 }),
  confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull(), // 0.0000–1.0000
  direction: text('direction'), // up | down | neutral
  modelVersion: text('model_version').notNull().default('v1'),
  reasoning: text('reasoning'), // AI explanation
  resolved: boolean('resolved').notNull().default(false),
  correct: boolean('correct'), // null = unresolved
  resolvedAt: timestamp('resolved_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('foresight_predictions_user_idx').on(table.userId),
  typeIdx: index('foresight_predictions_type_idx').on(table.predictionType),
  assetIdx: index('foresight_predictions_asset_idx').on(table.targetAsset),
  resolvedIdx: index('foresight_predictions_resolved_idx').on(table.resolved),
  createdAtIdx: index('foresight_predictions_created_at_idx').on(table.createdAt),
}));

// ─── Transaction Cache ───────────────────────────────────────────────
export const transactionCache = pgTable('transaction_cache', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  walletAddress: text('wallet_address').notNull(),
  signature: text('signature').notNull().unique(),
  blockTime: timestamp('block_time'),
  slot: integer('slot'),
  success: boolean('success').notNull(),
  type: text('type'), // transfer | swap | stake | unstake | nft | program | unknown
  direction: text('direction'), // in | out | self
  fromAddress: text('from_address'),
  toAddress: text('to_address'),
  amount: numeric('amount', { precision: 18, scale: 9 }),
  tokenMint: text('token_mint'),
  tokenSymbol: text('token_symbol'),
  valueUsd: numeric('value_usd', { precision: 18, scale: 6 }),
  fee: numeric('fee', { precision: 18, scale: 9 }),
  programId: text('program_id'),
  memo: text('memo'),
  rawData: jsonb('raw_data'), // full parsed Helius data
  taxCategory: text('tax_category'), // income | capital_gain | transfer | fee
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('tx_cache_wallet_idx').on(table.walletAddress),
  signatureIdx: index('tx_cache_signature_idx').on(table.signature),
  blockTimeIdx: index('tx_cache_block_time_idx').on(table.blockTime),
  typeIdx: index('tx_cache_type_idx').on(table.type),
  taxCategoryIdx: index('tx_cache_tax_category_idx').on(table.taxCategory),
}));

// ─── Notifications ───────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // alert | dca | agent | marketplace | system | team
  title: text('title').notNull(),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'), // info | success | warning | error
  read: boolean('read').notNull().default(false),
  readAt: timestamp('read_at'),
  actionUrl: text('action_url'), // deep link into the app
  actionLabel: text('action_label'),
  relatedEntityType: text('related_entity_type'), // dca_bot | agent_execution | mini_app | alert
  relatedEntityId: text('related_entity_id'),
  metadata: jsonb('metadata'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('notifications_user_idx').on(table.userId),
  readIdx: index('notifications_read_idx').on(table.read),
  typeIdx: index('notifications_type_idx').on(table.type),
  createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
}));

// ─── Team Activity Log ───────────────────────────────────────────────
export const teamActivityLog = pgTable('team_activity_log', {
  id: serial('id').primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  walletAddress: text('wallet_address'),
  vaultAddress: text('vault_address'),
  action: text('action').notNull(), // proposal_created | proposal_voted | proposal_executed | member_added | member_removed | settings_changed | funds_transferred | team_created | member_invited | role_changed
  targetType: text('target_type'), // proposal | member | vault | transaction
  targetId: text('target_id'),
  description: text('description'),
  details: jsonb('details'), // { proposalIndex, vote, amount, txSignature, ... }
  metadata: jsonb('metadata'), // additional context (e.g., old/new role, target user)
  txSignature: text('tx_signature'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  teamIdx: index('team_activity_team_idx').on(table.teamId),
  vaultIdx: index('team_activity_vault_idx').on(table.vaultAddress),
  userIdx: index('team_activity_user_idx').on(table.userId),
  actionIdx: index('team_activity_action_idx').on(table.action),
  createdAtIdx: index('team_activity_created_at_idx').on(table.createdAt),
}));

// ─── Rate Limits ─────────────────────────────────────────────────────
export const rateLimits = pgTable('rate_limits', {
  id: serial('id').primaryKey(),
  identifier: text('identifier').notNull(), // walletAddress or userId
  identifierType: text('identifier_type').notNull(), // wallet | user
  resource: text('resource').notNull(), // ai_architect_runs | atlas_ai_queries | dca_bots | studio_apps | marketplace_listings | alerts | atlas_tx_lookups
  windowStart: timestamp('window_start').notNull(),
  windowSize: text('window_size').notNull().default('day'), // hour | day | month
  count: integer('count').notNull().default(0),
  lastRequestAt: timestamp('last_request_at').defaultNow().notNull(),
}, (table) => ({
  identifierResourceIdx: index('rate_limits_id_resource_idx').on(table.identifier, table.resource, table.windowStart),
  resourceIdx: index('rate_limits_resource_idx').on(table.resource),
  windowIdx: index('rate_limits_window_idx').on(table.windowStart),
}));

// ─── Monitors (price/balance/APY alerts) ─────────────────────────────
export const monitors = pgTable('monitors', {
  id: serial('id').primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // price | balance | apy | risk
  target: text('target').notNull(), // token symbol or metric name
  operator: text('operator').notNull(), // above | below | equals | changes
  conditionValue: numeric('condition_value', { precision: 18, scale: 6 }).notNull(),
  active: boolean('active').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at'),
  lastCheckedValue: numeric('last_checked_value', { precision: 18, scale: 6 }),
  triggerCount: integer('trigger_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('monitors_wallet_idx').on(table.walletAddress),
  activeIdx: index('monitors_active_idx').on(table.active),
  typeIdx: index('monitors_type_idx').on(table.type),
}));

// ─── Atlas Sessions (wallet-based, no account required) ──────────────
export const atlasSessions = pgTable('atlas_sessions', {
  id: serial('id').primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  userId: uuid('user_id').references(() => users.id), // null for anonymous, backfilled on SIWS login
  conversationHistory: jsonb('conversation_history').notNull().default('[]'), // { role, content, timestamp }[]
  lastQuery: text('last_query'),
  context: jsonb('context'), // cached portfolio data, token balances, etc.
  expiresAt: timestamp('expires_at').notNull(), // 24h for anonymous, 30d for Keystone subscribers
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  walletIdx: index('atlas_sessions_wallet_idx').on(table.walletAddress),
  userIdx: index('atlas_sessions_user_idx').on(table.userId),
  expiresIdx: index('atlas_sessions_expires_idx').on(table.expiresAt),
}));

// ─── Developer Tokens (CLI Auth for Marketplace Publish) ─────────────
export const developerTokens = pgTable('developer_tokens', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(), // UUID bearer token
  walletAddress: text('wallet_address').notNull(), // Solana wallet (Turnkey-provisioned or BYO)
  turnkeySubOrgId: text('turnkey_sub_org_id'), // null if BYO key
  label: text('label').notNull().default('default'), // friendly name
  revoked: boolean('revoked').notNull().default(false),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index('developer_tokens_token_idx').on(table.token),
  walletIdx: index('developer_tokens_wallet_idx').on(table.walletAddress),
}));

// ─── Teams ────────────────────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  vaultAddress: text('vault_address'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  createdByIdx: index('teams_created_by_idx').on(table.createdBy),
}));

// ─── Team Members ─────────────────────────────────────────────────────
export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  walletAddress: text('wallet_address').notNull(),
  role: text('role').notNull().default('viewer'), // owner | admin | signer | viewer
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at').defaultNow(),
  acceptedAt: timestamp('accepted_at'),
  status: text('status').notNull().default('pending'), // pending | active | removed
}, (table) => ({
  teamIdx: index('team_members_team_idx').on(table.teamId),
  userIdx: index('team_members_user_idx').on(table.userId),
  statusIdx: index('team_members_status_idx').on(table.status),
}));

// ─── Team Invitations ─────────────────────────────────────────────────
export const teamInvitations = pgTable('team_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  invitedBy: uuid('invited_by').references(() => users.id).notNull(),
  email: text('email'),
  walletAddress: text('wallet_address'),
  role: text('role').notNull().default('viewer'),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  teamIdx: index('team_invitations_team_idx').on(table.teamId),
  tokenIdx: index('team_invitations_token_idx').on(table.token),
}));


// ─── Notification Preferences ─────────────────────────────────────────
export const notificationPreferences = pgTable('notification_preferences', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  teamInvites: boolean('team_invites').notNull().default(true),
  roleChanges: boolean('role_changes').notNull().default(true),
  txApprovals: boolean('tx_approvals').notNull().default(true),
  systemAlerts: boolean('system_alerts').notNull().default(true),
  tierExpiry: boolean('tier_expiry').notNull().default(true),
  // Phase 15: external channels
  telegramEnabled: boolean('telegram_enabled').notNull().default(false),
  telegramBotToken: text('telegram_bot_token'), // BYO bot — user pastes their own @BotFather token
  telegramChatId: text('telegram_chat_id'),
  slackEnabled: boolean('slack_enabled').notNull().default(false),
  slackWebhookUrl: text('slack_webhook_url'),
  slackChannel: text('slack_channel'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('notification_prefs_user_idx').on(table.userId),
}));

// ─── Email Preferences (proactive email streams + throttles) ─────────
export const emailPreferences = pgTable('email_preferences', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  emailsEnabled: boolean('emails_enabled').notNull().default(true),
  agentInsights: boolean('agent_insights').notNull().default(true),
  opportunities: boolean('opportunities').notNull().default(true),
  vaultCommands: boolean('vault_commands').notNull().default(true),
  weeklyDigest: boolean('weekly_digest').notNull().default(true),
  monthlyReport: boolean('monthly_report').notNull().default(true),
  anomalyAlerts: boolean('anomaly_alerts').notNull().default(true),
  approvalNudges: boolean('approval_nudges').notNull().default(true),
  upgradeNudges: boolean('upgrade_nudges').notNull().default(true),
  reengagement: boolean('reengagement').notNull().default(true),
  onboardingDrip: boolean('onboarding_drip').notNull().default(true),
  lastAgentInsightAt: timestamp('last_agent_insight_at'),
  lastOpportunityAt: timestamp('last_opportunity_at'),
  lastVaultCommandsAt: timestamp('last_vault_commands_at'),
  lastWeeklyDigestAt: timestamp('last_weekly_digest_at'),
  lastMonthlyReportAt: timestamp('last_monthly_report_at'),
  lastAnomalyAt: timestamp('last_anomaly_at'),
  lastApprovalNudgeAt: timestamp('last_approval_nudge_at'),
  lastUpgradeNudgeAt: timestamp('last_upgrade_nudge_at'),
  lastReengagementAt: timestamp('last_reengagement_at'),
  onboardingDay1SentAt: timestamp('onboarding_day1_sent_at'),
  onboardingDay3SentAt: timestamp('onboarding_day3_sent_at'),
  onboardingDay7SentAt: timestamp('onboarding_day7_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Notification Deliveries (Phase 15) ───────────────────────────────
// One row per (notification, channel) attempt. Powers per-channel audit + retry.
export const notificationDeliveries = pgTable('notification_deliveries', {
  id: serial('id').primaryKey(),
  notificationId: integer('notification_id').references(() => notifications.id, { onDelete: 'cascade' }).notNull(),
  channel: text('channel').notNull(), // email | telegram | slack | inapp
  status: text('status').notNull(),   // queued | sent | failed | skipped
  error: text('error'),
  providerId: text('provider_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  notifIdx: index('notif_deliveries_notif_idx').on(table.notificationId),
  channelIdx: index('notif_deliveries_channel_idx').on(table.channel, table.status, table.createdAt),
}));

// ─── Organizations (Workspaces) ───────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // URL-friendly identifier
  avatarUrl: text('avatar_url'),
  tier: text('tier').notNull().default('free'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  slugIdx: index('organizations_slug_idx').on(table.slug),
  createdByIdx: index('organizations_created_by_idx').on(table.createdBy),
}));

// ─── Organization Members ─────────────────────────────────────────────
export const orgMembers = pgTable('org_members', {
  id: serial('id').primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull().default('member'), // owner | admin | member
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('org_members_org_idx').on(table.orgId),
  userIdx: index('org_members_user_idx').on(table.userId),
}));

// ─── Organization Vaults ──────────────────────────────────────────────
export const orgVaults = pgTable('org_vaults', {
  id: serial('id').primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  vaultAddress: text('vault_address').notNull(),
  label: text('label').notNull().default('Default Vault'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('org_vaults_org_idx').on(table.orgId),
  vaultIdx: index('org_vaults_vault_idx').on(table.vaultAddress),
}));

// ─── Studio Runs (telemetry + self-learning loop for AI Architect) ───
export const studioRuns = pgTable('studio_runs', {
  id: serial('id').primaryKey(),
  shortId: text('short_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id),
  prompt: text('prompt').notNull(),
  promptCategory: text('prompt_category'),
  clarifyAnswers: jsonb('clarify_answers'),
  chosenIntegrations: jsonb('chosen_integrations'),
  unknownProtocols: jsonb('unknown_protocols'),
  researchSources: jsonb('research_sources'),
  analyzerOutcome: text('analyzer_outcome'),
  attempts: integer('attempts'),
  shipped: boolean('shipped').default(false),
  errors: jsonb('errors'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('studio_runs_user_idx').on(t.userId),
  categoryIdx: index('studio_runs_category_idx').on(t.promptCategory),
  outcomeIdx: index('studio_runs_outcome_idx').on(t.analyzerOutcome),
}));

// ─── Vaults (User-level vault registry with tier enforcement) ─────────
export const vaults = pgTable('vaults', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  address: text('address').notNull().unique(),
  label: text('label').notNull().default('My Vault'),
  isMultisig: boolean('is_multisig').notNull().default(false),
  // 'connected' = signed-in wallet, 'watch' = pasted address (read-only),
  // 'multisig' = Squads vault. Drives UI affordances + capability gating.
  kind: text('kind').notNull().default('connected'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('vaults_user_idx').on(table.userId),
  addressIdx: index('vaults_address_idx').on(table.address),
  kindIdx: index('vaults_kind_idx').on(table.kind),
}));

// ─── Vault Proposals (mirror of on-chain Squads proposals) ───────────
// Cached snapshot updated by /api/squads/proposals/sync after read or write.
// Drives War Room timelines, presence-aware approval counts, and team chat
// without re-hammering the Solana RPC on every render.
export const vaultProposals = pgTable('vault_proposals', {
  id: serial('id').primaryKey(),
  vaultAddress: text('vault_address').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  transactionIndex: integer('transaction_index').notNull(),
  status: text('status').notNull().default('Draft'), // Draft | Active | Approved | Rejected | Executed | Cancelled
  approvals: integer('approvals').notNull().default(0),
  rejections: integer('rejections').notNull().default(0),
  threshold: integer('threshold').notNull().default(1),
  approvedBy: jsonb('approved_by').notNull().default([]),
  rejectedBy: jsonb('rejected_by').notNull().default([]),
  summary: text('summary'),
  raw: jsonb('raw'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  executedAt: timestamp('executed_at'),
}, (table) => ({
  vaultIdx: index('vault_proposals_vault_idx').on(table.vaultAddress),
  teamIdx: index('vault_proposals_team_idx').on(table.teamId),
  statusIdx: index('vault_proposals_status_idx').on(table.status),
  vaultTxUnique: uniqueIndex('vault_proposals_vault_tx_unique').on(table.vaultAddress, table.transactionIndex),
}));

// ─── Dreyv Connector Gateway ──────────────────────────────────────────
// Per-user encrypted credentials for third-party providers (Helius,
// Jupiter, Birdeye, Marinade, Pyth, Resend, Telegram, Slack, ...).
// Secrets are encrypted at rest with AES-256-GCM via keypair-envelope.
export const dreyvConnections = pgTable('dreyv_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(), // 'helius' | 'jupiter' | 'resend' | ...
  label: text('label'),                  // optional user-supplied label
  authType: text('auth_type').notNull().default('api_key'), // api_key | oauth
  // Encrypted blob — JSON object of { keyName: ciphertext, ... }
  encryptedSecrets: text('encrypted_secrets').notNull(),
  // Public, non-secret config (workspace id, channel id, from-address, etc.)
  publicConfig: jsonb('public_config'),
  status: text('status').notNull().default('active'), // active | revoked | error
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userProviderIdx: index('dreyv_conn_user_provider_idx').on(t.userId, t.provider),
  providerIdx: index('dreyv_conn_provider_idx').on(t.provider),
}));
// ─── Waitlist ─────────────────────────────────────────────────────────
// Public waitlist for invite-only cohort onboarding. Anon-insertable
// (rate-limited at API layer); admin-only read/update via has_role check.
export const waitlistEntries = pgTable('waitlist_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  organization: text('organization'),
  role: text('role'), // treasurer | operator | founder | developer | other
  orgType: text('org_type'), // dao | fund | protocol | startup | solo
  chains: jsonb('chains').$type<string[]>(), // ['solana','evm']
  currentStack: text('current_stack'),
  aumBand: text('aum_band'), // not_disclosed | sub_100k | 100k_1m | 1m_10m | 10m_100m | 100m_plus
  useCase: text('use_case'),
  referralSource: text('referral_source'),
  status: text('status').notNull().default('pending'), // pending | invited | onboarded | rejected
  position: serial('position').notNull(),
  invitedAt: timestamp('invited_at'),
  onboardedAt: timestamp('onboarded_at'),
  inviteToken: text('invite_token').unique(),
  inviteExpiresAt: timestamp('invite_expires_at'),
  notes: text('notes'),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  emailIdx: index('waitlist_email_idx').on(t.email),
  statusIdx: index('waitlist_status_idx').on(t.status),
  inviteTokenIdx: index('waitlist_invite_token_idx').on(t.inviteToken),
  createdIdx: index('waitlist_created_idx').on(t.createdAt),
}));

// ─── Agent Brains: proposals & alerts ────────────────────────────────
// Durable record of every proposal/alert the brain pipeline emits.
// `status` is the lifecycle for the inbox UI; `actions` mirrors
// DeepProposal.actions so the UI can render them without re-querying.
export const agentProposals = pgTable('agent_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: text('kind').notNull(), // 'proposal' | 'alert'
  title: text('title').notNull(),
  thesis: text('thesis').notNull(),
  actions: jsonb('actions').notNull().default([]),
  riskNotes: jsonb('risk_notes').notNull().default([]),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0.5'),
  horizon: text('horizon').notNull().default('hours'),
  model: text('model').notNull().default('unknown'),
  triage: jsonb('triage'),
  opp: jsonb('opp'),
  status: text('status').notNull().default('open'), // open | dismissed | acted | expired
  tags: jsonb('tags').notNull().default([]),
  userId: uuid('user_id').references(() => users.id),
  actedAt: timestamp('acted_at'),
  dismissedAt: timestamp('dismissed_at'),
  observedAt: timestamp('observed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  statusIdx: index('agent_proposals_status_idx').on(t.status),
  kindIdx: index('agent_proposals_kind_idx').on(t.kind),
  createdIdx: index('agent_proposals_created_idx').on(t.createdAt),
  userIdx: index('agent_proposals_user_idx').on(t.userId),
}));

// ─── Agent Brains: spawned sub-agents ────────────────────────────────
// Reflector-driven persistent sub-agents. The Inngest runtime keeps
// these alive until `expires_at`, then auto-retires them.
export const agentSubagents = pgTable('agent_subagents', {
  id: text('id').primaryKey(), // sa_<slug>-<ts36>
  name: text('name').notNull(),
  goal: text('goal').notNull(),
  triggers: jsonb('triggers').notNull().default([]),
  capabilities: jsonb('capabilities').notNull().default([]),
  parent: text('parent').notNull().default('reflector'),
  status: text('status').notNull().default('active'), // active | paused | retired | expired
  ttlMinutes: integer('ttl_minutes').notNull().default(240),
  expiresAt: timestamp('expires_at').notNull(),
  notes: text('notes'),
  spec: jsonb('spec').notNull(),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  statusIdx: index('agent_subagents_status_idx').on(t.status),
  expiresIdx: index('agent_subagents_expires_idx').on(t.expiresAt),
  userIdx: index('agent_subagents_user_idx').on(t.userId),
}));

// ─── Agent Brains: per-wallet treasury watchers ───────────────────────
// Each row registers a wallet (Solana or EVM) for the cadence sweepers
// to scan on a schedule. The watcher feed surfaces user-scoped
// opportunities → triage → proposals routed back to that user's inbox.
export const agentTreasuryWatchers = pgTable('agent_treasury_watchers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  chain: text('chain').notNull(), // solana | ethereum | base | arbitrum | polygon | bsc
  address: text('address').notNull(),
  label: text('label'),
  active: boolean('active').notNull().default(true),
  lastScanAt: timestamp('last_scan_at'),
  lastSnapshot: jsonb('last_snapshot'), // last balances/values for delta detection
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('agent_watchers_user_idx').on(t.userId),
  activeIdx: index('agent_watchers_active_idx').on(t.active),
  addrIdx: index('agent_watchers_addr_idx').on(t.address),
}));

// ─── Agent Brains: HITL-gated transaction proposals ────────────────────
// Phase 6: when a brain proposal is high-confidence, the executor bridge
// builds a concrete unsigned transaction and queues it here for human
// approval. The wallet/multisig signer pulls from this queue, signs, and
// updates status. We never auto-sign.
export const agentTxProposals = pgTable('agent_tx_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  proposalId: uuid('proposal_id').references(() => agentProposals.id),
  userId: uuid('user_id').references(() => users.id),
  chain: text('chain').notNull().default('solana'),
  kind: text('kind').notNull(), // swap | transfer | stake | rebalance | unknown
  summary: text('summary').notNull(),
  // Serialized unsigned transaction (base64). For multisig: the inner instructions blob.
  unsignedTx: text('unsigned_tx'),
  instructions: jsonb('instructions'), // structured ix list (alt to unsignedTx)
  estimatedFeeSol: numeric('estimated_fee_sol', { precision: 12, scale: 9 }),
  riskLevel: text('risk_level').notNull().default('medium'), // low | medium | high
  routing: text('routing').notNull().default('wallet'), // wallet | multisig
  multisigVault: text('multisig_vault'),
  status: text('status').notNull().default('queued'),
  // queued | approved | submitted | confirmed | failed | rejected | expired
  signature: text('signature'),
  errorMessage: text('error_message'),
  meta: jsonb('meta'),
  expiresAt: timestamp('expires_at'),
  approvedAt: timestamp('approved_at'),
  submittedAt: timestamp('submitted_at'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  statusIdx: index('agent_tx_proposals_status_idx').on(t.status),
  userIdx: index('agent_tx_proposals_user_idx').on(t.userId),
  proposalIdx: index('agent_tx_proposals_proposal_idx').on(t.proposalId),
  createdIdx: index('agent_tx_proposals_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 1 — Shadow-mode command diff log ──────────────────────
export const commandDiffLog = pgTable('command_diff_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  commandId: text('command_id').notNull().unique(),
  walletAddress: text('wallet_address'),
  rawText: text('raw_text').notNull(),
  promptMode: text('prompt_mode').notNull().default('auto'),
  legacySummary: text('legacy_summary'),
  legacyToolCalls: jsonb('legacy_tool_calls'),
  legacyDecisionKind: text('legacy_decision_kind'),
  legacyLatencyMs: integer('legacy_latency_ms'),
  dacsIntent: jsonb('dacs_intent'),
  dacsPlan: jsonb('dacs_plan'),
  dacsDecisionKind: text('dacs_decision_kind'),
  dacsDecisionReason: text('dacs_decision_reason'),
  dacsLatencyMs: integer('dacs_latency_ms'),
  parity: text('parity'),
  parityNotes: text('parity_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  createdIdx: index('command_diff_log_created_idx').on(t.createdAt),
  parityIdx: index('command_diff_log_parity_idx').on(t.parity),
  walletIdx: index('command_diff_log_wallet_idx').on(t.walletAddress),
}));

// ─── DACS Phase 2 — HITL approval queue ───────────────────────────────
// Every plan the router decides to "queue_for_approval" lands here. The
// /app inbox surfaces pending rows; resolution writes back status +
// signature so the executor (Phase 3) can settle the plan.
export const commandApprovals = pgTable('command_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  commandId: text('command_id').notNull(),
  walletAddress: text('wallet_address'),
  status: text('status').notNull().default('pending'), // pending | approved | rejected | expired | executed
  reason: text('reason').notNull(),
  intent: jsonb('intent').notNull(),
  plan: jsonb('plan').notNull(),
  decision: jsonb('decision').notNull(),
  riskScore: numeric('risk_score'),
  estimatedValueUsd: numeric('estimated_value_usd'),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('command_approvals_wallet_idx').on(t.walletAddress),
  statusIdx: index('command_approvals_status_idx').on(t.status),
  commandIdx: index('command_approvals_command_idx').on(t.commandId),
  createdIdx: index('command_approvals_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 2 — Per-user agent policy ─────────────────────────────
// Router consults this to decide auto-execute vs HITL. Defaults are
// conservative; users opt into looser thresholds explicitly.
export const userAgentPolicy = pgTable('user_agent_policy', {
  walletAddress: text('wallet_address').primaryKey(),
  autoApproveBelowUsd: numeric('auto_approve_below_usd').notNull().default('0'),
  requireMultisigAboveUsd: numeric('require_multisig_above_usd'),
  protocolAllowlist: jsonb('protocol_allowlist').notNull().default('[]'),
  protocolDenylist: jsonb('protocol_denylist').notNull().default('[]'),
  allowDynamicWrites: boolean('allow_dynamic_writes').notNull().default(false),
  dailyValueCapUsd: numeric('daily_value_cap_usd'),
  // Phase 3: derivation suggestions awaiting user action (kind/value/rationale/confidence/createdAt).
  pendingSuggestions: jsonb('pending_suggestions').notNull().default('[]'),
  lastDerivationAt: timestamp('last_derivation_at'),
  // Phase 7D.1: extended treasury-policy rules persisted by `set_treasury_policy`.
  // Stores fields that don't have dedicated columns (policyName, runwayFloorMonths,
  // maxProtocolPct, maxSlippagePct, requireAudit, active flag, history[]).
  policyMeta: jsonb('policy_meta'),
  // Phase 4 — structured caps used by signer-aware policy guard.
  policyCaps: jsonb('policy_caps').notNull().default('{}'),
  // Phase 2 — autopilot threshold for inflow→yield routing.
  minIdleUsd: numeric('min_idle_usd'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── DACS Phase 3 — Episodic memory ──────────────────────────────────
// Settled outcomes feed back into the planner so risk_score reflects the
// user's actual approve/reject history, not just the static rubric.
export const agentEpisodes = pgTable('agent_episodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  commandId: text('command_id').notNull(),
  walletAddress: text('wallet_address'),
  intentKind: text('intent_kind').notNull(),
  capabilityIds: jsonb('capability_ids').notNull().default('[]'),
  outcome: text('outcome').notNull(),
  riskScore: numeric('risk_score'),
  valueUsd: numeric('value_usd'),
  durationMs: integer('duration_ms'),
  signature: text('signature'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('agent_episodes_wallet_idx').on(t.walletAddress),
  intentIdx: index('agent_episodes_intent_idx').on(t.intentKind),
  outcomeIdx: index('agent_episodes_outcome_idx').on(t.outcome),
  createdIdx: index('agent_episodes_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 4 — Sub-agent runtime ────────────────────────────────
// Long-running directives (recurring DCA, monitor, alert) live here.
// A cron sweep ticks each row whose next_run_at <= now and re-runs the
// stored plan template through DACS as a fresh command.
// NOTE: distinct from `agent_subagents` (Brains system); keep table name
// `dacs_subagents` to avoid colliding with the existing Brains table.
export const dacsSubagents = pgTable('dacs_subagents', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address'),
  parentCommandId: text('parent_command_id').notNull(),
  title: text('title').notNull(),
  rawText: text('raw_text').notNull(),
  intent: jsonb('intent').notNull(),
  planTemplate: jsonb('plan_template').notNull(),
  status: text('status').notNull().default('active'), // active | paused | completed | failed | cancelled
  intervalSeconds: integer('interval_seconds').notNull().default(86400),
  nextRunAt: timestamp('next_run_at').defaultNow().notNull(),
  tickCount: integer('tick_count').notNull().default(0),
  maxTicks: integer('max_ticks'),
  lastTickAt: timestamp('last_tick_at'),
  lastTickStatus: text('last_tick_status'),
  lastTickNote: text('last_tick_note'),
  expiresAt: timestamp('expires_at'),
  // Phase 4.1 — cron + conditional triggers + canvas spawn provenance.
  cronExpr: text('cron_expr'),
  trigger: jsonb('trigger'),
  triggerMeta: jsonb('trigger_meta'),
  spawnedFrom: jsonb('spawned_from'),
  lastEvalAt: timestamp('last_eval_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('dacs_subagents_wallet_idx').on(t.walletAddress),
  statusIdx: index('dacs_subagents_status_idx').on(t.status),
  nextRunIdx: index('dacs_subagents_next_run_idx').on(t.nextRunAt),
  createdIdx: index('dacs_subagents_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 5.2 — Specialist handoff reports ─────────────────────
// Persist every AgentReport emitted by a specialist runtime so the UI
// can render a per-command timeline of who handled what.
export const dacsHandoffs = pgTable('dacs_handoffs', {
  id: uuid('id').defaultRandom().primaryKey(),
  commandId: text('command_id').notNull(),
  walletAddress: text('wallet_address'),
  specialist: text('specialist').notNull(),
  intentKind: text('intent_kind').notNull(),
  status: text('status').notNull(), // accepted | completed | rejected | deferred
  summary: text('summary').notNull(),
  report: jsonb('report').notNull(),
  stepResults: jsonb('step_results'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  commandIdx: index('dacs_handoffs_command_idx').on(t.commandId),
  walletIdx: index('dacs_handoffs_wallet_idx').on(t.walletAddress),
  specialistIdx: index('dacs_handoffs_specialist_idx').on(t.specialist),
  createdIdx: index('dacs_handoffs_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 7A — Agent-generated artifacts (PDF/CSV/ZIP/JSON) ────
// Bytes live in Cloudflare R2 (`r2Key`). Neon stores metadata only.
// Legacy rows may still carry inline `body` (bytea). Served via
// /api/agent/artifacts/[id] which 302s to a fresh R2 presigned URL.
export const agentArtifacts = pgTable('agent_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerKey: text('owner_key').notNull(), // wallet address or vault PDA
  walletAddress: text('wallet_address'),
  capabilityId: text('capability_id').notNull(),
  commandId: text('command_id'),
  kind: text('kind').notNull(), // pdf | csv | zip | json
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  // R2 object key (e.g. `<owner>/<folder>/<id>-<filename>`). Null for legacy rows.
  r2Key: text('r2_key'),
  // Legacy inline body (pre-R2). Kept nullable for backward compatibility.
  body: bytea('body'),
  meta: jsonb('meta').notNull().default('{}'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index('agent_artifacts_owner_idx').on(t.ownerKey),
  walletIdx: index('agent_artifacts_wallet_idx').on(t.walletAddress),
  kindIdx: index('agent_artifacts_kind_idx').on(t.kind),
  createdIdx: index('agent_artifacts_created_idx').on(t.createdAt),
}));

// Failure log for artifact pipeline — surfaces retry actions in UI.
export const artifactFailures = pgTable('artifact_failures', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerKey: text('owner_key').notNull(),
  walletAddress: text('wallet_address'),
  capabilityId: text('capability_id').notNull(),
  commandId: text('command_id'),
  kind: text('kind').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  stage: text('stage').notNull(), // render | upload | sign | insert
  error: text('error').notNull(),
  meta: jsonb('meta').notNull().default('{}'),
  retryCount: integer('retry_count').notNull().default(0),
  resolvedArtifactId: uuid('resolved_artifact_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index('artifact_failures_owner_idx').on(t.ownerKey),
  createdIdx: index('artifact_failures_created_idx').on(t.createdAt),
}));

// ─── DACS Phase 7B — Helius transaction streaming ────────────────────
// Wallets we subscribe to via Helius webhook + cron reconciler. Either
// auto-subscribed from `vaults`/`org_vaults` or manually added by users.
export const txWatchedWallets = pgTable('tx_watched_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  ownerWallet: text('owner_wallet'),         // user wallet that owns this watch
  source: text('source').notNull().default('user'), // user | vault | org_vault | auto
  label: text('label'),
  heliusWebhookId: text('helius_webhook_id'),
  active: boolean('active').notNull().default(true),
  lastSyncedSignature: text('last_synced_signature'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('tx_watched_wallets_wallet_idx').on(t.walletAddress),
  ownerIdx: index('tx_watched_wallets_owner_idx').on(t.ownerWallet),
  activeIdx: index('tx_watched_wallets_active_idx').on(t.active),
}));

// Persisted, deduped, categorized Helius enhanced txs. Source of truth
// for treasury reports + analytics flows.
export const txEvents = pgTable('tx_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(), // the watched wallet this row belongs to
  signature: text('signature').notNull(),
  slot: integer('slot'),
  blockTime: timestamp('block_time'),
  feeLamports: integer('fee_lamports'),
  source: text('source'),                    // helius "source" e.g. JUPITER, SQUADS
  type: text('type'),                        // helius "type" e.g. SWAP, TRANSFER
  direction: text('direction'),              // in | out | internal | unknown
  counterparty: text('counterparty'),
  tokenMint: text('token_mint'),
  tokenSymbol: text('token_symbol'),
  amount: numeric('amount'),                 // human-readable token amount
  amountLamports: numeric('amount_lamports'),
  valueUsd: numeric('value_usd'),
  category: text('category').notNull().default('uncategorized'), // swap | transfer-in | transfer-out | payroll | yield | fee | mev | unknown
  categorySource: text('category_source'),   // builtin:<name> | rule:<id> | manual
  matchedRuleId: uuid('matched_rule_id'),
  tags: jsonb('tags').notNull().default('[]'),
  raw: jsonb('raw').notNull(),               // full Helius enhanced-tx payload
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  walletSigUniq: index('tx_events_wallet_sig_uniq').on(t.walletAddress, t.signature),
  walletTimeIdx: index('tx_events_wallet_time_idx').on(t.walletAddress, t.blockTime),
  categoryIdx: index('tx_events_category_idx').on(t.category),
  blockTimeIdx: index('tx_events_block_time_idx').on(t.blockTime),
}));

// User-defined categorization rules. Evaluated AFTER built-in heuristics
// (built-ins set a `default` category, user rules can override).
export const txCategoryRules = pgTable('tx_category_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerWallet: text('owner_wallet').notNull(),
  name: text('name').notNull(),
  // Match conditions (all required ones must pass; null = wildcard)
  matchProgramId: text('match_program_id'),
  matchSource: text('match_source'),
  matchCounterparty: text('match_counterparty'),
  matchTokenMint: text('match_token_mint'),
  matchMemoContains: text('match_memo_contains'),
  matchMinAmount: numeric('match_min_amount'),
  matchMaxAmount: numeric('match_max_amount'),
  matchDirection: text('match_direction'), // in | out | internal | any
  // Action
  category: text('category').notNull(),
  tags: jsonb('tags').notNull().default('[]'),
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  hits: integer('hits').notNull().default(0),
  lastMatchedAt: timestamp('last_matched_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index('tx_category_rules_owner_idx').on(t.ownerWallet),
  enabledIdx: index('tx_category_rules_enabled_idx').on(t.enabled),
  priorityIdx: index('tx_category_rules_priority_idx').on(t.priority),
}));

/**
 * Phase 7B.1 — Streamflow recurring-payment tracking.
 *
 * One row per `recurring_payment` capability invocation. Created at tx-build
 * time (status=`pending_signature`); reconciler updates to `confirmed` once
 * the on-chain stream account exists, or `expired` if not seen after 30 min.
 */
export const streamflowStreams = pgTable('streamflow_streams', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Streamflow on-chain metadata pubkey — also the user-visible streamId. */
  streamId: text('stream_id').notNull().unique(),
  commandId: text('command_id'),
  walletAddress: text('wallet_address').notNull(),
  recipient: text('recipient').notNull(),
  mint: text('mint').notNull(),
  tokenSymbol: text('token_symbol').notNull(),
  amountPerPeriod: numeric('amount_per_period').notNull(),
  periodSeconds: integer('period_seconds').notNull(),
  durationPeriods: integer('duration_periods').notNull(),
  totalAmount: numeric('total_amount').notNull(),
  cliffSeconds: integer('cliff_seconds').notNull().default(0),
  cancellable: boolean('cancellable').notNull().default(true),
  startTs: integer('start_ts').notNull(),
  /** pending_signature | confirmed | expired | cancelled | failed */
  status: text('status').notNull().default('pending_signature'),
  signature: text('signature'),
  reconciledAt: timestamp('reconciled_at'),
  reconcileAttempts: integer('reconcile_attempts').notNull().default(0),
  lastReconcileError: text('last_reconcile_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('streamflow_streams_wallet_idx').on(t.walletAddress),
  statusIdx: index('streamflow_streams_status_idx').on(t.status),
  createdIdx: index('streamflow_streams_created_idx').on(t.createdAt),
}));

/**
 * Phase 7B.3 — Gas-tank watcher rules.
 *
 * One row per `gas_tank_topup` capability invocation. The watcher cron polls
 * each enabled rule, checks the wallet's SOL balance via Helius, and emits a
 * `gas_tank_refills` row (status=`pending_signature`) when balance < `floor_sol`
 * and the daily cap hasn't been hit. The refill row carries a Jupiter swap
 * quote/instructions for the user to sign.
 */
export const gasTankRules = pgTable('gas_tank_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  /** Refill trigger threshold in SOL (e.g. 0.1). */
  floorSol: numeric('floor_sol').notNull(),
  /** Refill target balance in SOL (must be > floorSol). */
  targetSol: numeric('target_sol').notNull(),
  /** Symbol of the token to swap from (USDC, USDT, …). */
  fundingToken: text('funding_token').notNull().default('USDC'),
  fundingMint: text('funding_mint').notNull(),
  /** Hard cap on refills emitted per UTC day. */
  maxRefillsPerDay: integer('max_refills_per_day').notNull().default(3),
  /** Slippage tolerance for the Jupiter swap, basis points (50 = 0.5%). */
  slippageBps: integer('slippage_bps').notNull().default(50),
  enabled: boolean('enabled').notNull().default(true),
  /** Last time the watcher emitted a refill for this rule. */
  lastTriggeredAt: timestamp('last_triggered_at'),
  /** Last balance reading (SOL), set by the watcher every poll. */
  lastBalanceSol: numeric('last_balance_sol'),
  lastCheckedAt: timestamp('last_checked_at'),
  /** UTC date YYYY-MM-DD of the daily counter; reset on rollover. */
  refillDayBucket: text('refill_day_bucket'),
  refillsToday: integer('refills_today').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('gas_tank_rules_wallet_idx').on(t.walletAddress),
  enabledIdx: index('gas_tank_rules_enabled_idx').on(t.enabled),
}));

/**
 * Phase 7B.3 — Gas-tank refill events (audit trail).
 *
 * One row per refill the watcher proposes to the user. Carries the Jupiter
 * quote at proposal time + the swap instructions/transaction that the user
 * must sign. Status moves: pending_signature → signed → confirmed | failed
 * | expired (4h TTL on unsigned).
 */
export const gasTankRefills = pgTable('gas_tank_refills', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: uuid('rule_id').notNull().references(() => gasTankRules.id, { onDelete: 'cascade' }),
  walletAddress: text('wallet_address').notNull(),
  /** Wallet SOL balance at trigger time (numeric for precision). */
  triggerBalanceSol: numeric('trigger_balance_sol').notNull(),
  /** Target SOL after refill. */
  targetSol: numeric('target_sol').notNull(),
  /** SOL amount the swap is sized to deliver. */
  refillSol: numeric('refill_sol').notNull(),
  /** Smallest-unit amount of the funding token quoted as input. */
  inAmount: text('in_amount').notNull(),
  /** Smallest-unit amount of SOL quoted as output. */
  outAmount: text('out_amount').notNull(),
  fundingToken: text('funding_token').notNull(),
  fundingMint: text('funding_mint').notNull(),
  slippageBps: integer('slippage_bps').notNull(),
  /** Base64 unsigned VersionedTransaction from Jupiter `/swap`. */
  serializedTransaction: text('serialized_transaction'),
  /** Jupiter quote response JSON for audit. */
  quoteJson: text('quote_json'),
  /** pending_signature | signed | confirmed | failed | expired | skipped */
  status: text('status').notNull().default('pending_signature'),
  signature: text('signature'),
  failureReason: text('failure_reason'),
  signedAt: timestamp('signed_at'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  ruleIdx: index('gas_tank_refills_rule_idx').on(t.ruleId),
  walletIdx: index('gas_tank_refills_wallet_idx').on(t.walletAddress),
  statusIdx: index('gas_tank_refills_status_idx').on(t.status),
  createdIdx: index('gas_tank_refills_created_idx').on(t.createdAt),
}));

/**
 * Phase 7B.4 — Milestone-gated grants.
 *
 * One row per `grant_disbursement` invocation. The full grant amount is escrowed
 * in a single Streamflow stream (recipient = grantee) with a long cliff so the
 * grantee cannot withdraw until milestones are individually released. Each
 * `grant_milestones` row tracks proof state; the grants watcher cron flips
 * `pending` → `ready_to_release` when its proof is verified (GitHub PR merged,
 * on-chain event observed, or attesters confirmed). The funder then signs a
 * Streamflow `topup`/`transfer` tx via `grant_milestone_release`.
 *
 * `streamId` ties back to `streamflow_streams.streamId` for reconciliation.
 */
export const grants = pgTable('grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  funderWallet: text('funder_wallet').notNull(),
  grantee: text('grantee').notNull(),
  token: text('token').notNull().default('USDC'),
  mint: text('mint').notNull(),
  totalAmount: numeric('total_amount').notNull(),
  releasedAmount: numeric('released_amount').notNull().default('0'),
  /** Streamflow on-chain metadata pubkey for the escrow stream. */
  streamId: text('stream_id'),
  /** active | completed | cancelled | failed */
  status: text('status').notNull().default('pending_signature'),
  signature: text('signature'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  funderIdx: index('grants_funder_idx').on(t.funderWallet),
  granteeIdx: index('grants_grantee_idx').on(t.grantee),
  statusIdx: index('grants_status_idx').on(t.status),
}));

export const grantMilestones = pgTable('grant_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  grantId: uuid('grant_id').notNull().references(() => grants.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  label: text('label').notNull(),
  amount: numeric('amount').notNull(),
  /** Discriminated union: { type: 'github_pr', repo, prNumber } | { type: 'onchain_event', program, eventName } | { type: 'manual_attestation', attesters: string[] } */
  proof: jsonb('proof').notNull(),
  /** pending | ready_to_release | released | rejected */
  status: text('status').notNull().default('pending'),
  proofVerifiedAt: timestamp('proof_verified_at'),
  proofEvidence: jsonb('proof_evidence'),
  releaseSignature: text('release_signature'),
  releasedAt: timestamp('released_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  checkAttempts: integer('check_attempts').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  grantIdx: index('grant_milestones_grant_idx').on(t.grantId),
  statusIdx: index('grant_milestones_status_idx').on(t.status),
}));

// ─── Liquidation watches (DACS Phase 7C.5) ────────────────────────────
// One row per (wallet, venue) pair. `positionAccount` is the on-chain account
// (Kamino obligation, MarginFi account, Drift user) that exposes the position;
// supplied at watch creation since wallet→position discovery requires
// per-protocol PDA derivation. Without it the watch is `discovery_pending`.
export const liquidationWatches = pgTable('liquidation_watches', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  venue: text('venue').notNull(), // kamino | marginfi | drift
  positionAccount: text('position_account'),
  healthFactorFloor: numeric('health_factor_floor').notNull().default('1.25'),
  autoDeleverage: boolean('auto_deleverage').notNull().default(false),
  alertWebhook: text('alert_webhook'),
  enabled: boolean('enabled').notNull().default(true),
  /** active | discovery_pending | breached | disabled */
  status: text('status').notNull().default('active'),
  lastHealthFactor: numeric('last_health_factor'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  lastBreachedAt: timestamp('last_breached_at'),
  checkAttempts: integer('check_attempts').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('liq_watches_wallet_idx').on(t.walletAddress),
  enabledIdx: index('liq_watches_enabled_idx').on(t.enabled),
  statusIdx: index('liq_watches_status_idx').on(t.status),
}));

// ─── Runway autopilot rules (DACS Phase 7D.2) ─────────────────────────
// Persistent config for `treasury_runway_autopilot`. Watcher cron polls
// treasury USD value, computes runway, fires alert/episode on breach.
export const runwayAutopilotRules = pgTable('runway_autopilot_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  /** Minimum runway in months — alert/rebalance if projected runway falls below. */
  targetRunwayMonths: numeric('target_runway_months').notNull(),
  /** Monthly burn in USD. If null, watcher infers from 90d outflows. */
  monthlyBurnUsd: numeric('monthly_burn_usd'),
  /** Last inferred burn (for transparency when monthlyBurnUsd is null). */
  inferredBurnUsd: numeric('inferred_burn_usd'),
  rebalanceMode: text('rebalance_mode').notNull().default('balanced'), // conservative | balanced | aggressive
  /** Allowed actions JSONB array: ["yield_withdraw","swap_to_stable","open_hedge","alert_only"] */
  actionsAllowed: jsonb('actions_allowed').notNull().default('["alert_only"]'),
  alertWebhook: text('alert_webhook'),
  enabled: boolean('enabled').notNull().default(true),
  /** active | breached | disabled */
  status: text('status').notNull().default('active'),
  /** Last computed treasury USD value. */
  lastTreasuryUsd: numeric('last_treasury_usd'),
  /** Last computed runway (months). */
  lastRunwayMonths: numeric('last_runway_months'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  lastBreachedAt: timestamp('last_breached_at'),
  checkAttempts: integer('check_attempts').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('runway_autopilot_wallet_idx').on(t.walletAddress),
  enabledIdx: index('runway_autopilot_enabled_idx').on(t.enabled),
  statusIdx: index('runway_autopilot_status_idx').on(t.status),
}));

// ─── Sniper bot rules (DACS Phase 7E.1) ───────────────────────────────
// Persistent config for `deploy_sniper_bot`. Helius webhook (shared)
// monitors DEX programs for new pool events; receiver matches against
// active rules and drafts a Jupiter buy tx (`needs_signature`).
export const sniperBotRules = pgTable('sniper_bot_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  /** raydium_v4 | raydium_clmm | orca_whirlpools */
  exchange: text('exchange').notNull(),
  /** Minimum new-pool liquidity in USD before triggering. */
  liquidityThresholdUsd: numeric('liquidity_threshold_usd').notNull().default('5000'),
  /** Buy size in USDC (or fundingToken) per trigger. */
  buyAmountUsd: numeric('buy_amount_usd').notNull().default('25'),
  fundingToken: text('funding_token').notNull().default('USDC'),
  fundingMint: text('funding_mint').notNull(),
  maxSlippageBps: integer('max_slippage_bps').notNull().default(300),
  /** Optional token mint allowlist (only buy these). */
  tokenAllowlist: jsonb('token_allowlist').notNull().default('[]'),
  /** Optional token mint denylist (never buy these). */
  tokenDenylist: jsonb('token_denylist').notNull().default('[]'),
  maxBuysPerDay: integer('max_buys_per_day').notNull().default(5),
  enabled: boolean('enabled').notNull().default(true),
  /** active | disabled | webhook_failed */
  status: text('status').notNull().default('active'),
  /** Helius webhookId returned at registration (shared across rules). */
  heliusWebhookId: text('helius_webhook_id'),
  buyDayBucket: text('buy_day_bucket'),
  buysToday: integer('buys_today').notNull().default(0),
  lastTriggeredAt: timestamp('last_triggered_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('sniper_rules_wallet_idx').on(t.walletAddress),
  enabledIdx: index('sniper_rules_enabled_idx').on(t.enabled),
  exchangeIdx: index('sniper_rules_exchange_idx').on(t.exchange),
}));

// One row per autobuy event the sniper drafts. Status moves:
// pending_signature → signed → confirmed | failed | expired (4h TTL).
export const sniperBotEvents = pgTable('sniper_bot_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: uuid('rule_id').notNull().references(() => sniperBotRules.id, { onDelete: 'cascade' }),
  walletAddress: text('wallet_address').notNull(),
  exchange: text('exchange').notNull(),
  /** Detected new pool/token mint that triggered the buy. */
  detectedMint: text('detected_mint').notNull(),
  detectedSymbol: text('detected_symbol'),
  detectedSignature: text('detected_signature').notNull(),
  /** USD size of the buy at trigger. */
  buyAmountUsd: numeric('buy_amount_usd').notNull(),
  fundingToken: text('funding_token').notNull(),
  inAmount: text('in_amount'),
  outAmount: text('out_amount'),
  slippageBps: integer('slippage_bps').notNull(),
  serializedTransaction: text('serialized_transaction'),
  quoteJson: text('quote_json'),
  status: text('status').notNull().default('pending_signature'),
  signature: text('signature'),
  failureReason: text('failure_reason'),
  signedAt: timestamp('signed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  ruleIdx: index('sniper_events_rule_idx').on(t.ruleId),
  statusIdx: index('sniper_events_status_idx').on(t.status),
  createdIdx: index('sniper_events_created_idx').on(t.createdAt),
}));

// ─── Phase 6 — Payments & Treasury Operations ────────────────────────
// Three vault-scoped tables backing the new /app/treasury canvas blocks:
// recurring payouts, gas-tank watchers, and an invoice inbox.
// HITL execution still flows through agent_tx_proposals — these tables
// only persist intent, schedule, and audit trail.

export const treasuryRecurringPayouts = pgTable('treasury_recurring_payouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  label: text('label').notNull(),
  cadence: text('cadence').notNull().default('monthly'), // monthly | biweekly | weekly | manual
  anchorDay: integer('anchor_day'),
  defaultToken: text('default_token').notNull().default('USDC'),
  recipients: jsonb('recipients').notNull().default('[]'),
  status: text('status').notNull().default('active'), // active | paused | archived
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_recurring_user_idx').on(t.userId),
  vaultIdx: index('treasury_recurring_vault_idx').on(t.vaultAddress),
}));

export const treasuryGasTankWatchers = pgTable('treasury_gas_tank_watchers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  minSol: numeric('min_sol', { precision: 18, scale: 9 }).notNull().default('0.5'),
  targetSol: numeric('target_sol', { precision: 18, scale: 9 }).notNull().default('2'),
  fundingAddress: text('funding_address'),
  capPerTopupSol: numeric('cap_per_topup_sol', { precision: 18, scale: 9 }).notNull().default('1'),
  status: text('status').notNull().default('active'), // active | paused
  lastBalanceSol: numeric('last_balance_sol', { precision: 18, scale: 9 }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastTopupAt: timestamp('last_topup_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_gas_tank_user_idx').on(t.userId),
}));

export const treasuryInvoices = pgTable('treasury_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  vendorName: text('vendor_name').notNull(),
  payToAddress: text('pay_to_address').notNull(),
  amount: numeric('amount', { precision: 28, scale: 9 }).notNull(),
  token: text('token').notNull().default('USDC'),
  memo: text('memo'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'), // pending | queued | paid | rejected
  txProposalId: uuid('tx_proposal_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_invoices_user_idx').on(t.userId),
  vaultIdx: index('treasury_invoices_vault_idx').on(t.vaultAddress),
  statusIdx: index('treasury_invoices_status_idx').on(t.status),
  dueIdx: index('treasury_invoices_due_idx').on(t.dueAt),
}));

// ─── Phase 7 — Yield routing, reports, security audits ───────────────
// Three vault-scoped tables for the remaining /app/treasury buckets.

export const treasuryYieldRoutes = pgTable('treasury_yield_routes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  token: text('token').notNull().default('USDC'),
  venue: text('venue').notNull(),
  riskBand: text('risk_band').notNull().default('conservative'),
  targetAmount: numeric('target_amount', { precision: 28, scale: 9 }).notNull().default('0'),
  minApyBps: integer('min_apy_bps'),
  status: text('status').notNull().default('draft'),
  lastApyBps: integer('last_apy_bps'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_yield_user_idx').on(t.userId),
  vaultIdx: index('treasury_yield_vault_idx').on(t.vaultAddress),
  statusIdx: index('treasury_yield_status_idx').on(t.status),
}));

export const treasuryReports = pgTable('treasury_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  title: text('title').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  shareToken: text('share_token').unique(),
  shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
  snapshot: jsonb('snapshot').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_reports_user_idx').on(t.userId),
  vaultIdx: index('treasury_reports_vault_idx').on(t.vaultAddress),
  shareIdx: index('treasury_reports_share_idx').on(t.shareToken),
}));

export const treasurySecurityAudits = pgTable('treasury_security_audits', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  vaultAddress: text('vault_address').notNull(),
  score: integer('score').notNull().default(0),
  findings: jsonb('findings').notNull().default('[]'),
  signers: jsonb('signers').notNull().default('[]'),
  threshold: integer('threshold'),
  isMultisig: boolean('is_multisig').notNull().default(false),
  lastAuditAt: timestamp('last_audit_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_security_user_idx').on(t.userId),
  vaultIdx: index('treasury_security_vault_idx').on(t.vaultAddress),
}));

// ─── Phase 14: Treasury + Foresight foundation ───────────────────────
// USD-attributed event stream. Source of truth for foresight burn/inflow
// derivation and the Analytics attribution feed. Signed amount_usd: positive
// = treasury grew, negative = treasury shrank.
export const treasuryEvents = pgTable('treasury_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  walletAddress: text('wallet_address').notNull(),
  vaultAddress: text('vault_address'),
  occurredAt: timestamp('occurred_at').notNull(),
  kind: text('kind').notNull(), // inflow | outflow | yield | fee | swap | rebalance | airdrop | unknown
  category: text('category'),
  amountUsd: numeric('amount_usd', { precision: 20, scale: 6 }).notNull(),
  tokenSymbol: text('token_symbol'),
  tokenMint: text('token_mint'),
  counterparty: text('counterparty'),
  signature: text('signature'),
  source: text('source').notNull().default('derived'),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_events_user_idx').on(t.userId, t.occurredAt),
  walletIdx: index('treasury_events_wallet_idx').on(t.walletAddress, t.occurredAt),
  kindIdx: index('treasury_events_kind_idx').on(t.kind, t.occurredAt),
}));

// Periodic vault USD valuation. Drives the real treasury growth chart on
// /app/analytics and seeds Monte Carlo drift from realized history.
export const treasurySnapshots = pgTable('treasury_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  walletAddress: text('wallet_address').notNull(),
  vaultAddress: text('vault_address'),
  totalUsd: numeric('total_usd', { precision: 20, scale: 6 }).notNull(),
  stableUsd: numeric('stable_usd', { precision: 20, scale: 6 }).notNull().default('0'),
  volatileUsd: numeric('volatile_usd', { precision: 20, scale: 6 }).notNull().default('0'),
  yieldUsd: numeric('yield_usd', { precision: 20, scale: 6 }).notNull().default('0'),
  composition: jsonb('composition').notNull().default('[]'), // { symbol, amount, priceUsd, valueUsd, isStable }[]
  source: text('source').notNull().default('wallet'),
  capturedAt: timestamp('captured_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('treasury_snapshots_user_idx').on(t.userId, t.capturedAt),
  walletIdx: index('treasury_snapshots_wallet_idx').on(t.walletAddress, t.capturedAt),
}));

// ─── Media Studio (Dreyv internal brand/content studio) ───────────────
// Generated marketing/social assets: copy, infographic specs, images, videos.
// Access is restricted to authenticated Dreyv team members (server-side role check).
export const mediaStudioAssets = pgTable('media_studio_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id), // creator (team member)
  kind: text('kind').notNull(), // post | infographic | announcement | video
  channel: text('channel'),     // x | linkedin | instagram | generic
  title: text('title'),
  prompt: text('prompt').notNull(),
  // Structured generation result — copy variants, infographic spec, image meta, etc.
  spec: jsonb('spec').notNull().default('{}'),
  // R2 storage pointers (when an image/video is generated)
  storageKey: text('storage_key'),
  mimeType: text('mime_type'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('ready'), // generating | ready | failed
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('media_studio_user_idx').on(t.userId, t.createdAt),
  kindIdx: index('media_studio_kind_idx').on(t.kind, t.createdAt),
}));

// ─── Protocol fees (Dreyv 0.05% skim ledger) ─────────────────────────
// Every CommandBar / agent transaction that ships with a fee transfer to
// TREASURY_WALLET writes a row here, so the admin "Monitoring room" can
// show real take-rate, fee-by-day, and top fee payers without grepping
// transaction_cache.
export const protocolFees = pgTable('protocol_fees', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  walletAddress: text('wallet_address').notNull(),
  // The user-tx signature this fee rides alongside (foreign-keyish).
  parentSignature: text('parent_signature').notNull(),
  // The fee transfer signature itself (separate tx in the signAllTransactions batch).
  feeSignature: text('fee_signature').notNull().unique(),
  operation: text('operation'),                          // swap | transfer | yield_deposit | …
  source: text('source').notNull().default('commandbar'),
  estimatedValueUsd: numeric('estimated_value_usd', { precision: 20, scale: 6 }),
  feeUsd: numeric('fee_usd', { precision: 20, scale: 8 }).notNull(),
  feeLamports: numeric('fee_lamports', { precision: 20, scale: 0 }).notNull(),
  treasuryWallet: text('treasury_wallet').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  walletIdx: index('protocol_fees_wallet_idx').on(t.walletAddress, t.createdAt),
  parentSigIdx: index('protocol_fees_parent_sig_idx').on(t.parentSignature),
  createdAtIdx: index('protocol_fees_created_at_idx').on(t.createdAt),
}));

// ─── Phase 3 — Agent signing layer ─────────────────────────────────────
export const agentSigners = pgTable('agent_signers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  vaultId: uuid('vault_id').notNull(),
  kind: text('kind').notNull(), // session_key | squads_member
  pubkey: text('pubkey').notNull(),
  label: text('label'),
  policyCaps: jsonb('policy_caps').notNull().default('{}'),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  killSwitchAt: timestamp('kill_switch_at', { withTimezone: true }),
  envelopeRef: text('envelope_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('agent_signers_user_idx').on(t.userId),
  vaultIdx: index('agent_signers_vault_idx').on(t.vaultId),
  statusIdx: index('agent_signers_status_idx').on(t.status),
}));

export const agentCircuitBreaker = pgTable('agent_circuit_breaker', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  vaultId: uuid('vault_id'),
  scope: text('scope').notNull().default('autopilot'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastFirewallRejectAt: timestamp('last_firewall_reject_at', { withTimezone: true }),
  frozenUntil: timestamp('frozen_until', { withTimezone: true }),
  reason: text('reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('agent_breaker_user_idx').on(t.userId),
}));

export const agentAutopilotRuns = pgTable('agent_autopilot_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  vaultId: uuid('vault_id').notNull(),
  jobId: text('job_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status').notNull().default('pending'),
  outcome: jsonb('outcome'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('agent_autopilot_user_idx').on(t.userId),
  vaultIdx: index('agent_autopilot_vault_idx').on(t.vaultId),
  createdIdx: index('agent_autopilot_created_idx').on(t.createdAt),
}));

export const agentToolMetrics = pgTable('agent_tool_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  capabilityId: text('capability_id').notNull(),
  commandId: text('command_id'),
  latencyMs: integer('latency_ms').notNull(),
  outcome: text('outcome').notNull(),
  errorCode: text('error_code'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsdEst: numeric('cost_usd_est', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  capIdx: index('agent_metrics_cap_idx').on(t.capabilityId),
  userIdx: index('agent_metrics_user_idx').on(t.userId),
  createdIdx: index('agent_metrics_created_idx').on(t.createdAt),
  outcomeIdx: index('agent_metrics_outcome_idx').on(t.outcome),
}));

// ─── Crypto Subscription Invoices (Phase 1: manual renewals) ──────────
export const cryptoInvoices = pgTable('crypto_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tier: text('tier').notNull(),                              // mini | max
  chain: text('chain').notNull(),                            // solana | base | arbitrum | polygon | bsc
  asset: text('asset').notNull(),                            // usdc | usdt | sol
  amountMinor: numeric('amount_minor', { precision: 40, scale: 0 }).notNull(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  decimals: integer('decimals').notNull(),
  contractAddress: text('contract_address'),                 // null for native SOL
  receivingAddress: text('receiving_address').notNull(),
  memo: text('memo').notNull(),
  status: text('status').notNull().default('pending'),       // pending | confirmed | expired | failed
  txSignature: text('tx_signature'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('crypto_invoices_user_idx').on(t.userId),
  statusIdx: index('crypto_invoices_status_idx').on(t.status),
  memoUniq: uniqueIndex('crypto_invoices_memo_uniq').on(t.memo),
}));

// ─── Agent API keys + x402-style payments ─────────────────────────────
// Per-user API keys an autonomous agent presents on each call.
// Only the SHA-256 hash + 12-char prefix are stored.
export const agentApiKeys = pgTable('agent_api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: text('scopes').notNull().default('x402.pay'),       // comma-separated
  spendLimitUsd: numeric('spend_limit_usd', { precision: 12, scale: 2 }),
  spentUsd: numeric('spent_usd', { precision: 14, scale: 4 }).notNull().default('0'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  hashUniq: uniqueIndex('agent_api_keys_hash_uniq').on(t.keyHash),
  userIdx: index('agent_api_keys_user_idx').on(t.userId),
}));

// Links an agent API key + SKU + crypto invoice into one billable record.
// `receiptToken` is what an agent presents to claim the paid fulfilment.
export const agentPayments = pgTable('agent_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  apiKeyId: uuid('api_key_id').references(() => agentApiKeys.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  // Only present for the Solana/USDC rail.
  invoiceId: uuid('invoice_id').references(() => cryptoInvoices.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  status: text('status').notNull().default('pending'),      // pending | paid | expired | failed
  // Which payment rail this row settles on.
  rail: text('rail').notNull().default('solana'),           // solana | stripe | paystack
  // Provider-side identifier (Stripe Checkout Session id, Paystack reference).
  providerRef: text('provider_ref'),
  // Hosted checkout URL the agent / human follows for card rails.
  checkoutUrl: text('checkout_url'),
  txSignature: text('tx_signature'),
  receiptToken: text('receipt_token'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  // Set the first time a receipt is redeemed against a fulfilment endpoint.
  // Receipts are single-use: once non-null, the token no longer unlocks output.
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  receiptUniq: uniqueIndex('agent_payments_receipt_uniq').on(t.receiptToken),
  keyIdx: index('agent_payments_key_idx').on(t.apiKeyId),
  invoiceIdx: index('agent_payments_invoice_idx').on(t.invoiceId),
  userIdx: index('agent_payments_user_idx').on(t.userId),
  railIdx: index('agent_payments_rail_idx').on(t.rail),
  providerRefIdx: index('agent_payments_provider_ref_idx').on(t.providerRef),
}));

// Hosted Solana wallet per user — funds end-to-end autonomous agent
// payments (POST /api/x402/pay). One per user; private key encrypted with
// KEYPAIR_MASTER_KEY via src/lib/keypair-envelope.ts. Custodial by design.
export const agentWallets = pgTable('agent_wallets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  publicKey: text('public_key').notNull().unique(),
  encryptedSecret: text('encrypted_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  publicKeyIdx: index('agent_wallets_public_key_idx').on(t.publicKey),
}));

// First-class record of every paid agent output. One row per payment that
// produces a deliverable — drives /app/agent/deliverables, the post-payment
// email, and the permalink view page.
export const agentDeliverables = pgTable('agent_deliverables', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').references(() => agentPayments.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  apiKeyId: uuid('api_key_id').references(() => agentApiKeys.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),                  // snapshot | report | subscription
  sku: text('sku').notNull(),
  targetWallet: text('target_wallet'),           // null for subscription
  status: text('status').notNull().default('generating'), // generating | ready | failed
  summary: jsonb('summary').notNull().default({}),
  payload: jsonb('payload').notNull().default({}),
  pdfUrl: text('pdf_url'),
  emailTo: text('email_to'),
  emailMessageId: text('email_message_id'),
  emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
  emailError: text('email_error'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('agent_deliverables_user_idx').on(t.userId, t.createdAt),
  apiKeyIdx: index('agent_deliverables_api_key_idx').on(t.apiKeyId, t.createdAt),
  paymentIdx: index('agent_deliverables_payment_idx').on(t.paymentId),
  kindIdx: index('agent_deliverables_kind_idx').on(t.kind),
  paymentUniq: uniqueIndex('agent_deliverables_payment_uniq').on(t.paymentId),
}));

// ─── Public Dreyv API keys (dk_live_… / dk_test_…) ────────────────────
// Authenticates REST (/api/v1/*) + MCP (/api/mcp). Distinct from
// agent_api_keys (dak_…), which are payment-only.
export const publicApiKeys = pgTable('public_api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  env: text('env').notNull().default('live'),          // live | test
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: text('scopes').notNull().default('read:portfolio,read:treasury,read:market'),
  rateLimitRpm: integer('rate_limit_rpm').notNull().default(120),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Phase 11 — Safety & Policy
  killSwitchAt: timestamp('kill_switch_at', { withTimezone: true }),
  ipAllowlist: text('ip_allowlist').notNull().default(''),               // csv of IPs / CIDR
  originAllowlist: text('origin_allowlist').notNull().default(''),       // csv of hostnames
  capabilityAllowlist: text('capability_allowlist').notNull().default(''), // csv of capability ids
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  hashUniq: uniqueIndex('public_api_keys_hash_uniq').on(t.keyHash),
  userIdx: index('public_api_keys_user_idx').on(t.userId),
  envIdx: index('public_api_keys_env_idx').on(t.env),
}));

// Phase 11 — Tamper-evident audit log (hash chain) for key policy changes.
export const publicApiAuditLog = pgTable('public_api_audit_log', {
  id: serial('id').primaryKey(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  target: text('target'),
  meta: jsonb('meta').notNull().default('{}'),
  prevHash: text('prev_hash').notNull().default(''),
  hash: text('hash').notNull(),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  keyTsIdx: index('public_api_audit_log_key_ts_idx').on(t.keyId, t.ts),
  userTsIdx: index('public_api_audit_log_user_ts_idx').on(t.userId, t.ts),
}));

export const publicApiKeyUsage = pgTable('public_api_key_usage', {
  id: serial('id').primaryKey(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  capabilityId: text('capability_id').notNull(),
  transport: text('transport').notNull().default('rest'),  // rest | mcp
  status: text('status').notNull().default('ok'),          // ok | error | denied | rate_limited
  latencyMs: integer('latency_ms'),
  costCredits: numeric('cost_credits', { precision: 10, scale: 4 }).notNull().default('0'),
  errorCode: text('error_code'),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  keyTsIdx: index('public_api_key_usage_key_ts_idx').on(t.keyId, t.ts),
  userTsIdx: index('public_api_key_usage_user_ts_idx').on(t.userId, t.ts),
  capTsIdx: index('public_api_key_usage_cap_ts_idx').on(t.capabilityId, t.ts),
}));

// ─── Phase 5 — Outbound Webhooks & delivery log ──────────────────────
export const publicApiWebhooks = pgTable('public_api_webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  targetUrl: text('target_url').notNull(),
  signingSecret: text('signing_secret').notNull(),
  events: text('events').notNull(),               // CSV or '*'
  active: boolean('active').notNull().default(true),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastStatus: text('last_status'),                // ok | failed | retrying
  failureStreak: integer('failure_streak').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('public_api_webhooks_user_idx').on(t.userId),
  keyIdx: index('public_api_webhooks_key_idx').on(t.keyId),
  activeIdx: index('public_api_webhooks_active_idx').on(t.active),
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  webhookId: uuid('webhook_id').references(() => publicApiWebhooks.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').notNull().default('pending'), // pending | ok | failed
  httpStatus: integer('http_status'),
  responseBody: text('response_body'),
  error: text('error'),
  latencyMs: integer('latency_ms'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  hookTsIdx: index('webhook_deliveries_hook_ts_idx').on(t.webhookId, t.createdAt),
  userTsIdx: index('webhook_deliveries_user_ts_idx').on(t.userId, t.createdAt),
  eventTsIdx: index('webhook_deliveries_event_ts_idx').on(t.event, t.createdAt),
  statusIdx: index('webhook_deliveries_status_idx').on(t.status),
}));

// ─── Phase 17 — Privacy & Data Rights (Pillar Y) ─────────────────────
export const privacyRequests = pgTable('privacy_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),                            // export | delete | rectify | restrict
  status: text('status').notNull().default('pending'),     // pending | in_progress | fulfilled | rejected | cancelled
  reason: text('reason'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  dueBy: timestamp('due_by', { withTimezone: true }).notNull(),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  artifactSha: text('artifact_sha'),
  meta: jsonb('meta').notNull().default('{}'),
}, (t) => ({
  userIdx: index('privacy_requests_user_idx').on(t.userId, t.requestedAt),
  statusIdx: index('privacy_requests_status_idx').on(t.status, t.dueBy),
}));

export const privacyConsents = pgTable('privacy_consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),                          // telemetry | marketing | ai_training | third_party_sharing | session_replay
  granted: boolean('granted').notNull(),
  source: text('source').notNull().default('api'),         // api | ui | import
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('privacy_consents_user_idx').on(t.userId),
  userTopicUniq: uniqueIndex('privacy_consents_user_topic_uniq').on(t.userId, t.topic),
}));

// ─── Phase 18 — Storage & Artifacts (Pillar Z) ───────────────────────
export const publicApiArtifacts = pgTable('public_api_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  metadata: jsonb('metadata').notNull().default('{}'),
  visibility: text('visibility').notNull().default('private'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('public_api_artifacts_user_idx').on(t.userId, t.createdAt),
  keyIdx: index('public_api_artifacts_key_idx').on(t.keyId, t.createdAt),
  shaIdx: index('public_api_artifacts_sha_idx').on(t.userId, t.sha256),
}));

// ─── Phase 21 — Jobs & Scheduling (Pillar AE) ────────────────────────
export const publicApiJobs = pgTable('public_api_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  capabilityId: text('capability_id').notNull(),
  input: jsonb('input').notNull().default('{}'),
  kind: text('kind').notNull().default('recurring'),         // recurring | one_shot
  intervalSeconds: integer('interval_seconds'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  maxRetries: integer('max_retries').notNull().default(3),
  status: text('status').notNull().default('active'),        // active | paused | cancelled | completed
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  runCount: integer('run_count').notNull().default(0),
  failCount: integer('fail_count').notNull().default(0),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('public_api_jobs_user_idx').on(t.userId, t.createdAt),
  keyIdx: index('public_api_jobs_key_idx').on(t.keyId, t.createdAt),
  dueIdx: index('public_api_jobs_due_idx').on(t.status, t.nextRunAt),
}));

export const publicApiJobRuns = pgTable('public_api_job_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => publicApiJobs.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').notNull().default('queued'),        // queued | running | ok | failed | cancelled
  attempt: integer('attempt').notNull().default(1),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  result: jsonb('result'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  triggeredBy: text('triggered_by').notNull().default('schedule'), // schedule | manual | retry
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index('public_api_job_runs_job_idx').on(t.jobId, t.createdAt),
  userIdx: index('public_api_job_runs_user_idx').on(t.userId, t.createdAt),
  statusIdx: index('public_api_job_runs_status_idx').on(t.status, t.createdAt),
}));

// ─── Phase 22 — Exports & Reports (Pillar AF) ────────────────────────
export const publicApiExports = pgTable('public_api_exports', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  source: text('source').notNull(),
  format: text('format').notNull().default('csv'),       // csv | jsonl
  filters: jsonb('filters').notNull().default('{}'),
  rowCount: integer('row_count').notNull().default(0),
  byteSize: integer('byte_size').notNull().default(0),
  sha256: text('sha256').notNull().default(''),
  truncated: boolean('truncated').notNull().default(false),
  status: text('status').notNull().default('pending'),   // pending | completed | failed | purged
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  body: bytea('body'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('public_api_exports_user_idx').on(t.userId, t.createdAt),
  keyIdx: index('public_api_exports_key_idx').on(t.keyId, t.createdAt),
  sourceIdx: index('public_api_exports_source_idx').on(t.userId, t.source, t.createdAt),
  statusIdx: index('public_api_exports_status_idx').on(t.status, t.expiresAt),
}));

// ─── Phase 23 — Tags, Labels & Annotations (Pillar AG) ───────────────
export const publicApiTags = pgTable('public_api_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  display: text('display').notNull(),
  color: text('color').notNull().default('violet'),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('public_api_tags_user_name_uq').on(t.userId, t.name),
  userIdx: index('public_api_tags_user_idx').on(t.userId, t.createdAt),
}));

export const publicApiTagLinks = pgTable('public_api_tag_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tagId: uuid('tag_id').references(() => publicApiTags.id, { onDelete: 'cascade' }).notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uq: uniqueIndex('public_api_tag_links_uq').on(t.tagId, t.entityType, t.entityId),
  userIdx: index('public_api_tag_links_user_idx').on(t.userId, t.createdAt),
  entityIdx: index('public_api_tag_links_entity_idx').on(t.userId, t.entityType, t.entityId),
  tagIdx: index('public_api_tag_links_tag_idx').on(t.tagId, t.createdAt),
}));


// ─── Phase 24 — Feature Flags & Experiments (Pillar AH) ──────────────
export const publicApiFlags = pgTable('public_api_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  display: text('display').notNull(),
  description: text('description'),
  type: text('type').notNull(),                          // boolean | string | number | json
  defaultValue: jsonb('default_value').notNull(),
  rules: jsonb('rules').notNull().default('[]'),
  enabled: boolean('enabled').notNull().default(true),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userKeyUq: uniqueIndex('public_api_flags_user_key_uq').on(t.userId, t.key),
  userIdx: index('public_api_flags_user_idx').on(t.userId, t.createdAt),
  enabledIdx: index('public_api_flags_enabled_idx').on(t.userId, t.enabled),
}));

export const publicApiFlagEvaluations = pgTable('public_api_flag_evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  flagId: uuid('flag_id').references(() => publicApiFlags.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  matchedRule: integer('matched_rule'),
  value: jsonb('value').notNull(),
  contextHash: text('context_hash').notNull(),
  context: jsonb('context').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userTsIdx: index('public_api_flag_evals_user_ts_idx').on(t.userId, t.createdAt),
  flagTsIdx: index('public_api_flag_evals_flag_ts_idx').on(t.flagId, t.createdAt),
  hashIdx: index('public_api_flag_evals_hash_idx').on(t.flagId, t.contextHash),
}));

// ─── Phase 25 — Inbox & Digests (Pillar AI) ──────────────────────────
export const publicApiInboxState = pgTable('public_api_inbox_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  notificationId: integer('notification_id').references(() => notifications.id, { onDelete: 'cascade' }).notNull(),
  threadKey: text('thread_key'),
  archived: boolean('archived').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  pinned: boolean('pinned').notNull().default(false),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  notifUq: uniqueIndex('public_api_inbox_state_notif_uq').on(t.notificationId),
  userIdx: index('public_api_inbox_state_user_idx').on(t.userId, t.updatedAt),
  threadIdx: index('public_api_inbox_state_thread_idx').on(t.userId, t.threadKey),
}));

export const publicApiInboxDigests = pgTable('public_api_inbox_digests', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull().default('{}'),
  channel: text('channel').notNull().default('inbox'),     // inbox | preview
  scheduleSeconds: integer('schedule_seconds').notNull().default(86400),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastMatchCount: integer('last_match_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('public_api_inbox_digests_user_name_uq').on(t.userId, t.name),
  userIdx: index('public_api_inbox_digests_user_idx').on(t.userId, t.createdAt),
}));

// ─── Phase 26 — Teams, Members & Invites (Pillar AJ) ─────────────────
// Hash-chained audit overlay for team mutations. The legacy `teams`,
// `team_members`, and `team_invitations` tables are wrapped by the
// `teams.*` capabilities; every mutation appends one row here so callers
// can prove integrity of the team's history.
export const publicApiTeamAudit = pgTable('public_api_team_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),
  target: text('target'),
  meta: jsonb('meta').notNull().default('{}'),
  prevHash: text('prev_hash').notNull().default(''),
  hash: text('hash').notNull(),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  teamTsIdx: index('public_api_team_audit_team_ts_idx').on(t.teamId, t.ts),
  userTsIdx: index('public_api_team_audit_user_ts_idx').on(t.userId, t.ts),
  keyTsIdx: index('public_api_team_audit_key_ts_idx').on(t.keyId, t.ts),
  actionIdx: index('public_api_team_audit_action_idx').on(t.teamId, t.action, t.ts),
}));

// ─── Phase 27 — Billing, Usage & Quotas (Pillar AK) ──────────────────
// User-defined usage threshold alarms. Each alert is evaluated by
// `billing.alerts_evaluate` (and by the existing usage probes) against
// the current window; when crossed it writes one inbox notification +
// fires `billing.quota_threshold`, then debounces via `last_triggered_at`
// until the window rolls.
export const publicApiBillingAlerts = pgTable('public_api_billing_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  metric: text('metric').notNull().default('calls'),         // calls | credits
  scope: text('scope').notNull().default('monthly'),         // monthly | daily
  thresholdPct: integer('threshold_pct'),
  thresholdAbs: numeric('threshold_abs', { precision: 14, scale: 4 }),
  channel: text('channel').notNull().default('inbox'),       // inbox | webhook
  enabled: boolean('enabled').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  lastValue: numeric('last_value', { precision: 14, scale: 4 }).notNull().default('0'),
  fireCount: integer('fire_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('public_api_billing_alerts_user_name_uq').on(t.userId, t.name),
  userIdx: index('public_api_billing_alerts_user_idx').on(t.userId, t.createdAt),
  enabledIdx: index('public_api_billing_alerts_enabled_idx').on(t.userId, t.enabled),
}));


// ─── Phase 28 — Workspace Insights & Reporting (Pillar AL) ───────────
// Saved-report definitions, immutable snapshots, and tokenised public
// share links. Read-side `insights.*` capabilities run on the existing
// usage/audit/team-audit tables — these three are only the persistence
// layer for the reusable report surface.
export const publicApiReports = pgTable('public_api_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  sections: jsonb('sections').notNull().default('[]'),
  filters: jsonb('filters').notNull().default('{}'),
  scheduleSeconds: integer('schedule_seconds').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSnapshotId: uuid('last_snapshot_id'),
  runCount: integer('run_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('public_api_reports_user_name_uq').on(t.userId, t.name),
  userIdx: index('public_api_reports_user_idx').on(t.userId, t.createdAt),
}));

export const publicApiReportSnapshots = pgTable('public_api_report_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id').references(() => publicApiReports.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'set null' }),
  trigger: text('trigger').notNull().default('manual'),  // manual | scheduled | webhook
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  summary: jsonb('summary').notNull().default('{}'),
  payload: jsonb('payload').notNull().default('{}'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  reportIdx: index('public_api_report_snapshots_report_idx').on(t.reportId, t.generatedAt),
  userIdx: index('public_api_report_snapshots_user_idx').on(t.userId, t.generatedAt),
}));

export const publicApiReportShares = pgTable('public_api_report_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  snapshotId: uuid('snapshot_id').references(() => publicApiReportSnapshots.id, { onDelete: 'cascade' }).notNull(),
  reportId: uuid('report_id').references(() => publicApiReports.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'set null' }),
  token: text('token').notNull(),
  passwordHash: text('password_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tokenUq: uniqueIndex('public_api_report_shares_token_uq').on(t.token),
  userIdx: index('public_api_report_shares_user_idx').on(t.userId, t.createdAt),
  snapshotIdx: index('public_api_report_shares_snapshot_idx').on(t.snapshotId),
}));

// ─── Pillar AM — Marketplace & Catalog (Phase 29) ───────────────────
// Publisher identity (one per workspace), public catalog listings,
// immutable version history, per-user installs, and ratings/reviews.
export const publicApiPublishers = pgTable('public_api_publishers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  slug: text('slug').notNull(),
  displayName: text('display_name').notNull(),
  website: text('website'),
  supportEmail: text('support_email'),
  description: text('description'),
  logoUrl: text('logo_url'),
  verified: boolean('verified').notNull().default(false),
  verificationAt: timestamp('verification_at', { withTimezone: true }),
  payoutsAccount: text('payouts_account'),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userUq: uniqueIndex('public_api_publishers_user_uq').on(t.userId),
  slugUq: uniqueIndex('public_api_publishers_slug_uq').on(t.slug),
}));

export const publicApiListings = pgTable('public_api_listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  publisherId: uuid('publisher_id').references(() => publicApiPublishers.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  longDescription: text('long_description'),
  category: text('category').notNull().default('general'),
  kind: text('kind').notNull().default('capability'),    // capability | template | agent | dataset | workflow
  pricingModel: text('pricing_model').notNull().default('free'),
  priceMinor: integer('price_minor').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('draft'),     // draft | pending | published | suspended | archived
  visibility: text('visibility').notNull().default('public'),
  tags: jsonb('tags').notNull().default('[]'),
  manifest: jsonb('manifest').notNull().default('{}'),
  currentVersion: text('current_version').notNull().default('0.1.0'),
  installCount: integer('install_count').notNull().default(0),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default('0'),
  ratingCount: integer('rating_count').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  publisherSlugUq: uniqueIndex('public_api_listings_publisher_slug_uq').on(t.publisherId, t.slug),
  userIdx: index('public_api_listings_user_idx').on(t.userId, t.createdAt),
  statusIdx: index('public_api_listings_status_idx').on(t.status, t.visibility, t.publishedAt),
  categoryIdx: index('public_api_listings_category_idx').on(t.category, t.kind, t.status),
}));

export const publicApiListingVersions = pgTable('public_api_listing_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => publicApiListings.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  version: text('version').notNull(),
  changelog: text('changelog'),
  manifest: jsonb('manifest').notNull().default('{}'),
  manifestHash: text('manifest_hash').notNull(),
  yankedAt: timestamp('yanked_at', { withTimezone: true }),
  yankReason: text('yank_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  listingVersionUq: uniqueIndex('public_api_listing_versions_listing_version_uq').on(t.listingId, t.version),
  listingIdx: index('public_api_listing_versions_listing_idx').on(t.listingId, t.createdAt),
}));

export const publicApiListingInstalls = pgTable('public_api_listing_installs', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => publicApiListings.id, { onDelete: 'cascade' }).notNull(),
  versionId: uuid('version_id').references(() => publicApiListingVersions.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  keyId: uuid('key_id').references(() => publicApiKeys.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  pricingModel: text('pricing_model').notNull().default('free'),
  priceMinor: integer('price_minor').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  billingRef: text('billing_ref'),
  config: jsonb('config').notNull().default('{}'),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userListingUq: uniqueIndex('public_api_listing_installs_user_listing_uq').on(t.userId, t.listingId),
  listingIdx: index('public_api_listing_installs_listing_idx').on(t.listingId, t.status),
}));

export const publicApiListingReviews = pgTable('public_api_listing_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  listingId: uuid('listing_id').references(() => publicApiListings.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenReason: text('hidden_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userListingUq: uniqueIndex('public_api_listing_reviews_user_listing_uq').on(t.userId, t.listingId),
  listingIdx: index('public_api_listing_reviews_listing_idx').on(t.listingId, t.createdAt),
}));



// ─── Pillar AN — SLA & Status pages (Phase 30) ───────────────────────
export const publicApiStatusPages = pgTable('public_api_status_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  branding: jsonb('branding').notNull().default('{}'),
  components: jsonb('components').notNull().default('[]'),
  isPublic: boolean('is_public').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  slugUq: uniqueIndex('public_api_status_pages_slug_uq').on(t.slug),
  userIdx: index('public_api_status_pages_user_idx').on(t.userId),
}));

export const publicApiStatusIncidents = pgTable('public_api_status_incidents', {
  id: uuid('id').defaultRandom().primaryKey(),
  pageId: uuid('page_id').references(() => publicApiStatusPages.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('investigating'),
  severity: text('severity').notNull().default('minor'),
  impact: text('impact').notNull().default('none'),
  componentIds: jsonb('component_ids').notNull().default('[]'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pageIdx: index('public_api_status_incidents_page_idx').on(t.pageId, t.startedAt),
}));

export const publicApiStatusIncidentUpdates = pgTable('public_api_status_incident_updates', {
  id: uuid('id').defaultRandom().primaryKey(),
  incidentId: uuid('incident_id').references(() => publicApiStatusIncidents.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').notNull(),
  body: text('body').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  incidentIdx: index('public_api_status_incident_updates_incident_idx').on(t.incidentId, t.postedAt),
}));

export const publicApiStatusMaintenance = pgTable('public_api_status_maintenance', {
  id: uuid('id').defaultRandom().primaryKey(),
  pageId: uuid('page_id').references(() => publicApiStatusPages.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  body: text('body'),
  componentIds: jsonb('component_ids').notNull().default('[]'),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pageIdx: index('public_api_status_maintenance_page_idx').on(t.pageId, t.scheduledStart),
}));

export const publicApiStatusSubscribers = pgTable('public_api_status_subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  pageId: uuid('page_id').references(() => publicApiStatusPages.id, { onDelete: 'cascade' }).notNull(),
  channel: text('channel').notNull(),
  target: text('target').notNull(),
  componentIds: jsonb('component_ids').notNull().default('[]'),
  confirmToken: text('confirm_token').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uq: uniqueIndex('public_api_status_subscribers_uq').on(t.pageId, t.channel, t.target),
}));

export const publicApiSlaTargets = pgTable('public_api_sla_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  tier: text('tier'),
  componentKey: text('component_key').notNull(),
  uptimeTarget: numeric('uptime_target', { precision: 6, scale: 4 }).notNull(),
  latencyP95Ms: integer('latency_p95_ms').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('public_api_sla_targets_user_idx').on(t.userId, t.componentKey),
  tierIdx: index('public_api_sla_targets_tier_idx').on(t.tier, t.componentKey),
}));

export const publicApiSlaCredits = pgTable('public_api_sla_credits', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  periodMonth: text('period_month').notNull(),
  target: jsonb('target').notNull().default('{}'),
  observed: jsonb('observed').notNull().default('{}'),
  creditPct: numeric('credit_pct', { precision: 6, scale: 4 }).notNull().default('0'),
  status: text('status').notNull().default('pending'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userPeriodUq: uniqueIndex('public_api_sla_credits_user_period_uq').on(t.userId, t.periodMonth),
}));

// ─── Pillar AO — Data Contracts & Schema Registry (Phase 31) ──────────
export const publicApiSchemas = pgTable('public_api_schemas', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  namespace: text('namespace').notNull().default('default'),
  name: text('name').notNull(),
  description: text('description'),
  latestVersion: text('latest_version'),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNsNameUq: uniqueIndex('public_api_schemas_user_ns_name_uq').on(t.userId, t.namespace, t.name),
  userIdx: index('public_api_schemas_user_idx').on(t.userId),
}));

export const publicApiSchemaVersions = pgTable('public_api_schema_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  schemaId: uuid('schema_id').references(() => publicApiSchemas.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  version: text('version').notNull(),
  jsonSchema: jsonb('json_schema').notNull(),
  schemaHash: text('schema_hash').notNull(),
  changelog: text('changelog'),
  compatibility: text('compatibility').notNull().default('unknown'),
  breakingChanges: jsonb('breaking_changes').notNull().default('[]'),
  yankedAt: timestamp('yanked_at', { withTimezone: true }),
  yankReason: text('yank_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  schemaVersionUq: uniqueIndex('public_api_schema_versions_schema_version_uq').on(t.schemaId, t.version),
  schemaIdx: index('public_api_schema_versions_schema_idx').on(t.schemaId, t.createdAt),
}));

export const publicApiContracts = pgTable('public_api_contracts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  subjectType: text('subject_type').notNull(),
  subject: text('subject').notNull(),
  schemaId: uuid('schema_id').references(() => publicApiSchemas.id, { onDelete: 'restrict' }).notNull(),
  schemaVersion: text('schema_version').notNull(),
  mode: text('mode').notNull().default('validate'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('public_api_contracts_user_name_uq').on(t.userId, t.name),
  subjectIdx: index('public_api_contracts_subject_idx').on(t.userId, t.subjectType, t.subject),
}));

export const publicApiContractViolations = pgTable('public_api_contract_violations', {
  id: uuid('id').defaultRandom().primaryKey(),
  contractId: uuid('contract_id').references(() => publicApiContracts.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  subject: text('subject').notNull(),
  payloadExcerpt: jsonb('payload_excerpt').notNull().default('{}'),
  errors: jsonb('errors').notNull().default('[]'),
  severity: text('severity').notNull().default('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  contractIdx: index('public_api_contract_violations_contract_idx').on(t.contractId, t.createdAt),
  userIdx: index('public_api_contract_violations_user_idx').on(t.userId, t.createdAt),
}));

// ─── Phases 32-39 — Pillars AP..AX ────────────────────────────────────

export const obsTraces = pgTable('obs_traces', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  traceId: text('trace_id').notNull(),
  service: text('service').notNull(),
  rootName: text('root_name'),
  startNs: numeric('start_ns').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  status: text('status').notNull().default('ok'),
  spanCount: integer('span_count').notNull().default(0),
  attributes: jsonb('attributes').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userTraceUq: uniqueIndex('obs_traces_user_trace_uq').on(t.userId, t.traceId),
  userIdx: index('obs_traces_user_idx').on(t.userId, t.createdAt),
}));

export const obsSpans = pgTable('obs_spans', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  traceId: text('trace_id').notNull(),
  spanId: text('span_id').notNull(),
  parentSpanId: text('parent_span_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('internal'),
  service: text('service'),
  startNs: numeric('start_ns').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  status: text('status').notNull().default('ok'),
  attributes: jsonb('attributes').notNull().default('{}'),
  events: jsonb('events').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userSpanUq: uniqueIndex('obs_spans_user_span_uq').on(t.userId, t.traceId, t.spanId),
  traceIdx: index('obs_spans_trace_idx').on(t.userId, t.traceId),
}));

export const obsMetrics = pgTable('obs_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('gauge'),
  value: numeric('value').notNull(),
  unit: text('unit'),
  labels: jsonb('labels').notNull().default('{}'),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameIdx: index('obs_metrics_user_name_idx').on(t.userId, t.name, t.ts),
}));

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  seq: numeric('seq').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource'),
  payload: jsonb('payload').notNull().default('{}'),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userSeqUq: uniqueIndex('audit_log_user_seq_uq').on(t.userId, t.seq),
  userTimeIdx: index('audit_log_user_time_idx').on(t.userId, t.occurredAt),
}));

export const rateLimitPolicies = pgTable('rate_limit_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  scope: text('scope').notNull().default('key'),
  matchTarget: text('match_target').notNull().default('*'),
  windowSec: integer('window_sec').notNull().default(60),
  limitCount: integer('limit_count').notNull().default(60),
  burst: integer('burst').notNull().default(0),
  action: text('action').notNull().default('throttle'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('rate_limit_policies_user_name_uq').on(t.userId, t.name),
}));

export const rateLimitUsage = pgTable('rate_limit_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  policyId: uuid('policy_id').references(() => rateLimitPolicies.id, { onDelete: 'cascade' }),
  bucketKey: text('bucket_key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
  rejected: integer('rejected').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uq: uniqueIndex('rate_limit_usage_uq').on(t.userId, t.policyId, t.bucketKey, t.windowStart),
}));

export const regionPolicies = pgTable('region_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  defaultRegion: text('default_region').notNull().default('us-east-1'),
  allowedRegions: jsonb('allowed_regions').notNull().default('["us-east-1","eu-west-1","ap-southeast-1"]'),
  strict: boolean('strict').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const regionPins = pgTable('region_pins', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  region: text('region').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  resourceUq: uniqueIndex('region_pins_resource_uq').on(t.userId, t.resourceType, t.resourceId),
}));

export const digestChannels = pgTable('digest_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  target: text('target').notNull(),
  secretRef: text('secret_ref'),
  enabled: boolean('enabled').notNull().default(true),
  quietStart: text('quiet_start'),
  quietEnd: text('quiet_end'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const digestSchedules = pgTable('digest_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  channelIds: jsonb('channel_ids').notNull().default('[]'),
  cron: text('cron').notNull(),
  source: text('source').notNull().default('inbox'),
  filter: jsonb('filter').notNull().default('{}'),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('digest_schedules_user_name_uq').on(t.userId, t.name),
}));

export const searchDocs = pgTable('search_docs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  tags: jsonb('tags').notNull().default('[]'),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  entityUq: uniqueIndex('search_docs_entity_uq').on(t.userId, t.entityType, t.entityId),
}));

export const searchSaved = pgTable('search_saved', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  filters: jsonb('filters').notNull().default('{}'),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('search_saved_user_name_uq').on(t.userId, t.name),
}));

export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  trigger: jsonb('trigger').notNull().default('{"kind":"manual"}'),
  nodes: jsonb('nodes').notNull().default('[]'),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userNameUq: uniqueIndex('workflows_user_name_uq').on(t.userId, t.name),
}));

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  trigger: jsonb('trigger').notNull().default('{}'),
  status: text('status').notNull().default('queued'),
  input: jsonb('input').notNull().default('{}'),
  output: jsonb('output'),
  nodeLog: jsonb('node_log').notNull().default('[]'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  workflowIdx: index('workflow_runs_workflow_idx').on(t.workflowId, t.createdAt),
}));

export const entitlementOverrides = pgTable('entitlement_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  feature: text('feature').notNull(),
  value: jsonb('value').notNull(),
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userFeatureUq: uniqueIndex('entitlement_overrides_user_feature_uq').on(t.userId, t.feature),
}));

// ─── OAuth 2.1 + Dynamic Client Registration server ───────────────────
// Lets MCP clients (Claude, ChatGPT, Cursor, etc.) self-register and obtain
// scoped JWT access tokens that authorize calls to /api/mcp and /api/v1/*.
// See db-migrations/0048_oauth_server.sql for the source-of-truth schema.

export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientSecretHash: text('client_secret_hash'),
  clientName: text('client_name').notNull(),
  clientUri: text('client_uri'),
  logoUri: text('logo_uri'),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  responseTypes: text('response_types').array().notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  scopes: text('scopes').array().notNull(),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  registrationAccessTokenHash: text('registration_access_token_hash'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const oauthAuthCodes = pgTable('oauth_auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  nonce: text('nonce'),
  state: text('state'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauthTokens = pgTable('oauth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  tokenType: text('token_type').notNull(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  jti: text('jti'),
  parentRefreshHash: text('parent_refresh_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauthDeviceCodes = pgTable('oauth_device_codes', {
  deviceCodeHash: text('device_code_hash').primaryKey(),
  userCode: text('user_code').notNull().unique(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  intervalSeconds: integer('interval_seconds').notNull().default(5),
  approvedUserId: uuid('approved_user_id').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  deniedAt: timestamp('denied_at', { withTimezone: true }),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauthSigningKeys = pgTable('oauth_signing_keys', {
  kid: text('kid').primaryKey(),
  algorithm: text('algorithm').notNull().default('ES256'),
  publicJwk: jsonb('public_jwk').notNull(),
  privateJwkEncrypted: bytea('private_jwk_encrypted').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});

export const oauthConsents = pgTable('oauth_consents', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: uniqueIndex('oauth_consents_pk').on(t.userId, t.clientId),
}));

export const oauthRegistrationAttempts = pgTable('oauth_registration_attempts', {
  ip: text('ip').notNull(),
  day: text('day').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => ({
  pk: uniqueIndex('oauth_registration_attempts_pk').on(t.ip, t.day),
}));


// ─── Agent signup audit (machine /api/agents/signup) ──────────────────
export const agentSignupAudit = pgTable('agent_signup_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  clientId: text('client_id').notNull(),
  method: text('method').notNull(),
  callerDid: text('caller_did'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  clientIdx: index('agent_signup_audit_client_idx').on(t.clientId),
}));


// ─── Agent prepaid balance ("metered prepaid" rail) ───────────────────
// Top up once (Stripe / x402 / manual crypto), capabilities debit per
// call. See src/lib/agent/balance.ts and migration 0050_agent_balances.
export const agentBalances = pgTable('agent_balances', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balanceMinor: text('balance_minor').notNull().default('0'), // bigint as text to preserve precision
  currency: text('currency').notNull().default('USDC'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentBalanceLedger = pgTable('agent_balance_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  deltaMinor: text('delta_minor').notNull(),
  balanceAfter: text('balance_after').notNull(),
  reason: text('reason').notNull(),
  ref: text('ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('agent_balance_ledger_user_idx').on(t.userId, t.createdAt),
}));

// Persistent single-use replay guard for agent claim tokens (migration 0051).
export const redeemedClaimTokens = pgTable('redeemed_claim_tokens', {
  jti: text('jti').primaryKey(),
  agentUserId: uuid('agent_user_id').notNull(),
  customerUserId: uuid('customer_user_id').notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index('redeemed_claim_tokens_customer_idx').on(t.customerUserId, t.redeemedAt),
}));

// Studio video render jobs (migration 0055). Background fal.ai pipeline
// that turns a generated TikTok pack into a stitched 9:16 MP4 ad.
export const studioVideoJobs = pgTable('studio_video_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: text('status').notNull().default('queued'), // queued|rendering_shots|stitching|done|failed
  pack: jsonb('pack').notNull(),
  model: text('model').notNull().default('fal-ai/veo3/fast'),
  shotsTotal: integer('shots_total').notNull().default(0),
  shotsDone: integer('shots_done').notNull().default(0),
  shotUrls: jsonb('shot_urls').notNull().default([] as unknown as object),
  finalUrl: text('final_url'),
  durationSec: integer('duration_sec'),
  costUsdMinor: integer('cost_usd_minor'),
  error: text('error'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  createdIdx: index('studio_video_jobs_created_idx').on(t.createdAt),
}));
