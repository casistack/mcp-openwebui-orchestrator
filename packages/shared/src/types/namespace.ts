export interface Namespace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isPublic: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNamespaceInput {
  name: string;
  description?: string;
  isPublic?: boolean;
  serverIds?: string[];
}

export interface UpdateNamespaceInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}
