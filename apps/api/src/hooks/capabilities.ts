import type { Role } from '../modules/users/repository';

// Single source of truth for the role → capability matrix (design §2, §4.1).
// Routes reference these named sets; they never inline role literals.
export const CAN_READ_FEATURES: readonly Role[] = ['admin', 'editor', 'viewer'];
// Admin only (supervisor feedback 2026-09-17): "chỉ admin mới có quyền cập nhật,
// người dùng readonly". `editor` keeps its enum value so existing accounts still
// log in, but it grants nothing beyond `viewer`.
export const CAN_WRITE_FEATURES: readonly Role[] = ['admin'];
export const CAN_MANAGE_USERS: readonly Role[] = ['admin'];
