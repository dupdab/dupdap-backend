import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('soroban_indexer_cursors')
export class SorobanIndexerCursor {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  ledger!: number;
}
