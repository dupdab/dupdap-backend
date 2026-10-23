import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetApiKeyIpAllowlistDto {
  @ApiProperty({
    type: [String],
    description:
      'IPv4/IPv6 CIDR ranges or bare IP addresses allowed to use the API key. An empty array removes the restriction.',
    example: ['203.0.113.0/24', '2001:db8::/32'],
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  cidrs: string[];
}
