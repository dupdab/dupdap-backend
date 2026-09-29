import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandPaymentNetworkEnum1772200000003 implements MigrationInterface {
  name = 'ExpandPaymentNetworkEnum1772200000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The multi-chain PaymentNetwork values (polygon, base, celo, arbitrum,
    // optimism, starknet, stacks) were removed from the PaymentNetwork enum
    // because no EVM/ethers.js integration exists in this codebase. This
    // migration is intentionally a no-op so migration ordering stays intact
    // and it no longer adds dead enum values to the Postgres type.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values; down is a no-op
  }
}
