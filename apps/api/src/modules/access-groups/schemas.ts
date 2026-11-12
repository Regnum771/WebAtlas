import { z } from 'zod';
import { PERMISSIONS, UNIT_CODE_RE } from '@webatlas/shared';

const Name = z.string().trim().min(1).max(200);
const Description = z.string().max(2000);
const Units = z.array(z.string().regex(UNIT_CODE_RE)).min(1);
const Permissions = z.array(z.enum(PERMISSIONS)).min(1);

export const CreateGroupBody = z.object({
  name: Name,
  description: Description.optional(),
  units: Units,
  permissions: Permissions,
});
export const UpdateGroupBody = z.object({
  name: Name.optional(),
  description: Description.nullable().optional(),
  units: Units.optional(),
  permissions: Permissions.optional(),
});
export const GroupIdParams = z.object({ id: z.string().uuid() });
export const SetUserGroupsBody = z.object({ groupIds: z.array(z.string().uuid()) });
