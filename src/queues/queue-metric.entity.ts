import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('queue_metrics')
export class QueueMetric {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ type: 'int', default: 0 }) completed: number;
  @Column({ type: 'int', default: 0 }) failed: number;
  @Column({ type: 'int', default: 0 }) waiting: number;
  @Column({ type: 'int', default: 0 }) active: number;
  @CreateDateColumn() createdAt: Date;
}
