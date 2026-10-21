import { HttpStatus } from '@nestjs/common';

export class SorobanRpcException extends Error {
  constructor(
    message: string,
    public readonly sorobanCode?: string,
    public readonly statusCode: number = HttpStatus.BAD_GATEWAY,
    public readonly rpcMethod?: string,
    public readonly rpcParams?: unknown,
  ) {
    super(message);
    this.name = 'SorobanRpcException';
  }
}
