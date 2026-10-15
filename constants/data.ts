import type { Principal, Resource } from "@cerbos/core";

// Demo principals and resources, for the policy in policies/resource.yaml.
export const principals: Principal[] = [
  { id: "alice", roles: ["USER"], attr: {} },
  { id: "sally", roles: ["USER"], attr: {} },
  { id: "ian", roles: ["ADMIN"], attr: {} },
];

export const resources: Resource[] = [
  {
    kind: "resource",
    id: "doc1",
    attr: { ownerId: "sally", status: "published" },
  },
  { kind: "resource", id: "doc2", attr: { ownerId: "alice", status: "draft" } },
  {
    kind: "resource",
    id: "doc3",
    attr: { ownerId: "admin", status: "published" },
  },
];
