export type UserRole = 'admin' | 'operator' | 'user' | 'viewer';

export interface User {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
  image?: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  id: string;
  name: UserRole;
  description?: string;
  isSystem: boolean;
  createdAt: Date;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'execute';
  description?: string;
}
