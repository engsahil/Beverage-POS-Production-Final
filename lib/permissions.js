// Simple permission model on top of the existing roles.
// Admins implicitly hold every permission. Cashiers hold only
// explicitly granted ones (user_permissions table).
// Authorization is always enforced server-side in the API routes.

export const PERMISSIONS = [
  'discount',
  'price_override',
  'stock_adjustment',
  'customer_credit',
  'reports',
  'reprint',
  'customer_management',
];

export const PERMISSION_LABELS = {
  discount: 'Apply discounts',
  price_override: 'Price override (below minimum price)',
  stock_adjustment: 'Adjust stock',
  customer_credit: 'Customer credit & recovery',
  reports: 'View reports',
  reprint: 'Open any sale / reprint receipt',
  customer_management: 'Manage customers',
};

/** user.permissions is an array (empty for users with none). */
export function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export function permissionListFor(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSIONS];
  return Array.isArray(user.permissions) ? user.permissions : [];
}
