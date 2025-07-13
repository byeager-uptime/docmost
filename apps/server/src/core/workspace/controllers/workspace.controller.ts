import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from '../services/workspace.service';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { UpdateWorkspaceUserRoleDto } from '../dto/update-workspace-user-role.dto';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { WorkspaceInvitationService } from '../services/workspace-invitation.service';
import { Public } from '../../../common/decorators/public.decorator';
import {
  AcceptInviteDto,
  InvitationIdDto,
  InviteUserDto,
  RevokeInviteDto,
} from '../dto/invitation.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../casl/interfaces/workspace-ability.type';import { FastifyReply } from 'fastify';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { CheckHostnameDto } from '../dto/check-hostname.dto';
import { RemoveWorkspaceUserDto } from '../dto/remove-workspace-user.dto';
import { DocusaurusService } from '../services/docusaurus.service';
import { DocusaurusConfigDto } from '../dto/docusaurus-config.dto';
import { BrandingConfigDto, UpdateBrandingConfigDto } from '../dto/branding-config.dto';

@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceInvitationService: WorkspaceInvitationService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private environmentService: EnvironmentService,
    private readonly docusaurusService: DocusaurusService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/public')
  async getWorkspacePublicInfo(@Req() req: any) {
    return this.workspaceService.getWorkspacePublicData(req.raw.workspaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getWorkspace(@AuthWorkspace() workspace: Workspace) {
    return this.workspaceService.getWorkspaceInfo(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: UpdateWorkspaceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }

    const updatedWorkspace = await this.workspaceService.update(
      workspace.id,
      dto,
    );

    if (
      dto.hostname &&
      dto.hostname === updatedWorkspace.hostname &&
      workspace.hostname !== updatedWorkspace.hostname
    ) {
      // log user out of old hostname
      res.clearCookie('authToken');
    }

    return updatedWorkspace;
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  async getWorkspaceMembers(
    @Body()
    pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceService.getWorkspaceUsers(workspace.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/deactivate')
  async deactivateWorkspaceMember(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/delete')
  async deleteWorkspaceMember(
    @Body() dto: RemoveWorkspaceUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    await this.workspaceService.deleteUser(user, dto.userId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/change-role')
  async updateWorkspaceMemberRole(
    @Body() workspaceUserRoleDto: UpdateWorkspaceUserRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceService.updateWorkspaceUserRole(
      user,
      workspaceUserRoleDto,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites')
  async getInvitations(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body()
    pagination: PaginationOptions,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.getInvitations(
      workspace.id,
      pagination,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('invites/info')
  async getInvitationById(
    @Body() dto: InvitationIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.workspaceInvitationService.getInvitationById(
      dto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/create')
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.createInvitation(
      inviteUserDto,
      workspace,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/resend')
  async resendInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.resendInvitation(
      revokeInviteDto.invitationId,
      workspace,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/revoke')
  async revokeInvite(
    @Body() revokeInviteDto: RevokeInviteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }

    return this.workspaceInvitationService.revokeInvitation(
      revokeInviteDto.invitationId,
      workspace.id,
    );
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('invites/accept')
  async acceptInvite(
    @Body() acceptInviteDto: AcceptInviteDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const authToken = await this.workspaceInvitationService.acceptInvitation(
      acceptInviteDto,
      workspace,
    );

    res.setCookie('authToken', authToken, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/check-hostname')
  async checkHostname(@Body() checkHostnameDto: CheckHostnameDto) {
    return this.workspaceService.checkHostname(checkHostnameDto.hostname);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invites/link')
  async getInviteLink(
    @Body() inviteDto: InvitationIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (this.environmentService.isCloud()) {
      throw new ForbiddenException();
    }

    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
    ) {
      throw new ForbiddenException();
    }
    const inviteLink =
      await this.workspaceInvitationService.getInvitationLinkById(
        inviteDto.invitationId,
        workspace,
      );

    return { inviteLink };
  }

  // Docusaurus Integration Endpoints

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/config')
  async getDocusaurusConfig(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getDocusaurusConfig(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/config/update')
  async updateDocusaurusConfig(
    @Body() configDto: DocusaurusConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.updateDocusaurusConfig(workspace.id, configDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/validate')
  async validateDocusaurusSetup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.validateDocusaurusSetup(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/mappings')
  async getSpaceMappings(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getSpaceMappings(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/mappings/update')
  async updateSpaceMapping(
    @Body() body: { spaceId: string; mapping: any },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.updateSpaceMapping(
      workspace.id,
      body.spaceId,
      body.mapping
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/export')
  async exportToDocusaurus(
    @Body() body: { 
      contentId: string; 
      contentType: 'page' | 'space'; 
      options?: { includeChildren?: boolean; includeAttachments?: boolean }
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.exportContentToDocusaurus(
      workspace.id,
      body.contentId,
      body.contentType,
      body.options || {}
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/analyze')
  async analyzeContentForCategorization(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.suggestCategories(workspace.id);
  }

  // Phase 4: Automated Sync Endpoints

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/sync/manual')
  async triggerManualSync(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.triggerManualSync(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/sync/history')
  async getSyncHistory(
    @Body() body: { limit?: number },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getSyncHistory(workspace.id, body.limit || 10);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/sync/status')
  async getLastSyncStatus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getLastSyncStatus(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/sync/status/detailed')
  async getDetailedSyncStatus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getDetailedSyncStatus(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/sync/report')
  async generateSyncReport(
    @Body() body: { syncId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getSyncReport(workspace.id, body.syncId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/pages')
  async getAvailablePages(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.getAvailablePagesForLanding(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('docusaurus/landing-page')
  async setLandingPage(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.setLandingPage(workspace.id, body.pageId);
  }

  // Branding Configuration Endpoints

  @HttpCode(HttpStatus.OK)
  @Post('branding/config')
  async getBrandingConfig(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    const currentSettings = (workspace?.settings as any) || {};
    const defaultConfig = {
      logo: workspace.logo || null,
      siteName: workspace.name,
      hideSiteName: false,
      navigationLinks: [],
      showDocmostBranding: true,
    };
    
    // Merge saved config with defaults to ensure all fields are present
    const savedConfig = currentSettings.brandingConfig || {};
    return {
      ...defaultConfig,
      ...savedConfig,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('branding/config/update')
  async updateBrandingConfig(
    @Body() body: BrandingConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    const currentSettings = (workspace?.settings as any) || {};
    const updatedSettings = {
      ...currentSettings,
      brandingConfig: body,
    };

    // Also update the workspace logo field for backwards compatibility
    const updateData: any = {
      settings: updatedSettings,
    };

    if (body.logo) {
      updateData.logo = body.logo;
    }

    await this.workspaceService.update(workspace.id, updateData);

    // Apply branding to Docusaurus if it's enabled
    try {
      const docusaurusConfig = await this.docusaurusService.getDocusaurusConfig(workspace.id);
      if (docusaurusConfig && docusaurusConfig.enabled) {
        await this.docusaurusService.applyBrandingToDocusaurus(workspace.id);
      }
    } catch (error) {
      // Log the error but don't fail the branding config update
      console.error('Failed to apply branding to Docusaurus:', error);
    }

    return body;
  }

  @HttpCode(HttpStatus.OK)
  @Post('branding/apply')
  async applyBrandingToDocusaurus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }

    return await this.docusaurusService.applyBrandingToDocusaurus(workspace.id);
  }
}
