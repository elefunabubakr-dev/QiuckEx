import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ManifestsService } from './manifests.service';
import { CompareManifestsDto } from './dto/manifest-diff.dto';
import { RateLimitTier } from '../auth/decorators/rate-limit-group.decorator';

@Controller('manifests')
export class ManifestsController {
  constructor(private readonly manifestsService: ManifestsService) {}

  @Post('diff')
  @RateLimitTier('mutation')
  @HttpCode(200)
  compareManifests(@Body() compareDto: CompareManifestsDto) {
    return this.manifestsService.diffManifests(
      compareDto.baseManifest,
      compareDto.targetManifest,
    );
  }
}
