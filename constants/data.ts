import type { Principal, Resource } from "@cerbos/core";

// Define available principals
export const principals: Principal[] = [
  { id: "alice", roles: ["USER"], attr: {} },
  { id: "sally", roles: ["USER"], attr: {} },
  { id: "ian", roles: ["ADMIN"], attr: {} },
];

// Define available resources
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
