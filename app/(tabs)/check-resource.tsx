import type { CheckResourceRequest } from "@cerbos/core";

import { useCerbos } from "@/components/CerbosContext";
import { RpcScreen } from "@/components/demo/RpcScreen";

const defaultRequest: Omit<CheckResourceRequest, "requestId"> = {
  principal: {
    id: "alice",
    roles: ["USER"],
    attr: { department: "IT" },
  },
  resource: {
    kind: "resource",
    id: "doc2",
    attr: { ownerId: "alice", status: "draft" },
  },
  actions: ["create", "read", "update", "delete", "publish"],
  includeMetadata: true,
};

/**
 * Edit any `checkResource` request as JSON and run it. Useful for trying out
 * attributes, scopes, `includeMetadata` and `auxData` against your policies.
 */
export default function CheckResourceScreen() {
  const { checkResource } = useCerbos();

  return (
    <RpcScreen
      title="checkResource"
      description="Checks a principal's permissions on a single resource and returns the result, including the effect for each action and any outputs and validation errors."
      defaultRequest={defaultRequest}
      run={checkResource}
    />
  );
}
