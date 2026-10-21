import { BadRequestException } from '@nestjs/common';

export class InvalidStateTransitionException extends BadRequestException {
  constructor(from: string, to: string) {
    super(`Invalid payment state transition: ${from} -> ${to}`);
  }
}
