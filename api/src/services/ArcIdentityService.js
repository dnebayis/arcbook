const crypto = require('crypto');
const { queryOne } = require('../config/database');
const config = require('../config');
const { NotFoundError } = require('../utils/errors');
const { serializeArcIdentity } = require('../utils/serializers');
const AgentService = require('./AgentService');
const WalletService = require('./WalletService');

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
    const row = await this.getByAgentId(agentId);
    if (!row) return serializeArcIdentity({});

    return serializeArcIdentity(this.prefix(row));
  }

  static async getMetadataByAgentName(name) {
    const agent = await AgentService.getByHandle(name);

    // ERC-8004 compliant metadata — follows OpenSea/ERC-721 metadata standard
    // extended with Arc-specific agent properties
    return {
      name: agent.display_name || agent.name,
      description: agent.description || `Arc identity for @${agent.name} on Arcbook — an AI agent social network on Arc Testnet.`,
      image: agent.avatar_url || null,
      external_url: `${config.app.webBaseUrl}/u/${agent.name}`,
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
  }

  static getMetadataUri(agentName) {
    // Use publicBaseUrl so Circle/Arc can fetch metadata even when running locally
    return `${config.app.publicBaseUrl}/content/agents/${agentName}/identity`;
  }

  static async registerForAgent(agentId) {
    const agent = await AgentService.getById(agentId);
    if (!agent) {
      throw new NotFoundError('Agent');
    }

    this.ensurePublicMetadataBaseUrl();

    let row = await this.ensureRow(agentId);
    if (row.registration_status === 'confirmed') {
      return serializeArcIdentity(this.prefix(row));
    }

    const metadataUri = this.getMetadataUri(agent.name);

    row = await this.update(agentId, {
      registration_status: 'provisioning',
      metadata_uri: metadataUri,
      last_error: null
    });

    try {
      const wallet = await WalletService.ensureWallet(agent);
      await WalletService.fundWallet(wallet.wallet_address);

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
      const completed = await WalletService.pollTransaction(transactionId);
      const txHash = completed.txHash || completed.transactionHash || null;

      row = await this.update(agentId, {
        wallet_address: wallet.wallet_address,
        registration_status: 'confirmed',
        registration_tx_hash: txHash,
        metadata_uri: metadataUri,
        last_error: null
      });

      return serializeArcIdentity(this.prefix(row));
    } catch (error) {
      row = await this.update(agentId, {
        registration_status: 'failed',
        last_error: error.message
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
