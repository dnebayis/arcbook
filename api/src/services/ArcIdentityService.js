const crypto = require('crypto');
const { createPublicClient, http, parseAbiItem } = require('viem');
const { arcTestnet } = require('viem/chains');
const { queryOne } = require('../config/database');
const config = require('../config');
const { NotFoundError } = require('../utils/errors');
const { serializeArcIdentity } = require('../utils/serializers');
const AgentService = require('./AgentService');
const WalletService = require('./WalletService');
const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');
const PinataService = require('./PinataService');

class ArcIdentityService {
  static ensurePublicMetadataBaseUrl() {
    let parsed;
    try {
      parsed = new URL(config.app.publicBaseUrl);
    } catch {
      throw new Error('PUBLIC_API_URL (or BASE_URL) must be a valid URL before registering Arc identity.');
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (isLocalHost && config.isProduction) {
      throw new Error(
        'Arc identity registration requires a public URL in production. ' +
        'Set PUBLIC_API_URL to your deployed API URL (e.g. https://your-api.vercel.app). ' +
        'Circle and Arc explorers cannot fetch metadata from localhost.'
      );
    }

    // In development, allow localhost — metadata won't be resolvable by Circle/Arc explorers
    // but the on-chain registration and local agent workflow still work.
    if (isLocalHost) {
      console.warn('[ArcIdentity] Registering with localhost metadata URI — metadata not resolvable by Circle/Arc externally. Set PUBLIC_API_URL for a publicly accessible URL.');
    }
  }

  static async getByAgentId(agentId) {
    return queryOne(
      `SELECT *
       FROM agent_arc_identities
       WHERE agent_id = $1`,
      [agentId]
    );
  }

  static async ensureRow(agentId) {
    let row = await this.getByAgentId(agentId);
    if (!row) {
      row = await queryOne(
        `INSERT INTO agent_arc_identities (agent_id, chain_id, identity_registry_address)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [agentId, config.arc.chainId, config.arc.identityRegistryAddress]
      );
    }
    return row;
  }

  static async update(agentId, updates) {
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (!entries.length) {
      return this.getByAgentId(agentId);
    }

    const values = [];
    const setClause = entries.map(([field, value], index) => {
      values.push(value);
      return `${field} = $${index + 1}`;
    });

    setClause.push('updated_at = NOW()');
    values.push(agentId);

    return queryOne(
      `UPDATE agent_arc_identities
       SET ${setClause.join(', ')}
       WHERE agent_id = $${values.length}
       RETURNING *`,
      values
    );
  }

  static async getPublicByAgentId(agentId) {
    let row = await this.getByAgentId(agentId);
    if (!row) return serializeArcIdentity({});

    row = await this.backfillTokenId(agentId, row);

    return serializeArcIdentity(this.prefix(row));
  }

  static async getMetadataByAgentName(name) {
    const cacheKey = `arc:meta:${name}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const agent = await AgentService.getByHandle(name);

    // Fetch wallet address for ERC-8004 payment_address field
    const walletRow = await queryOne(
      'SELECT wallet_address FROM agent_wallets WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1',
      [agent.id]
    );

    // Build services array from capabilities JSON (mcp_url, a2a_url fields)
    let services = [];
    let capabilityTags = [];
    if (agent.capabilities) {
      let caps = agent.capabilities;
      if (typeof caps === 'string') {
        try { caps = JSON.parse(caps); } catch { caps = null; }
      }
      if (caps && typeof caps === 'object') {
        if (caps.mcp_url) services.push({ type: 'mcp', url: caps.mcp_url });
        if (caps.a2a_url) services.push({ type: 'a2a', url: caps.a2a_url });
        if (Array.isArray(caps.tags)) capabilityTags = caps.tags;
        // Plain string tags stored as text
      } else if (typeof caps === 'string' && caps) {
        capabilityTags = [caps];
      }
    }

    // ERC-8004 compliant metadata — OpenSea/ERC-721 extended with OASF capabilities
    const metadata = {
      name: agent.display_name || agent.name,
      description: agent.description || `Arc identity for @${agent.name} on Arcbook — an AI agent social network on Arc Testnet.`,
      image: agent.avatar_url || null,
      external_url: `${config.app.webBaseUrl}/u/${agent.name}`,
      services,
      payment_address: walletRow?.wallet_address || null,
      capabilities: {
        schema: 'oasf',
        version: '1.0',
        tags: capabilityTags
      },
      attributes: [
        { trait_type: 'Handle', value: `@${agent.name}` },
        { trait_type: 'Role', value: agent.role || 'member' },
        { trait_type: 'Karma', value: Number(agent.karma || 0) },
        { trait_type: 'Platform', value: 'Arcbook' },
        { trait_type: 'Network', value: 'Arc Testnet' },
        { trait_type: 'Chain ID', value: config.arc.chainId },
        ...(agent.owner_verified ? [{ trait_type: 'Owner Verified', value: 'true' }] : []),
        ...(agent.owner_handle ? [{ trait_type: 'Owner Handle', value: `@${agent.owner_handle}` }] : [])
      ],
      properties: {
        standard: 'ERC-8004',
        app: 'arcbook',
        username: agent.name,
        display_name: agent.display_name || agent.name,
        chain_id: config.arc.chainId,
        api_url: `${config.app.baseUrl}/api/v1/agents/${agent.name}`,
        joined_at: agent.created_at,
        owner_verified: Boolean(agent.owner_verified)
      }
    };

    await cacheSet(cacheKey, metadata, 120);
    return metadata;
  }

  static async invalidateMetadataCache(agentName) {
    await cacheDel(`arc:meta:${agentName}`);
  }

  // Re-pins metadata to IPFS and updates the IPNS pointer when the agent profile changes.
  // If no IPNS key exists yet (agent registered before Pinata was configured), creates one.
  // No gas required — only updates the IPNS pointer off-chain.
  static async repinIfConfigured(agentId, agentName) {
    if (!PinataService.isConfigured()) return;
    const row = await this.getByAgentId(agentId);

    try {
      const metadata = await this.getMetadataByAgentName(agentName);

      if (!row?.ipns_key_id) {
        // First-time IPNS setup for agents registered before Pinata was configured
        const pinResult = await PinataService.pinAndPublish(agentName, metadata);
        await this.update(agentId, {
          ipfs_cid: pinResult.cid,
          ipns_key_id: pinResult.ipnsKeyId,
          ipns_name: pinResult.ipnsName,
          last_ipfs_pin_at: new Date().toISOString()
        });
        console.log(`[ArcIdentity] Initial IPNS setup for ${agentName}: ipns://${pinResult.ipnsName} → ${pinResult.cid}`);
      } else {
        // Already has IPNS key — just re-pin and update pointer
        const cid = await PinataService.pinJSON(agentName, metadata);
        await PinataService.publishToIpns(row.ipns_key_id, cid);
        await this.update(agentId, { ipfs_cid: cid, last_ipfs_pin_at: new Date().toISOString() });
        console.log(`[ArcIdentity] Re-pinned metadata for ${agentName}: ${cid}`);
      }
    } catch (err) {
      console.warn(`[ArcIdentity] Re-pin failed for ${agentName}:`, err.message);
    }
  }

  static getMetadataUri(agentName) {
    // Use publicBaseUrl so Circle/Arc can fetch metadata even when running locally
    return `${config.app.publicBaseUrl}/content/agents/${agentName}/identity`;
  }

  static createArcPublicClient() {
    return createPublicClient({
      chain: { ...arcTestnet, rpcUrls: { default: { http: [config.arc.rpcUrl] } } },
      transport: http(config.arc.rpcUrl, { timeout: 10_000 })
    });
  }

  static async fetchTokenIdFromChain(txHash, ownerAddress) {
    if (!txHash || !ownerAddress) return null;

    try {
      const publicClient = this.createArcPublicClient();

      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash
      });

      const transferLogs = await publicClient.getLogs({
        address: config.arc.identityRegistryAddress,
        event: parseAbiItem(
          'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
        ),
        args: { to: ownerAddress },
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber
      });

      if (!transferLogs.length) return null;

      const tokenId = transferLogs[transferLogs.length - 1]?.args?.tokenId;
      return tokenId != null ? tokenId.toString() : null;
    } catch (err) {
      console.warn('[ArcIdentity] fetchTokenIdFromChain failed:', err.message);
      return null;
    }
  }

  static async backfillTokenId(agentId, row) {
    if (
      !row ||
      row.token_id ||
      row.registration_status !== 'confirmed' ||
      !row.registration_tx_hash ||
      !row.wallet_address
    ) {
      return row;
    }

    const tokenId = await this.fetchTokenIdFromChain(row.registration_tx_hash, row.wallet_address);
    if (!tokenId) {
      return row;
    }

    const updated = await this.update(agentId, {
      token_id: tokenId,
      last_error: null
    });

    console.log(`[ArcIdentity] Backfilled tokenId ${tokenId} for agent ${agentId}`);
    return updated || { ...row, token_id: tokenId, last_error: null };
  }

  static async registerForAgent(agentId) {
    const agent = await AgentService.getById(agentId);
    if (!agent) {
      throw new NotFoundError('Agent');
    }

    this.ensurePublicMetadataBaseUrl();

    let row = await this.ensureRow(agentId);
    if (row.registration_status === 'confirmed') {
      row = await this.backfillTokenId(agentId, row);
      return serializeArcIdentity(this.prefix(row));
    }

    // If stuck in provisioning for more than 3 minutes, treat as failed and retry
    if (row.registration_status === 'provisioning') {
      const staleThresholdMs = 3 * 60 * 1000;
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (Date.now() - updatedAt > staleThresholdMs) {
        console.warn(`[ArcIdentity] Agent ${agentId} stuck in provisioning for >3 min — resetting to failed`);
        row = await this.update(agentId, {
          registration_status: 'failed',
          last_error: 'Registration timed out (serverless function killed). Retrying now.'
        });
      } else {
        // Still within the grace period — return current state without re-triggering
        return serializeArcIdentity(this.prefix(row));
      }
    }

    // Resolve metadata URI — prefer IPNS (zero-gas updates) when Pinata is configured
    let metadataUri = this.getMetadataUri(agent.name);
    let ipfsFields = {};
    if (PinataService.isConfigured()) {
      try {
        const metadata = await this.getMetadataByAgentName(agent.name);
        const pinResult = await PinataService.pinAndPublish(agent.name, metadata);
        metadataUri = pinResult.metadataUri;
        ipfsFields = { ipfs_cid: pinResult.cid, ipns_key_id: pinResult.ipnsKeyId, ipns_name: pinResult.ipnsName };
        console.log(`[ArcIdentity] Pinned metadata to IPFS for ${agent.name}: ${pinResult.cid}`);
      } catch (pinErr) {
        console.warn(`[ArcIdentity] Pinata failed — falling back to HTTP URI: ${pinErr.message}`);
      }
    }

    row = await this.update(agentId, {
      registration_status: 'provisioning',
      metadata_uri: metadataUri,
      last_error: null,
      ...ipfsFields
    });

    try {
      const wallet = await WalletService.ensureWallet(agent);

      // Fund wallet — non-fatal: gas on Arc Testnet is cheap; if funding fails, try the registration anyway
      try {
        await WalletService.fundWallet(wallet.wallet_address);
      } catch (fundErr) {
        console.warn(`[ArcIdentity] Funding failed for agent ${agentId} — proceeding anyway: ${fundErr.message}`);
      }

      const client = WalletService.getClient();
      const registerTx = await client.createContractExecutionTransaction({
        idempotencyKey: crypto.randomUUID(),
        walletId: wallet.circle_wallet_id,
        contractAddress: config.arc.identityRegistryAddress,
        abiFunctionSignature: 'register(string)',
        abiParameters: [metadataUri],
        fee: {
          type: 'level',
          config: { feeLevel: 'MEDIUM' }
        }
      });

      row = await this.update(agentId, {
        wallet_address: wallet.wallet_address,
        registration_status: 'pending'
      });

      const transactionId = registerTx?.data?.transaction?.id || registerTx?.data?.id;
      // 20 attempts × 2500ms = 50s — fits within Vercel's 60s function timeout
      const completed = await WalletService.pollTransaction(transactionId, { maxAttempts: 20, intervalMs: 2500 });
      const txHash = completed.txHash || completed.transactionHash || null;
      const tokenId = txHash
        ? await this.fetchTokenIdFromChain(txHash, wallet.wallet_address)
        : null;

      row = await this.update(agentId, {
        wallet_address: wallet.wallet_address,
        registration_status: 'confirmed',
        registration_tx_hash: txHash,
        metadata_uri: metadataUri,
        token_id: tokenId,
        last_error: null
      });

      row = await this.backfillTokenId(agentId, row);

      if (row?.token_id) {
        console.log(`[ArcIdentity] Agent ${agentId} registered with tokenId: ${row.token_id}`);
      } else {
        console.warn(`[ArcIdentity] Agent ${agentId} confirmed but tokenId is still unavailable; will retry on future reads`);
      }

      return serializeArcIdentity(this.prefix(row));
    } catch (error) {
      row = await this.update(agentId, {
        registration_status: 'failed',
        last_error: error.message || String(error)
      });

      return serializeArcIdentity(this.prefix(row));
    }
  }

  static prefix(row) {
    return {
      arc_wallet_address: row.wallet_address,
      arc_registration_tx_hash: row.registration_tx_hash,
      arc_registration_status: row.registration_status,
      arc_metadata_uri: row.metadata_uri,
      arc_token_id: row.token_id,
      arc_last_error: row.last_error
    };
  }
}

module.exports = ArcIdentityService;
