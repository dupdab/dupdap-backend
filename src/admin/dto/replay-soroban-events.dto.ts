import { IsInt, Min } from 'class-validator';

export class ReplaySorobanEventsDto {
  @IsInt()
  @Min(1)
  fromLedger!: number;
}
