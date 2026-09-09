import {
  useCerbos,
  type PlanResourcesRequestInput,
} from "@/components/CerbosContext";
import { RpcScreen } from "@/components/demo/RpcScreen";

const defaultRequest: PlanResourcesRequestInput = {
  principal: {
    id: "alice",
    roles: ["USER"],
    attr: { department: "IT" },
  },
  resource: {
    kind: "resource",
  },
  action: "update",
  includeMetadata: true,
};

/**
 * Edit any `planResources` request as JSON and run it. The response is a
 * query plan: always allowed, always denied, or a condition (an expression
 * tree) to apply when listing resources.
 */
export default function PlanResourcesScreen() {
  const { planResources } = useCerbos();

  return (
    <RpcScreen
      title="planResources"
      description="Produces a query plan describing which resources of a kind the principal may perform an action on, for filtering lists without checking each item."
      defaultRequest={defaultRequest}
      run={planResources}
    />
  );
}
