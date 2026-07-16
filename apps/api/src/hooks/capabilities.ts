import type { Role } from '../modules/users/repository';

// Single source of truth for the role → capability matrix (design §2, §3.1).
// Routes reference these named sets; they never inline role literals.
export const CAN_READ_FEATURES: readonly Role[] = ['admin', 'editor', 'viewer'];
export const CAN_WRITE_FEATURES: readonly Role[] = ['admin', 'editor'];
export const CAN_MANAGE_USERS: readonly Role[] = ['admin'];
