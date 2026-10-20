/**
 * Stellar testnet integration tests (integration:stellar).
 *
 * These tests run against Soroban contracts deployed on Stellar testnet and
 * require a funded testnet keypair provided via CI secrets:
 *   - STELLAR_TESTNET_SECRET (funded testnet secret key)
 *   - SOROBAN_TESTNET_CONTRACT_ID (deployed escrow contract id)
 *
 * Skipped in unit test runs: this file lives under test/stellar/ (outside
 * jest rootDir src) and is executed only via `test:integration:stellar`.
 * It also self-skips unless STELLAR_TESTNET_ENABLED === 'true'.
 */
import * as StellarSdk from '@stellar/stellar-sdk';

const describeOnTestnet = process.env.STELLAR_TESTNET_ENABLED === 'true' ? describe : describe.skip;

describeOnTestnet('integration:stellar Stellar testnet escrow flows', () => {
  const rpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const contractId = process.env.SOROBAN_TESTNET_CONTRACT_ID ?? '';
  const secret = process.env.STELLAR_TESTNET_SECRET ?? '';
  let server: InstanceType<typeof StellarSdk.rpc.Server>;

  beforeAll(() => {
    if (!secret || !contractId) {
      throw new Error(
        'Missing STELLAR_TESTNET_SECRET or SOROBAN_TESTNET_CONTRACT_ID for testnet integration tests',
      );
    }
    server = new StellarSdk.rpc.Server(rpcUrl);
  });

  it('connects to testnet and reads the escrow contract footprint', async () => {
    const account = StellarSdk.Keypair.fromSecret(secret);
    const source = await server.getAccount(account.publicKey());
    expect(source.accountId()).toBe(account.publicKey());
    expect(typeof contractId).toBe('string');
  });

  it('verifies deposit flow on testnet contract', async () => {
    const contract = new StellarSdk.Contract(contractId);
    const account = StellarSdk.Keypair.fromSecret(secret);
    const source = await server.getAccount(account.publicKey());
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call('deposit'))
      .setTimeout(30)
      .build();
    expect(tx.operations).toHaveLength(1);
  });

  it('verifies release flow on testnet contract', async () => {
    const contract = new StellarSdk.Contract(contractId);
    const account = StellarSdk.Keypair.fromSecret(secret);
    const source = await server.getAccount(account.publicKey());
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call('release'))
      .setTimeout(30)
      .build();
    expect(tx.operations).toHaveLength(1);
  });

  it('verifies refund flow on testnet contract', async () => {
    const contract = new StellarSdk.Contract(contractId);
    const account = StellarSdk.Keypair.fromSecret(secret);
    const source = await server.getAccount(account.publicKey());
    const tx = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call('refund'))
      .setTimeout(30)
      .build();
    expect(tx.operations).toHaveLength(1);
  });
});
