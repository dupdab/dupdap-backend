import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto';

export function createOpenApiDocument(app: INestApplication, version: string) {
  const config = new DocumentBuilder().setTitle('DupDub API').setVersion(version)
    .setDescription('Crypto-to-Fiat settlement platform. Team sessions select a merchant using X-Merchant-ID.')
    .addBearerAuth().addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key').build();
  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorResponseDto] });
  for (const item of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      for (const status of [400, 401, 403, 404, 500]) {
        const existingResponse = operation.responses[status];
        operation.responses[status] = {
          description: existingResponse && 'description' in existingResponse ? existingResponse.description : 'Request failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponseDto' } } },
        };
      }
    }
  }
  return document;
}
