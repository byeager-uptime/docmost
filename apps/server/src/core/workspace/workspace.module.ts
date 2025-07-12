import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { WorkspaceController } from './controllers/workspace.controller';
import { SpaceModule } from '../space/space.module';
import { WorkspaceInvitationService } from './services/workspace-invitation.service';
import { DocusaurusService } from './services/docusaurus.service';
import { TokenModule } from '../auth/token.module';
import { ExportModule } from '../../integrations/export/export.module';

@Module({
  imports: [SpaceModule, TokenModule, ExportModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService, DocusaurusService],
  exports: [WorkspaceService, DocusaurusService],
})
export class WorkspaceModule {}
