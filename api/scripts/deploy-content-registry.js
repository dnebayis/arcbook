const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  initiateDeveloperControlledWalletsClient
} = require('@circle-fin/developer-controlled-wallets');
const {
  initiateSmartContractPlatformClient
} = require('@circle-fin/smart-contract-platform');

const repoRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(__dirname, '..', '.env');

require('dotenv').config({ path: envPath });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function buildContract() {
  const result = spawnSync('forge', ['build', '--root', repoRoot], {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error('forge build failed');
  }
}

function readArtifact() {
  const artifactPath = path.join(
    repoRoot,
    'contracts',
    'out',
    'ArcbookContentRegistry.sol',
    'ArcbookContentRegistry.json'
  );

  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

function updateEnv(address) {
  const contents = fs.readFileSync(envPath, 'utf8');
  const next = contents.match(/^ARC_CONTENT_REGISTRY_ADDRESS=.*$/m)
    ? contents.replace(/^ARC_CONTENT_REGISTRY_ADDRESS=.*$/m, `ARC_CONTENT_REGISTRY_ADDRESS=${address}`)
    : `${contents}\nARC_CONTENT_REGISTRY_ADDRESS=${address}\n`;

  fs.writeFileSync(envPath, next);
}

function writeDeploymentReceipt(contract) {
  const dir = path.join(repoRoot, 'contracts', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'arc-testnet-content-registry.json'),
    JSON.stringify(
      {
        deployedAt: new Date().toISOString(),
        contractId: contract.id,
        address: contract.contractAddress,
        blockchain: contract.blockchain,
        status: contract.status,
        deployerAddress: contract.deployerAddress
      },
      null,
      2
    )
  );
}

async function pollContract(scpClient, contractId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const response = await scpClient.getContract({ id: contractId });
    const contract = response.data?.contract || response.data || null;
    const status = contract?.status;

    console.log(`contract status: ${status || 'UNKNOWN'}`);

    if (status === 'COMPLETE') {
      return contract;
    }

    if (status === 'FAILED') {
      throw new Error(
        `deployment failed: ${contract?.deploymentErrorReason || 'unknown'} ${contract?.deploymentErrorDetails || ''}`.trim()
      );
    }
  }

  throw new Error('timed out while waiting for deployment');
}

async function main() {
  const apiKey = required('CIRCLE_API_KEY');
  const entitySecret = required('CIRCLE_ENTITY_SECRET');
  const walletId = required('CIRCLE_TREASURY_WALLET_ID');
  const blockchain = process.env.ARC_BLOCKCHAIN || 'ARC-TESTNET';

  console.log('Building ArcbookContentRegistry with Foundry...');
  buildContract();

  const artifact = readArtifact();
  const abi = artifact.abi;
  const bytecode = artifact.bytecode?.object?.startsWith('0x')
    ? artifact.bytecode.object
    : `0x${artifact.bytecode.object}`;

  const walletsClient = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret
  });

  const scpClient = initiateSmartContractPlatformClient({
    apiKey,
    entitySecret
  });

  console.log('Checking treasury wallet balance...');
  const balance = await walletsClient.getWalletTokenBalance({ id: walletId }).catch(() => null);
  if (balance?.data?.tokenBalances) {
    console.log(JSON.stringify(balance.data.tokenBalances, null, 2));
  }

  console.log('Deploying unaudited custom bytecode to Arc Testnet...');
  const deployment = await scpClient.deployContract({
    name: 'ArcbookContentRegistry',
    description: 'Arcbook content anchor registry for posts and comments',
    blockchain,
    walletId,
    abiJson: JSON.stringify(abi),
    bytecode,
    constructorParameters: [],
    fee: {
      type: 'level',
      config: { feeLevel: 'MEDIUM' }
    },
    idempotencyKey: crypto.randomUUID(),
    refId: `arcbook-content-registry-${Date.now()}`
  });

  const contractId = deployment.data?.contractId || deployment.contractId;
  if (!contractId) {
    throw new Error('Circle did not return a contractId');
  }

  console.log(`Deployment started. contractId=${contractId}`);
  const contract = await pollContract(scpClient, contractId);

  if (!contract.contractAddress) {
    throw new Error('Deployment completed without contract address');
  }

  updateEnv(contract.contractAddress);
  writeDeploymentReceipt(contract);

  console.log(`ArcbookContentRegistry deployed: ${contract.contractAddress}`);
  console.log(`Updated ${envPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
